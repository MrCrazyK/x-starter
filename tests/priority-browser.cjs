'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const extension = path.resolve(__dirname, '..'), output = path.join(extension, '.test-output'); fs.mkdirSync(output, { recursive: true });
const evidence = { checks: [], pageErrors: [], views: [], modelCalls: 0 };
const badge = '<svg data-testid="icon-verified" aria-label="Verified account" viewBox="0 0 20 20" style="width:16px;height:16px;fill:#1d9bf0"><circle cx="10" cy="10" r="9"/></svg>';
function avatar(name, id) { return `<div id="${id}" data-testid="UserAvatar-Container-${name}" title="原头像提示" class="avatar"><a href="/${name}" onclick="event.preventDefault();window.avatarClicks++"><div class="avatar-inner">${name.slice(0,1).toUpperCase()}</div></a></div>`; }
function tweet(name, id, verified = true, quote = false) {
  return `<article id="post-${id}" data-testid="tweet">${avatar(name, id)}<div class="post-body"><div data-testid="User-Name"><a class="author-link" href="/${name}">测试作者 @${name}${verified ? badge : ''}</a>${!verified ? `<a href="/different">${badge}</a>` : ''}<a href="/${name}/status/${id.length}00"><time>今天</time></a></div><p data-testid="tweetText">这里是模拟帖子，用来检查头像推荐标记。</p>${quote ? `<div class="quote">${avatar('quoted','quoted-avatar')}<div data-testid="User-Name"><a href="/quoted">引用作者${badge}</a></div><p>引用内容，不把它当作发帖作者。</p></div>` : ''}<div role="group"><button data-testid="reply">回复</button></div></div></article>`;
}
function fixture(url) {
  const name = new URL(url).pathname.slice(1).toLowerCase(); let body;
  if (name === 'home') body = `${tweet('alpha', 'alpha-avatar', true, true)}${tweet('alpha', 'alpha-second')}${tweet('beta', 'beta-avatar')}${tweet('equal', 'equal-avatar')}${tweet('plain', 'plain-avatar', false)}<div style="height:1400px"></div>${tweet('late', 'late-avatar')}`;
  else {
    evidence.views.push(name);
    body = `<section class="profile"><div data-testid="UserName"><span>测试作者</span><span>@${name}</span><button>${badge}</button></div><div><a href="/${name}/following" title="1,200 Following">1.2K Following</a><a href="/${name}/verified_followers" title="800 Followers">800 Followers</a></div><button id="never-follow" data-testid="${name}-follow" onclick="window.followClicks++">Follow</button></section>`;
  }
  return `<!doctype html><html><meta charset="utf-8"><title>X-starter · 头像绿框模拟</title><style>*{box-sizing:border-box}body{margin:0;font:15px/1.6 sans-serif;background:#f5f8fa;color:#20333c}nav{padding:12px 40px;background:white}main{width:640px;margin:20px 40px}article{padding:18px;display:flex;gap:16px;background:white;margin-bottom:10px;border:1px solid #dce6e8;border-radius:14px}.avatar{width:40px;height:40px;flex-shrink:0}.avatar a{color:white;text-decoration:none}.avatar-inner{width:40px;height:40px;background:#789c9b;border-radius:50%;display:grid;place-items:center;font-weight:bold}.post-body{min-width:0;flex:1}.post-body a{color:#263e4a;text-decoration:none;margin-right:8px;font-size:13px}.post-body p{font-size:13px;margin:8px 0}.post-body time{color:#7c8b94;font-size:11px}button{padding:4px 10px;border:1px solid #d5e2e2;border-radius:7px;background:#eef6f2;color:#497365}.quote{border:1px solid #e1e7e9;border-radius:8px;padding:12px;font-size:11px;margin:12px 0;display:flex;gap:12px}.quote .avatar-inner,.quote .avatar{width:30px;height:30px}.profile{padding:25px;background:white}.profile span{display:block}</style><nav><strong>X-starter</strong> · 本地模拟时间线 <a data-testid="AppTabBar_Profile_Link" href="/writer">@writer</a></nav><main><div data-testid="primaryColumn">${body}</div></main><script>window.avatarClicks=0;window.followClicks=0;window.hoverEvents=0;document.querySelectorAll('[data-testid^="UserAvatar-Container-"]').forEach(avatar=>avatar.addEventListener('mouseenter',()=>window.hoverEvents++));</script></html>`;
}
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/hello') res.end(JSON.stringify({ name: 'magpie', version: 'fixture' }));
  else if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'group/fixture' }] }));
  else { evidence.modelCalls++; res.writeHead(404); res.end('{}'); }
});
async function step(name, action) { await action(); evidence.checks.push({ name, pass: true }); console.log('PASS ' + name); }
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const context = await chromium.launchPersistentContext(path.join(output, `priority-browser-${Date.now()}`), { channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1260, height: 1000 }, timeout: 25000 });
  context.on('page', page => page.on('pageerror', error => evidence.pageErrors.push(error.message)));
  try {
    await context.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture(route.request().url()) }));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async port => {
      await priorityProfiles.ready; await chrome.storage.local.set({ settings: { port, autoGenerate: false, timelinePriorityEnabled: false } });
      // Warm a blank tab before navigation so Edge's first request cannot race
      // Playwright's interceptor. This affects only the test browser adapter.
      const create = chrome.tabs.create.bind(chrome.tabs);
      chrome.tabs.create = async options => { const tab = await create({ ...options, url: 'about:blank' }); await new Promise(resolve => setTimeout(resolve, 200)); await chrome.tabs.update(tab.id, { url: options.url }); return tab; };
    }, server.address().port);
    const page = await context.newPage(), popup = await context.newPage();
    await page.goto('https://x.com/home'); await page.locator('#magpie-profile-style').waitFor({ state: 'attached' });
    await popup.goto(worker.url().replace('/background.js', '') + '/popup.html'); await popup.waitForFunction(() => !document.getElementById('save').disabled);
    const save = async () => { await popup.locator('#save').click(); await popup.locator('#feedback').filter({ hasText: '已保存' }).waitFor(); await popup.waitForFunction(() => !document.getElementById('save').disabled); };
    const marked = id => page.locator('#' + id).getAttribute('data-xstarter-priority-avatar');
    const waitMark = (id, expected) => page.waitForFunction(({ id, expected }) => document.getElementById(id)?.hasAttribute('data-xstarter-priority-avatar') === expected, { id, expected });
    await step('default settings leave timeline avatars unchanged and perform no background profile reads', async () => {
      assert.equal(await popup.locator('#timeline-priority').isChecked(), false); assert.deepEqual(evidence.views, []); assert.equal(await marked('alpha-avatar'), null);
    });
    await step('enabling the feature reads a visible certified author without any hover and marks both appearances', async () => {
      await popup.locator('#timeline-priority').check(); await save();
      await worker.evaluate(async () => {
        for (const [account, following, followers] of [['beta', 1500, 500], ['equal', 800, 800], ['plain', 1200, 800], ['quoted', 1200, 800], ['late', 1200, 800]]) await priorityProfiles.observe({ account, following, followers, verified: true });
      });
      await page.bringToFront(); await waitMark('alpha-avatar', true); await waitMark('alpha-second', true);
      assert.deepEqual(evidence.views, ['alpha']); assert.equal(await page.evaluate(() => window.hoverEvents), 0);
      assert.equal(await page.locator('[data-testid="HoverCard"]').count(), 0);
    });
    await step('the green outline is conspicuous, preserves avatar size and exposes the checked counts', async () => {
      const css = await page.locator('#alpha-avatar').evaluate(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, outline: getComputedStyle(node).outlineWidth, color: getComputedStyle(node).outlineColor, title: node.title }));
      assert.equal(css.width, 40); assert.equal(css.height, 40); assert.equal(css.outline, '3px'); assert.equal(css.color, 'rgb(8, 173, 97)'); assert.match(css.title, /1,200/); assert.match(css.title, /800/);
      await page.screenshot({ path: path.join(output, 'v0.6.0-timeline-green-frames.png') });
      await page.locator('#post-alpha-avatar').screenshot({ path: path.join(output, 'v0.6.0-avatar-preview.png') });
    });
    await step('the outline remains visible on dark timelines and avatar links still receive normal clicks', async () => {
      await page.addStyleTag({ content: 'body{background:#0f1419;color:#eff3f4}article{background:#15202b;color:#eff3f4}.post-body a{color:#eff3f4}' });
      assert.equal(await page.locator('#alpha-avatar').evaluate(node => getComputedStyle(node).outlineColor), 'rgb(8, 173, 97)');
      await page.locator('#alpha-avatar a').click(); assert.equal(await page.evaluate(() => window.avatarClicks), 1);
    });
    await step('exactly 500 followers, equal counts, foreign verified badges and quoted avatars are not recommended', async () => {
      for (const id of ['beta-avatar', 'equal-avatar', 'plain-avatar', 'quoted-avatar', 'late-avatar']) assert.equal(await marked(id), null, id);
    });
    await step('cached data immediately marks a newly visible author after scrolling without a profile lookup', async () => {
      await page.locator('#late-avatar').scrollIntoViewIfNeeded(); await waitMark('late-avatar', true); assert.deepEqual(evidence.views, ['alpha']);
      await page.evaluate(() => window.scrollTo(0, 0)); await waitMark('alpha-avatar', true);
    });
    await step('a recycled avatar is cleared for its new owner and its original title is restored', async () => {
      await page.evaluate(() => { document.getElementById('alpha-avatar').dataset.testid = 'UserAvatar-Container-beta'; document.querySelector('#post-alpha-avatar .author-link').href = '/beta'; });
      await waitMark('alpha-avatar', false); assert.equal(await page.locator('#alpha-avatar').getAttribute('title'), '原头像提示'); await waitMark('alpha-second', true);
      await page.evaluate(() => { document.getElementById('alpha-avatar').dataset.testid = 'UserAvatar-Container-alpha'; document.querySelector('#post-alpha-avatar .author-link').href = '/alpha'; }); await waitMark('alpha-avatar', true);
    });
    await step('removing the current authors badge clears the frame even when cached verification is positive', async () => {
      await page.evaluate(() => document.querySelector('#post-alpha-avatar .author-link svg').remove()); await waitMark('alpha-avatar', false);
      assert.equal(await marked('alpha-second'), 'alpha');
    });
    await step('reloading a timeline uses the same cached profile without another background tab', async () => {
      await page.reload(); await waitMark('alpha-avatar', true); assert.deepEqual(evidence.views, ['alpha']);
    });
    await step('hover-card green can be disabled independently while timeline frames keep working', async () => {
      await popup.bringToFront(); await popup.locator('#profile-priority').uncheck(); await save(); await page.bringToFront(); await waitMark('alpha-avatar', true); assert.deepEqual(evidence.views, ['alpha']);
    });
    await step('normal foreground profile pages populate the cache through the owners header badge and exact counts', async () => {
      const profile = await context.newPage(); await profile.goto('https://x.com/manual'); await profile.bringToFront();
      await profile.waitForFunction(() => !!document.getElementById('xstarter-priority-style'));
      let result;
      for (let i = 0; i < 100; i++) { result = await worker.evaluate(async () => (await chrome.storage.local.get('priorityProfileCache')).priorityProfileCache?.records.find(row => row.account === 'manual')); if (result) break; await profile.waitForTimeout(100); }
      assert.equal(result?.verified, true); assert.equal(result?.following, 1200); assert.equal(result?.followers, 800);
      assert.equal(await profile.evaluate(() => window.followClicks), 0); await profile.close();
    });
    await step('disabling clears existing frames and clearing the cache does not start reads while disabled', async () => {
      await popup.bringToFront(); await popup.locator('#timeline-priority').uncheck(); await save(); await waitMark('alpha-avatar', false);
      await popup.locator('#clear-priority-cache').click(); await popup.locator('#priority-status').filter({ hasText: '已缓存 0 位' }).waitFor();
      await page.bringToFront(); assert.equal(await page.locator('[data-xstarter-priority-avatar]').count(), 0); assert.deepEqual(evidence.views, ['alpha', 'manual']);
    });
    await step('profile hints make no model calls and never click follow or publish', async () => {
      assert.equal(evidence.modelCalls, 0); assert.equal(await page.evaluate(() => window.followClicks), 0); assert.deepEqual(evidence.pageErrors, []);
    });
    console.log(`Timeline priority browser checks passed: ${evidence.checks.length}; background profile reads: 1; model calls: ${evidence.modelCalls}`);
  } finally { await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.writeFileSync(path.join(output, 'priority-browser-evidence-v060.json'), JSON.stringify(evidence, null, 2)); }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
