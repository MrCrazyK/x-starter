/* Mark only the visible post author's avatar, with a reversible, layout-free outline. */
(() => {
  'use strict';
  const P = globalThis.MagpiePriority, H = globalThis.MagpieProfile, C = globalThis.MagpieReply;
  const AVATAR = '[data-testid^="UserAvatar-Container-"]', ARTICLE = 'article[data-testid="tweet"]';
  const visible = node => {
    if (!node?.isConnected || node.closest('[aria-hidden="true"],[inert]') || getComputedStyle(node).visibility === 'hidden') return false;
    const box = node.getBoundingClientRect(); return box.width > 5 && box.height > 5 && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
  };
  function linkAccount(link) {
    const url = link && C.xURL(link.href); return url && /^\/[a-zA-Z0-9_]{1,15}\/?$/u.test(url.pathname) ? P.account(url.pathname.replaceAll('/', '')) : '';
  }
  function authors() {
    const result = [], owner = linkAccount(document.querySelector('[data-testid="AppTabBar_Profile_Link"]'));
    for (const article of document.querySelectorAll(`main ${ARTICLE}`)) {
      const header = [...article.querySelectorAll('[data-testid="User-Name"]')].find(node => node.closest(ARTICLE) === article);
      const name = header && [...header.querySelectorAll('a[href]')].map(linkAccount).find(Boolean);
      if (!name || name === owner) continue;
      const avatar = [...article.querySelectorAll(AVATAR)].find(node => node.closest(ARTICLE) === article && P.account(node.getAttribute('data-testid').slice('UserAvatar-Container-'.length)) === name);
      if (avatar && visible(avatar)) result.push({ account: name, avatar, verified: H.isVerified(header, name) });
    }
    return result;
  }
  function create({ send }) {
    let options = null, stopped = true, timer = null, poll = null, busy = false, generation = 0, lastSent = '', lastAt = 0, hiddenSent = false;
    const cache = new Map(), painted = new Map(), observed = new Map();
    const style = document.createElement('style'); style.id = 'xstarter-priority-style';
    style.textContent = '[data-xstarter-priority-avatar]{outline:3px solid #08ad61!important;outline-offset:3px!important;border-radius:var(--xstarter-priority-radius,50%)!important;box-shadow:0 0 0 6px #08ad6128!important}';
    document.documentElement.append(style);
    function restore(node) {
      const old = painted.get(node); if (!old) return;
      if (node.getAttribute('title') === old.applied) old.title === null ? node.removeAttribute('title') : node.setAttribute('title', old.title);
      node.removeAttribute('data-xstarter-priority-avatar'); node.style.removeProperty('--xstarter-priority-radius'); painted.delete(node);
    }
    function paint(rows) {
      const wanted = new Map(rows.filter(row => row.verified && P.fresh(cache.get(row.account)) && P.qualifies(cache.get(row.account))).map(row => [row.avatar, row]));
      for (const node of painted.keys()) if (!wanted.has(node) || painted.get(node).account !== wanted.get(node).account) restore(node);
      for (const [node, row] of wanted) {
        const data = cache.get(row.account);
        let old = painted.get(node);
        if (!old) { old = { account: row.account, title: node.getAttribute('title'), applied: null }; painted.set(node, old); }
        else if (node.getAttribute('title') !== old.applied) old.title = node.getAttribute('title');
        const rounded = [...node.querySelectorAll('div,a,img')].find(child => parseFloat(getComputedStyle(child).borderTopLeftRadius) > 0 && child.getBoundingClientRect().width >= node.getBoundingClientRect().width * .8);
        node.style.setProperty('--xstarter-priority-radius', rounded ? getComputedStyle(rounded).borderRadius : '50%');
        old.applied = `${old.title ? old.title + '\n' : ''}推荐关注 · 已认证\n关注 ${data.following.toLocaleString()} · 粉丝 ${data.followers.toLocaleString()}\n资料读取于 ${new Date(data.checkedAt).toLocaleString('zh-CN')}`;
        if (node.getAttribute('title') !== old.applied) node.setAttribute('title', old.applied);
        node.setAttribute('data-xstarter-priority-avatar', row.account);
      }
    }
    function accept(value) {
      const row = P.record(value);
      if (row && P.fresh(row)) { cache.set(row.account, row); while (cache.size > P.MAX) cache.delete(cache.keys().next().value); }
    }
    async function scan() {
      if (stopped || !options?.timelinePriorityEnabled) return;
      if (document.visibilityState !== 'visible') {
        if (!hiddenSent) { hiddenSent = true; void send({ type: 'PRIORITY_PROFILES', accounts: [], candidates: [], visible: false }).catch(() => {}); }
        return;
      }
      hiddenSent = false;
      const rows = authors(); paint(rows);
      const name = P.account(location.pathname.replaceAll('/', ''));
      const profile = name && globalThis.MagpiePriorityPage.snapshot(name);
      if (profile) {
        const signature = JSON.stringify(profile), previous = observed.get(name);
        if (!previous || previous.signature !== signature || Date.now() - previous.time > 600000) {
          observed.set(name, { signature, time: Date.now() });
          while (observed.size > P.MAX) observed.delete(observed.keys().next().value);
          void send({ type: 'OBSERVED_PRIORITY_PROFILE', profile }).catch(() => {});
        }
      }
      const accounts = P.accounts(rows.map(row => row.account)), candidates = P.accounts(rows.filter(row => row.verified).map(row => row.account));
      const key = accounts.join(',') + '/' + candidates.join(',');
      if (busy || Date.now() - lastAt < 750 || key === lastSent && Date.now() - lastAt < 10000) return;
      busy = true; lastSent = key; lastAt = Date.now(); const current = generation;
      try { const result = await send({ type: 'PRIORITY_PROFILES', accounts, candidates, visible: true }); if (current === generation && !stopped) { for (const row of result.profiles || []) accept(row); paint(authors()); } }
      catch {} finally { busy = false; }
    }
    function schedule() { if (!stopped && !timer) timer = setTimeout(() => { timer = null; void scan(); }, 180); }
    const observer = new MutationObserver(schedule);
    function stop() {
      stopped = true; generation++; observer.disconnect(); clearTimeout(timer); timer = null; clearInterval(poll); poll = null;
      for (const node of painted.keys()) restore(node);
    }
    function configure(value) {
      stop(); options = value; if (!value?.timelinePriorityEnabled) return;
      stopped = false; lastSent = ''; lastAt = 0; hiddenSent = false;
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-testid', 'href', 'aria-label', 'aria-hidden'] });
      poll = setInterval(() => void scan(), 10000); void scan();
    }
    window.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule); document.addEventListener('visibilitychange', () => void scan());
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      if (sender.id !== chrome.runtime.id) return;
      if (message?.type === 'PRIORITY_IS_VISIBLE') { respond({ ok: true, data: { visible: !stopped && options?.timelinePriorityEnabled === true && document.visibilityState === 'visible' && authors().some(row => row.verified && row.account === message.account) } }); return; }
      if (message?.type === 'PRIORITY_PROFILE_UPDATED') { accept(message.profile); schedule(); }
      if (message?.type === 'PRIORITY_CACHE_CLEARED') { cache.clear(); observed.clear(); lastAt = 0; lastSent = ''; schedule(); }
    });
    return { configure, stop, scan };
  }
  globalThis.MagpiePriorityTimeline = Object.freeze({ create });
})();
