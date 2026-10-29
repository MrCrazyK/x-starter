/* Local follow-back queue. No model requests and no automatic follow decisions. */
(() => {
  'use strict';
  const PERIOD = 30 * 60 * 1000, LIMIT = 5, GAP = 10000;
  function account(value) {
    return typeof value === 'string' && /^@?[a-zA-Z0-9_]{1,15}$/u.test(value.trim()) ? value.trim().replace(/^@/u, '').toLowerCase() : '';
  }
  function item(input) {
    const name = account(input?.account);
    if (!name) return null;
    return { account: name, name: typeof input.name === 'string' ? input.name.replace(/[\r\n\x00]/gu, ' ').trim().slice(0, 80) : '', url: `https://x.com/${name}`, status: ['pending', 'confirming', 'followed', 'requested', 'uncertain'].includes(input.status) ? input.status : 'pending' };
  }
  function state(input, owner, time = Date.now()) {
    const row = input?.account === owner ? input : {};
    const expired = !Number.isFinite(row.roundAt) || time - row.roundAt >= PERIOD || time < row.roundAt;
    return { account: owner, items: [...new Map((Array.isArray(row.items) ? row.items : []).map(item).filter(Boolean).filter(value => value.account !== owner).map(value => [value.account, value])).values()].slice(0, LIMIT),
      ignored: [...new Set((Array.isArray(row.ignored) ? row.ignored : []).map(account).filter(Boolean))].slice(-500),
      checkedAt: Number.isFinite(row.checkedAt) ? row.checkedAt : 0, scanned: Number.isSafeInteger(row.scanned) ? row.scanned : 0,
      partial: row.partial === true, paused: row.paused === true, busy: row.busy === true,
      notice: typeof row.notice === 'string' ? row.notice.slice(0, 300) : '',
      roundAt: expired ? time : row.roundAt, confirmed: expired ? 0 : Math.min(LIMIT, Math.max(0, Number(row.confirmed) || 0)),
      nextAllowedAt: Number.isFinite(row.nextAllowedAt) ? row.nextAllowedAt : 0 };
  }
  globalThis.MagpieFollowback = Object.freeze({ PERIOD, LIMIT, GAP, account, item, state });
})();
