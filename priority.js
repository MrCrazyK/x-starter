/* Bounded, local public-profile cache and lookup budget. No model requests. */
(() => {
  'use strict';
  const TTL = 24 * 60 * 60 * 1000, RETRY = 30 * 60 * 1000, GAP = 20000, WINDOW = 60000, MAX = 500, BATCH = 24;
  const account = value => typeof value === 'string' && /^@?[a-zA-Z0-9_]{1,15}$/u.test(value.trim()) ? value.trim().replace(/^@/u, '').toLowerCase() : '';
  function record(input, time = Date.now()) {
    const name = account(input?.account), checkedAt = Number(input?.checkedAt);
    if (!name || !Number.isFinite(checkedAt) || checkedAt <= 0 || checkedAt > time + WINDOW) return null;
    if (input.status === 'unavailable') return { account: name, checkedAt, status: 'unavailable' };
    if (![input.following, input.followers].every(value => Number.isSafeInteger(value) && value >= 0) || typeof input.verified !== 'boolean') return null;
    return { account: name, following: input.following, followers: input.followers, verified: input.verified, checkedAt, status: 'ready' };
  }
  const fresh = (row, time = Date.now()) => Boolean(row && time >= row.checkedAt - WINDOW && time - row.checkedAt < (row.status === 'ready' ? TTL : RETRY));
  const qualifies = row => row?.status === 'ready' && row.verified === true && [row.following, row.followers].every(value => Number.isSafeInteger(value) && value >= 0) && row.followers > 500 && row.following > row.followers;
  function state(input = {}, time = Date.now()) {
    return {
      records: [...new Map((Array.isArray(input.records) ? input.records : []).map(value => record(value, time)).filter(value => fresh(value, time)).sort((a, b) => a.checkedAt - b.checkedAt).map(value => [value.account, value])).values()].slice(-MAX),
      starts: (Array.isArray(input.starts) ? input.starts : []).filter(value => Number.isFinite(value) && time - value < WINDOW).map(value => Math.min(value, time)).sort((a, b) => a - b).slice(-3),
      pausedUntil: Number.isFinite(input.pausedUntil) ? Math.min(input.pausedUntil, time + RETRY) : 0,
      notice: typeof input.notice === 'string' ? input.notice.slice(0, 200) : ''
    };
  }
  function nextAt(value, time = Date.now()) {
    const starts = state(value, time).starts;
    return Math.max(time, value.pausedUntil || 0, starts.length ? starts.at(-1) + GAP : 0, starts.length >= 3 ? starts[0] + WINDOW : 0);
  }
  const accounts = values => [...new Set((Array.isArray(values) ? values : []).slice(0, BATCH).map(account).filter(Boolean))];
  globalThis.MagpiePriority = Object.freeze({ TTL, RETRY, GAP, WINDOW, MAX, BATCH, account, record, fresh, qualifies, state, nextAt, accounts });
})();
