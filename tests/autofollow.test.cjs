'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..'), START = Date.UTC(2026, 9, 30, 2), clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
async function harness(options = {}) {
  let clock = options.time || START, settings, manager, id = 0, activated;
  const local = { autoFollowState: clone(options.initial) }, session = {}, alarms = new Map(), tabs = new Map(), actions = [], clicks = [], closed = [], probed = new Set();
  const area = data => ({ get: async key => ({ [key]: clone(data[key]) }), set: async values => Object.assign(data, clone(values)), remove: async key => { delete data[key]; } });
  const sandbox = vm.createContext({ URL, console, crypto: require('node:crypto').webcrypto, setTimeout, clearTimeout, chrome: {
    storage: { local: area(local), session: area(session) },
    alarms: { get: async name => alarms.get(name), create: async (name, value) => alarms.set(name, { name, ...value, scheduledTime: value.when }), clear: async name => alarms.delete(name), onAlarm: { addListener() {} } },
    tabs: {
      create: async input => { const tab = { ...input, id: ++id }; tabs.set(id, tab); return clone(tab); }, get: async id => { const tab = clone(tabs.get(id)); if (options.staleSnapshot && !probed.has(id)) { probed.add(id); return { ...tab, url: 'about:blank' }; } return tab; },
      remove: async id => { closed.push(id); tabs.delete(id); }, onActivated: { addListener: handler => { activated = handler; } },
      sendMessage: async (tabId, message) => {
        if (message.type === 'AUTOFOLLOW_CANCEL_PAGE') return { ok: true };
        if (message.type === 'AUTOFOLLOW_READY') return { ok: true, data: { account: settings.autoFollowAccount } };
        actions.push(clone(message));
        if (message.type === 'AUTOFOLLOW_SCAN_PAGE') {
          if (options.scan) return options.scan(message);
          const names = message.source === 'followers' ? ['fan'] : Array.from({ length: 40 }, (_, i) => 'search' + i);
          return { ok: true, data: { account: message.account, source: message.source, items: names.filter(name => !message.exclude.includes(name)).slice(0, message.limit).map(account => ({ account, source: message.source })), partial: true } };
        }
        const authorize = (override = {}, sender = {}) => manager.authorize({ ...message, ...override }, { tab: { id: tabId }, frameId: 0, ...sender });
        if (options.follow) return options.follow(message, { authorize, activate: () => { tabs.get(tabId).active = true; activated({ tabId }); }, advance: ms => { clock += ms; }, change: patch => { settings = sandbox.MagpieReply.settings({ ...settings, ...patch }); } });
        const permission = await authorize(); assert.equal(permission.allowed, true);
        clicks.push(message.target); return { ok: true, data: { status: 'followed', clicked: true } };
      }
    }
  } });
  for (const file of ['shared.js', 'autofollow.js', 'autofollow-background.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox);
  const C = sandbox.MagpieReply, A = sandbox.MagpieAutoFollow;
  settings = C.settings({ xAccount: 'writer', ...options.settings });
  manager = sandbox.MagpieAutoFollowBackground.create({ getSettings: async () => settings, onFollow: options.onFollow, now: () => clock, random: () => options.random ?? .5, timers: { setTimeout: () => 1, clearTimeout() {} } });
  await manager.ready;
  return { manager, C, A, local, actions, clicks, tabs, closed, session, alarms, now: () => clock, advance: ms => { clock += ms; }, settings: () => settings,
    configure: async patch => { const previous = settings; settings = C.settings({ ...settings, ...patch }); await manager.configure(previous, settings); },
    enable: async () => { const previous = settings; settings = C.settings({ ...settings, autoFollowEnabled: true }); await manager.configure(previous, settings); } };
}
test('automatic-follow settings default off, normalize accounts and reject missing binding or invalid limits', async () => {
  const h = await harness(), defaults = h.C.settings();
  assert.equal(defaults.autoFollowEnabled, false); assert.equal(defaults.autoFollowInterval, 30); assert.equal(defaults.autoFollowPerRound, 20); assert.equal(defaults.autoFollowDaily, 400);
  assert.throws(() => h.C.settings({ autoFollowEnabled: true }), { code: 'PREFERENCES' });
  assert.equal(h.C.settings({ autoFollowAccount: '@Writer' }).autoFollowAccount, 'writer');
  for (const patch of [{ autoFollowInterval: 0 }, { autoFollowInterval: '' }, { autoFollowDaily: 401 }, { autoFollowPerRound: 1.5 }, { autoFollowPerRound: true }, { autoFollowAccount: '../bad' }]) assert.throws(() => h.C.settings(patch), { code: 'PREFERENCES' });
  assert.equal(h.A.delay(() => 0), 5000); assert.equal(h.A.delay(() => 1), 10000);
});
test('followers need only blue and a current follows-you relationship; search needs the strict green-frame counts', async () => {
  const { A } = await harness();
  assert.equal(A.qualifies({ blue: true, followsYou: true, followers: 1 }, 'followers'), true);
  assert.equal(A.qualifies({ blue: true, followsYou: false }, 'followers'), false);
  for (const row of [{ blue: false, following: 2000, followers: 800 }, { blue: true, following: 800, followers: 800 }, { blue: true, following: 900, followers: 500 }, { blue: true, following: null, followers: 800 }]) assert.equal(A.qualifies(row, 'search'), false);
  assert.equal(A.qualifies({ blue: true, following: 2000, followers: 800 }, 'search'), true);
});
test('queue merges to twenty rather than adding twenty, promotes fans, deduplicates and rejects self/ignored identities', async () => {
  const { A } = await harness(), old = Array.from({ length: 4 }, (_, i) => ({ account: 'search' + i, source: 'search' }));
  const rows = A.merge(old, [{ account: 'search1', source: 'followers' }, { account: 'writer', source: 'followers' }, ...Array.from({ length: 30 }, (_, i) => ({ account: 'fan' + i, source: 'followers' }))], ['fan0'], 'writer', START);
  assert.equal(rows.length, 20); assert.equal(rows[0].account, 'search1'); assert.equal(rows[0].source, 'followers'); assert.equal(new Set(rows.map(row => row.account)).size, 20);
  assert.equal(rows.some(row => ['writer', 'fan0'].includes(row.account)), false);
});
test('new installs perform no reads or follows; enabling fills the queue with fans ahead of search authors', async () => {
  const h = await harness(); await h.manager.tick(); assert.equal(h.actions.length, 0); assert.equal(h.alarms.size, 0);
  await h.enable(); await h.manager.tick(); const value = await h.manager.status();
  assert.equal(value.queue.length, 20); assert.equal(value.queue[0].account, 'fan'); assert.equal(value.queue[1].source, 'search'); assert.equal(h.clicks.length, 0);
  assert.deepEqual(h.actions.map(row => row.type), ['AUTOFOLLOW_SCAN_PAGE', 'AUTOFOLLOW_SCAN_PAGE']);
  assert.equal(h.tabs.size, 0);
});
test('one authorized follow is followed by a persisted random five-to-ten-second minimum wait', async () => {
  const h = await harness(); await h.enable(); await h.manager.tick(); await h.manager.tick();
  assert.deepEqual(h.clicks, ['fan']); assert.equal((await h.manager.status()).dayUsed, 1); assert.equal((await h.manager.status()).nextAllowedAt, h.now() + 7500);
  h.advance(7499); await h.manager.tick(); assert.equal(h.clicks.length, 1);
  h.advance(1); await h.manager.tick(); assert.deepEqual(h.clicks, ['fan', 'search0']);
});
test('per-round and daily ceilings stop execution and retain remaining candidates for later rounds', async () => {
  const h = await harness({ settings: { autoFollowPerRound: 2, autoFollowDaily: 3 } }); await h.enable(); await h.manager.tick();
  await h.manager.tick(); h.advance(10000); await h.manager.tick(); h.advance(10000); await h.manager.tick(); assert.equal(h.clicks.length, 2);
  h.advance(30 * 60000); await h.manager.tick(); await h.manager.tick(); assert.equal(h.clicks.length, 3);
  h.advance(60 * 60000); await h.manager.tick(); assert.equal(h.clicks.length, 3);
  assert.equal((await h.manager.status()).nextAt, h.A.dayAt(h.now()) + h.A.DAY);
});
test('the daily allowance resets at Beijing midnight while the last action spacing is retained', async () => {
  const h = await harness({ time: Date.UTC(2026, 9, 30, 15, 59, 58), settings: { autoFollowDaily: 1 } }); await h.enable(); await h.manager.tick(); await h.manager.tick();
  h.advance(3000); await h.manager.tick(); assert.equal(h.clicks.length, 1); assert.equal((await h.manager.status()).dayUsed, 0);
  h.advance(5000); await h.manager.tick(); assert.equal(h.clicks.length, 2);
});
test('pause/resume and disable/re-enable preserve allowances and never reset a round', async () => {
  const h = await harness(); await h.enable(); await h.manager.tick(); await h.manager.tick();
  await h.manager.pause(); h.advance(10000); await h.manager.tick(); assert.equal(h.clicks.length, 1);
  await h.manager.resume(); await h.configure({ autoFollowEnabled: false }); await h.manager.tick(); assert.equal(h.alarms.size, 0);
  await h.enable(); assert.equal((await h.manager.status()).dayUsed, 1); await h.manager.tick(); assert.equal(h.clicks.length, 2);
});
test('a lost page response is never resent and remains excluded after resume and worker restart', async () => {
  const h = await harness({ follow: async (_message, { authorize }) => { await authorize(); throw new Error('message port closed'); } });
  await h.enable(); await h.manager.tick(); await h.manager.tick();
  const value = await h.manager.status(); assert.equal(value.paused, true); assert.equal(value.dayUsed, 1); assert.equal(value.history[0].status, 'uncertain'); assert.deepEqual(Array.from(value.uncertain), ['fan']);
  await h.manager.tick(); assert.equal(h.actions.filter(row => row.type === 'AUTOFOLLOW_FOLLOW_PAGE').length, 1);
  const restarted = await harness({ initial: h.local.autoFollowState, settings: { autoFollowEnabled: true } });
  assert.equal((await restarted.manager.status()).paused, true); await restarted.manager.resume(); restarted.advance(10000); await restarted.manager.tick();
  assert.equal(restarted.actions.filter(row => row.type === 'AUTOFOLLOW_FOLLOW_PAGE').some(row => row.target === 'fan'), false);
});
test('an in-flight reservation recovered on startup becomes uncertain, keeps its count and pauses execution', async () => {
  const initial = { accounts: [{ account: 'writer', roundAt: START, roundUsed: 1, dayAt: Math.floor((START + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000, dayUsed: 1,
    inFlight: { account: 'fan', source: 'followers', reservedDay: START, reservedRound: START } }] };
  const h = await harness({ initial, settings: { autoFollowEnabled: true } }), value = await h.manager.status();
  assert.equal(value.paused, true); assert.equal(value.inFlight, null); assert.equal(value.dayUsed, 1); assert.equal(value.history[0].status, 'interrupted');
  await h.manager.tick(); assert.equal(h.actions.length, 0);
});
test('already-followed or no-longer-qualified people consume no follow allowance and are logged without retry', async () => {
  const h = await harness({ follow: async message => ({ ok: true, data: { status: message.target === 'fan' ? 'already' : 'skipped', clicked: false, reason: 'not eligible' } }) });
  await h.enable(); await h.manager.tick(); await h.manager.tick(); h.advance(1000); await h.manager.tick();
  const value = await h.manager.status(); assert.equal(value.dayUsed, 0); assert.equal(value.roundUsed, 0); assert.equal(value.roundChecked, 2);
  assert.deepEqual(Array.from(value.history, row => row.status), ['skipped', 'already']); assert.equal(h.clicks.length, 0);
});
test('account mismatch and X verification errors pause the queue before any follow', async () => {
  for (const code of ['AUTOFOLLOW_ACCOUNT', 'AUTOFOLLOW_BLOCKED']) {
    const h = await harness({ scan: () => ({ ok: false, error: { code, message: 'verification required', clicked: false } }) });
    await h.enable(); await h.manager.tick(); assert.equal((await h.manager.status()).paused, true); await h.manager.tick(); assert.equal(h.actions.length, 1); assert.equal(h.clicks.length, 0);
  }
});
test('foreign tabs, forged tokens, child frames and repeat authorizations cannot authorize a follow', async () => {
  const h = await harness({ follow: async (_message, { authorize }) => {
    assert.equal((await authorize({ token: 'wrong' })).allowed, false);
    assert.equal((await authorize({}, { tab: { id: 900 } })).allowed, false);
    assert.equal((await authorize({}, { frameId: 1 })).allowed, false);
    assert.equal((await authorize()).allowed, true); assert.equal((await authorize()).allowed, false);
    return { ok: true, data: { status: 'followed', clicked: true } };
  } });
  await h.enable(); await h.manager.tick(); await h.manager.tick(); assert.equal((await h.manager.status()).dayUsed, 1);
});
test('turning the setting off while a profile loads denies its late authorization and releases its reservation', async () => {
  let entered, finish; const started = new Promise(resolve => { entered = resolve; });
  const h = await harness({ follow: async (_message, { authorize }) => {
    entered(); await new Promise(resolve => { finish = resolve; });
    assert.equal((await authorize()).allowed, false);
    return { ok: false, error: { code: 'AUTOFOLLOW_CANCELLED', message: 'disabled', clicked: false } };
  } });
  await h.enable(); await h.manager.tick(); const action = h.manager.tick(); await started;
  await h.configure({ autoFollowEnabled: false }); finish(); await action;
  const value = await h.manager.status(); assert.equal(value.dayUsed, 0); assert.equal(value.enabled, false); assert.equal(h.alarms.size, 0);
});
test('opening a temporary page preserves it, pauses the task and rejects its follow authorization', async () => {
  const h = await harness({ follow: async (_message, { activate, authorize }) => {
    activate(); await assert.rejects(authorize(), { code: 'AUTOFOLLOW_CANCELLED' });
    return { ok: false, error: { code: 'AUTOFOLLOW_CANCELLED', message: 'user opened page', clicked: false } };
  } });
  await h.enable(); await h.manager.tick(); await h.manager.tick();
  assert.equal((await h.manager.status()).paused, true); assert.equal((await h.manager.status()).dayUsed, 0); assert.equal(h.tabs.size, 1);
});
test('fewer than five remaining candidates triggers one bounded refill and full queues are consumed without repeated scans', async () => {
  const queue = Array.from({ length: 4 }, (_, i) => ({ account: 'old' + i, source: 'search', foundAt: START - 1000 }));
  const h = await harness({ initial: { accounts: [{ account: 'writer', queue, roundAt: START, checkedRound: true }] } });
  await h.enable(); await h.manager.tick(); assert.equal((await h.manager.status()).queue.length, 20);
  const scans = h.actions.length; await h.manager.tick(); assert.equal(h.actions.length, scans + 1); assert.equal(h.actions.at(-1).type, 'AUTOFOLLOW_FOLLOW_PAGE');
  assert.equal(h.actions.at(-1).target, 'fan');
});
test('switching bound accounts retains the original account limits and ignored people', async () => {
  const h = await harness(); await h.enable(); await h.manager.tick(); await h.manager.ignore('search0'); await h.manager.tick();
  await h.configure({ xAccount: 'other' }); assert.equal((await h.manager.status()).dayUsed, 0);
  await h.configure({ xAccount: 'writer' }); const value = await h.manager.status();
  assert.equal(value.dayUsed, 1); assert.equal(value.ignored.includes('search0'), true); assert.equal(value.queue.some(row => row.account === 'search0'), false);
});
test('profile validation work is bounded even when every search author is rejected', async () => {
  const h = await harness(), value = h.A.state({ account: 'writer', roundAt: START, roundChecked: 60 }, 'writer', h.settings(), START);
  assert.equal(h.A.nextAt(value, h.settings(), START), START + 30 * 60000);
});
test('a reservation crossing midnight is charged to the actual authorization day before clicking', async () => {
  const h = await harness({ time: Date.UTC(2026, 9, 30, 15, 59, 59), follow: async (_message, { authorize, advance }) => {
    advance(2000); assert.equal((await authorize()).allowed, true);
    return { ok: true, data: { status: 'followed', clicked: true } };
  } });
  await h.enable(); await h.manager.tick(); await h.manager.tick(); assert.equal((await h.manager.status()).dayUsed, 1);
});
test('a short source list is consumed immediately instead of repeatedly refilling the same people', async () => {
  const h = await harness({ scan: message => ({ ok: true, data: { account: message.account, source: message.source, items: message.source === 'followers' ? [{ account: 'fan', source: 'followers' }] : [] } }) });
  await h.enable(); await h.manager.tick(); const scans = h.actions.length; await h.manager.tick();
  assert.equal(h.actions.length, scans + 1); assert.equal(h.actions.at(-1).type, 'AUTOFOLLOW_FOLLOW_PAGE'); assert.deepEqual(h.clicks, ['fan']);
});
test('simultaneous timer and alarm wakeups serialize before reading settings and can dispatch only one action', async () => {
  const h = await harness(); await h.enable(); await Promise.all(Array.from({ length: 4 }, () => h.manager.tick()));
  assert.equal(h.actions.length, 2); assert.equal((await h.manager.status()).queue.length, 20);
  await Promise.all(Array.from({ length: 4 }, () => h.manager.tick()));
  assert.deepEqual(h.clicks, ['fan']); assert.equal((await h.manager.status()).dayUsed, 1);
});
test('a tab completing navigation during its readiness response is checked using a fresh URL snapshot', async () => {
  const h = await harness({ staleSnapshot: true }); await h.enable(); await h.manager.tick();
  assert.equal((await h.manager.status()).paused, false); assert.equal((await h.manager.status()).queue.length, 20);
  await h.manager.tick(); assert.deepEqual(h.clicks, ['fan']);
});
test('only actual confirmed follows emit one success event; skipped or uncertain results never emit one', async () => {
  const events = [], h = await harness({ onFollow: event => events.push(event) });
  await h.enable(); await h.manager.tick(); await h.manager.tick(); assert.equal(events.length, 1); assert.equal(events[0].target, 'fan'); assert.equal(events[0].source, 'auto');
  for (const result of [{ status: 'already', clicked: false }, { status: 'skipped', clicked: false }, { status: 'uncertain', clicked: true }]) {
    const h = await harness({ follow: async () => ({ ok: true, data: result }), onFollow: event => events.push(event) }); await h.enable(); await h.manager.tick(); await h.manager.tick();
  }
  assert.equal(events.length, 1);
});
