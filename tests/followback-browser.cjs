'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const extension = path.resolve(__dirname, '..'), output = path.join(extension, '.test-output');
fs.mkdirSync(output, { recursive: true });
const evidence = { checks: [], pageErrors: [], clicks: [], scans: 0, modelCalls: 0, requests: [] };
let signedIn = 'writer', modes = {};
const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
function fixture(url) {
  const target = new URL(url).pathname.split('/')[1];
  const nav = `<nav><a data-testid="AppTabBar_Profile_Link" href="/${signedIn}">@${signedIn}</a></nav>`;
  const userCell = (name, status = '') => `<div data-testid="UserCell"><a href="/${name}"><div data-testid="UserAvatar-Container-${name}">A</div></a><a href="/${name}">Test ${name}</a><a href="/${name}">@${name}</a><button data-testid="${name}-${status === 'followed' ? 'unfollow' : status === 'requested' ? 'pending' : 'follow'}">${status === 'followed' ? 'Following' : status === 'requested' ? 'Requested' : 'Follow back'}</button></div>`;
  let body;
  if (new URL(url).pathname.endsWith('/followers')) {
    evidence.scans++;
    body = `<section aria-label="Timeline: Followers">${userCell('already', 'followed')}${userCell('requested', 'requested')}${names.map(name => userCell(name)).join('')}</section><aside aria-label="Timeline: Trending now">${userCell('unrelated')}</aside>`;
  } else if (target === 'home') body = '<p>Synthetic home page</p>';
  else {
    const mode = modes[target] || 'normal';
    body = `<section id="profile"><div><button id="target-follow" data-testid="${target}-${mode === 'already' ? 'unfollow' : 'follow'}">${mode === 'already' ? 'Following' : 'Follow back'}</button></div><h1>Test ${target}</h1>${mode === 'not-follower' ? '' : '<div data-testid="userFollowIndicator">Follows you</div>'}<div><a href="/${target}/following">900 Following</a><a href="/${target}/followers">800 Followers</a></div>${mode === 'blocked' ? '<p role="alert">Unable to follow. Rate limit reached.</p>' : ''}</section><aside>${userCell('unrelated')}</aside><script>document.getElementById('target-follow').onclick = function () { window.recordSyntheticFollow(${JSON.stringify(target)}); if (${JSON.stringify(mode)} === 'unknown') return; this.dataset.testid = ${JSON.stringify(target)} + (${JSON.stringify(mode)} === 'private' ? '-pending' : '-unfollow'); this.textContent = ${JSON.stringify(mode)} === 'private' ? 'Requested' : 'Following'; };</script>`;
  }
  return `<!doctype html><html><meta charset="utf-8"><title>Synthetic X fixture</title><style>body{font:16px/1.6 sans-serif;margin:20px}main{max-width:600px}section{padding:16px;background:#eef4f2}button{padding:10px;margin:5px}a{margin-right:15px}[data-testid="UserCell"]{padding:5px;border-bottom:1px solid #ccc}</style>${nav}<main><div data-testid="primaryColumn">${body}</div></main></html>`;
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
  const context = await chromium.launchPersistentContext(path.join(output, `followback-browser-${Date.now()}`), {
    channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1180, height: 1000 }, timeout: 25000
  });
  context.on('page', page => page.on('pageerror', error => evidence.pageErrors.push(error.message)));
  context.on('request', request => evidence.requests.push(request.url()));
  try {
    await context.exposeBinding('recordSyntheticFollow', (_source, target) => evidence.clicks.push(target));
    await context.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture(route.request().url()) }));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => {
      // Edge can start an extension-created tab before Playwright attaches its
      // request interceptor. Warm a blank tab in this test harness so every X
      // navigation is mocked, including the first request of background tabs.
      const create = chrome.tabs.create.bind(chrome.tabs);
      chrome.tabs.create = async options => {
        const tab = await create({ ...options, url: 'about:blank' });
        await new Promise(resolve => setTimeout(resolve, 200));
        await chrome.tabs.update(tab.id, { url: options.url });
        return tab;
      };
    });
    await worker.evaluate(async port => { await followback.ready; await chrome.storage.local.set({ settings: { port, autoGenerate: false } }); }, server.address().port);
    const popup = await context.newPage();
    await popup.goto(worker.url().replace('/background.js', '') + '/popup.html?settings=1');
    await popup.waitForFunction(() => !document.getElementById('save').disabled);
    const send = message => popup.evaluate(message => chrome.runtime.sendMessage(message), message);
    const status = async () => (await send({ type: 'FOLLOWBACK_STATUS' })).data;
    const refresh = async () => { await popup.locator('#followback-refresh').click(); await popup.waitForTimeout(100); };
    const settled = async () => { for (let i = 0; i < 100; i++) { const value = await status(); if (!value.busy) return value; await popup.waitForTimeout(100); } throw new Error('Follow-back operation did not settle'); };
    const save = async () => { await popup.locator('#save').click(); await popup.locator('#feedback').filter({ hasText: '已保存' }).waitFor(); await popup.waitForFunction(() => !document.getElementById('save').disabled); };
    const pending = async accounts => {
      await worker.evaluate(async accounts => {
        const time = Date.now();
        await chrome.storage.local.set({ followbackState: MagpieFollowback.state({ account: 'writer', items: accounts.map(account => ({ account })), roundAt: time, checkedAt: time, notice: 'Synthetic test queue' }, 'writer', time) });
      }, accounts); await refresh();
    };
    const allowNext = async () => { await worker.evaluate(async () => { const value = (await chrome.storage.local.get('followbackState')).followbackState; value.nextAllowedAt = Date.now() - 1; await chrome.storage.local.set({ followbackState: value }); }); await refresh(); };
    const confirm = name => popup.getByRole('button', { name: `确认回关 @${name}`, exact: true });

    await step('X-starter is named consistently and new installs perform no scheduled reads or follows', async () => {
      assert.equal(await popup.locator('h1').innerText(), 'X-starter');
      assert.equal(await popup.locator('#followback-enabled').isChecked(), false);
      assert.equal(await worker.evaluate(() => chrome.alarms.get('magpie-followback-scan')), undefined);
      assert.equal(evidence.scans, 0); assert.deepEqual(evidence.clicks, []);
    });
    await step('enabling checks existing followers and creates a bounded list without clicking Follow', async () => {
      await popup.locator('#x-account').fill('@writer'); await popup.locator('#followback-enabled').check(); await save();
      const alarm = await worker.evaluate(() => chrome.alarms.get('magpie-followback-scan')); assert.equal(alarm.periodInMinutes, 30);
      for (let i = 0; i < 150 && !(await status()).checkedAt; i++) await popup.waitForTimeout(100);
      const value = await settled(); await refresh();
      assert.deepEqual(value.items.map(row => row.account), names, JSON.stringify(value)); assert.equal(value.scanned, 7); assert.equal(value.partial, true);
      assert.equal(value.items[0].name, 'Test alpha');
      assert.deepEqual(evidence.clicks, []); assert.equal(await popup.locator('.followback-item').count(), 5);
      await popup.locator('.followback-options').screenshot({ path: path.join(output, 'followback-list.png') });
      await popup.screenshot({ path: path.join(output, 'x-starter-settings.png'), fullPage: true });
    });
    await step('an alarm refreshes only the list and never confirms a person', async () => {
      const before = evidence.scans;
      await worker.evaluate(() => chrome.alarms.create('magpie-followback-scan', { when: Date.now() + 300, periodInMinutes: 30 }));
      for (let i = 0; i < 450 && evidence.scans === before; i++) await popup.waitForTimeout(100);
      await settled(); assert.ok(evidence.scans > before); assert.deepEqual(evidence.clicks, []); await refresh();
    });
    await step('one explicit confirmation follows one person exactly once and enforces the ten-second gap', async () => {
      await confirm('alpha').click(); const value = await settled(); await refresh();
      assert.deepEqual(evidence.clicks, ['alpha']); assert.equal(value.items[0].status, 'followed'); assert.equal(value.confirmed, 1);
      assert.equal((await worker.evaluate(() => followActivity.snapshot('writer'))).total, 1);
      assert.equal(await confirm('alpha').isEnabled(), false); assert.equal(await confirm('beta').isEnabled(), false);
      const blocked = await send({ type: 'FOLLOWBACK_CONFIRM', account: 'beta' });
      assert.equal(blocked.ok, false); assert.equal(blocked.error.code, 'FOLLOWBACK_COOLDOWN'); assert.deepEqual(evidence.clicks, ['alpha']);
    });
    await step('a private profile records a pending request without retrying', async () => {
      modes.beta = 'private'; await allowNext(); await confirm('beta').click(); const value = await settled(); await refresh();
      assert.deepEqual(evidence.clicks, ['alpha', 'beta']); assert.equal(value.items.find(row => row.account === 'beta').status, 'requested');
      assert.equal((await worker.evaluate(() => followActivity.snapshot('writer'))).total, 2);
    });
    await step('a person who no longer follows the bound account is not followed', async () => {
      modes.gamma = 'not-follower'; await allowNext(); await confirm('gamma').click(); const value = await settled();
      assert.equal(value.items.find(row => row.account === 'gamma').status, 'pending'); assert.match(value.notice, /关注你/); assert.deepEqual(evidence.clicks, ['alpha', 'beta']);
    });
    await step('an already-followed profile is detected without clicking an Unfollow button', async () => {
      modes.delta = 'already'; await allowNext(); await confirm('delta').click(); const value = await settled();
      assert.equal(value.items.find(row => row.account === 'delta').status, 'followed'); assert.deepEqual(evidence.clicks, ['alpha', 'beta']);
    });
    await step('an unconfirmed result is marked uncertain and cannot be clicked again', async () => {
      modes.epsilon = 'unknown'; await allowNext(); await confirm('epsilon').click(); const value = await settled(); await refresh();
      assert.equal(value.items.find(row => row.account === 'epsilon').status, 'uncertain'); assert.equal(await confirm('epsilon').isEnabled(), false);
      const retry = await send({ type: 'FOLLOWBACK_CONFIRM', account: 'epsilon' }); assert.equal(retry.ok, false); assert.equal(retry.error.code, 'FOLLOWBACK_STALE');
      assert.deepEqual(evidence.clicks, ['alpha', 'beta', 'epsilon']);
    });
    await step('a login-account mismatch pauses reads and follows before any click', async () => {
      signedIn = 'different'; await popup.locator('#followback-check').click(); const value = await settled(); await refresh();
      assert.equal(value.paused, true); assert.match(value.notice, /不一致/); assert.deepEqual(evidence.clicks, ['alpha', 'beta', 'epsilon']);
      signedIn = 'writer'; await popup.locator('#followback-check').click(); assert.equal((await settled()).paused, false); await refresh();
    });
    await step('a verification or rate limit pauses confirmation before any follow', async () => {
      modes.alpha = 'blocked'; await pending(['alpha']); await confirm('alpha').click(); const value = await settled(); await refresh();
      assert.equal(value.paused, true); assert.match(value.notice, /验证|限制/); assert.deepEqual(evidence.clicks, ['alpha', 'beta', 'epsilon']);
      assert.equal(await confirm('alpha').isEnabled(), false);
    });
    await step('disabling removes the browser alarm and leaves model calls at zero', async () => {
      await popup.locator('#followback-enabled').uncheck(); await save();
      assert.equal(await worker.evaluate(() => chrome.alarms.get('magpie-followback-scan')), undefined);
      assert.equal((await status()).enabled, false); assert.equal(await popup.locator('#followback-check').isEnabled(), false);
      assert.equal(evidence.modelCalls, 0); assert.deepEqual(evidence.pageErrors, []);
    });
    console.log(`Follow-back browser checks passed: ${evidence.checks.length}; synthetic follow clicks: ${evidence.clicks.length}; model calls: ${evidence.modelCalls}`);
  } finally {
    await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(output, 'followback-browser-evidence.json'), JSON.stringify(evidence, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
