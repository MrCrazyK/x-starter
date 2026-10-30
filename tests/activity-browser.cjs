'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const extension = path.resolve(__dirname, '..'), output = path.join(extension, '.test-output'); fs.mkdirSync(output, { recursive: true });
const evidence = { checks: [], pageErrors: [], modelCalls: 0 };
const fixture = `<!doctype html><html><meta charset="utf-8"><style>body{margin:0;background:#f4f7f8;font:16px/1.7 sans-serif;color:#263c37;min-height:100vh}nav{padding:20px}main{margin:70px;max-width:600px}button.native{position:fixed;right:20px;width:55px;height:55px;background:white;color:#18252b;border:1px solid #b5c6ce;border-radius:16px;box-shadow:0 2px 10px #0002;display:grid;place-items:center}.native svg{width:28px;height:28px}</style><nav><a data-testid="AppTabBar_Profile_Link" href="/writer">@writer</a></nav><main><h1>X-starter</h1><p>功能演示 · 计数与账号均为模拟数据</p><button id="native-follow" data-testid="someone-follow" onclick="this.textContent='Following';this.dataset.testid='someone-unfollow'">Follow</button></main><button class="native" data-testid="GrokDrawerHeader" style="bottom:91px" aria-label="Grok"><svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M18 5a8 8 0 1 0 1 12M3 22 22 2M16 2h6v6"/></svg></button><button class="native" data-testid="chat-drawer-main" style="bottom:24px" aria-label="Chat"><svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M20 11a8 8 0 0 1-11 7l-6 2 2-6A8 8 0 1 1 20 11Z"/></svg></button></html>`;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/hello') res.end(JSON.stringify({ name: 'magpie', version: 'fixture' }));
  else if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'group/fixture' }] }));
  else { evidence.modelCalls++; res.writeHead(404); res.end('{}'); }
});
async function step(name, action) { await action(); evidence.checks.push({ name, pass: true }); console.log('PASS ' + name); }
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const context = await chromium.launchPersistentContext(path.join(output, `activity-browser-${Date.now()}`), {
    channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, timeout: 25000
  });
  context.on('page', page => page.on('pageerror', error => evidence.pageErrors.push(error.message)));
  try {
    await context.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture }));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async port => { await followActivity.ready; await autoFollow.ready; await followback.ready; await chrome.storage.local.set({ settings: { port } }); }, server.address().port);
    const page = await context.newPage(); await page.goto('https://x.com/home');
    const settings = await context.newPage(); await settings.goto(worker.url().replace('/background.js', '') + '/popup.html?settings=1');
    await settings.waitForFunction(() => !document.getElementById('save').disabled);
    const launcher = page.locator('#magpie-x-reply-root').locator('#launcher'), ring = launcher.locator('.xs-follow-ring'), bump = launcher.locator('.xs-follow-bump');
    const save = async () => { await settings.locator('#save').click(); await settings.waitForFunction(() => document.getElementById('feedback').textContent.includes('已保存')); await settings.waitForFunction(() => !document.getElementById('save').disabled); };
    const record = input => worker.evaluate(input => followActivity.record({ account: 'writer', target: 'person', source: 'auto', status: 'followed', ...input, at: Date.now() }), input);
    const count = async expected => page.waitForFunction(expected => document.getElementById('magpie-x-reply-root')?.shadowRoot?.getElementById('launcher')?.dataset.followCount === String(expected), expected);
    await step('a single account input identifies X from full settings and feeds both follow features', async () => {
      assert.equal(await settings.locator('input[placeholder="@用户名"]').count(), 1); assert.equal(await settings.locator('#autofollow-daily').inputValue(), '400');
      await settings.locator('#x-identify').click(); await settings.waitForFunction(() => document.getElementById('x-account').value === 'writer'); await save();
      const options = await worker.evaluate(() => getSettings()); assert.equal(options.xAccount, 'writer'); assert.equal(options.autoFollowAccount, 'writer'); assert.equal(options.followbackAccount, 'writer');
      await page.bringToFront(); await count(0); assert.equal(await ring.getAttribute('aria-valuemax'), '400');
    });
    await step('the dark launcher keeps its shape and click area while the ring stays outside it and above native buttons', async () => {
      const box = await launcher.boundingBox(), native = await page.locator('[data-testid="GrokDrawerHeader"]').boundingBox(), outer = await ring.boundingBox();
      assert.equal(Math.round(box.width), 55); assert.equal(Math.round(box.height), 55); assert.ok(outer.width > box.width && outer.height > box.height); assert.ok(outer.y + outer.height < native.y);
      assert.equal(await launcher.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(32, 45, 50)');
      await launcher.click(); assert.equal(await page.locator('#magpie-x-reply-root').locator('#panel').isVisible(), true); await page.locator('#magpie-x-reply-root').locator('#close').click();
    });
    await step('a confirmed automatic follow increments the daily ring and displays one +1 animation', async () => {
      await page.bringToFront(); await record({ id: 'ui:auto' }); await count(1); await bump.waitFor({ state: 'visible' });
      assert.equal(await ring.getAttribute('aria-valuetext'), '今日 1 / 400'); assert.equal(await bump.innerText(), '+1');
      await bump.waitFor({ state: 'hidden' });
    });
    await step('a confirmed manual follow request uses the same count and duplicate events cannot replay +1', async () => {
      const event = { id: 'ui:manual', source: 'manual', status: 'requested', target: 'private' };
      await record(event); await count(2); await bump.waitFor({ state: 'visible' }); await bump.waitFor({ state: 'hidden' });
      assert.equal((await record(event)).added, false); await page.waitForTimeout(100); assert.equal(await bump.isVisible(), false); assert.equal(await launcher.getAttribute('data-follow-count'), '2');
    });
    await step('failed/unknown callbacks and native X follow clicks do not increment plugin progress', async () => {
      await record({ id: 'ui:unknown', status: 'uncertain' }); await record({ id: 'ui:skip', status: 'skipped' }); await page.locator('#native-follow').click(); await page.waitForTimeout(150);
      assert.equal(await launcher.getAttribute('data-follow-count'), '2'); assert.equal(await bump.isVisible(), false);
    });
    await step('page reload restores today count without replaying old animations', async () => {
      await page.reload(); await count(2); assert.equal(await bump.isVisible(), false); assert.equal(await ring.getAttribute('aria-valuetext'), '今日 2 / 400');
    });
    await step('changing the daily target rescales the ring without clearing successes and rejects 401', async () => {
      await settings.bringToFront(); await settings.locator('#autofollow-daily').fill('401'); assert.equal(await settings.locator('#autofollow-daily').evaluate(node => node.checkValidity()), false);
      await settings.locator('#autofollow-daily').fill('100'); await save(); await page.bringToFront(); await page.waitForFunction(() => document.getElementById('magpie-x-reply-root').shadowRoot.getElementById('launcher').dataset.followLimit === '100');
      assert.equal(await launcher.getAttribute('data-follow-count'), '2'); assert.equal(await launcher.locator('.xs-follow-value').getAttribute('stroke-dashoffset'), '98');
      await settings.locator('#autofollow-daily').fill('400'); await save(); await page.bringToFront();
    });
    await step('account changes clear stale progress and cannot leak another account count into the configured owner', async () => {
      await page.evaluate(() => { document.querySelector('[data-testid="AppTabBar_Profile_Link"]').setAttribute('href', '/another'); }); await ring.waitFor({ state: 'hidden' });
      await record({ id: 'ui:other', account: 'another', target: 'otherperson' }); assert.equal(await ring.isVisible(), false);
      await settings.locator('#x-account').fill('another'); await save(); await page.bringToFront(); await count(1); assert.equal(await bump.isVisible(), false);
      await page.evaluate(() => { document.querySelector('[data-testid="AppTabBar_Profile_Link"]').setAttribute('href', '/writer'); }); await settings.locator('#x-account').fill('writer'); await save(); await page.bringToFront(); await count(2);
    });
    await step('reduced-motion preference shows a static +1 and removes the ring transition', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' }); await record({ id: 'ui:reduced', source: 'manual' }); await count(3); await bump.waitFor({ state: 'visible' });
      assert.equal(await bump.evaluate(node => node.getAnimations().length), 0); assert.equal(await launcher.locator('.xs-follow-value').evaluate(node => getComputedStyle(node).transitionDuration), '0s'); await bump.waitFor({ state: 'hidden' }); await page.emulateMedia({ reducedMotion: 'no-preference' });
    });
    await step('page-cache suspension removes listeners and resuming restores counts without duplicate animations', async () => {
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))); await record({ id: 'ui:cached' }); assert.equal(await ring.isVisible(), false);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))); await count(4); assert.equal(await bump.isVisible(), false);
    });
    await step('conflicting old account bindings pause both tasks and require one explicit shared choice', async () => {
      const port = server.address().port;
      await worker.evaluate(async port => chrome.storage.local.set({ settings: { port, autoFollowAccount: 'old_auto', autoFollowEnabled: true, followbackAccount: 'old_manual', followbackEnabled: true, autoFollowDaily: 50 } }), port);
      await settings.reload(); await settings.waitForFunction(() => !document.getElementById('save').disabled);
      assert.equal(await settings.locator('#x-account').inputValue(), ''); assert.match(await settings.locator('#account-status').innerText(), /old_auto.*old_manual|old_manual.*old_auto/);
      assert.equal(await settings.locator('#autofollow-enabled').isChecked(), false); assert.equal(await settings.locator('#followback-enabled').isChecked(), false); assert.equal(await settings.locator('#autofollow-daily').inputValue(), '50');
      await settings.locator('#x-account').fill('writer'); await settings.locator('#autofollow-daily').fill('400'); await save(); await page.bringToFront(); await count(4);
    });
    await step('a half-complete ring and +1 remain readable in light and dark themes with zero model calls', async () => {
      await worker.evaluate(async () => {
        const current = (await followActivity.snapshot('writer')).total;
        await Promise.all(Array.from({ length: 200 - current }, (_, i) => followActivity.record({ id: 'preview:' + i, account: 'writer', target: 'demo' + i, source: 'auto', status: 'followed', at: Date.now() })));
      });
      await count(200); await bump.waitFor({ state: 'hidden' }); await record({ id: 'preview:last', target: 'lastdemo' }); await count(201); await bump.waitFor({ state: 'visible' });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(output, 'activity-launcher-plus-one.png'), clip: { x: 900, y: 620, width: 200, height: 280 } });
      await page.evaluate(() => { document.body.style.background = '#10171b'; document.body.style.color = '#eef5f3'; });
      await page.screenshot({ path: path.join(output, 'activity-launcher-dark.png'), clip: { x: 900, y: 620, width: 200, height: 280 } });
      await page.waitForTimeout(600);
      const painted = await ring.evaluate(async node => {
        const size = node.getBoundingClientRect().width, clone = node.cloneNode(true);
        clone.setAttribute('width', String(size)); clone.setAttribute('height', String(size));
        const originals = node.querySelectorAll('circle');
        clone.querySelectorAll('circle').forEach((circle, index) => {
          const css = getComputedStyle(originals[index]); circle.style.fill = 'none'; circle.style.stroke = css.stroke; circle.style.strokeWidth = css.strokeWidth; circle.style.vectorEffect = css.vectorEffect;
        });
        const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone)); await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = Math.round(size * 2); const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data, radius = size * .48 * 2, center = canvas.width / 2; let green = 0;
        for (let degree = 0; degree < 360; degree++) { const angle = degree / 180 * Math.PI, x = Math.floor(center + radius * Math.cos(angle)), y = Math.floor(center + radius * Math.sin(angle)), offset = (y * canvas.width + x) * 4; if (pixels[offset + 1] > 170 && pixels[offset + 3] > 100) green++; }
        return green / 360;
      });
      assert.ok(painted > .47 && painted < .54, `201/400 must paint about half the circle, got ${painted}`);
      evidence.paintedFraction = painted;
      assert.equal(await launcher.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(32, 45, 50)'); assert.equal(evidence.modelCalls, 0); assert.deepEqual(evidence.pageErrors, []);
    });
    console.log(`Activity browser checks passed: ${evidence.checks.length}; model calls: ${evidence.modelCalls}`);
  } finally { await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.writeFileSync(path.join(output, 'activity-browser-evidence.json'), JSON.stringify(evidence, null, 2)); }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
