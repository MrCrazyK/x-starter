/* Bounded automatic-follow queues and persisted limits. No network or DOM access. */
(() => {
  'use strict';
  const TARGET = 20, LOW = 5, DAY = 86400000, OFFSET = 8 * 3600000;
  const account = value => typeof value === 'string' && /^@?[a-zA-Z0-9_]{1,15}$/u.test(value.trim()) ? value.trim().replace(/^@/u, '').toLowerCase() : '';
  const dayAt = time => Math.floor((time + OFFSET) / DAY) * DAY - OFFSET;
  const delay = (random = Math.random) => 5000 + Math.floor(Math.min(1, Math.max(0, random())) * 5000);
  const text = (value, max) => typeof value === 'string' ? value.replace(/[\r\n\x00]/gu, ' ').trim().slice(0, max) : '';
  function item(input, time = Date.now()) {
    const name = account(input?.account);
    if (!name || !['followers', 'search'].includes(input?.source)) return null;
    return { account: name, name: text(input.name, 80), source: input.source,
      foundAt: Number.isFinite(input.foundAt) && input.foundAt > 0 && input.foundAt <= time ? input.foundAt : time };
  }
  function log(input, time) {
    const row = item(input, time);
    if (!row || !['followed', 'requested', 'already', 'skipped', 'uncertain', 'interrupted'].includes(input.status)) return null;
    return { ...row, status: input.status, at: Number.isFinite(input.at) ? Math.min(time, input.at) : time, reason: text(input.reason, 180) };
  }
  function state(input, owner, options, time = Date.now()) {
    const row = input?.account === owner ? input : {}, integer = key => Number.isSafeInteger(row[key]) && row[key] >= 0 ? row[key] : 0;
    const day = dayAt(time), roundAt = Number.isFinite(row.roundAt) && row.roundAt > 0 && row.roundAt <= time ? row.roundAt : 0;
    const roundExpired = !roundAt || time >= roundAt + options.autoFollowInterval * 60000;
    const names = values => [...new Set((Array.isArray(values) ? values : []).map(account).filter(Boolean))].slice(-2000);
    const value = {
      account: owner, queue: merge([], Array.isArray(row.queue) ? row.queue : [], [], owner, time),
      history: (Array.isArray(row.history) ? row.history : []).map(value => log(value, time)).filter(Boolean).slice(-500),
      ignored: names(row.ignored), uncertain: names(row.uncertain),
      dayAt: day, dayUsed: row.dayAt === day ? integer('dayUsed') : 0,
      roundAt: roundExpired ? time : roundAt, roundUsed: roundExpired ? 0 : integer('roundUsed'),
      roundChecked: roundExpired ? 0 : integer('roundChecked'), refills: roundExpired ? 0 : integer('refills'),
      checkedRound: roundExpired ? false : row.checkedRound === true,
      refillArmed: roundExpired ? true : row.refillArmed !== false,
      nextAllowedAt: Number.isFinite(row.nextAllowedAt) ? row.nextAllowedAt : 0,
      idleUntil: roundExpired ? 0 : Number.isFinite(row.idleUntil) ? row.idleUntil : 0,
      checkedAt: Number.isFinite(row.checkedAt) ? row.checkedAt : 0,
      paused: row.paused === true, notice: text(row.notice, 300),
      inFlight: item(row.inFlight, time) ? {
        ...item(row.inFlight, time), reservedDay: row.inFlight.reservedDay, reservedRound: row.inFlight.reservedRound
      } : null
    };
    value.queue = merge([], value.queue, excluded(value, time), owner, time);
    return value;
  }
  function excluded(value, time = Date.now()) {
    return [...new Set([...value.ignored, ...value.uncertain,
      ...value.history.filter(row => row.status !== 'skipped' || time - row.at < DAY).map(row => row.account)])];
  }
  function merge(previous, added, ignore = [], owner = '', time = Date.now()) {
    const omitted = new Set(ignore), rows = new Map();
    for (const input of [...previous, ...added]) {
      const row = item(input, time);
      if (!row || row.account === owner || omitted.has(row.account)) continue;
      const old = rows.get(row.account);
      if (!old || old.source === 'search' && row.source === 'followers') rows.set(row.account, { ...row, foundAt: old?.foundAt || row.foundAt });
    }
    return [...rows.values()].sort((a, b) => Number(a.source === 'search') - Number(b.source === 'search') || a.foundAt - b.foundAt).slice(0, TARGET);
  }
  function nextAt(value, options, time = Date.now()) {
    return Math.max(time, value.nextAllowedAt,
      value.dayUsed >= options.autoFollowDaily ? value.dayAt + DAY : 0,
      value.roundUsed >= options.autoFollowPerRound || value.roundChecked >= Math.max(TARGET, options.autoFollowPerRound * 3) ? value.roundAt + options.autoFollowInterval * 60000 : 0,
      value.idleUntil);
  }
  function qualifies(profile, source) {
    return profile?.blue === true && (source === 'followers' ? profile.followsYou === true
      : source === 'search' && [profile.following, profile.followers].every(value => Number.isSafeInteger(value) && value >= 0) && profile.followers > 500 && profile.following > profile.followers);
  }
  globalThis.MagpieAutoFollow = Object.freeze({ TARGET, LOW, DAY, account, dayAt, delay, item, state, excluded, merge, nextAt, qualifies });
})();
