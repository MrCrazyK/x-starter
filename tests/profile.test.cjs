const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../shared.js');
require('../profile.js');
const C = globalThis.MagpieReply, P = globalThis.MagpieProfile;
test('profile counts support full digits, thousands separators, English units and Chinese units', () => {
  for (const [input, expected] of [['4,860 Following', 4860], ['Followers 4,742', 4742], ['０', 0], ['3.2K', 3200], ['3.234K', 3234], ['1.2M Followers', 1200000], ['2.5万 粉丝', 25000], ['1.1亿', 110000000], ['关注 2,000', 2000], ['4\u202f860', 4860], ['2,5K', 2500], ['1,234.5K', 1234500]]) assert.equal(P.parseCount(input), expected, input);
});
test('unknown, lower-bound, negative and ambiguous count text is not treated as zero', () => {
  for (const input of ['', '—', '…', '-2000', '2K+', '2K Following 4K Followers', 'not loaded', '12.5', null, Infinity]) assert.equal(P.parseCount(input), null, String(input));
});
test('the 20 percent threshold includes the exact boundary and uses followers as its denominator', () => {
  assert.equal(P.qualifies(2000, 4000), true); assert.equal(P.qualifies(3200, 4000), true); assert.equal(P.qualifies(3201, 4000), false);
  assert.equal(P.qualifies(4860, 4742), false); assert.equal(P.qualifies(4000, 4000), false);
  assert.equal(P.qualifies(2000, 4000, 50), true); assert.equal(P.qualifies(2000, 4000, 51), false);
  assert.equal(P.qualifies(0, 4000, 100), true); assert.equal(P.qualifies(0, 0), false);
  assert.equal(P.qualifies(null, 4000), false); assert.equal(P.qualifies(2000, null), false); assert.equal(P.qualifies(-1, 4000), false);
  assert.equal(P.qualifies(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0), true);
});
test('new and legacy settings enable the local highlight at 20 percent and validate editable percentages', () => {
  assert.equal(C.settings().profileHighlightEnabled, true); assert.equal(C.settings().profileGapThreshold, 20);
  const migrated = C.settings({ model: 'my/model', autoGenerate: false, tone: '我的语气' });
  assert.equal(migrated.model, 'my/model'); assert.equal(migrated.tone, '我的语气'); assert.equal(migrated.autoGenerate, false);
  assert.equal(C.settings({ profileGapThreshold: '50', profileHighlightEnabled: false }).profileGapThreshold, 50);
  assert.equal(C.settings({ profileHighlightEnabled: false }).profileHighlightEnabled, false);
  for (const value of [-1, 101, 20.5, '', ' ', 'oops', true, []]) assert.throws(() => C.settings({ profileGapThreshold: value }), { code: 'PREFERENCES' });
});
test('profile marker preferences do not become model prompt data', () => {
  const source = C.source({ url: 'https://x.com/a/status/1', text: '普通帖子' });
  const prompt = JSON.stringify(C.messages(source, C.settings({ profileGapThreshold: 39 })));
  assert.doesNotMatch(prompt, /profileGapThreshold|profileHighlightEnabled|profilePriorityEnabled|followbackEnabled|followbackAccount|芥末黄/);
});
test('green needs verification, more following than followers, and strictly over 500 followers', () => {
  assert.equal(P.priority(601, 600, true), true); assert.equal(P.priority(502, 501, true), true);
  for (const args of [[600,500,true],[501,501,true],[500,501,true],[900,600,false],[900,600,'true'],[null,600,true],[900,null,true],[-1,600,true],[Infinity,600,true]]) assert.equal(P.priority(...args), false, String(args));
  assert.equal(C.settings().profilePriorityEnabled, true);
  assert.equal(C.settings({profilePriorityEnabled:false}).profilePriorityEnabled, false);
});
