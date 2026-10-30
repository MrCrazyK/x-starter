/* Single-file public-profile reads, bounded to 3 starts/minute across tabs/restarts. */
(() => {
  'use strict';
  const P = globalThis.MagpiePriority, KEY = 'priorityProfileCache', SESSION = 'priorityCollector', ALARM = 'magpie-priority-drain';
  function create({ getSettings, now = () => Date.now(), loadProfile, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let saved = P.state({}, now()), running = null, timer = null, writes = Promise.resolve(), stopped = false, draining = false;
    const interests = new Map();
    const failure = (code, message) => Object.assign(new Error(message), { code });
    const persist = () => { const value = structuredClone(saved); const task = writes.catch(() => {}).then(() => chrome.storage.local.set({ [KEY]: value })); writes = task; return task; };
    const cached = (name, viewer) => saved.records.find(row => row.account === name && row.viewer === viewer && P.fresh(row, now()));
    async function close(job) {
      if (!job?.tabId) return;
      await chrome.tabs.sendMessage(job.tabId, { type: 'PRIORITY_CANCEL_PAGE', token: job.token }).catch(() => {});
      const tab = await chrome.tabs.get(job.tabId).catch(() => null);
      if (tab && !job.touched && !tab.active && tab.url?.replace(/\/$/u, '').toLowerCase() === `https://x.com/${job.account}`) await chrome.tabs.remove(job.tabId).catch(() => {});
      const previous = (await chrome.storage.session.get(SESSION))[SESSION];
      if (previous?.tabId === job.tabId) await chrome.storage.session.remove(SESSION);
    }
    async function page(job) {
      const tab = await chrome.tabs.create({ url: `https://x.com/${job.account}`, active: false }); job.tabId = tab.id;
      await chrome.storage.session.set({ [SESSION]: { tabId: tab.id, account: job.account, token: job.token, touched: job.touched === true } });
      const until = Date.now() + 12000;
      while (Date.now() < until && !job.cancelled) {
        const target = await chrome.tabs.get(tab.id).catch(() => null);
        if (target?.url && /\/(?:i\/flow\/login|account\/access)(?:\/|$)/u.test(new URL(target.url).pathname)) throw failure('PRIORITY_BLOCKED', 'X 需要登录或验证，资料读取已暂停。');
        let response;
        try { response = await chrome.tabs.sendMessage(tab.id, { type: 'PRIORITY_READY' }); } catch {}
        if (response?.ok) {
          const result = await chrome.tabs.sendMessage(tab.id, { type: 'PRIORITY_READ_PAGE', account: job.account, viewer: job.viewer, token: job.token });
          if (!result?.ok) throw failure(result?.error?.code || 'PRIORITY_SOURCE', result?.error?.message || '未读到资料，暂不标记。');
          return result.data;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw failure(job.cancelled ? 'PRIORITY_CANCELLED' : 'PRIORITY_SOURCE', '资料页未加载，暂不标记。');
    }
    async function notify(record) {
      await Promise.allSettled([...interests].filter(([, item]) => item.viewer === record.viewer && item.accounts.includes(record.account)).map(([tabId]) => chrome.tabs.sendMessage(tabId, { type: 'PRIORITY_PROFILE_UPDATED', profile: record })));
    }
    function put(record) {
      saved.records = saved.records.filter(row => row.account !== record.account || row.viewer !== record.viewer).concat(record).sort((a, b) => a.checkedAt - b.checkedAt).slice(-P.MAX);
    }
    async function observe(input) {
      if (!(await getSettings()).timelinePriorityEnabled) return {};
      const row = P.record({ ...input, checkedAt: now() }, now()); if (!row?.viewer || row.status !== 'ready' && !['following', 'requested'].includes(row.relationship)) return {};
      put(row); await persist(); await notify(row); return {};
    }
    async function followed(event) {
      await ready;
      const viewer = P.account(event.account), name = P.account(event.target);
      if (!viewer || !name || !['followed', 'requested'].includes(event.status)) return;
      const existing = cached(name, viewer), at = Number.isFinite(event.at) ? event.at : now();
      if (existing?.checkedAt > at) return;
      const row = P.record({ ...(existing || { status: 'unavailable' }), account: name, viewer, relationship: event.status === 'requested' ? 'requested' : 'following', checkedAt: Math.min(now(), at) }, now());
      if (!row) return;
      put(row); await persist(); await notify(row);
    }
    function pending() {
      return [...new Map([...interests.values()].filter(value => now() - value.time < 30000).flatMap(value => value.candidates.map(account => ({ account, viewer: value.viewer }))).map(row => [`${row.viewer}/${row.account}`, row])).values()].filter(row => !cached(row.account, row.viewer));
    }
    async function plan() {
      if (timer) clearTimer(timer); timer = null;
      if (stopped || running || draining || !(await getSettings()).timelinePriorityEnabled || !pending().length) { await chrome.alarms.clear(ALARM); return; }
      const when = P.nextAt(saved, now()), wait = Math.max(0, when - now());
      timer = setTimer(() => { timer = null; void drain().catch(() => {}); }, wait);
      await chrome.alarms.create(ALARM, { when: Math.max(now() + 1000, when) });
    }
    async function request(message, tabId) {
      await ready;
      const viewer = P.account(message.viewer), accounts = P.accounts(message.accounts), candidates = P.accounts(message.candidates).filter(name => accounts.includes(name) && name !== viewer);
      if (!viewer || !(await getSettings()).timelinePriorityEnabled || running?.tabId === tabId) { interests.delete(tabId); return { profiles: [] }; }
      interests.set(tabId, { viewer, accounts, candidates: message.visible === true ? candidates : [], time: now() });
      const profiles = accounts.map(name => cached(name, viewer)).filter(Boolean);
      void plan().catch(() => {}); return { profiles };
    }
    async function drain() {
      await ready;
      if (running || draining || stopped) return;
      draining = true;
      try {
        if (!(await getSettings()).timelinePriorityEnabled || stopped || P.nextAt(saved, now()) > now()) return;
        let name, viewer;
        for (const candidate of pending()) {
          const tabs = [...interests].filter(([, item]) => item.viewer === candidate.viewer && item.candidates.includes(candidate.account) && now() - item.time < 30000);
          let seen = false;
          for (const [tabId] of tabs) {
            const result = await chrome.tabs.sendMessage(tabId, { type: 'PRIORITY_IS_VISIBLE', account: candidate.account, viewer: candidate.viewer }).catch(() => null);
            if (result?.ok && result.data?.visible === true) { seen = true; break; }
            const item = interests.get(tabId); if (item) item.candidates = item.candidates.filter(value => value !== candidate.account);
          }
          if (seen) { name = candidate.account; viewer = candidate.viewer; break; }
        }
        if (!name || stopped || !(await getSettings()).timelinePriorityEnabled) return;
        const job = { account: name, viewer, token: crypto.randomUUID(), tabId: null, time: now(), cancelled: false }; running = job;
        saved = P.state(saved, now()); saved.starts.push(now()); await persist();
        try {
          if (job.cancelled || stopped) return;
          const input = await (loadProfile || page)(job);
          if (job.cancelled || !(await getSettings()).timelinePriorityEnabled) return;
          const row = P.record({ ...input, checkedAt: now() }, now());
          if (!row || row.account !== name || row.viewer !== viewer || row.status !== 'ready') throw failure('PRIORITY_SOURCE', '资料身份、登录账号或数量未确认，暂不标记。');
          if (['following', 'requested'].includes(row.relationship) || !(cached(name, viewer)?.checkedAt >= job.time)) { put(row); saved.notice = ''; await persist(); await notify(row); }
        } catch (error) {
          if (!job.cancelled && error.code !== 'PRIORITY_CANCELLED') {
            if (!cached(name, viewer)) put(P.record({ account: name, viewer, status: 'unavailable', checkedAt: now() }, now()));
            if (error.code === 'PRIORITY_BLOCKED') { saved.pausedUntil = now() + P.RETRY; saved.notice = 'X 显示登录、验证或访问限制，后台资料读取暂停 30 分钟。'; }
            await persist();
          }
        } finally { await close(job); if (running === job) running = null; }
      } finally { draining = false; await plan(); }
    }
    async function configure(previous, next) {
      stopped = !next.timelinePriorityEnabled;
      if (!stopped) { await plan(); return; }
      interests.clear(); if (timer) clearTimer(timer); timer = null; await chrome.alarms.clear(ALARM);
      if (running) { running.cancelled = true; await close(running); }
    }
    async function clear() {
      if (running) { running.cancelled = true; await close(running); }
      saved.records = []; saved.pausedUntil = 0; saved.notice = ''; await persist();
      const tabs = await chrome.tabs.query({}); await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'PRIORITY_CACHE_CLEARED' })));
      await plan(); return status();
    }
    async function status() { await ready; return { enabled: (await getSettings()).timelinePriorityEnabled, cached: P.state(saved, now()).records.filter(row => row.status === 'ready').length, pending: pending().length, busy: Boolean(running), pausedUntil: saved.pausedUntil, notice: saved.notice, nextAt: P.nextAt(saved, now()) }; }
    const ready = (async () => {
      saved = P.state((await chrome.storage.local.get(KEY))[KEY], now());
      const previous = (await chrome.storage.session.get(SESSION))[SESSION]; if (previous) await close(previous);
      const settings = await getSettings(); stopped = !settings.timelinePriorityEnabled; await chrome.alarms.clear(ALARM);
    })();
    ready.catch(() => {});
    chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void drain().catch(() => {}); });
    chrome.tabs.onRemoved.addListener(tabId => interests.delete(tabId));
    chrome.tabs.onActivated?.addListener(({ tabId }) => {
      const job = running; if (job?.tabId !== tabId) return;
      job.touched = true;
      void (async () => { const value = (await chrome.storage.session.get(SESSION))[SESSION]; if (value?.tabId === tabId) await chrome.storage.session.set({ [SESSION]: { ...value, touched: true } }); })().catch(() => {});
    });
    return { ready, request, observe, followed, drain, configure, clear, status };
  }
  globalThis.MagpiePriorityBackground = Object.freeze({ create });
})();
