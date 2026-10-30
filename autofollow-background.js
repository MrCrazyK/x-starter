/* Opt-in automatic follows: persisted queue, per-account limits and one-shot actions. */
(() => {
  'use strict';
  const A = globalThis.MagpieAutoFollow, C = globalThis.MagpieReply;
  const KEY = 'autoFollowState', SESSION = 'autoFollowTab', ALARM = 'x-starter-auto-follow';
  const SEARCH = 'https://x.com/search?q=' + encodeURIComponent('"蓝v互关"') + '&src=typed_query&f=live';
  function create({ getSettings, now = () => Date.now(), random = Math.random, timers = { setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: id => clearTimeout(id) } }) {
    let accounts = [], running = null, draining = false, timer = null, generation = 0, writes = Promise.resolve();
    const failure = (code, message) => new C.ReplyError('AUTOFOLLOW_' + code, message);
    const persist = () => {
      const snapshot = JSON.parse(JSON.stringify({ accounts }));
      writes = writes.catch(() => {}).then(() => chrome.storage.local.set({ [KEY]: snapshot })); return writes;
    };
    function ownerState(owner, settings) {
      if (!owner) return A.state(null, '', settings, now());
      let index = accounts.findIndex(row => row.account === owner);
      if (index < 0) { if (accounts.length >= 50) throw failure('LIMIT', '已保存 50 个账号的执行记录，请先导出并清理扩展数据。'); index = accounts.push({ account: owner }) - 1; }
      return accounts[index] = A.state(accounts[index], owner, settings, now());
    }
    function log(value, item, status, reason = '') {
      value.history.push({ ...item, status, reason: String(reason).slice(0, 180), at: now() }); value.history = value.history.slice(-500);
      if (['uncertain', 'interrupted'].includes(status) && !value.uncertain.includes(item.account)) value.uncertain.push(item.account);
    }
    async function close(job) {
      const id = job?.tabId;
      if (!Number.isInteger(id)) return;
      await chrome.tabs.sendMessage(id, { type: 'AUTOFOLLOW_CANCEL_PAGE', token: job.token }).catch(() => {});
      const tab = await chrome.tabs.get(id).catch(() => null);
      if (tab && !job.touched && !tab.active && sameURL(tab.url, job.url)) await chrome.tabs.remove(id).catch(() => {});
      const saved = (await chrome.storage.session.get(SESSION))[SESSION];
      if (saved?.token === job.token && saved.tabId === id) await chrome.storage.session.remove(SESSION);
      if (job.tabId === id) job.tabId = null;
    }
    function sameURL(left, right) {
      const a = C.xURL(left), b = C.xURL(right);
      return Boolean(a && b && a.pathname.replace(/\/$/u, '').toLowerCase() === b.pathname.replace(/\/$/u, '').toLowerCase() && a.search === b.search);
    }
    async function active(job) {
      const settings = await getSettings();
      if (job.cancelled || job.generation !== generation || !settings.autoFollowEnabled || settings.autoFollowAccount !== job.account) throw failure('CANCELLED', '自动关注已关闭、暂停或更换了配置。');
      if (ownerState(job.account, settings).paused) throw failure('CANCELLED', '自动关注已暂停。');
      return settings;
    }
    async function page(job, url, message) {
      await active(job); job.url = url; job.dispatched = false; job.touched = false;
      const tab = await chrome.tabs.create({ url, active: false }); job.tabId = tab.id;
      await chrome.storage.session.set({ [SESSION]: { tabId: tab.id, token: job.token, url, account: job.account, touched: false } });
      try {
        const until = Date.now() + 14000;
        while (Date.now() < until) {
          await active(job);
          const current = await chrome.tabs.get(tab.id).catch(() => null);
          if (!current) throw failure('SOURCE', '临时页面已关闭，本次操作停止。');
          if (current.url && /^\/(?:i\/flow\/login|login|account\/access)(?:\/|$)/u.test(C.xURL(current.url)?.pathname || '')) throw failure('BLOCKED', 'X 需要登录或验证，自动关注已暂停。');
          let response;
          try { response = await chrome.tabs.sendMessage(tab.id, { type: 'AUTOFOLLOW_READY' }); } catch { /* Only readiness probes may retry. */ }
          if (!response?.ok) { await new Promise(resolve => setTimeout(resolve, 250)); continue; }
          const loaded = await chrome.tabs.get(tab.id).catch(() => null);
          if (!sameURL(loaded?.url, url)) throw failure('SOURCE', '临时页面地址已变化，本次操作停止。');
          await active(job);
          job.phase = message.type === 'AUTOFOLLOW_FOLLOW_PAGE' ? 'follow' : 'scan';
          job.dispatched = job.phase === 'follow';
          const result = await chrome.tabs.sendMessage(tab.id, { ...message, account: job.account, token: job.token });
          if (!result?.ok) {
            const error = failure((result?.error?.code || 'AUTOFOLLOW_UNCERTAIN').replace(/^AUTOFOLLOW_/u, ''), result?.error?.message || '页面未确认操作结果，请先核实。');
            if (typeof result?.error?.clicked === 'boolean') error.clicked = result.error.clicked;
            throw error;
          }
          return result.data;
        }
        throw failure('SOURCE', 'X 页面未能加载，自动关注已暂停。');
      } finally { await close(job); }
    }
    async function authorize(message, sender) {
      await ready;
      const job = running;
      if (!job || job.phase !== 'follow' || !job.dispatched || job.authorized || job.token !== message.token || job.account !== message.account || job.target !== A.account(message.target) || sender.tab?.id !== job.tabId || sender.frameId !== 0) return { allowed: false };
      const settings = await active(job), value = ownerState(job.account, settings), flight = value.inFlight;
      const tab = await chrome.tabs.get(job.tabId).catch(() => null);
      if (!flight || flight.account !== job.target || job.touched || !tab || tab.active || !sameURL(tab.url, `https://x.com/${job.target}`)) return { allowed: false };
      // A page opened just before midnight/a round boundary must reserve the
      // actual execution day's/round's allowance before its button can be used.
      if (flight.reservedDay !== value.dayAt) { value.dayUsed++; flight.reservedDay = value.dayAt; }
      if (flight.reservedRound !== value.roundAt) { value.roundUsed++; flight.reservedRound = value.roundAt; }
      if (value.dayUsed > settings.autoFollowDaily || value.roundUsed > settings.autoFollowPerRound) return { allowed: false };
      job.authorized = true; await persist();
      await active(job);
      return { allowed: true };
    }
    async function refill(job, settings) {
      let value = ownerState(job.account, settings);
      value.checkedRound = true; value.refills++; value.notice = '正在优先读取蓝 V 粉丝，补充候选队列…'; await persist();
      const omitted = A.excluded(value, now());
      const followers = await page(job, `https://x.com/${job.account}/followers`, { type: 'AUTOFOLLOW_SCAN_PAGE', source: 'followers', limit: A.TARGET,
        exclude: [...new Set([...omitted, ...value.queue.filter(row => row.source === 'followers').map(row => row.account)])] });
      await active(job); value = ownerState(job.account, settings);
      if (followers?.account !== job.account || followers.source !== 'followers' || !Array.isArray(followers.items)) throw failure('SOURCE', '粉丝页身份或候选格式不匹配。');
      value.queue = A.merge(value.queue, followers.items.filter(row => row.source === 'followers'), A.excluded(value, now()), job.account, now()); await persist();
      if (value.queue.length < A.TARGET) {
        value.notice = '粉丝候选不足，正在搜索“蓝v互关”…'; await persist();
        const found = await page(job, SEARCH, { type: 'AUTOFOLLOW_SCAN_PAGE', source: 'search', limit: A.TARGET - value.queue.length,
          exclude: [...new Set([...A.excluded(value, now()), ...value.queue.map(row => row.account)])] });
        await active(job); value = ownerState(job.account, settings);
        if (found?.account !== job.account || found.source !== 'search' || !Array.isArray(found.items)) throw failure('SOURCE', '搜索页身份或候选格式不匹配。');
        value.queue = A.merge(value.queue, found.items.filter(row => row.source === 'search'), A.excluded(value, now()), job.account, now());
      }
      value.checkedAt = now(); value.notice = `队列 ${value.queue.length}/${A.TARGET} 人；蓝 V 粉丝优先，搜索候选在关注前核验数量。`;
      value.refillArmed = value.queue.length >= A.LOW;
      if (!value.queue.length) { value.idleUntil = value.roundAt + settings.autoFollowInterval * 60000; value.notice = '本轮未找到新候选，等待下一轮检查。'; }
      await persist();
    }
    function release(value, flight) {
      if (value.dayAt === flight.reservedDay) value.dayUsed = Math.max(0, value.dayUsed - 1);
      if (value.roundAt === flight.reservedRound) value.roundUsed = Math.max(0, value.roundUsed - 1);
    }
    async function follow(job, settings) {
      let value = ownerState(job.account, settings);
      const item = value.queue.shift(); if (!item) return;
      job.target = item.account; job.authorized = false;
      value.inFlight = { ...item, reservedDay: value.dayAt, reservedRound: value.roundAt };
      value.dayUsed++; value.roundUsed++; value.roundChecked++;
      value.notice = `正在核验并关注 @${item.account}…`; await persist();
      try {
        const result = await page(job, `https://x.com/${item.account}`, { type: 'AUTOFOLLOW_FOLLOW_PAGE', target: item.account, source: item.source });
        value = ownerState(job.account, settings);
        const flight = value.inFlight;
        if (!result || !['followed', 'requested', 'already', 'skipped', 'uncertain'].includes(result.status) || typeof result.clicked !== 'boolean') throw failure('UNCERTAIN', '未确认关注结果，请手动核实。');
        if (!result.clicked && flight) release(value, flight);
        log(value, item, result.status, result.reason || ''); value.inFlight = null;
        value.nextAllowedAt = Math.max(value.nextAllowedAt, now() + (result.clicked ? A.delay(random) : 1000));
        value.notice = result.status === 'followed' ? `已关注 @${item.account}。` : result.status === 'requested' ? `已向 @${item.account} 发送关注申请。` : result.reason || `已处理 @${item.account}。`;
        if (result.status === 'uncertain') { value.paused = true; value.notice += ' 任务已暂停，请核实后再恢复；此人不会自动重试。'; }
        await persist();
      } catch (error) {
        value = ownerState(job.account, settings);
        const flight = value.inFlight;
        if (flight) {
          const uncertain = job.dispatched && error.clicked !== false;
          if (!uncertain) release(value, flight);
          log(value, item, uncertain ? 'uncertain' : 'skipped', uncertain ? '操作中断，结果未确认，不会自动重试。' : error.message);
          value.inFlight = null; value.nextAllowedAt = Math.max(value.nextAllowedAt, now() + A.delay(random));
        }
        throw error;
      }
    }
    async function plan() {
      if (timer !== null) { timers.clearTimeout(timer); timer = null; }
      const settings = await getSettings();
      if (!settings.autoFollowEnabled || !settings.autoFollowAccount) { await chrome.alarms.clear(ALARM); return; }
      const value = ownerState(settings.autoFollowAccount, settings);
      if (value.paused || running) { await chrome.alarms.clear(ALARM); return; }
      const at = Math.max(now() + 250, A.nextAt(value, settings, now()));
      await chrome.alarms.create(ALARM, { when: at });
      // Short gaps use a worker timer; the persisted alarm recovers after sleep
      // or worker termination. Browser scheduling can delay, never accelerate it.
      if (at - now() <= 30000) timer = timers.setTimeout(() => { timer = null; void tick().catch(() => {}); }, Math.max(0, at - now()));
    }
    async function tick() {
      await ready;
      if (draining) return;
      draining = true;
      try { await step(); } finally { draining = false; }
    }
    async function step() {
      if (running) return;
      const settings = await getSettings();
      if (!settings.autoFollowEnabled || !settings.autoFollowAccount) { await plan(); return; }
      let value = ownerState(settings.autoFollowAccount, settings);
      if (value.paused || A.nextAt(value, settings, now()) > now()) { await plan(); return; }
      const job = { account: settings.autoFollowAccount, token: crypto.randomUUID(), tabId: null, generation, phase: '', cancelled: false, dispatched: false, touched: false };
      running = job;
      try {
        if ((!value.checkedRound || value.queue.length < A.LOW && value.refillArmed) && value.refills < 3) await refill(job, settings);
        else if (value.queue.length) await follow(job, settings);
        else { value.idleUntil = value.roundAt + settings.autoFollowInterval * 60000; value.notice = '本轮候选已处理，等待下一轮。'; await persist(); }
      } catch (error) {
        value = ownerState(job.account, settings);
        if (error.code !== 'AUTOFOLLOW_CANCELLED') { value.paused = true; value.notice = error.code?.startsWith('AUTOFOLLOW_') ? error.message : '操作中断，自动关注已暂停，请先检查 X。'; }
        await persist();
      } finally { await close(job); if (running === job) running = null; await plan(); }
    }
    async function status() {
      await ready;
      const settings = await getSettings(), value = ownerState(settings.autoFollowAccount, settings);
      const alarm = await chrome.alarms.get(ALARM);
      return { ...value, history: value.history.slice(-30).reverse(), enabled: settings.autoFollowEnabled, busy: Boolean(running),
        nextAt: settings.autoFollowEnabled && !value.paused ? alarm?.scheduledTime || A.nextAt(value, settings, now()) : 0,
        interval: settings.autoFollowInterval, perRound: settings.autoFollowPerRound, daily: settings.autoFollowDaily, target: A.TARGET };
    }
    async function pause() {
      await ready;
      const settings = await getSettings(), value = ownerState(settings.autoFollowAccount, settings);
      value.paused = true; value.notice = '已手动暂停自动关注。';
      if (running) { running.cancelled = true; await close(running); }
      await persist(); await plan(); return status();
    }
    async function resume() {
      await ready;
      if (running) throw failure('BUSY', '当前操作尚在结束，请稍后恢复。');
      const settings = await getSettings();
      if (!settings.autoFollowEnabled || !settings.autoFollowAccount) throw failure('CANCELLED', '请先开启自动关注、绑定账号并保存。');
      const value = ownerState(settings.autoFollowAccount, settings);
      value.paused = false; value.notice = '已恢复，保留本轮及今日用量，等待执行。';
      await persist(); await plan(); return status();
    }
    async function ignore(target) {
      await ready;
      const name = A.account(target), settings = await getSettings(), value = ownerState(settings.autoFollowAccount, settings);
      if (running?.target === name) throw failure('BUSY', '该账号正在处理，请先暂停任务。');
      if (name && !value.ignored.includes(name)) value.ignored.push(name);
      value.ignored = value.ignored.slice(-2000); value.queue = value.queue.filter(row => row.account !== name);
      await persist(); return status();
    }
    async function configure(previous, next) {
      await ready;
      const changed = ['autoFollowEnabled', 'autoFollowAccount', 'autoFollowInterval', 'autoFollowPerRound', 'autoFollowDaily'].some(key => previous[key] !== next[key]);
      if (changed) { generation++; if (running) { running.cancelled = true; await close(running); } }
      if (next.autoFollowEnabled && !previous.autoFollowEnabled && next.autoFollowAccount) {
        const value = ownerState(next.autoFollowAccount, next);
        if (!value.roundUsed && !value.roundChecked && !value.checkedRound) value.roundAt = now();
      }
      await persist(); await plan();
    }
    chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void tick().catch(() => {}); });
    chrome.tabs.onActivated?.addListener(({ tabId }) => {
      const job = running; if (!job || job.tabId !== tabId) return;
      job.touched = true; job.cancelled = true;
      void (async () => {
        await chrome.storage.session.set({ [SESSION]: { tabId, token: job.token, url: job.url, account: job.account, touched: true } });
        const settings = await getSettings(), value = ownerState(job.account, settings);
        value.paused = true; value.notice = '你打开了任务的临时页面，自动关注已暂停，页面为你保留。';
        await persist(); await close(job);
      })().catch(() => {});
    });
    const ready = (async () => {
      const saved = (await chrome.storage.local.get(KEY))[KEY], settings = await getSettings();
      accounts = (Array.isArray(saved?.accounts) ? saved.accounts : []).filter(row => A.account(row?.account) === row.account && row.account).slice(0, 50).map(row => A.state(row, row.account, settings, now()));
      for (const value of accounts) if (value.inFlight) {
        log(value, value.inFlight, 'interrupted', '后台中断，结果未确认，不会自动重试。'); value.inFlight = null;
        value.paused = true; value.nextAllowedAt = Math.max(value.nextAllowedAt, now() + 10000); value.notice = '上次关注中断，请核实执行记录后再恢复；该账号不会自动重试。';
      }
      const orphan = (await chrome.storage.session.get(SESSION))[SESSION];
      if (Number.isInteger(orphan?.tabId)) {
        const tab = await chrome.tabs.get(orphan.tabId).catch(() => null);
        if (tab && !tab.active && !orphan.touched && sameURL(tab.url, orphan.url)) await chrome.tabs.remove(tab.id).catch(() => {});
        await chrome.storage.session.remove(SESSION);
      }
      await persist(); await plan();
    })();
    ready.catch(() => {});
    return { ready, tick, status, pause, resume, ignore, configure, authorize };
  }
  globalThis.MagpieAutoFollowBackground = Object.freeze({ create });
})();
