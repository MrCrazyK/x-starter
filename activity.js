/* Confirmed plugin follows, separated by X account and Beijing calendar day. */
(() => {
  'use strict';
  const DAY = 86400000, OFFSET = 8 * 3600000, MAX_EVENTS = 2048;
  const account = value => typeof value === 'string' && /^@?[a-zA-Z0-9_]{1,15}$/u.test(value.trim()) ? value.trim().replace(/^@/u, '').toLowerCase() : '';
  const dayAt = time => Math.floor((time + OFFSET) / DAY) * DAY - OFFSET;
  function event(input, time = Date.now()) {
    const owner = account(input?.account), target = account(input?.target), id = input?.id;
    if (!owner || !target || owner === target || typeof id !== 'string' || !/^[a-zA-Z0-9:_-]{1,160}$/u.test(id) || !['auto', 'manual'].includes(input.source) || !['followed', 'requested'].includes(input.status) || !Number.isFinite(input.at) || input.at > time || dayAt(input.at) !== dayAt(time)) return null;
    return { id, account: owner, target, source: input.source, status: input.status, at: input.at };
  }
  function state(input = {}, time = Date.now()) {
    const owners = new Map();
    for (const row of Array.isArray(input?.accounts) ? input.accounts : []) {
      const owner = account(row?.account); if (!owner) continue;
      const events = (Array.isArray(row.events) ? row.events : []).map(value => event(value, time)).filter(value => value?.account === owner);
      owners.set(owner, { account: owner, events: [...new Map(events.map(value => [value.id, value])).values()].slice(-MAX_EVENTS) });
    }
    return { accounts: [...owners.values()].slice(-50) };
  }
  function snapshot(value, owner, limit = 400, time = Date.now()) {
    const row = state(value, time).accounts.find(row => row.account === owner), events = row?.events || [];
    return { account: owner, dayAt: dayAt(time), total: events.length, automatic: events.filter(row => row.source === 'auto').length,
      manual: events.filter(row => row.source === 'manual').length, limit, updatedAt: events.at(-1)?.at || 0 };
  }
  globalThis.MagpieActivity = Object.freeze({ DAY, MAX_EVENTS, account, dayAt, event, state, snapshot });
})();
