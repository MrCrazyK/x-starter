'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const testOutput = path.join(root, '.test-output'); fs.mkdirSync(testOutput, { recursive: true });
const evidence = { checks: [], pageErrors: [], live: null };
const requests = [];
const mockMarkdown = '# 语气记忆\n\n## 说话习惯\n- 用短句，直接接话。\n- 常用“呗”，偶尔反问，不写客套开场。\n\n## 表达参考\n- 先试试呗。\n- 想那么多干嘛。';
const replies = ['先把要做啥说清楚呗，省得来回改。', '需求还没想明白，代码倒是跑得挺快。', '需求都没说清，提示词改一百遍也白搭。', '先定好怎么算做完，再让工具干活就顺了。'];
const handwritten = ['先做个能跑的呗，想那么多干嘛。', '这事先试两天。好不好用，自己一跑就知道。'];
function fixture() { return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font:15px/1.6 sans-serif;background:#edf3f5;margin:0;color:#21333b}nav{padding:14px;background:#fff}main{margin:25px 60px;width:600px}article{background:white;padding:20px;border:1px solid #ccd8de;margin-bottom:14px;border-radius:12px}[contenteditable]{background:#fff;border:1px solid #b7c8cf;padding:15px;min-height:65px}button{padding:8px 14px;border:1px solid #8caca2;border-radius:6px;background:#d6eee5;cursor:pointer}[data-testid=toast]{position:fixed;left:40px;bottom:15px;background:#204c41;color:white;padding:10px}</style><nav>本地手写发布测试 · <a data-testid="AppTabBar_Profile_Link" href="/manualuser">@manualuser</a></nav><main><section data-testid="conversation"><article data-testid="tweet"><div data-testid="User-Name">林舟 @linzhou</div><a href="/linzhou/status/111"><time datetime="2026-10-28T00:00:00Z">今天</time></a><p data-testid="tweetText">小团队用 AI 写代码，先把需求和验收标准说清楚，比反复改提示词更省时间。</p><div role="group"><button data-testid="reply">回复</button></div></article><div id="composer"><div contenteditable="true" role="textbox" data-testid="tweetTextarea_0"></div><button id="publish" data-testid="tweetButtonInline" disabled>发布</button></div></section><div id="published"></div></main><script>
window.fixtureMode='dom';window.fixturePublished=0;window.fixtureNext=Date.now();
function ownAccount(){return document.querySelector('[data-testid=AppTabBar_Profile_Link]')?.getAttribute('href').slice(1)||'manualuser'}
window.fixtureAddPost=function(text,account,id){const article=document.createElement('article');article.dataset.testid='tweet';const author=document.createElement('div');author.dataset.testid='User-Name';author.textContent='@'+account;const link=document.createElement('a');link.href='/'+account+'/status/'+id;const time=document.createElement('time');time.textContent='刚刚';link.append(time);const body=document.createElement('p');body.dataset.testid='tweetText';body.textContent=text;const actions=document.createElement('div');actions.setAttribute('role','group');actions.innerHTML='<button data-testid="reply">回复</button>';article.append(author,link,body,actions);document.getElementById('published').prepend(article)};
const editor=document.querySelector('[contenteditable]'),publish=document.getElementById('publish');editor.addEventListener('input',()=>{publish.disabled=!editor.innerText.trim()});
publish.addEventListener('click',()=>{if(window.fixtureMode==='failure')return;const text=editor.innerText,account=ownAccount(),id=++window.fixtureNext;window.fixturePublished++;document.querySelectorAll('[data-testid=toast]').forEach(x=>x.remove());if(window.fixtureMode!=='toast')window.fixtureAddPost(text,account,id);else{const toast=document.createElement('div');toast.dataset.testid='toast';const link=document.createElement('a');link.href='/'+account+'/status/'+id;link.textContent='查看已发布内容';toast.append(link);document.body.append(toast)}editor.textContent='';editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));});
</script></html>`; }
const server = http.createServer(async (request, response) => {
  if (request.url === '/api/hello') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ name: 'magpie', version: 'memory-test' })); return; }
  if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'group/memory-test' }] })); return; }
  if (request.url !== '/v1/chat/completions') { response.writeHead(404); response.end(); return; }
  let raw = ''; for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw); requests.push(body);
  const summary = body.messages[0].content.includes('整理可用于模仿');
  const content = summary ? mockMarkdown : JSON.stringify({ replies: replies.map(text => ({ text })) });
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.end('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n');
});
async function step(name, fn) { const start = Date.now(); await fn(); evidence.checks.push({ name, pass: true, ms: Date.now() - start }); console.log('PASS ' + name); }
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const context = await chromium.launchPersistentContext(path.join(testOutput, `browser-memory-${Date.now()}`), { channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`], viewport: { width: 1250, height: 1100 }, timeout: 25000 });
  context.on('page', page => page.on('pageerror', error => evidence.pageErrors.push(error.message)));
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionBase = worker.url().replace('/background.js', '');
    await worker.evaluate(async port => chrome.storage.local.set({ settings: { port, autoGenerate: false } }), port);
    await context.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture() }));
    const page = await context.newPage(), settings = await context.newPage();
    const panel = page.locator('#magpie-x-reply-root'), editor = page.locator('[contenteditable]');
    const saved = () => worker.evaluate(async () => (await chrome.storage.local.get('voiceMemory')).voiceMemory);
    const count = async (account = 'manualuser') => (await saved())?.accounts.find(row => row.account === account)?.samples.length || 0;
    const waitCount = async (expected, account = 'manualuser') => {
      const found = await worker.evaluate(async ({ expected, account }) => {
        for (let i = 0; i < 100; i++) {
          if (((await chrome.storage.local.get('voiceMemory')).voiceMemory?.accounts.find(row => row.account === account)?.samples.length || 0) === expected) return true;
          await new Promise(resolve => setTimeout(resolve, 60));
        }
        return false;
      }, { expected, account });
      if (!found) console.error('COLLECTION_DIAGNOSTIC', { expected, account, saved: await saved(), note: await panel.locator('#voice-note').innerText() });
      assert.equal(found, true, `Expected ${expected} samples for ${account}`);
    };
    const visit = async url => { await page.goto(url); await page.locator('[data-magpie-action]').first().waitFor(); };
    const publish = async (text, mode = 'dom') => { await page.evaluate(mode => { window.fixtureMode = mode; }, mode); await editor.fill(text); await page.locator('#publish').click(); };
    const generate = async () => { await page.locator('article').first().locator('[data-magpie-action]').click(); await panel.locator('.candidate').nth(3).waitFor({ timeout: 95000 }); };
    await settings.goto(extensionBase + '/popup.html?settings=1');
    await settings.waitForFunction(() => !document.getElementById('save').disabled);
    await step('drafts and failed publishing are not collected and opening posts makes no model request', async () => {
      await visit('https://x.com/linzhou/status/111');
      await publish('这是没发成功的草稿。', 'failure'); await page.waitForTimeout(900);
      assert.equal(await count(), 0); assert.equal(requests.length, 0);
    });
    await step('a confirmed handwritten reply is collected once without calling the model', async () => {
      await publish(handwritten[0]); await waitCount(1);
      assert.equal((await saved()).accounts[0].samples[0].text, handwritten[0]);
      assert.equal((await saved()).accounts[0].samples[0].kind, 'reply'); assert.equal(requests.length, 0);
      await page.waitForTimeout(500); assert.equal(await count(), 1);
    });
    await step('a top-level post can be confirmed by a new own-account success link and cleared composer', async () => {
      await visit('https://x.com/home'); await publish(handwritten[1], 'toast'); await waitCount(2);
      assert.equal((await saved()).accounts[0].samples[0].kind, 'post'); assert.equal(requests.length, 0);
    });
    await step('old own posts and other peoples posts on the timeline are not learned', async () => {
      await page.evaluate(() => { window.fixtureAddPost('我自己的旧帖子。', 'manualuser', 777); window.fixtureAddPost('别人的帖子。', 'stranger', 778); });
      await page.waitForTimeout(700); assert.equal(await count(), 2); assert.equal(requests.length, 0);
    });
    await step('published edited candidates remain excluded from handwriting', async () => {
      await visit('https://x.com/linzhou/status/111'); await generate();
      await panel.locator('.candidate').first().locator('.fill').click();
      await panel.locator('#status').filter({ hasText: '已填入草稿' }).waitFor();
      await editor.fill('我把刚才的候选改了几个字。'); await page.locator('#publish').click();
      await page.waitForTimeout(800); assert.equal(await count(), 2);
      assert.match(await panel.locator('#voice-note').innerText(), /插件候选/);
    });
    await step('a generated candidate copied to a fresh page is excluded by its session fingerprint', async () => {
      await visit('https://x.com/linzhou/status/111'); await publish(replies[0]);
      await page.waitForTimeout(800); assert.equal(await count(), 2);
    });
    await step('manual update produces Markdown from only the collected handwritten samples', async () => {
      await settings.locator('#memory-refresh').click();
      await settings.locator('#memory-meta').filter({ hasText: '2 条本地' }).waitFor();
      assert.equal(await settings.locator('#memory-markdown').inputValue(), '');
      const before = requests.length;
      await settings.locator('#memory-update').click(); await settings.locator('#memory-feedback').filter({ hasText: '语气记忆已更新' }).waitFor();
      assert.equal(requests.length, before + 1);
      const samples = JSON.parse(requests.at(-1).messages[1].content).handwritten_samples;
      assert.deepEqual(samples.map(row => row.text), handwritten);
      assert.equal(await settings.locator('#memory-markdown').inputValue(), mockMarkdown);
    });
    await step('replies reference this accounts summary without sending its raw writing history', async () => {
      await visit('https://x.com/linzhou/status/111'); await generate();
      const user = JSON.parse(requests.at(-1).messages[1].content);
      assert.equal(user.voice_style_memory, mockMarkdown);
      assert.equal(JSON.stringify(user).includes(handwritten[1]), false);
      assert.match(await panel.locator('#model-note').innerText(), /已参考 @manualuser/);
    });
    await step('Markdown can be edited, saved, exported and displayed as text safely', async () => {
      const value = '# 我的语气\n\n- 用短句，结尾偶尔说呗。\n<img src=x onerror=window.memoryHacked=true>';
      await settings.locator('#memory-markdown').fill(value); await settings.locator('#memory-save').click();
      await settings.locator('#memory-feedback').filter({ hasText: '语气记忆已保存' }).waitFor();
      assert.equal((await saved()).accounts[0].markdown, value);
      assert.equal(await settings.evaluate(() => window.memoryHacked), undefined);
      const downloadPromise = settings.waitForEvent('download'); await settings.locator('#memory-export').click();
      const download = await downloadPromise, output = path.join(testOutput, 'memory-export-test.md'); await download.saveAs(output);
      assert.equal(download.suggestedFilename(), 'x-voice-manualuser.md'); assert.match(fs.readFileSync(output, 'utf8'), /结尾偶尔说呗/);
      await settings.locator('#memory-markdown').fill(mockMarkdown); await settings.locator('#memory-save').click();
      await settings.locator('#memory-feedback').filter({ hasText: '语气记忆已保存' }).waitFor();
    });
    await step('disabling style memory omits it from replies while preserving the saved Markdown', async () => {
      await settings.locator('#use-voice-memory').uncheck(); await settings.locator('#save').click(); await settings.locator('#feedback').filter({ hasText: '已保存' }).waitFor();
      await visit('https://x.com/linzhou/status/111'); await generate();
      assert.equal(JSON.parse(requests.at(-1).messages[1].content).voice_style_memory, undefined);
      assert.equal((await saved()).accounts[0].markdown, mockMarkdown);
      await settings.locator('#use-voice-memory').check(); await settings.locator('#save').click(); await settings.locator('#feedback').filter({ hasText: '已保存' }).waitFor();
    });
    await step('switching accounts clears old candidates and uses only the new accounts samples', async () => {
      await page.locator('[data-testid=AppTabBar_Profile_Link]').evaluate(link => { link.href = '/otheruser'; });
      await panel.locator('#status').filter({ hasText: '账号已变化' }).waitFor(); assert.equal(await panel.locator('.candidate').count(), 0);
      await generate(); assert.equal(JSON.parse(requests.at(-1).messages[1].content).voice_style_memory, undefined);
      await publish('这是另一个账号，只说自己的话。'); await waitCount(1, 'otheruser');
      await settings.locator('#memory-refresh').click(); await settings.locator('#memory-account option[value=otheruser]').waitFor({ state: 'attached' });
      await settings.locator('#memory-account').selectOption('otheruser'); await settings.locator('#memory-meta').filter({ hasText: '1 条本地' }).waitFor();
      await settings.locator('#memory-update').click(); await settings.locator('#memory-feedback').filter({ hasText: '语气记忆已更新' }).waitFor();
      const samples = JSON.parse(requests.at(-1).messages[1].content).handwritten_samples;
      assert.deepEqual(samples.map(row => row.text), ['这是另一个账号，只说自己的话。']); assert.equal(await count('manualuser'), 2);
    });
    await step('deleting a sample clears its old summary and clearing one account preserves the others memory', async () => {
      await settings.locator('.memory-samples').evaluate(el => { el.open = true; });
      await settings.locator('.writing-sample button').first().click(); await settings.locator('#memory-feedback').filter({ hasText: '样本已删除' }).waitFor();
      assert.equal(await settings.locator('#memory-markdown').inputValue(), ''); assert.equal(await count('otheruser'), 0);
      settings.once('dialog', dialog => dialog.accept()); await settings.locator('#memory-clear').click();
      await settings.locator('#memory-feedback').filter({ hasText: '已清空' }).waitFor();
      assert.equal((await saved()).accounts.length, 1); assert.equal(await count('manualuser'), 2);
    });
    await step('turning off local collection and failing to identify an account both prevent collection', async () => {
      await settings.locator('#collect-writing').uncheck(); await settings.locator('#save').click(); await settings.locator('#feedback').filter({ hasText: '已保存' }).waitFor();
      await visit('https://x.com/home'); await publish('开关关了，这条不要记。'); await page.waitForTimeout(700); assert.equal(await count(), 2);
      await settings.locator('#collect-writing').check(); await settings.locator('#save').click(); await settings.locator('#feedback').filter({ hasText: '已保存' }).waitFor();
      await page.locator('[data-testid=AppTabBar_Profile_Link]').evaluate(link => link.remove());
      await publish('没有识别到账号，这条也不记。'); await page.waitForTimeout(700); assert.equal(await count(), 2);
    });
    if (process.env.MAGPIE_MEMORY_LIVE) await step('real Magpie manually summarizes handwriting and the next four replies use that Markdown', async () => {
      await settings.locator('details.advanced').evaluate(el => { el.open = true; });
      await settings.locator('#port').fill('3425'); await settings.locator('#check').click();
      await settings.locator('#connection-label').filter({ hasText: '已连接' }).waitFor();
      await settings.locator('#model').selectOption(process.env.MAGPIE_BROWSER_TEST_MODEL || 'cursor/grok-4.6');
      await settings.locator('#auto-generate').uncheck(); await settings.locator('#save').click(); await settings.locator('#feedback').filter({ hasText: '已保存' }).waitFor();
      await visit('https://x.com/home'); await publish('别急着下结论，先把那一项说清楚呗。'); await waitCount(3);
      await publish('我就问一句，这到底省了谁的时间啊。', 'toast'); await waitCount(4);
      await settings.locator('#memory-refresh').click(); await settings.locator('#memory-meta').filter({ hasText: '4 条本地' }).waitFor();
      await settings.locator('#memory-update').click();
      try { await settings.locator('#memory-feedback').filter({ hasText: '语气记忆已更新' }).waitFor({ timeout: 95000 }); }
      catch (error) { console.error('SUMMARY_STATUS', await settings.locator('#memory-feedback').innerText()); throw error; }
      const markdown = await settings.locator('#memory-markdown').inputValue(); assert.match(markdown, /^# /m);
      await visit('https://x.com/linzhou/status/111');
      try { await generate(); } catch (error) { console.error('REPLY_STATUS', await panel.locator('#status').innerText()); throw error; }
      assert.match(await panel.locator('#model-note').innerText(), /已参考 @manualuser/);
      const candidates = await panel.locator('.reply-text').evaluateAll(nodes => nodes.map(node => node.value)); assert.equal(candidates.length, 4);
      evidence.live = { model: process.env.MAGPIE_BROWSER_TEST_MODEL || 'cursor/grok-4.6', markdown, handwritten: (await saved()).accounts[0].samples.map(row => row.text), candidates };
      await settings.locator('.memory-samples').evaluate(el => { el.open = false; });
      await settings.locator('#voice-memory-panel').screenshot({ path: path.join(root, '.test-output/v0.3.0-语气记忆设置.png') });
      await page.screenshot({ path: path.join(root, '.test-output/v0.3.0-记忆回复预览.png') });
    });
    assert.deepEqual(evidence.pageErrors, []);
    console.log(`Memory browser checks passed: ${evidence.checks.length}; page errors: ${evidence.pageErrors.length}`);
  } finally {
    await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(testOutput, 'memory-browser-evidence-v043.json'), JSON.stringify(evidence, null, 2));
  }
})().catch(error => { console.error(error.stack); server.closeAllConnections(); server.close(); process.exitCode = 1; });
