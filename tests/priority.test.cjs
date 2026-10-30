const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
require('../shared.js'); require('../priority.js');
const P = globalThis.MagpiePriority, C = globalThis.MagpieReply;
const valid = (account = 'alpha', checkedAt = 1000000, viewer = 'writer') => ({ account, viewer, relationship: 'not-following', checkedAt, following: 1200, followers: 800, verified: true, status: 'ready' });
async function harness(options = {}) {
  let time = 1000000, settings = { timelinePriorityEnabled: options.enabled !== false }, timer = null, alarm = null, visible = true, activated;
  const local = { priorityProfileCache: options.initial }, session = {}, views = [], messages = [], closed = [];
  const area = store => ({ get: async key => ({ [key]: store[key] }), set: async input => Object.assign(store, structuredClone(input)), remove: async key => { delete store[key]; } });
  const sandbox = vm.createContext({ structuredClone, crypto: require('node:crypto').webcrypto, setTimeout, clearTimeout, console, chrome: {
    storage: { local: area(local), session: area(session) },
    alarms: { get: async () => alarm, create: async (name, value) => { alarm = { name, ...value }; }, clear: async () => { alarm = null; }, onAlarm: { addListener() {} } },
    tabs: { onRemoved: { addListener() {} }, onActivated: { addListener: fn => { activated = fn; } }, get: async id => ({ id, active: false, url: 'https://x.com/alpha' }), remove: async id => { closed.push(id); }, query: async () => [], sendMessage: async (tab, message) => { messages.push(message); return { ok: true, data: { visible } }; } }
  } });
  for (const file of ['priority.js', 'priority-background.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), sandbox);
  const manager = sandbox.MagpiePriorityBackground.create({ getSettings: async () => settings, now: () => time,
    setTimer: fn => { timer = fn; return 1; }, clearTimer: () => { timer = null; },
    loadProfile: async job => { views.push(job.account); return options.load ? options.load(job) : valid(job.account, time, job.viewer); }
  }); await manager.ready;
  const request = (accounts = ['alpha'], tab = 1, viewer = 'writer') => manager.request({ viewer, accounts, candidates: accounts, visible: true }, tab);
  return { manager, request, views, messages, local, closed, activate: tabId => activated({ tabId }), advance: ms => { time += ms; }, clock: () => time, visible: value => { visible = value; },
    enable: async value => { const previous = settings; settings = { timelinePriorityEnabled: value }; await manager.configure(previous, settings); }, timer: () => timer, alarm: () => alarm };
}
test('timeline profile reads are opt-in and preserve all existing green-card defaults', () => {
  assert.equal(C.settings().timelinePriorityEnabled, false); assert.equal(C.settings({ profilePriorityEnabled: true }).timelinePriorityEnabled, false);
  assert.equal(C.settings({ timelinePriorityEnabled: true }).timelinePriorityEnabled, true); assert.equal(C.settings().profilePriorityEnabled, true);
});
test('cache identity, numeric counts, verification, expiry and strict green boundaries are validated', () => {
  assert.equal(P.account('@Alpha'), 'alpha'); assert.equal(P.account('../alpha'), '');
  for (const input of [{ ...valid(), following: '1200' }, { ...valid(), followers: -1 }, { ...valid(), verified: 'true' }, { ...valid(), checkedAt: 2000000 }]) assert.equal(P.record(input, 1000000), null);
  assert.equal(P.qualifies(valid()), true);
  for (const input of [{ ...valid(), verified: false }, { ...valid(), followers: 500 }, { ...valid(), following: 800 }, { ...valid(), status: 'unavailable' }]) assert.equal(P.qualifies(input), false);
  assert.equal(P.fresh(valid(), 1000000 + P.TTL), false); assert.equal(P.fresh({ account: 'alpha', checkedAt: 1000000, status: 'unavailable' }, 1000000 + P.RETRY), false);
  const rows = Array.from({ length: 600 }, (_, i) => valid('p' + i, 1000000 + i)); assert.equal(P.state({ records: rows }, 1000600).records.length, 500);
});
test('disabled lookup requests perform no profile reads or cache writes', async () => {
  const h = await harness({ enabled: false }); await h.request(); await h.manager.drain();
  assert.equal(h.views.length, 0); assert.equal(h.local.priorityProfileCache, undefined);
});
test('cached public counts are reused across tabs without another page read', async () => {
  const h = await harness(); await h.request(); await h.manager.drain(); const result = await h.request(['alpha'], 2); await h.manager.drain();
  assert.deepEqual(h.views, ['alpha']); assert.equal(result.profiles[0].following, 1200);
  const restored = await harness({ initial: h.local.priorityProfileCache }); await restored.request(); await restored.manager.drain(); assert.equal(restored.views.length, 0);
  assert.equal(h.messages.some(row => row.type === 'PRIORITY_PROFILE_UPDATED'), true);
});
test('a persistent minimum twenty-second gap and three-per-minute limit cover simultaneous tabs and worker restarts', async () => {
  const h = await harness(); await h.request(['alpha', 'beta', 'gamma', 'delta']); await Promise.all([h.manager.drain(), h.manager.drain()]);
  assert.deepEqual(h.views, ['alpha']); h.advance(19999); await h.manager.drain(); assert.equal(h.views.length, 1);
  h.advance(1); await h.request(['beta', 'gamma', 'delta']); await h.manager.drain(); assert.equal(h.views.length, 2);
  h.advance(20000); await h.request(['gamma', 'delta']); await h.manager.drain(); assert.equal(h.views.length, 3);
  const restored = await harness({ initial: { starts: [980000, 1000000] } }); await restored.request(); await restored.manager.drain(); assert.equal(restored.views.length, 0);
  h.advance(19999); await h.manager.drain(); assert.equal(h.views.length, 3);
  h.advance(1); await h.request(['delta']); await h.manager.drain(); assert.equal(h.views.length, 4);
});
test('scrolled-away and expired viewport interests never start a profile read', async () => {
  const h = await harness(); await h.request(); h.visible(false); await h.manager.drain(); assert.equal(h.views.length, 0);
  h.visible(true); await h.request(); h.advance(30001); await h.manager.drain(); assert.equal(h.views.length, 0);
});
test('unknown counts and failures are cached as unavailable rather than recommended or retried repeatedly', async () => {
  const h = await harness({ load: async () => { throw Object.assign(new Error('missing'), { code: 'PRIORITY_SOURCE' }); } });
  await h.request(); await h.manager.drain(); h.advance(60000); await h.request(); await h.manager.drain();
  assert.equal(h.views.length, 1); assert.equal(h.local.priorityProfileCache.records[0].status, 'unavailable');
});
test('login or verification limits pause reads without clicking anything and clearing cache retains the request budget', async () => {
  const h = await harness({ load: async () => { throw Object.assign(new Error('verification'), { code: 'PRIORITY_BLOCKED' }); } });
  await h.request(['alpha', 'beta']); await h.manager.drain(); assert.ok((await h.manager.status()).pausedUntil > h.clock());
  h.advance(20000); await h.request(['beta']); await h.manager.drain(); assert.equal(h.views.length, 1);
  await h.manager.clear(); assert.equal((await h.manager.status()).pausedUntil, 0); assert.equal(h.local.priorityProfileCache.starts.length, 1);
  assert.equal(h.messages.some(row => /FOLLOWBACK_CONFIRM|FOLLOWBACK_SCAN/u.test(row.type)), false);
});
test('hover or foreground profile observations populate the same cache without consuming a lookup', async () => {
  const h = await harness(); await h.manager.observe(valid('alpha')); await h.request(); await h.manager.drain();
  assert.equal(h.views.length, 0); assert.equal(h.local.priorityProfileCache.records[0].account, 'alpha');
});
test('disabling or clearing during an outstanding read cannot resurrect the old profile result', async () => {
  let done; const h = await harness({ load: () => new Promise(resolve => { done = resolve; }) }); await h.request(); const running = h.manager.drain();
  for (let i = 0; i < 20 && !done; i++) await new Promise(resolve => setImmediate(resolve));
  await h.enable(false); done(valid()); await running; assert.equal(h.local.priorityProfileCache.records.length, 0);
  assert.equal(h.timer(), null); assert.equal(h.alarm(), null);
});
test('temporary profile tabs the user has opened stay open even after becoming inactive', async () => {
  const untouched = await harness({ load: async job => { job.tabId = 101; return valid(); } }); await untouched.request(); await untouched.manager.drain(); assert.deepEqual(untouched.closed, [101]);
  const touched = await harness({ load: async job => { job.tabId = 102; touched.activate(102); return valid(); } }); await touched.request(); await touched.manager.drain(); assert.deepEqual(touched.closed, []);
});
test('recommendations require this viewers explicit unfollowed state, never an old public-only cache entry', () => {
  assert.equal(P.recommend(valid(), 'writer', 1000000), true);
  for (const row of [{ ...valid(), relationship: 'following' }, { ...valid(), relationship: 'requested' }, { ...valid(), relationship: 'unknown' }, { ...valid(), viewer: 'another' }, { ...valid(), viewer: '' }, { ...valid(), account: 'writer' }]) assert.equal(P.recommend(row, 'writer', 1000000), false);
  assert.equal(P.recommend(valid(), '', 1000000), false); assert.equal(P.recommend(valid(), 'writer', 1000000 + P.RELATION_TTL), false);
});
test('one target can have independent cached relationships for two signed-in viewers', async () => {
  const h = await harness(); await h.manager.observe(valid()); await h.manager.observe({ ...valid('alpha', h.clock(), 'another'), relationship: 'following' });
  const first = await h.request(['alpha'], 1, 'writer'), second = await h.request(['alpha'], 2, 'another');
  assert.equal(first.profiles[0].relationship, 'not-following'); assert.equal(second.profiles[0].relationship, 'following');
  assert.equal(P.recommend(first.profiles[0], 'writer', h.clock()), true); assert.equal(P.recommend(first.profiles[0], 'another', h.clock()), false);
  assert.equal(h.local.priorityProfileCache.records.length, 2); assert.equal(h.views.length, 0);
});
test('unknown viewers cannot trigger background lookups and unfollowed relationships are refreshed after five minutes', async () => {
  const h = await harness(); await h.request(['alpha'], 1, ''); await h.manager.drain(); assert.equal(h.views.length, 0);
  await h.request(); await h.manager.drain(); assert.equal(h.views.length, 1);
  h.advance(P.RELATION_TTL + 1); await h.request(); await h.manager.drain(); assert.equal(h.views.length, 2);
});
test('a confirmed follow or pending request updates the cache immediately and cannot be undone by an older in-flight read', async () => {
  let done; const h = await harness({ load: () => new Promise(resolve => { done = resolve; }) });
  await h.request(); const running = h.manager.drain(); for (let i = 0; i < 20 && !done; i++) await new Promise(resolve => setImmediate(resolve));
  await h.manager.followed({ account: 'writer', target: 'alpha', status: 'followed', at: h.clock() }); done(valid()); await running;
  assert.equal((await h.request()).profiles[0].relationship, 'following'); assert.equal(P.recommend((await h.request()).profiles[0], 'writer', h.clock()), false);
  h.advance(1); await h.manager.followed({ account: 'writer', target: 'alpha', status: 'requested', at: h.clock() }); assert.equal((await h.request()).profiles[0].relationship, 'requested');
});
test('a profile read reporting Following overrides a conflicting unfollowed observation made while it loaded', async () => {
  let done; const h = await harness({load:()=>new Promise(resolve=>{done=resolve})}); await h.request(); const running=h.manager.drain();
  for(let i=0;i<20&&!done;i++) await new Promise(resolve=>setImmediate(resolve));
  h.advance(1); await h.manager.observe(valid('alpha',h.clock())); done({...valid('alpha',h.clock()),relationship:'following'}); await running;
  assert.equal((await h.request()).profiles[0].relationship,'following');
});
test('an inline Following control without counts suppresses recommendations without opening another profile', async () => {
  const h=await harness(); await h.manager.observe({account:'alpha',viewer:'writer',relationship:'following',status:'unavailable'}); await h.request(); await h.manager.drain();
  assert.equal(h.views.length,0); assert.equal((await h.request()).profiles[0].relationship,'following');
});
