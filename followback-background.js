/* Thirty-minute reads; never schedule a follow. Every follow requires CONFIRM. */
(() => {
  'use strict';
  const F = globalThis.MagpieFollowback, C = globalThis.MagpieReply, KEY = 'followbackState', ALARM = 'magpie-followback-scan';
  function create({ getSettings, now = () => Date.now() }) {
    let running = null, queue = Promise.resolve();
    const failure = (code, text) => new C.ReplyError(code, text);
    async function read(owner) { return F.state((await chrome.storage.local.get(KEY))[KEY], owner, now()); }
    function change(owner, edit) {
      const task = queue.catch(() => {}).then(async () => {
        const settings = await getSettings();
        if (settings.followbackAccount !== owner) throw failure('FOLLOWBACK_ACCOUNT', '已切换名单所属账号，请刷新设置。');
        const value = await read(owner), result = edit(value);
        await chrome.storage.local.set({ [KEY]: value }); return result ?? value;
      });
      queue = task; return task;
    }
    async function enabled(owner) {
      const settings = await getSettings();
      if (!settings.followbackEnabled || settings.followbackAccount !== owner) throw failure('FOLLOWBACK_CANCELLED', '定期名单已关闭或绑定账号已更改。');
      return settings;
    }
    async function close(job) {
      if (!job?.tabId) return;
      await chrome.tabs.sendMessage(job.tabId, { type: 'FOLLOWBACK_CANCEL_PAGE', token: job.token }).catch(() => {});
      const tab = await chrome.tabs.get(job.tabId).catch(() => null);
      // Do not close a temporary tab the user has opened to inspect or solve a challenge.
      if (tab && !tab.active) await chrome.tabs.remove(job.tabId).catch(() => {});
    }
    async function page(job, url, message) {
      await enabled(job.account);
      const tab = await chrome.tabs.create({ url, active: false }); job.tabId = tab.id;
      const until = now() + 15000;
      while (now() < until) {
        await enabled(job.account);
        if (job.cancelled) throw failure('FOLLOWBACK_CANCELLED', '已取消本次操作。');
        let response;
        try { response = await chrome.tabs.sendMessage(tab.id, { type: 'FOLLOWBACK_ACCOUNT' }); }
        catch { await new Promise(resolve => setTimeout(resolve, 300)); continue; }
        if (!response) { await new Promise(resolve => setTimeout(resolve, 300)); continue; }
        // Readiness probes can retry. The actual scan/confirmed follow is sent once.
        await enabled(job.account);
        const result = await chrome.tabs.sendMessage(tab.id, { ...message, account: job.account, token: job.token });
        if (!result?.ok) {
          const error = failure(result?.error?.code || 'FOLLOWBACK_UNCERTAIN', result?.error?.message || '未确认操作结果，请打开资料核实。');
          if (result?.error && typeof result.error.clicked === 'boolean') error.clicked = result.error.clicked;
          throw error;
        }
        return result.data;
      }
      throw failure('FOLLOWBACK_SOURCE', 'X 页面未能载入，请在登录 X 后重试。');
    }
    async function run(owner, action) {
      if (running) throw failure('FOLLOWBACK_BUSY', '正在整理或确认回关，请稍候。');
      const job = { account: owner, token: crypto.randomUUID(), tabId: null, cancelled: false }; running = job;
      try { await change(owner, value => { value.busy = true; }); return await action(job); }
      finally {
        await close(job);
        await change(owner, value => { value.busy = false; }).catch(() => {});
        if (running === job) running = null;
      }
    }
    async function noteError(owner, error) {
      await change(owner, value => {
        value.notice = error.code?.startsWith('FOLLOWBACK_') ? error.message : '操作未确认，请先在 X 检查。';
        if (['FOLLOWBACK_BLOCKED', 'FOLLOWBACK_ACCOUNT'].includes(error.code)) value.paused = true;
      }).catch(() => {});
    }
    async function scan(manual = false) {
      const settings = await getSettings(), owner = settings.followbackAccount;
      if (!settings.followbackEnabled || !owner) return status();
      const initial = await read(owner);
      if (initial.paused && !manual) return status();
      try {
        await run(owner, async job => {
          await change(owner, value => { if (manual) value.paused = false; value.notice = '正在读取粉丝页，整理待回关名单…'; });
          const result = await page(job, `https://x.com/${owner}/followers`, { type: 'FOLLOWBACK_SCAN_PAGE', ignored: initial.ignored });
          await enabled(owner);
          if (result?.account !== owner || !Array.isArray(result.items)) throw failure('FOLLOWBACK_SOURCE', '粉丝页返回的账号不匹配，未更新名单。');
          await change(owner, value => {
            const uncertain = new Set(value.items.filter(row => ['confirming', 'uncertain'].includes(row.status)).map(row => row.account));
            value.items = [...new Map(result.items.map(F.item).filter(Boolean).filter(row => row.account !== owner && !value.ignored.includes(row.account)).map(row => [row.account, { ...row, status: uncertain.has(row.account) ? 'uncertain' : 'pending' }])).values()].slice(0, F.LIMIT);
            value.checkedAt = now(); value.scanned = Number.isSafeInteger(result.scanned) ? Math.max(0, result.scanned) : 0; value.partial = result.partial !== false;
            value.notice = `已查看 ${value.scanned} 位粉丝，找到 ${value.items.length} 位待确认${value.partial ? '；未遍历全部粉丝' : ''}。每人需单独确认。`;
          });
          return status();
        });
        return status();
      } catch (error) { await noteError(owner, error); throw error; }
    }
    async function confirm(target) {
      const settings = await getSettings(), owner = settings.followbackAccount, name = F.account(target);
      await enabled(owner);
      await run(owner, async job => {
        await change(owner, value => {
          const item = value.items.find(row => row.account === name);
          if (value.paused) throw failure('FOLLOWBACK_BLOCKED', '任务已暂停，请先处理 X 的提示，再点击立即检查。');
          if (!item || item.status !== 'pending') throw failure('FOLLOWBACK_STALE', '这条候选已处理或状态不确定，请重新检查名单。');
          if (value.confirmed >= F.LIMIT) throw failure('FOLLOWBACK_LIMIT', '本半小时已确认 5 人，请等下一轮再处理。');
          if (now() < value.nextAllowedAt) throw failure('FOLLOWBACK_COOLDOWN', `请再等 ${Math.ceil((value.nextAllowedAt - now()) / 1000)} 秒再确认下一位。`);
          item.status = 'confirming'; value.notice = `正在确认 @${name} 的当前关注关系…`;
        });
        try {
          const result = await page(job, `https://x.com/${name}`, { type: 'FOLLOWBACK_CONFIRM_PAGE', target: name });
          await enabled(owner);
          const state = ['followed', 'requested'].includes(result?.status) ? result.status : 'uncertain';
          await change(owner, value => {
            const item = value.items.find(row => row.account === name); if (item) item.status = state;
            value.confirmed++; value.nextAllowedAt = now() + F.GAP;
            value.notice = state === 'followed' ? `已回关 @${name}。` : state === 'requested' ? `已向 @${name} 发送关注请求，等待对方批准。` : `未确认 @${name} 的结果，请打开资料核实，插件不会自动重试。`;
          });
          return status();
        } catch (error) {
          await change(owner, value => {
            const item = value.items.find(row => row.account === name);
            if (item) item.status = error.clicked === false ? 'pending' : 'uncertain';
            if (error.clicked !== false) value.confirmed++;
            value.nextAllowedAt = now() + F.GAP;
          }).catch(() => {});
          await noteError(owner, error); throw error;
        }
      });
      return status();
    }
    async function status() {
      const settings = await getSettings(), value = await read(settings.followbackAccount);
      const alarm = await chrome.alarms.get(ALARM);
      return { ...value, enabled: settings.followbackEnabled, busy: Boolean(running), nextAt: alarm?.scheduledTime || 0, limit: F.LIMIT, gap: F.GAP };
    }
    async function ignore(target) {
      const settings = await getSettings(), name = F.account(target);
      if (running) throw failure('FOLLOWBACK_BUSY', '当前操作完成后才能忽略。');
      await change(settings.followbackAccount, value => { value.items = value.items.filter(row => row.account !== name); value.ignored = [...new Set([...value.ignored, name])].filter(Boolean).slice(-500); });
      return status();
    }
    async function configure(previous, next) {
      const changed = previous.followbackEnabled !== next.followbackEnabled || previous.followbackAccount !== next.followbackAccount;
      if (changed && running) { running.cancelled = true; await close(running); }
      if (!next.followbackEnabled) { await chrome.alarms.clear(ALARM); return; }
      if (changed || !await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM, { when: now() + (changed ? 1000 : F.PERIOD), periodInMinutes: 30 });
    }
    async function identify() {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const selected = tabs.find(tab => C.xURL(tab.url));
      if (!selected) throw failure('FOLLOWBACK_ACCOUNT', '请先切到已登录的 X 页面，再点击识别账号。');
      const result = await chrome.tabs.sendMessage(selected.id, { type: 'FOLLOWBACK_ACCOUNT' });
      const account = F.account(result?.data?.account);
      if (!result?.ok || !account) throw failure('FOLLOWBACK_ACCOUNT', '未识别当前账号，请先登录 X，更新扩展后需刷新 X。');
      return { account };
    }
    chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void scan(false).catch(() => {}); });
    const ready = (async () => {
      const settings = await getSettings();
      await change(settings.followbackAccount, value => {
        value.busy = false;
        for (const item of value.items) if (item.status === 'confirming') {
          item.status = 'uncertain'; value.confirmed = Math.min(F.LIMIT, value.confirmed + 1);
          value.nextAllowedAt = Math.max(value.nextAllowedAt, now() + F.GAP);
        }
      });
      await configure(settings, settings);
    })();
    ready.catch(() => {});
    return { ready, status, scan, confirm, ignore, configure, identify };
  }
  globalThis.MagpieFollowbackBackground = Object.freeze({ create });
})();
