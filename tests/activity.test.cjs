'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..'), START = Date.UTC(2026, 9, 30, 10), copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
async function harness(initial = {}) {
  let clock = START;
  const local = copy(initial), notices = [];
  const sandbox = vm.createContext({ URL, console, chrome: {
    storage: { local: { get: async key => ({ [key]: copy(local[key]) }), set: async value => Object.assign(local, copy(value)) } },
    tabs: { query: async () => [{ id: 1, url: 'https://x.com/home' }, { id: 2, url: 'https://example.com' }], sendMessage: async (id, message) => { notices.push({ id, message: copy(message) }); return { ok: true }; } }
  } });
  for (const file of ['shared.js', 'activity.js', 'activity-background.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox);
  const C = sandbox.MagpieReply, R = sandbox.MagpieActivity;
  const manager = sandbox.MagpieActivityBackground.create({ getSettings: async () => C.settings({ xAccount: 'writer' }), now: () => clock }); await manager.ready;
  const event = (id, extra = {}) => ({ id, account: 'writer', target: 'person', source: 'auto', status: 'followed', at: clock, ...extra });
  return { C, R, manager, local, notices, event, advance: ms => { clock += ms; }, now: () => clock };
}
test('one normalized account feeds both follow features and explicit saved daily limits are preserved', async () => {
  const { C } = await harness(), fresh = C.settings({ xAccount: '@Writer', followbackEnabled: true, autoFollowEnabled: true });
  assert.equal(fresh.xAccount, 'writer'); assert.equal(fresh.followbackAccount, 'writer'); assert.equal(fresh.autoFollowAccount, 'writer'); assert.equal(fresh.autoFollowDaily, 400);
  assert.equal(C.settings({ autoFollowDaily: 50 }).autoFollowDaily, 50); assert.equal(C.settings({ autoFollowDaily: 400 }).autoFollowDaily, 400);
  for (const autoFollowDaily of [0, 401, 1.5, '', true]) assert.throws(() => C.settings({ autoFollowDaily }), { code: 'PREFERENCES' });
  assert.throws(() => C.settings({ xAccount: '', autoFollowAccount: 'old', autoFollowEnabled: true }), { code: 'PREFERENCES' });
});
test('legacy bindings migrate once, prefer the sole active account, and stop ambiguous old bindings', async () => {
  const { C } = await harness();
  for (const input of [{ followbackAccount: '@Writer', followbackEnabled: true }, { autoFollowAccount: '@Writer', autoFollowEnabled: true }]) {
    const value = C.settings(input); assert.equal(value.xAccount, 'writer'); assert.equal(value.followbackAccount, value.autoFollowAccount); assert.deepEqual(C.settings(value), value);
  }
  const sole = C.settings({ autoFollowAccount: 'active', autoFollowEnabled: true, followbackAccount: 'inactive' }); assert.equal(sole.xAccount, 'active');
  const conflict = C.settings({ autoFollowAccount: 'automatic', autoFollowEnabled: true, followbackAccount: 'manual', followbackEnabled: true });
  assert.equal(conflict.xAccount, ''); assert.equal(conflict.autoFollowEnabled, false); assert.equal(conflict.followbackEnabled, false); assert.equal(conflict.accountConflict.length, 2);
  const resolved = C.settings({ ...conflict, xAccount: 'chosen', autoFollowEnabled: true }); assert.equal(resolved.autoFollowAccount, 'chosen'); assert.equal(resolved.followbackAccount, 'chosen'); assert.equal(resolved.accountConflict.length, 0);
});
test('auto successes and manual requests share the daily progress count and duplicate IDs cannot add twice', async () => {
  const h = await harness();
  assert.equal((await h.manager.snapshot()).total, 0);
  await h.manager.record(h.event('one')); await h.manager.record(h.event('one'));
  await h.manager.record(h.event('two', { source: 'manual', status: 'requested', target: 'private' }));
  const value = await h.manager.snapshot(); assert.equal(value.total, 2); assert.equal(value.automatic, 1); assert.equal(value.manual, 1); assert.equal(value.limit, 400);
  assert.equal(h.notices.length, 2); assert.ok(h.notices.every(row => row.id === 1));
});
test('already followed, skipped, uncertain, invalid targets and old-day events never produce +1', async () => {
  const h = await harness();
  for (const status of ['already', 'skipped', 'uncertain', 'interrupted']) await h.manager.record(h.event(status, { status }));
  await h.manager.record(h.event('self', { target: 'writer' })); await h.manager.record(h.event('bad', { target: '../victim' })); await h.manager.record(h.event('old', { at: h.now() - h.R.DAY }));
  assert.equal((await h.manager.snapshot()).total, 0); assert.equal(h.notices.length, 0);
});
test('concurrent success callbacks serialize their writes and keep every distinct event exactly once', async () => {
  const h = await harness(); await Promise.all(Array.from({ length: 30 }, (_, i) => h.manager.record(h.event('event' + i, { target: 'person' + i }))));
  assert.equal((await h.manager.snapshot()).total, 30); assert.equal(h.local.followActivityState.accounts[0].events.length, 30);
});
test('counts survive worker restart, remain account-isolated and reset at Beijing midnight', async () => {
  const h = await harness(); await h.manager.record(h.event('one')); await h.manager.record(h.event('other', { account: 'another' }));
  const restarted = await harness(h.local); assert.equal((await restarted.manager.snapshot('writer')).total, 1); assert.equal((await restarted.manager.snapshot('another')).total, 1);
  const untilMidnight = h.R.dayAt(h.now()) + h.R.DAY - h.now(); restarted.advance(untilMidnight);
  assert.equal((await restarted.manager.snapshot('writer')).total, 0); await restarted.manager.record(restarted.event('newday')); assert.equal((await restarted.manager.snapshot()).total, 1);
});
test('v0.7 automatic success history is recovered once; uncertain entries are excluded and never broadcast as new animations', async () => {
  const h = await harness({ autoFollowState: { accounts: [{ account: 'writer', history: [
    { account: 'first', at: START - 1000, status: 'followed' }, { account: 'private', at: START - 500, status: 'requested' },
    { account: 'unknown', at: START - 200, status: 'uncertain' }, { account: 'yesterday', at: START - 86400000, status: 'followed' }
  ] }] } });
  assert.equal((await h.manager.snapshot()).total, 2); assert.equal(h.notices.length, 0);
  const restarted = await harness(h.local); assert.equal((await restarted.manager.snapshot()).total, 2); assert.equal(restarted.notices.length, 0);
});
test('the configured account and progress preferences never become model prompt data', async () => {
  const { C } = await harness(), options = C.settings({ xAccount: 'private_handle', autoFollowDaily: 400 });
  const prompt = JSON.stringify(C.messages(C.source({ url: 'https://x.com/author/status/1', text: 'Hello' }), options)); assert.equal(prompt.includes('private_handle'), false);
});
