const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const extension = path.resolve(__dirname, '..');
const texts = ['先明确验收标准，确实能减少反复修改。', '也可以把关键要求变成几个可运行的例子。', '你们如何确认需求已经足够明确？', '探索未知需求时，先做小实验可能也很有帮助。'];
const sender = { id: 'test-id', url: 'https://x.com/alice/status/123', frameId: 0, tab: { id: 8 } };
const popup = { id: 'test-id', url: 'chrome-extension://test-id/popup.html' };
function harness(options = {}) {
  const stores = { local: {}, session: {} }, requests = [];
  let listener;
  const area = name => ({
    get: async key => ({ [key]: stores[name][key] }),
    set: async value => { Object.assign(stores[name], value); },
    remove: async key => { delete stores[name][key]; },
    setAccessLevel: async () => {}
  });
  const sandbox = vm.createContext({
    URL, TextEncoder, TextDecoder, AbortController, DOMException, Headers, Response, ReadableStream,
    crypto: webcrypto, setInterval, clearInterval, setTimeout, clearTimeout, console,
    chrome: {
      runtime: { id: 'test-id', getURL: p => `chrome-extension://test-id/${p}`, getPlatformInfo: async () => ({}), onMessage: { addListener: fn => { listener = fn; } } },
      storage: { local: area('local'), session: area('session') },
      tabs: { onRemoved: { addListener() {} }, query: async () => [], create: async () => ({}), sendMessage: async () => ({ ok: true }) }
    },
    fetch: async (url, init) => {
      requests.push({ url, headers: init.headers, body: init.body });
      if (url.endsWith('/api/hello')) return Response.json({ name: options.wrongService ? 'other' : 'magpie', version: 'test' });
      if (url.endsWith('/v1/models')) return Response.json({ data: [{ id: 'group/test', display_name: 'Test group' }] });
      assert.equal(url, 'http://127.0.0.1:3425/v1/chat/completions');
      if (options.status) return new Response('SECRET_UPSTREAM_KEY', { status: options.status });
      if (options.delay) await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, options.delay);
        const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
        init.signal.addEventListener('abort', abort, { once: true });
      });
      const isSummary = JSON.parse(init.body).messages[0].content.includes('整理可用于模仿');
      const value = isSummary ? options.summary || '# 语气记忆\n\n- 短句，直接接话。\n- 偶尔用“呗”，不用固定问好。' : JSON.stringify({ replies: options.replies || texts });
      const chunks = [value.slice(0, 30), value.slice(30)];
      const stream = chunks.map(content => 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\r\n\r\n').join('') + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: options.incomplete ? 'length' : 'stop' }] }) + '\r\n\r\ndata: [DONE]\r\n\r\n';
      const bytes = new TextEncoder().encode(stream);
      const emitted = options.holdOpen ? new TextEncoder().encode(stream.replace('data: [DONE]\r\n\r\n', '')) : bytes;
      return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < emitted.length; i += 7) controller.enqueue(emitted.slice(i, i + 7)); if (!options.holdOpen) controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
    }
  });
  sandbox.importScripts = (...files) => { for (const file of files) vm.runInContext(fs.readFileSync(path.join(extension, file), 'utf8'), sandbox); };
  vm.runInContext(fs.readFileSync(path.join(extension, 'background.js'), 'utf8'), sandbox);
  return { stores, requests, send: (message, from = sender) => new Promise(resolve => { assert.equal(listener(message, from, resolve), true); }) };
}
const request = (requestId = 'request_1', force = false) => ({ type: 'GENERATE', requestId, force, source: { url: 'https://x.com/alice/status/123', text: 'UNIQUE_SOURCE_123 小团队先明确验收标准再使用 AI。' } });
test('X content scripts cannot ask the background to confirm follows or change follow-back lists', async()=>{
  const h=harness();for(const type of ['FOLLOWBACK_STATUS','FOLLOWBACK_CHECK','FOLLOWBACK_CONFIRM','FOLLOWBACK_IGNORE','FOLLOWBACK_IDENTIFY','IDENTIFY_X_ACCOUNT','PRIORITY_STATUS','CLEAR_PRIORITY_CACHE','AUTOFOLLOW_STATUS','AUTOFOLLOW_PAUSE','AUTOFOLLOW_RESUME','AUTOFOLLOW_IGNORE'])assert.equal((await h.send({type,account:'victim'})).error.code,'DENIED');
});
test('content pages can read only the configured follow progress and cannot forge a success event', async()=>{
  const h=harness();h.stores.local.settings={xAccount:'writer'};
  assert.equal((await h.send({type:'GET_FOLLOW_ACTIVITY',account:'someoneelse'})).error.code,'DENIED');
  assert.equal((await h.send({type:'GET_FOLLOW_ACTIVITY',account:'writer'})).data.total,0);
  assert.equal((await h.send({type:'RECORD_FOLLOW_ACTIVITY',event:{id:'forged',account:'writer',target:'victim',source:'auto',status:'followed',at:Date.now()}})).ok,false);
  assert.equal((await h.send({type:'GET_FOLLOW_ACTIVITY',account:'writer'})).data.total,0);
});
test('real worker dispatch generates four replies via fixed local identity and caches no source body', async () => {
  const h = harness();
  const first = await h.send(request());
  assert.equal(first.ok, true); assert.equal(first.data.replies.length, 4);
  const second = await h.send(request('request_2'));
  assert.equal(second.data.cached, true);
  assert.equal(h.requests.filter(r => r.body).length, 1);
  assert.equal(h.requests.at(-1).headers.Authorization, 'Bearer magpie-x-reply');
  assert.equal(JSON.stringify(h.stores).includes('UNIQUE_SOURCE_123'), false);
  await h.send(request('request_3', true));
  assert.equal(h.requests.filter(r => r.body).length, 2);
});
test('worker rejects foreign origins, child frames and content-script settings mutations', async () => {
  const h = harness();
  for (const from of [{ ...sender, url: 'https://evil.test' }, { ...sender, id: 'foreign-id' }, { ...sender, frameId: 1 }]) assert.equal((await h.send(request(), from)).error.code, 'DENIED');
  assert.equal((await h.send({ type: 'SAVE_SETTINGS', settings: { port: 5555 } })).error.code, 'DENIED');
  assert.equal((await h.send(request(), popup)).error.code, 'DENIED');
  assert.equal(h.requests.length, 0);
});
test('wrong local service and invalid source cannot invoke a model', async () => {
  const h = harness({ wrongService: true });
  assert.equal((await h.send(request())).error.code, 'NOT_MAGPIE');
  assert.equal(h.requests.some(r => r.body), false);
  const invalid = { ...request(), source: { url: 'https://evil.test/a/status/123', text: 'hello' } };
  assert.equal((await harness().send(invalid)).error.code, 'SOURCE');
});
test('saved missing model fails explicitly instead of switching to another billed model', async () => {
  const h = harness(); h.stores.local.settings = { model: 'removed/model' };
  assert.equal((await h.send(request())).error.code, 'MODEL_GONE');
  assert.equal(h.requests.some(r => r.body), false);
});
test('upstream auth error reports a useful local message without echoing secrets', async () => {
  const result = await harness({ status: 401 }).send(request());
  assert.equal(result.error.code, 'HTTP_401');
  assert.equal(JSON.stringify(result).includes('SECRET_UPSTREAM_KEY'), false);
});
test('bad candidate count and incomplete streams are rejected and not cached', async () => {
  const a = harness({ replies: texts.slice(0, 3) });
  assert.equal((await a.send(request())).error.code, 'COUNT');
  assert.equal(a.stores.session.replyCache, undefined);
  const b = harness({ incomplete: true });
  assert.equal((await b.send(request())).error.code, 'INCOMPLETE');
  assert.equal(b.stores.session.replyCache, undefined);
});
test('navigation cancellation aborts a running model request', async () => {
  const h = harness({ delay: 1000 });
  const pending = h.send(request());
  await new Promise(resolve => setTimeout(resolve, 20));
  await h.send({ type: 'CANCEL', requestId: 'request_1' });
  assert.equal((await pending).error.code, 'CANCELLED');
  assert.equal(h.stores.session.replyCache, undefined);
});
test('only the owning tab can cancel its request', async () => {
  const h = harness({ delay: 50 });
  const pending = h.send(request());
  await new Promise(resolve => setTimeout(resolve, 10));
  await h.send({ type: 'CANCEL', requestId: 'request_1' }, { ...sender, tab: { id: 99 } });
  assert.equal((await pending).ok, true);
});
test('context and writing preferences participate in the cache identity', async () => {
  const h = harness();
  await h.send(request());
  const withContext = { ...request('request_2'), source: { ...request().source, context: { items: [{ kind: 'root', author: 'A', text: '更早的主帖' }], coverage: 'loaded' } } };
  await h.send(withContext);
  assert.equal(h.requests.filter(r => r.body).length, 2);
  h.stores.local.settings = { tone: '更直接' };
  await h.send({ ...withContext, requestId: 'request_3' });
  assert.equal(h.requests.filter(r => r.body).length, 3);
  const sent = JSON.parse(h.requests.at(-1).body);
  assert.match(sent.messages[0].content, /更直接/);
  assert.equal(JSON.parse(sent.messages[1].content).conversation_before[0].text, '更早的主帖');
  assert.equal(JSON.stringify(h.stores.session).includes('更早的主帖'), false);
});
test('banned output is not cached or returned and configured labels are respected', async () => {
  const h = harness(); h.stores.local.settings = { bannedTerms: ['验收标准'] };
  assert.equal((await h.send(request())).error.code, 'BANNED_TERM');
  assert.equal(h.stores.session.replyCache, undefined);
  h.stores.local.settings = { candidatePreferences: [1, 2, 3, 4].map(n => ({ label: `我的选项${n}`, prompt: `表达要求${n}` })) };
  const result = await h.send(request('request_2'));
  assert.equal(result.data.replies[0].label, '我的选项1');
});
test('changing conversational mode invalidates otherwise identical cached suggestions', async () => {
  const h = harness();
  await h.send(request());
  h.stores.local.settings = { conversational: false };
  const result = await h.send(request('request_2'));
  assert.equal(result.data.cached, false);
  assert.equal(h.requests.filter(row => row.body).length, 2);
  assert.doesNotMatch(JSON.parse(h.requests.at(-1).body).messages[0].content, /【口语表达】/);
});
test('completed model replies do not wait for an optional DONE frame on an open stream', async () => {
  const h = harness({ holdOpen: true });
  const pending = h.send(request());
  let timer;
  const result = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve(null), 700); })]);
  clearTimeout(timer);
  if (!result) await h.send({ type: 'CANCEL', requestId: 'request_1' });
  assert.ok(result, 'A finish_reason must finish generation even while the SSE connection stays open');
  assert.equal(result.ok, true); assert.equal(result.data.replies.length, 4);
});

