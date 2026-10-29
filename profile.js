/* Local-only hover profile highlighting. Does not fetch profiles or change follows. */
(() => {
  'use strict';
  const SCOPES = '#layers, [data-testid="HoverCard"], [data-testid="UserHoverCard"], [role="tooltip"]';
  const CARDS = '[data-testid="HoverCard"], [data-testid="UserHoverCard"], [role="tooltip"]';
  const COLOR = '#b59a25';
  const GREEN = '#9bd3aa';
  function parseCount(input) {
    if (typeof input !== 'string') return null;
    const text = input.normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '').trim();
    const match = text.match(/^(?:(?:Following|Followers|Verified followers|正在关注|已关注|关注|关注者|粉丝|跟隨中|跟随中|跟隨者|跟随者|位粉絲)\s*)?((?:\d{1,3}(?:[, .\u00a0\u202f]\d{3})+|\d+)(?:[.,]\d+)?)(?:\s*([KMBT万萬亿億]))?(?:\s*(?:Following|Followers|Verified followers|正在关注|已关注|关注|关注者|粉丝|跟隨中|跟随中|跟隨者|跟随者|位粉絲))?$/iu);
    if (!match) return null;
    let number = match[1].replace(/[ \u00a0\u202f]/gu, '');
    const unit = (match[2] || '').toUpperCase();
    if (!unit && /^\d{1,3}(?:[,.]\d{3})+$/u.test(number)) number = number.replace(/[,.]/gu, '');
    else if (unit && /^\d+,\d{1,2}$/u.test(number)) number = number.replace(',', '.');
    else number = number.replaceAll(',', '');
    const scale = { K: 1e3, M: 1e6, B: 1e9, T: 1e12, 万: 1e4, 萬: 1e4, 亿: 1e8, 億: 1e8 }[unit] || 1;
    const raw = Number(number) * scale, value = Math.round(raw);
    if (!Number.isFinite(raw) || !Number.isSafeInteger(value) || value < 0 || Math.abs(raw - value) > 0.001) return null;
    return value;
  }
  function qualifies(following, followers, threshold = 20) {
    if (![following, followers].every(value => Number.isSafeInteger(value) && value >= 0) || followers === 0 || !Number.isInteger(threshold) || threshold < 0 || threshold > 100) return false;
    return BigInt(following) * 100n <= BigInt(followers) * BigInt(100 - threshold);
  }
  function priority(following, followers, verified) {
    return verified === true && [following, followers].every(value => Number.isSafeInteger(value) && value >= 0) && followers > 500 && following > followers;
  }
  function isVerified(card, account) {
    return [...card.querySelectorAll('[data-testid="icon-verified"], svg[aria-label="Verified account"], svg[aria-label="认证账号"], svg[aria-label="已认证账号"]')].some(badge => {
      const link = badge.closest('a[href]');
      if (!visible(badge) || !link || badge.closest('button, [role="button"]')) return false;
      try { const url = new URL(link.href, location.href); return globalThis.MagpieReply.xURL(url.href) && url.pathname.replace(/\/$/u, '').toLowerCase() === `/${account}`; } catch { return false; }
    });
  }
  function countLink(link) {
    try {
      const url = new URL(link.href, location.href);
      if (!globalThis.MagpieReply.xURL(url.href)) return null;
      const match = url.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/(following|followers|verified_followers)\/?$/u);
      return match ? { account: match[1].toLowerCase(), kind: match[2] === 'following' ? 'following' : 'followers' } : null;
    } catch { return null; }
  }
  function readCount(link) {
    const exact = [link.getAttribute('title'), link.getAttribute('aria-label'), ...[...link.querySelectorAll('[title], [aria-label]')].flatMap(node => [node.getAttribute('title'), node.getAttribute('aria-label')])];
    // Prefer a full numeric title over a rounded visible number such as 3.2K.
    for (const text of exact) {
      const value = parseCount(text);
      if (value !== null && !/[KMBT万萬亿億]/iu.test(String(text).replace(/Following|Followers|Verified followers/giu, ''))) return value;
    }
    for (const text of [...exact, link.innerText, ...[...link.querySelectorAll('span')].map(node => node.innerText)]) {
      const value = parseCount(text); if (value !== null) return value;
    }
    return null;
  }
  const visible = node => Boolean(node?.isConnected && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
  function opaque(color) {
    const values = color.match(/[\d.]+/gu)?.map(Number);
    return values && values.length >= 3 && (values.length < 4 || values[3] > 0.1);
  }
  function neutral(color) {
    const values = color.match(/[\d.]+/gu)?.slice(0, 3).map(Number);
    return opaque(color) && values && Math.max(...values) - Math.min(...values) < 45;
  }
  function findCard(following, followers, scope, account) {
    let common = following;
    while (common && !common.contains(followers)) common = common.parentElement;
    const explicit = following.closest(CARDS);
    const boundary = explicit && explicit.contains(followers) ? explicit : scope;
    for (let node = common; node && boundary.contains(node); node = node.parentElement) {
      const box = node.getBoundingClientRect();
      if (!visible(node) || box.width < 180 || box.width > 650 || box.height < 100 || box.height > 1200) { if (node === boundary) break; continue; }
      const ownProfile = [...node.querySelectorAll('a[href]')].some(link => {
        try { const url = new URL(link.href, location.href); return globalThis.MagpieReply.xURL(url.href) && url.pathname.replace(/\/$/u, '').toLowerCase() === `/${account}`; } catch { return false; }
      });
      const css = getComputedStyle(node), rounded = parseFloat(css.borderTopLeftRadius) >= 8;
      if (ownProfile && (node === explicit || rounded && opaque(css.backgroundColor))) return node;
      if (node === boundary) break;
    }
    return null;
  }
  function create() {
    let options = null, portal = null, timer = null, stopped = false;
    const painted = new Map();
    const style = document.createElement('style'); style.id = 'magpie-profile-style';
    style.textContent = `[data-magpie-profile-highlight="true"],[data-magpie-profile-surface="true"]{background-color:var(--magpie-profile-color,${COLOR})!important}[data-magpie-profile-text="true"]{color:#172018!important}`;
    document.documentElement.append(style);
    const observer = new MutationObserver(() => { if (!timer && !stopped) timer = setTimeout(() => { timer = null; scan(); }, 60); });
    function restore(card) {
      const record = painted.get(card);
      for (const node of record?.surfaces || []) node.removeAttribute('data-magpie-profile-surface');
      for (const node of record?.text || []) node.removeAttribute('data-magpie-profile-text');
      card.removeAttribute('data-magpie-profile-highlight'); card.removeAttribute('data-magpie-profile-gap');
      card.removeAttribute('data-magpie-profile-tone'); card.style.removeProperty('--magpie-profile-color');
      painted.delete(card);
    }
    function paint(card, following, followers, tone) {
      restore(card);
      const record = { surfaces: [], text: [] };
      const excluded = 'button, [role="button"], svg, [data-testid^="UserAvatar-Container-"], [data-magpie-action]';
      for (const node of [card, ...card.querySelectorAll('div, section, span, p, strong, b, a, time, h1, h2, h3, h4, h5, h6, em, small, label')]) {
        if (node.closest(excluded)) continue;
        const css = getComputedStyle(node);
        if (node !== card && !node.querySelector('img, [role="img"]') && css.backgroundImage === 'none' && neutral(css.backgroundColor)) {
          node.setAttribute('data-magpie-profile-surface', 'true'); record.surfaces.push(node);
        }
        if ([...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim())) {
          node.setAttribute('data-magpie-profile-text', 'true'); record.text.push(node);
        }
      }
      card.setAttribute('data-magpie-profile-highlight', 'true');
      card.setAttribute('data-magpie-profile-tone', tone);
      card.style.setProperty('--magpie-profile-color', tone === 'green' ? GREEN : COLOR);
      card.setAttribute('data-magpie-profile-gap', ((followers - following) / followers * 100).toFixed(1));
      painted.set(card, record);
    }
    function scan() {
      if (stopped) return;
      const nextPortal = document.getElementById('layers');
      if (nextPortal !== portal) {
        observer.disconnect(); portal = nextPortal;
        if (portal) observer.observe(portal, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'title', 'aria-label', 'data-testid', 'class'] });
      }
      const matches = new Map();
      if (options?.profileHighlightEnabled || options?.profilePriorityEnabled) for (const scope of document.querySelectorAll(SCOPES)) {
        const links = [...scope.querySelectorAll('a[href]')].map(link => ({ link, info: countLink(link) })).filter(row => row.info && visible(row.link));
        for (const row of links.filter(row => row.info.kind === 'following')) {
          for (const other of links.filter(other => other.info.kind === 'followers' && other.info.account === row.info.account)) {
            const following = readCount(row.link), followers = readCount(other.link);
            const card = findCard(row.link, other.link, scope, row.info.account);
            if (!card) continue;
            const tone = options.profilePriorityEnabled && priority(following, followers, isVerified(card, row.info.account)) ? 'green' : options.profileHighlightEnabled && qualifies(following, followers, options.profileGapThreshold) ? 'yellow' : '';
            if (tone) matches.set(card, { following, followers, tone });
          }
        }
      }
      for (const card of painted.keys()) if (!matches.has(card)) restore(card);
      for (const [card, counts] of matches) paint(card, counts.following, counts.followers, counts.tone);
    }
    return { scan, configure: value => { options = value; stopped = false; scan(); }, stop: () => {
      stopped = true; observer.disconnect(); portal = null; clearTimeout(timer); timer = null;
      for (const card of painted.keys()) restore(card);
    } };
  }
  globalThis.MagpieProfile = Object.freeze({ COLOR, GREEN, parseCount, qualifies, priority, create });
})();
