'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), evidence = { checks: [], pageErrors: [] }, requests = [];
const testOutput = path.join(root, '.test-output'); fs.mkdirSync(testOutput, { recursive: true });
const textA = '先把需求说清楚，再让工具写代码。', textB = '先说住宿预算，餐费和交通费另算。';
const replies = ['先把要做啥讲明白呗。', '需求还没想明白，代码先跑起来了。', '需求说不清，工具再快也白搭。', '先定好怎样算完成，再让工具干活。'];
function fixture() { return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>原生回复识别 · 本地测试</title><style>*{box-sizing:border-box}body{font:14px/1.6 sans-serif;background:#eef3f5;color:#243b45;margin:0}nav{padding:12px;background:white}main{width:580px;margin:20px 30px}article{border:1px solid #bbcdd5;border-radius:12px;padding:16px;margin:12px 0;background:white}a{color:#386476}button{padding:7px 12px;border:1px solid #81a69b;border-radius:6px;background:#d4ecdf;cursor:pointer}[contenteditable]{background:#fff;border:1px solid #90aaa7;padding:12px;min-height:72px;margin:10px 0}.composer{position:fixed;left:390px;top:40px;width:490px;border:2px solid #809d92;border-radius:14px;background:#e7f1ed;padding:18px;z-index:300}.photo{position:fixed;inset:0;background:#dbe6ed;padding:30px;overflow:auto;z-index:200}.photo [aria-label="Timeline: Conversation"]{width:580px;margin-left:280px}.photo-toolbar{position:fixed;left:30px;top:100px;width:220px;padding:15px;background:#9db2bd;border-radius:12px}.photo-toolbar p{font-size:12px}.label{font-size:11px;color:#65808c}</style><nav>本地模拟 X 原生回复弹窗 · <a href="/testwriter" data-testid="AppTabBar_Profile_Link">@testwriter</a></nav><main id="main"></main><div id="layers"></div><script>
window.fixturePublished=0;window.fixtureDetach=false;window.fixtureTextA=${JSON.stringify(textA)};window.fixtureTextB=${JSON.stringify(textB)};
function post(id,text,author='alpha'){const article=document.createElement('article');article.dataset.testid='tweet';article.dataset.id=id;article.innerHTML='<div data-testid="User-Name">测试作者 @'+author+'</div><a href="/'+author+'"><span>@'+author+'</span></a><a href="/'+author+'/status/'+id+'"><time datetime="2026-10-28T00:00:00Z">今天</time></a><p data-testid="tweetText"></p><div role="group"><button data-testid="reply">X 原生回复</button></div>';article.querySelector('[data-testid=tweetText]').textContent=text;article.querySelector('[data-testid=reply]').addEventListener('click',()=>openReply(article));return article}
function editor(){const wrap=document.createElement('div');wrap.className='editing';wrap.innerHTML='<p class="label">X 回复框（模拟）</p><div contenteditable="true" role="textbox" data-testid="tweetTextarea_0"></div><button id="publish" data-testid="tweetButtonInline" disabled>发布</button>';const box=wrap.querySelector('[contenteditable]'),button=wrap.querySelector('button');box.addEventListener('input',()=>{box.dataset.frameworkValue=box.innerText;button.disabled=!box.innerText.trim()});button.addEventListener('click',()=>window.fixturePublished++);return wrap}
function openReply(article,skipRoute=false){const preview=article.cloneNode(true);preview.querySelectorAll('a[href*="/status/"]').forEach(a=>a.remove());preview.querySelector('[role=group]')?.remove();const body=preview.querySelector('[data-testid=tweetText]');body.textContent+=' https://pic.x.com/example';const path=location.pathname;document.querySelector('main').setAttribute('aria-hidden','true');const photo=document.getElementById('photo-root');if(photo)photo.setAttribute('aria-hidden','true');if(window.fixtureDetach){article.remove();photo?.remove()}const dialog=document.createElement('div');dialog.id='native-composer';dialog.className='composer';dialog.setAttribute('role','dialog');dialog.innerHTML='<button id="close-composer">关闭回复框</button><p class="label">预览里没有帖子链接，与实际 X 弹窗一致。</p>';dialog.append(preview,editor());document.getElementById('layers').append(dialog);if(!skipRoute)history.pushState({},'','/compose/post');dialog.querySelector('#close-composer').onclick=()=>{dialog.remove();document.querySelector('main').removeAttribute('aria-hidden');document.getElementById('photo-root')?.removeAttribute('aria-hidden');history.pushState({},'',path)};dialog.querySelector('[contenteditable]').focus();return dialog}
window.fixtureOpenReply=openReply;window.fixturePost=post;
const main=document.getElementById('main');main.append(post('111',window.fixtureTextA),post('222',window.fixtureTextB,'beta'));
const inline=editor();inline.id='background-composer';main.append(inline);
if(location.pathname.includes('/photo/')){main.setAttribute('aria-hidden','true');const photo=document.createElement('div');photo.id='photo-root';photo.className='photo';photo.setAttribute('role','dialog');photo.innerHTML='<div class="photo-toolbar"><p>图片查看层（模拟）</p><button id="media-reply" data-testid="reply">图片旁的原生回复</button></div><section aria-label="Timeline: Conversation"></section>';const thread=photo.querySelector('section');thread.append(post('90','上文说的是小团队先约定验收标准。','parent'));const focal=post('111',window.fixtureTextA);focal.id='photo-current';thread.append(focal,editor());document.getElementById('layers').append(photo);photo.querySelector('#media-reply').onclick=()=>openReply(focal)}
const mode=new URLSearchParams(location.search).get('case');if(mode==='recover'||mode==='ambiguous'){if(mode==='ambiguous')main.append(post('333',window.fixtureTextA));openReply(main.querySelector('article'),true)}
</script></html>`; }
const server = http.createServer(async (request, response) => {
  if (request.url === '/api/hello') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ name: 'magpie', version: 'reply-test' })); return; }
  if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'group/reply-test' }] })); return; }
  if (request.url !== '/v1/chat/completions') { response.writeHead(404); response.end(); return; }
  let raw = ''; for await (const chunk of request) raw += chunk; requests.push(JSON.parse(raw));
  const content = JSON.stringify({ replies: replies.map(text => ({ text })) });
  response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.end('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n');
});
async function step(name, fn) { const started = Date.now(); await fn(); evidence.checks.push({ name, pass: true, ms: Date.now() - started }); console.log('PASS ' + name); }
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, extension = root;
  const context = await chromium.launchPersistentContext(path.join(testOutput, `browser-reply-${Date.now()}`), { channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1400, height: 1100 }, timeout: 25000 });
  context.on('page', page => page.on('pageerror', error => evidence.pageErrors.push(error.message)));
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async port => chrome.storage.local.set({ settings: { port, autoGenerate: false } }), port);
    await context.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture() }));
    const page = await context.newPage(), panel = page.locator('#magpie-x-reply-root');
    const visit = async url => { await page.goto(url); await page.locator('[data-magpie-action]').first().waitFor({ state: 'attached' }); };
    const nativeReply = async selector => { await page.locator(selector).click(); await page.locator('#native-composer [contenteditable]').waitFor(); };
    const expectSource = async (text, id = '111') => {
      await page.waitForFunction(({ text, id }) => { const root = document.getElementById('magpie-x-reply-root')?.shadowRoot; return root?.getElementById('source').value === text && root?.getElementById('source-link').href.endsWith('/status/' + id); }, { text, id });
    };
    const generate = async () => { await panel.locator('#generate').click(); await panel.locator('.candidate').nth(3).waitFor(); };
    await step('native reply captures the original before the linkless modal and waits for a manual generation click', async () => {
      await visit('https://x.com/home'); const before = requests.length;
      await nativeReply('main article[data-id="111"] [data-testid="reply"]'); await expectSource(textA);
      assert.equal(await page.locator('#native-composer a[href*="/status/"]').count(), 0);
      await page.waitForTimeout(1300); assert.equal(requests.length, before);
      await generate(); assert.equal(JSON.parse(requests.at(-1).messages[1].content).reply_target.url, 'https://x.com/i/web/status/111');
      assert.equal(JSON.parse(requests.at(-1).messages[1].content).original_text, textA);
      await page.screenshot({ path: path.join(root, '.test-output/v0.4.3-原生回复修复预览.png') });
    });
    await step('filling a linkless reply modal targets its editor and preserves the background draft', async () => {
      await page.locator('#background-composer [contenteditable]').evaluate(el => { el.textContent = '背景草稿保持不动'; });
      await panel.locator('.candidate').first().locator('.fill').click();
      await panel.locator('#status').filter({ hasText: '已填入草稿' }).waitFor();
      assert.equal(await page.locator('#native-composer [contenteditable]').innerText(), replies[0]);
      assert.equal(await page.locator('#native-composer [contenteditable]').getAttribute('data-framework-value'), replies[0]);
      assert.equal(await page.locator('#background-composer [contenteditable]').innerText(), '背景草稿保持不动');
      assert.equal(await page.evaluate(() => window.fixturePublished), 0);
      await page.locator('#native-composer [contenteditable]').fill('自己写的回复草稿先保留');
      await panel.locator('.candidate').nth(1).locator('.fill').click();
      await panel.locator('#draft-confirm').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#native-composer [contenteditable]').innerText(), '自己写的回复草稿先保留');
      await panel.locator('#keep').click();
    });
    await step('the extension post button can generate then open and fill a native linkless modal', async () => {
      await visit('https://x.com/home');
      await page.locator('main article[data-id="111"] [data-magpie-action]').click();
      await panel.locator('.candidate').nth(3).waitFor();
      await panel.locator('.candidate').first().locator('.fill').click();
      assert.equal(await page.locator('#native-composer a[href*="/status/"]').count(), 0);
      await panel.locator('#status').filter({ hasText: '已填入草稿' }).waitFor();
      assert.equal(await page.locator('#native-composer [contenteditable]').innerText(), replies[0]);
      assert.equal(await page.evaluate(() => window.fixturePublished), 0);
    });
    await step('a removed original tweet does not lose its captured identity or break insertion', async () => {
      await visit('https://x.com/home'); await page.evaluate(() => { window.fixtureDetach = true; });
      await nativeReply('main article[data-id="111"] [data-testid="reply"]'); await expectSource(textA);
      assert.equal(await page.locator('main article[data-id="111"]').count(), 0);
      await generate(); await panel.locator('.candidate').first().locator('.fill').click();
      await panel.locator('#status').filter({ hasText: '已填入草稿' }).waitFor();
      assert.equal(await page.locator('#native-composer [contenteditable]').innerText(), replies[0]);
    });
    await step('switching native reply targets replaces the old source and generates for the correct post', async () => {
      await visit('https://x.com/home');
      await nativeReply('main article[data-id="111"] [data-testid="reply"]'); await expectSource(textA);
      await page.locator('#close-composer').click();
      await nativeReply('main article[data-id="222"] [data-testid="reply"]'); await expectSource(textB, '222');
      await generate(); const payload = JSON.parse(requests.at(-1).messages[1].content);
      assert.equal(payload.original_text, textB); assert.equal(payload.reply_target.url, 'https://x.com/i/web/status/222');
    });
    await step('the photo toolbar reply preserves the visible photo post and its upstream context', async () => {
      await visit('https://x.com/alpha/status/111/photo/1'); await page.evaluate(() => { window.fixtureDetach = true; });
      const before = requests.length; await nativeReply('#media-reply'); await expectSource(textA);
      await page.waitForTimeout(900); assert.equal(requests.length, before);
      await generate(); const payload = JSON.parse(requests.at(-1).messages[1].content);
      assert.equal(payload.original_text, textA); assert.deepEqual(payload.conversation_before.map(row => row.url), ['https://x.com/i/web/status/90']);
    });
    await step('focusing the photo inline editor selects the focal post rather than its first ancestor', async () => {
      await visit('https://x.com/alpha/status/111/photo/1');
      await page.locator('#photo-root [contenteditable]').focus(); await expectSource(textA);
      const before = requests.length; await page.waitForTimeout(1300); assert.equal(requests.length, before);
      await generate(); assert.equal(JSON.parse(requests.at(-1).messages[1].content).reply_target.url, 'https://x.com/i/web/status/111');
    });
    await step('the photo launcher also reads the visible layer without using hidden background text', async () => {
      await visit('https://x.com/alpha/status/111/photo/1');
      await page.locator('main article[data-id="111"] [data-testid="tweetText"]').evaluate(el => { el.textContent = '隐藏背景的旧文字，不应成为当前原文'; });
      await panel.locator('#launcher').click(); await expectSource(textA);
    });
    await step('a modal opened before initialization recovers only a unique matching original', async () => {
      await visit('https://x.com/compose/post?case=recover');
      await expectSource(textA); await generate();
      assert.equal(JSON.parse(requests.at(-1).messages[1].content).reply_target.url, 'https://x.com/i/web/status/111');
    });
    await step('ambiguous original posts are not guessed when the modal has no status link', async () => {
      await visit('https://x.com/compose/post?case=ambiguous'); const before = requests.length;
      await panel.locator('#launcher').click(); await panel.locator('#generate').click();
      await panel.locator('#status').filter({ hasText: '未识别到原帖' }).waitFor();
      assert.equal(requests.length, before); assert.equal(await panel.locator('.candidate').count(), 0);
    });
    await step('unrelated new-post composers are not bound to stale replies or overwritten', async () => {
      await visit('https://x.com/home'); await page.evaluate(() => { window.fixtureDetach = true; });
      await nativeReply('main article[data-id="111"] [data-testid="reply"]'); await expectSource(textA); await generate();
      await page.evaluate(() => { const dialog = document.getElementById('native-composer'); dialog.querySelector('article').remove(); const editor = dialog.querySelector('[contenteditable]'); editor.textContent = '这是一个新帖草稿，不能被填入'; editor.focus(); });
      await panel.locator('.candidate').first().locator('.fill').click();
      await panel.locator('#status').filter({ hasText: '未找到' }).waitFor();
      assert.equal(await page.locator('#native-composer [contenteditable]').innerText(), '这是一个新帖草稿，不能被填入');
      assert.equal(await page.evaluate(() => window.fixturePublished), 0);
    });
    assert.deepEqual(evidence.pageErrors, []); console.log(`Native reply browser checks passed: ${evidence.checks.length}; page errors: ${evidence.pageErrors.length}`);
  } finally {
    await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(testOutput, 'reply-browser-evidence-v043.json'), JSON.stringify(evidence, null, 2));
  }
})().catch(error => { console.error(error.stack); server.closeAllConnections(); server.close(); process.exitCode = 1; });