const capture = (n = 1, account = 'alice', text = '先跑起来再说呗，光看文档哪知道。') => ({ type: 'CAPTURE_HANDWRITTEN', account, confirmed: true, assisted: false, sample: { url: `https://x.com/${account}/status/${1000 + n}`, text, kind: 'reply' } });
test('confirmed handwriting is collected locally once, with no automatic model calls', async () => {
  const h = harness();
  const first = await h.send(capture());
  assert.equal(first.data.saved, true); assert.equal(first.data.count, 1);
  assert.equal((await h.send(capture())).data.saved, false);
  assert.equal(h.requests.length, 0);
  assert.equal((await h.send({ ...capture(2), confirmed: false })).data.saved, false);
  assert.equal((await h.send({ ...capture(2), assisted: true })).data.saved, false);
  assert.equal((await h.send(capture(2), popup)).error.code, 'DENIED');
  assert.equal((await h.send({ type: 'GET_VOICE_MEMORY' })).error.code, 'DENIED');
  assert.equal((await h.send({ type: 'SUMMARIZE_VOICE_MEMORY', account: 'alice' })).error.code, 'DENIED');
  h.stores.local.settings = { collectWritingSamples: false };
  assert.equal((await h.send(capture(3))).data.saved, false);
  assert.equal(h.stores.local.voiceMemory.accounts[0].samples.length, 1);
});
test('generated candidates and edited candidate text marked at copy time are excluded from handwriting', async () => {
  const h = harness(); await h.send(request());
  assert.equal((await h.send(capture(1, 'alice', texts[0]))).data.saved, false);
  await h.send({ type: 'MARK_ASSISTED_TEXT', text: '在候选卡片里改写过的文字' });
  assert.equal((await h.send(capture(2, 'alice', '在候选卡片里改写过的文字'))).data.saved, false);
  assert.equal(h.stores.local.voiceMemory, undefined);
  assert.equal(JSON.stringify(h.stores.session.generatedReplyHashes).includes('在候选'), false);
});
test('parallel sample writes retain recent samples separately for each account', async () => {
  const h = harness();
  const results = await Promise.all(Array.from({ length: 85 }, (_, i) => h.send(capture(i))));
  assert.ok(results.every(row => row.ok));
  await h.send(capture(1, 'bob', '另一个人的说法。'));
  const info = (await h.send({ type: 'GET_VOICE_MEMORY', account: 'alice' }, popup)).data;
  assert.equal(info.profile.samples.length, 80);
  assert.equal(new Set(info.profile.samples.map(row => row.url)).size, 80);
  assert.equal(info.profile.sampleRevision, 85);
  assert.equal(info.accounts.length, 2); assert.equal(h.requests.length, 0);
});
test('only an explicit settings action summarizes this account and keeps raw samples out of future replies', async () => {
  const h = harness();
  await h.send(capture(1, 'alice', 'UNIQUE_HANDWRITTEN_TEXT 写两句就够了呗。'));
  await h.send(capture(2, 'bob', 'OTHER_ACCOUNT_PRIVATE_SAMPLE'));
  assert.equal(h.requests.length, 0);
  const result = await h.send({ type: 'SUMMARIZE_VOICE_MEMORY', account: 'alice' }, popup);
  assert.equal(result.ok, true); assert.match(result.data.profile.markdown, /^# 语气记忆/);
  const summaryBody = JSON.parse(h.requests.find(row => row.body).body);
  assert.equal(JSON.parse(summaryBody.messages[1].content).handwritten_samples.length, 1);
  assert.doesNotMatch(summaryBody.messages[1].content, /OTHER_ACCOUNT|https:\/\//u);
  await h.send({ ...request(), account: 'alice' });
  const replyBody = JSON.parse(h.requests.at(-1).body), user = JSON.parse(replyBody.messages[1].content);
  assert.match(user.voice_style_memory, /短句/);
  assert.doesNotMatch(JSON.stringify(replyBody), /UNIQUE_HANDWRITTEN_TEXT|OTHER_ACCOUNT_PRIVATE_SAMPLE/u);
  assert.equal((await h.send({ ...request('missing'), account: 'bob' })).data.voiceUsed, false);
  assert.equal((await h.send(request('unknown'))).data.voiceUsed, false);
  h.stores.local.settings = { useVoiceMemory: false };
  assert.equal((await h.send({ ...request('disabled'), account: 'alice' })).data.voiceUsed, false);
  assert.equal(JSON.parse(JSON.parse(h.requests.at(-1).body).messages[1].content).voice_style_memory, undefined);
});
test('editing or deleting voice memory invalidates replies and clearing one account preserves the other', async () => {
  const h = harness(); await h.send(capture()); await h.send(capture(1, 'bob'));
  await h.send({ type: 'SAVE_VOICE_MEMORY', account: 'alice', markdown: '# 我的语气\n短句就行。' }, popup);
  assert.equal((await h.send({ ...request(), account: 'alice' })).data.voiceUsed, true);
  assert.ok(h.stores.session.replyCache);
  await h.send({ type: 'DELETE_WRITING_SAMPLE', account: 'alice', url: capture().sample.url }, popup);
  assert.equal(h.stores.local.voiceMemory.accounts[0].markdown, '');
  assert.equal(h.stores.session.replyCache, undefined);
  await h.send({ type: 'CLEAR_VOICE_MEMORY', account: 'alice' }, popup);
  assert.equal(h.stores.local.voiceMemory.accounts.length, 1); assert.equal(h.stores.local.voiceMemory.accounts[0].account, 'bob');
});
test('new samples collected during a summary are preserved and marked as not summarized yet', async () => {
  const h = harness({ delay: 50 }); await h.send(capture());
  const pending = h.send({ type: 'SUMMARIZE_VOICE_MEMORY', account: 'alice' }, popup);
  await new Promise(resolve => setTimeout(resolve, 15)); await h.send(capture(2));
  const result = await pending;
  assert.equal(result.ok, true); assert.equal(result.data.profile.samples.length, 2);
  assert.equal(result.data.profile.summaryRevision, 1); assert.equal(result.data.profile.sampleRevision, 2);
});
test('clearing or editing while a model is summarizing cannot resurrect deleted data or overwrite edits', async () => {
  for (const operation of ['CLEAR_VOICE_MEMORY', 'SAVE_VOICE_MEMORY']) {
    const h = harness({ delay: 80 }); await h.send(capture());
    const pending = h.send({ type: 'SUMMARIZE_VOICE_MEMORY', account: 'alice' }, popup);
    await new Promise(resolve => setTimeout(resolve, 20));
    await h.send({ type: operation, account: 'alice', markdown: '# 保留我手写的总结' }, popup);
    assert.equal((await pending).ok, false);
    if (operation === 'CLEAR_VOICE_MEMORY') assert.equal(h.stores.local.voiceMemory.accounts.length, 0);
    else assert.equal(h.stores.local.voiceMemory.accounts[0].markdown, '# 保留我手写的总结');
  }
});
