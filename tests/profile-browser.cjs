'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), evidence = { checks: [], pageErrors: [], chats: 0 };
const testOutput = path.join(root, '.test-output'); fs.mkdirSync(testOutput, { recursive: true });
function fixture() { return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>资料卡标记 · 本地模拟页面</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f6f8;font:15px/1.65 "Microsoft YaHei",sans-serif;color:#18232b}main{padding:35px;width:340px}.note{font-size:12px;color:#73838d}.trigger{display:block;margin:20px 0;padding:20px;background:#fff;border-radius:12px;color:#183e4d;text-decoration:none}.normal-profile{padding:18px;background:#fff;border-radius:14px;font-size:12px}.normal-profile a{color:#617481}.card{position:fixed;left:380px;top:65px;width:360px;border-radius:20px;background:rgb(255,255,255);box-shadow:0 4px 26px #20384826;overflow:hidden;border:1px solid #d8e1e7;padding:23px}.card .top{display:flex;justify-content:space-between;align-items:start}.avatar{width:76px;height:76px;border-radius:50%;background:#e8edf0;display:grid;place-items:center;font-size:30px;font-weight:bold;color:#45606c}.card button{background:#0f1419;color:#fff;border:0;border-radius:25px;padding:10px 20px;font-size:15px;font-weight:bold;cursor:pointer}.card a{color:inherit;text-decoration:none}.card h2{font-size:20px;margin:16px 0 0;display:flex;gap:5px;align-items:center}.card .verified{width:19px;height:19px;color:rgb(29,155,240)}.handle,.label{color:#536471}.body,.stats,.bio{background:rgb(255,255,255)}.bio{margin:18px 0}.stats{display:flex;gap:18px;margin:18px 0}.stats a{white-space:nowrap}.amount{font-weight:bold;margin-right:5px}.mutual{font-size:13px;color:#536471;margin-bottom:20px}.card .summary{background:#fff;color:#26363f;border:1px solid #c8d6de;width:100%;font-size:14px;padding:9px}.card.dark,.card.dark .body,.card.dark .stats,.card.dark .bio{background:rgb(21,32,43);color:#f7f9f9}.card.dark .handle,.card.dark .label,.card.dark .mutual{color:#8b98a5}.card.dark button{background:#eff3f7;color:#0f1419}.card.dark .summary{background:#223443;color:#f7f9f9;border-color:#536471}
</style><main><p class="note">本地模拟悬浮资料卡，非真实用户。</p><a id="trigger" class="trigger" href="/mustard">把鼠标停在这里<br><strong>测试账号 @mustard</strong></a><p class="note">默认：关注比粉丝少 20% 及以上标黄。</p><section class="normal-profile"><p>普通页面区域保持原色：</p><a href="/normal">@normal</a><p><a href="/normal/following">2,000 Following</a> · <a href="/normal/followers">4,000 Followers</a></p></section></main><div id="layers"></div><script>
window.fixtureOptions={following:'2,000',followers:'4,000',account:'mustard',kind:'explicit',dark:false,route:'followers'};window.fixtureClicks=0;let closeTimer;
const escapeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(card){const o=window.fixtureOptions;card.className='card'+(o.dark?' dark':'');card.innerHTML='<div class="top"><a href="/'+o.account+'"><div class="avatar" data-testid="UserAvatar-Container-'+o.account+'">测</div></a><button id="card-follow">Follow</button></div><a href="/'+o.account+'"><h2>测试账号 <svg class="verified" data-testid="icon-verified" aria-label="Verified account" style="display:'+(o.verified===false?'none':'inline-block')+'" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M5 10l3 3 7-7" stroke="white" fill="none" stroke-width="2"/></svg></h2><span class="handle">@'+o.account+'</span></a><div class="body"><p class="bio">用这张模拟卡验证颜色和数量判断。<br>关注与粉丝数字只在本地计算。</p><div class="stats"><a id="following-count" href="/'+o.account+'/following"><span class="amount">'+escapeText(o.following)+'</span><span class="label">'+(o.zh?'关注':'Following')+'</span></a><a id="followers-count" href="/'+(o.followerOwner||o.account)+'/'+o.route+'"><span class="amount">'+escapeText(o.followers)+'</span><span class="label">'+(o.zh?'粉丝':'Followers')+'</span></a></div><p class="mutual">测试内容 · 不调用模型</p><button class="summary">Profile Summary</button></div>';if(o.followingTitle)card.querySelector('#following-count').title=o.followingTitle;if(o.followersTitle)card.querySelector('#followers-count').title=o.followersTitle;card.querySelector('#card-follow').onclick=()=>window.fixtureClicks++;}
window.fixtureClose=()=>{clearTimeout(closeTimer);document.getElementById('profile-test-card')?.remove()};
window.fixtureUpdate=data=>{Object.assign(window.fixtureOptions,data);const card=document.getElementById('profile-test-card');if(card)render(card)};
function open(){window.fixtureClose();const card=document.createElement('div');card.id='profile-test-card';if(window.fixtureOptions.kind!=='generic')card.dataset.testid=window.fixtureOptions.kind==='outside'?'UserHoverCard':'HoverCard';render(card);(window.fixtureOptions.kind==='outside'?document.body:document.getElementById('layers')).append(card);card.addEventListener('mouseenter',()=>clearTimeout(closeTimer));card.addEventListener('mouseleave',()=>{closeTimer=setTimeout(window.fixtureClose,120)})}
document.getElementById('trigger').addEventListener('mouseenter',()=>{clearTimeout(closeTimer);open()});document.getElementById('trigger').addEventListener('mouseleave',()=>{closeTimer=setTimeout(window.fixtureClose,120)});
</script></html>`; }
const server = http.createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/api/hello') response.end(JSON.stringify({ name: 'magpie', version: 'profile-test' }));
  else if (request.url === '/v1/models') response.end(JSON.stringify({ data: [{ id: 'group/profile-test' }] }));
  else if (request.url === '/v1/chat/completions') { evidence.chats++; response.end('{}'); }
  else { response.writeHead(404); response.end('{}'); }
});
async function step(name, fn) { const started = Date.now(); await fn(); evidence.checks.push({ name, pass: true, ms: Date.now() - started }); console.log('PASS ' + name); }
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const context = await chromium.launchPersistentContext(path.join(testOutput, `browser-profile-${Date.now()}`), { channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`], viewport: { width: 1150, height: 850 }, timeout: 25000 });
  context.on('page', page => page.on('pageerror', error => evidence.pageErrors.push(error.message)));
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionBase = worker.url().replace('/background.js', '');
    await worker.evaluate(async port => chrome.storage.local.set({ settings: { port, autoGenerate: false } }), port);
    await context.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture() }));
    const page = await context.newPage(), popup = await context.newPage();
    await page.goto('https://x.com/home'); await page.locator('#magpie-profile-style').waitFor({ state: 'attached' });
    await popup.goto(extensionBase + '/popup.html'); await popup.waitForFunction(() => !document.getElementById('save').disabled);
    const card = page.locator('#profile-test-card');
    const waitPaint = marked => page.waitForFunction(marked => Boolean(document.getElementById('profile-test-card')?.hasAttribute('data-magpie-profile-highlight')) === marked, marked);
    const open = async data => {
      await page.mouse.move(1100, 800);
      await page.evaluate(data => { window.fixtureClose(); window.fixtureOptions = { following: '2,000', followers: '4,000', account: 'mustard', kind: 'explicit', dark: false, route: 'followers', ...data }; }, data || {});
      await page.locator('#trigger').hover(); await card.waitFor();
    };
    const update = data => page.evaluate(data => window.fixtureUpdate(data), data);
    const save = async () => { await popup.locator('#save').click(); await popup.locator('#feedback').filter({ hasText: '已保存' }).waitFor(); };
    await step('hovering highlights the complete qualifying card while the ordinary page stays unchanged', async () => {
      assert.equal(await popup.locator('#profile-highlight').isChecked(), true); assert.equal(await popup.locator('#profile-gap-threshold').inputValue(), '20');
      await open(); await waitPaint(true);
      assert.equal(await card.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(181, 154, 37)');
      assert.equal(await page.locator('#profile-test-card .body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(181, 154, 37)');
      assert.equal(await page.locator('.normal-profile').evaluate(el => el.hasAttribute('data-magpie-profile-highlight')), false);
      await page.screenshot({ path: path.join(root, '.test-output/v0.5.0-悬浮资料卡-浅色.png') });
    });
    await step('follow buttons, avatars and verified icons retain their styles and behavior', async () => {
      assert.equal(await page.locator('#card-follow').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(15, 20, 25)');
      assert.equal(await page.locator('#card-follow').evaluate(el => getComputedStyle(el).color), 'rgb(255, 255, 255)');
      assert.equal(await card.locator('.verified').evaluate(el => getComputedStyle(el).color), 'rgb(29, 155, 240)');
      assert.equal(await card.locator('.avatar').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(232, 237, 240)');
      await page.locator('#card-follow').click(); assert.equal(await page.evaluate(() => window.fixtureClicks), 1);
    });
    await step('the screenshot verified account turns green and exactly 20 percent less following turns yellow', async () => {
      await update({ following: '4,860', followers: '4,742' });
      await page.waitForFunction(() => document.getElementById('profile-test-card')?.getAttribute('data-magpie-profile-tone') === 'green');
      await update({ following: '3,200', followers: '4,000' }); await waitPaint(true);
      await update({ following: '3,201' }); await waitPaint(false);
    });
    await step('unknown counts clear old marks and asynchronously loaded counts can trigger again', async () => {
      await update({ following: '—', followers: '4,000' }); await waitPaint(false);
      await update({ following: '2,000' }); await waitPaint(true);
      await update({ followers: '…' }); await waitPaint(false);
      await update({ followers: '4,000' }); await waitPaint(true);
    });
    await step('English and Chinese abbreviations work and full numeric titles take priority', async () => {
      await update({ following: '3.2K', followers: '4K' }); await waitPaint(true);
      await update({ followingTitle: '3,201', followersTitle: '4,000' }); await waitPaint(false);
      await update({ following: '2万', followers: '4万', followingTitle: null, followersTitle: null, zh: true }); await waitPaint(true);
    });
    await step('portal fallback highlights cards without a HoverCard test id', async () => {
      await open({ kind: 'generic' }); await waitPaint(true);
      assert.equal(await card.getAttribute('data-testid'), null);
    });
    await step('explicit hover cards outside the portal are detected by the page observer', async () => {
      await open({ kind: 'outside' }); await waitPaint(true);
    });
    await step('mixed accounts and mutual-follower links cannot supply another users follower count', async () => {
      await open({ followerOwner: 'someoneelse' }); await waitPaint(false);
      await update({ followerOwner: 'mustard', route: 'followers_you_follow' }); await waitPaint(false);
      await update({ route: 'verified_followers' }); await waitPaint(true);
    });
    await step('changing threshold or disabling the feature takes effect on the open card without reloading X', async () => {
      await open(); await waitPaint(true);
      await popup.locator('#profile-gap-threshold').fill('51'); await save(); await waitPaint(false);
      await popup.locator('#profile-gap-threshold').fill('50'); await save(); await waitPaint(true);
      await popup.locator('#profile-highlight').uncheck(); await save(); await waitPaint(false);
      assert.equal(await popup.locator('#profile-gap-threshold').isDisabled(), true);
      await popup.locator('#profile-highlight').check(); await save(); await waitPaint(true);
      await popup.reload(); await popup.waitForFunction(() => !document.getElementById('save').disabled);
      assert.equal(await popup.locator('#profile-highlight').isChecked(), true); assert.equal(await popup.locator('#profile-gap-threshold').inputValue(), '50');
    });
    await step('dark theme cards remain readable while their action buttons keep their original colors', async () => {
      await open({ dark: true }); await waitPaint(true);
      assert.equal(await card.locator('.label').first().evaluate(el => getComputedStyle(el).color), 'rgb(23, 32, 24)');
      assert.equal(await card.locator('h2').evaluate(el => getComputedStyle(el).color), 'rgb(23, 32, 24)');
      assert.equal(await page.locator('#card-follow').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(239, 243, 247)');
      assert.equal(await page.locator('#card-follow').evaluate(el => getComputedStyle(el).color), 'rgb(15, 20, 25)');
      await page.screenshot({ path: path.join(root, '.test-output/v0.5.0-悬浮资料卡-深色.png') });
    });
    await step('zero followers and hidden counts do not trigger and closing a card removes its marker', async () => {
      await update({ following: '0', followers: '0' }); await waitPaint(false);
      await update({ following: '0', followers: '4,000' }); await waitPaint(true);
      await card.locator('#following-count').evaluate(el => { el.style.display = 'none'; });
      await page.evaluate(() => document.querySelector('#following-count').setAttribute('aria-label', '0 Following')); await waitPaint(false);
      await page.mouse.move(1100, 800); await card.waitFor({ state: 'detached' });
      await page.waitForFunction(() => !document.querySelector('[data-magpie-profile-highlight]'));
    });
    await step('green requires all three conditions and restores cards when verification or counts change', async () => {
      await open({ following:'900', followers:'600' });
      await page.waitForFunction(() => document.getElementById('profile-test-card')?.getAttribute('data-magpie-profile-tone') === 'green');
      assert.equal(await card.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(155, 211, 170)');
      await page.screenshot({path:path.join(root,'.test-output/v0.5.0-优先关注绿色卡片.png')});
      await update({ followers:'500' });await waitPaint(false);
      await update({ following:'501', followers:'501' });await waitPaint(false);
      await update({ following:'502', verified:false });await waitPaint(false);
      await update({ verified:true });await waitPaint(true);
      await update({ verified:false });await waitPaint(false);
    });
    await step('another users verification badge cannot qualify the owner and the green toggle is independent of yellow', async () => {
      await open({following:'900',followers:'600'});await waitPaint(true);
      await card.locator('.verified').evaluate(el=>{const link=document.createElement('a');link.href='/someoneelse';el.parentElement.append(link);link.append(el)});await waitPaint(false);
      await update({verified:true});await waitPaint(true);
      await popup.locator('#profile-priority').uncheck();await save();await waitPaint(false);
      await update({following:'200',followers:'600'});await waitPaint(true);
      assert.equal(await card.getAttribute('data-magpie-profile-tone'),'yellow');
      await popup.locator('#profile-priority').check();await save();
      await open({following:'900',followers:'600',dark:true});await waitPaint(true);
      assert.equal(await card.locator('.label').first().evaluate(el=>getComputedStyle(el).color),'rgb(23, 32, 24)');
      assert.equal(await card.locator('.verified').evaluate(el=>getComputedStyle(el).color),'rgb(29, 155, 240)');
    });
    await step('full settings share the same saved threshold and highlighting sends no model request or writing sample', async () => {
      const full = await context.newPage(); await full.goto(extensionBase + '/popup.html?settings=1');
      await full.waitForFunction(() => !document.getElementById('save').disabled);
      assert.equal(await full.locator('#profile-gap-threshold').inputValue(), '50');
      await popup.setViewportSize({ width: 400, height: 1050 }); await popup.locator('.profile-options').screenshot({ path: path.join(root, '.test-output/v0.5.0-阈值设置.png') });
      assert.equal(evidence.chats, 0);
      assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('voiceMemory')).voiceMemory), undefined);
    });
    assert.deepEqual(evidence.pageErrors, []); console.log(`Profile browser checks passed: ${evidence.checks.length}; page errors: ${evidence.pageErrors.length}; model calls: ${evidence.chats}`);
  } finally {
    await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(testOutput, 'profile-browser-evidence-v050.json'), JSON.stringify(evidence, null, 2));
  }
})().catch(error => { console.error(error.stack); server.closeAllConnections(); server.close(); process.exitCode = 1; });
