'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const extension = path.resolve(__dirname, '..'), output = path.join(extension, '.test-output');
fs.mkdirSync(output, { recursive: true });
const evidence = { checks: [], clicks: [], pageErrors: [], modelCalls: 0 };
let owner = 'writer', followers = [], search = [], modes = {};
const badge = type => !type || type === 'plain' ? '' : `<svg data-testid="icon-verified" aria-label="Verified account" viewBox="0 0 24 24" style="width:18px;height:18px;fill:${type === 'gold' ? 'rgb(226,183,25)' : type === 'gray' ? 'rgb(130,130,130)' : 'rgb(29,155,240)'}"><path d="M0 0h24v24H0z"/></svg>`;
function cell(name) {
  const mode = modes[name] || {}, state = mode.cellState || 'follow';
  return `<div data-testid="UserCell"><a href="/${name}"><div data-testid="UserAvatar-Container-${name}">A</div></a><a href="/${name}">Test ${name}${badge(mode.cellBadge || 'blue')}</a><a href="/${name}">@${name}</a><button data-testid="${name}-${state}">${state === 'unfollow' ? 'Following' : state === 'pending' ? 'Requested' : 'Follow back'}</button></div>`;
}
function post(name) {
  const mode = modes[name] || {};
  return `<article data-testid="tweet"><div data-testid="User-Name"><a href="/${name}">Test ${name}${badge(mode.cellBadge || 'blue')}</a><a href="/${name}">@${name}</a><a href="/${name}/status/123"><time>now</time></a></div><div data-testid="tweetText">${mode.text || '蓝V互关，一起交流。'}</div>${mode.quote ? `<div data-testid="quoteTweet"><a href="/stranger">Stranger${badge('blue')}</a><div data-testid="tweetText">蓝v互关</div></div>` : ''}</article>`;
}
function fixture(url) {
  const parsed = new URL(url), target = parsed.pathname.split('/')[1], mode = modes[target] || {};
  const navOwner = mode.mismatch ? 'another' : owner;
  const nav = `<nav><a data-testid="AppTabBar_Profile_Link" href="/${navOwner}">@${navOwner}</a></nav>`;
  let body;
  if (parsed.pathname.endsWith('/followers')) body = `<section aria-label="Timeline: Followers">${followers.map(cell).join('')}<p>End of demo list</p></section><aside>${cell('outside')}</aside>`;
  else if (target === 'search') body = `<section aria-label="Timeline: Search timeline">${search.map(post).join('')}<p>End of search</p></section>`;
  else {
    const status = mode.already ? 'unfollow' : 'follow';
    body = `<section id="profile" ${mode.delay ? 'style="display:none"' : ''}><button id="target-follow" data-testid="${target}-${status}">${mode.already ? 'Following' : 'Follow'}</button><div data-testid="UserName"><span>Test ${target}</span>${badge(mode.profileBadge || 'blue')}<div><span>@${target}</span></div></div>${mode.notFollower ? '' : '<div data-testid="userFollowIndicator">Follows you</div>'}<div><a href="/${target}/following">${mode.following ?? 2000} Following</a><a href="/${target}/verified_followers">${mode.followers ?? 800} Followers</a></div></section>${mode.blocked ? '<p role="alert">Unable to follow: rate limit reached.</p>' : ''}<aside>${cell('outside')}</aside><script>document.getElementById('target-follow').onclick=function(){window.recordSyntheticFollow(${JSON.stringify(target)},${JSON.stringify(owner)});if(${mode.unknown === true})return;this.dataset.testid=${JSON.stringify(target)}+${JSON.stringify(mode.private ? '-pending' : '-unfollow')};this.textContent=${JSON.stringify(mode.private ? 'Requested' : 'Following')};};${mode.delay ? 'setTimeout(()=>document.getElementById("profile").style.display="block",3000);' : ''}</script>`;
  }
  if (mode.foreignBlue) body += '<script>document.querySelector(\'[data-testid="UserName"]\').insertAdjacentHTML("beforeend",' + JSON.stringify('<a href="/stranger">Affiliation' + badge('blue') + '</a>') + ')</script>';
  if (mode.splitControls) body += '<script>{const root=document.getElementById("profile"),info=document.createElement("div");for(const node of [...root.children])if(node.id!=="target-follow")info.append(node);root.append(info);}</script>';
  return `<!doctype html><html><meta charset="utf-8"><title>Synthetic X auto-follow fixture</title><style>body{font:16px/1.6 sans-serif;margin:20px}main{max-width:680px}section,article{padding:15px;background:#eef4f2}button{padding:10px;margin:8px}a{margin-right:12px}[data-testid="UserCell"]{padding:8px;border-bottom:1px solid #ccc}</style>${nav}<main><div data-testid="primaryColumn">${body}</div></main></html>`;
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
  const context = await chromium.launchPersistentContext(path.join(output, `autofollow-browser-${Date.now()}`), {
    channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1160, height: 1200 }, timeout: 25000
  });
  context.on('page', page => page.on('pageerror', error => evidence.pageErrors.push(error.message)));
  try {
    await context.exposeBinding('recordSyntheticFollow', (_source, target, account) => evidence.clicks.push({ target, account, at: Date.now() }));
    await context.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture(route.request().url()) }));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async port => {
      const originalDispatch = dispatch;
      dispatch = async (...args) => { try { return await originalDispatch(...args); } catch (error) { if (args[0]?.type === 'SAVE_SETTINGS') globalThis.__autoSaveError = { message: error.message, stack: error.stack }; throw error; } };
      // Test-only warmup ensures Edge's first background-tab navigation is mocked.
      const create = chrome.tabs.create.bind(chrome.tabs);
      chrome.tabs.create = async options => { const tab = await create({ ...options, url: 'about:blank' }); await new Promise(resolve => setTimeout(resolve, 200)); await chrome.tabs.update(tab.id, { url: options.url }); return tab; };
      await autoFollow.ready; await chrome.storage.local.set({ settings: { port } });
    }, server.address().port);
    const popup = await context.newPage();
    await popup.goto(worker.url().replace('/background.js', '') + '/popup.html?settings=1');
    await popup.waitForFunction(() => !document.getElementById('save').disabled);
    const send = message => popup.evaluate(message => chrome.runtime.sendMessage(message), message);
    const status = async () => (await send({ type: 'AUTOFOLLOW_STATUS' })).data;
    const waitFor = async (predicate, timeout = 25000) => { const end = Date.now() + timeout; while (Date.now() < end) { const value = await status(); if (await predicate(value)) return value; await popup.waitForTimeout(100); } throw new Error('Timed out: ' + JSON.stringify(await status())); };
    const save = async () => {
      await popup.locator('#save').click();
      try { await popup.waitForFunction(() => document.getElementById('feedback').textContent.includes('已保存') || document.getElementById('feedback').classList.contains('error'), undefined, { timeout: 10000 }); }
      catch { throw new Error('Save did not complete: ' + JSON.stringify(await popup.evaluate(() => ({ feedback: document.getElementById('feedback').textContent, invalid: [...document.querySelectorAll(':invalid')].map(node => node.id) })))); }
      assert.match(await popup.locator('#feedback').innerText(), /已保存/, JSON.stringify(await worker.evaluate(() => globalThis.__autoSaveError)));
      await popup.waitForFunction(() => !document.getElementById('save').disabled);
    };
    const off = async () => { await popup.locator('#autofollow-enabled').uncheck(); await save(); await waitFor(value => !value.busy); };
    const start = async (account, fanNames, searchNames, profileModes, limits = {}) => {
      await off(); owner = account; followers = fanNames; search = searchNames; modes = profileModes;
      await popup.locator('#autofollow-account').fill('@' + account); await popup.locator('#autofollow-round').fill(String(limits.round || 1)); await popup.locator('#autofollow-daily').fill(String(limits.daily || 1));
      await popup.locator('#autofollow-enabled').check(); await save();
    };
    async function readScan(source) {
      const target = source === 'followers' ? `https://x.com/${owner}/followers` : 'https://x.com/search?q=' + encodeURIComponent('"蓝v互关"') + '&src=typed_query&f=live';
      const page = await context.newPage(); await page.goto(target); await page.waitForTimeout(250);
      const result = await worker.evaluate(async ({ target, source, account }) => {
        const tab = (await chrome.tabs.query({})).find(tab => tab.url === target);
        return chrome.tabs.sendMessage(tab.id, { type: 'AUTOFOLLOW_SCAN_PAGE', account, source, token: 'read-only-fixture', limit: 20, exclude: [] });
      }, { target, source, account: owner });
      await page.close(); assert.equal(result.ok, true, JSON.stringify(result)); return result.data;
    }
    await step('fresh settings show an off switch and thirty-minute/twenty/fifty defaults without opening X', async () => {
      assert.equal(await popup.locator('#autofollow-enabled').isChecked(), false);
      assert.equal(await popup.locator('#autofollow-interval').inputValue(), '30'); assert.equal(await popup.locator('#autofollow-round').inputValue(), '20'); assert.equal(await popup.locator('#autofollow-daily').inputValue(), '50');
      assert.equal(await worker.evaluate(() => chrome.alarms.get('x-starter-auto-follow')), undefined); assert.equal(evidence.clicks.length, 0);
    });
    await step('follower reads reject plain/gold/grey badges and already-followed or pending rows', async () => {
      followers = ['bluefan', 'plainfan', 'goldfan', 'grayfan', 'already', 'pending'];
      modes = { plainfan: { cellBadge: 'plain' }, goldfan: { cellBadge: 'gold' }, grayfan: { cellBadge: 'gray' }, already: { cellState: 'unfollow' }, pending: { cellState: 'pending' } };
      const value = await readScan('followers'); assert.deepEqual(value.items.map(row => row.account), ['bluefan']); assert.equal(value.scanned, 6); assert.equal(evidence.clicks.length, 0);
    });
    await step('search reads only matching original-post authors, excluding quote-only keywords and foreign badges', async () => {
      search = ['findgood', 'findplain', 'findgold', 'quotedkeyword', 'foreignbadge'];
      modes = { findplain: { cellBadge: 'plain' }, findgold: { cellBadge: 'gold' }, quotedkeyword: { text: 'Other conversation', quote: true }, foreignbadge: { cellBadge: 'plain', quote: true } };
      const value = await readScan('search'); assert.deepEqual(value.items.map(row => row.account), ['findgood']); assert.equal(evidence.clicks.length, 0);
    });
    await step('the scheduler follows a blue follower with low counts before a qualifying search author and observes its random gap', async () => {
      await start('roundtest', ['tinyfan'], ['searchgood'], { tinyfan: { following: 10, followers: 20, splitControls: true } }, { round: 2, daily: 2 });
      const first = await waitFor(value => value.history.length === 1 && !value.busy);
      assert.equal(first.history[0].account, 'tinyfan'); assert.equal(first.history[0].status, 'followed', JSON.stringify(first)); assert.equal(first.dayUsed, 1);
      const planned = first.nextAllowedAt - evidence.clicks.at(-1).at; assert.ok(planned >= 5000 && planned <= 11500, String(planned));
      await popup.locator('#autofollow-refresh').click(); await popup.locator('.autofollow-options details').first().evaluate(node => { node.open = true; }); await popup.locator('.autofollow-history').evaluate(node => { node.open = true; });
      await popup.locator('.autofollow-options').screenshot({ path: path.join(output, 'autofollow-settings.png') });
      const second = await waitFor(value => value.history.length === 2 && !value.busy);
      assert.equal(second.history[0].account, 'searchgood'); assert.equal(second.dayUsed, 2); assert.equal(second.roundUsed, 2);
      const pair = evidence.clicks.filter(row => row.account === 'roundtest'); assert.equal(pair.length, 2); assert.ok(pair[1].at - pair[0].at >= 5000);
      await worker.evaluate(() => autoFollow.tick()); assert.equal(evidence.clicks.filter(row => row.account === 'roundtest').length, 2);
    });
    await step('private profiles record one pending request and do not retry', async () => {
      await start('privatetest', ['privatefan'], [], { privatefan: { private: true } });
      const value = await waitFor(value => value.history.length && !value.busy); assert.equal(value.history[0].status, 'requested'); assert.equal(value.dayUsed, 1);
      assert.equal(evidence.clicks.filter(row => row.target === 'privatefan').length, 1);
    });
    await step('a follower who removed their relationship is skipped before any click', async () => {
      await start('lostfantest', ['lostfan'], [], { lostfan: { notFollower: true } });
      const value = await waitFor(value => value.history.length && !value.busy); assert.equal(value.history[0].status, 'skipped'); assert.equal(value.dayUsed, 0); assert.equal(evidence.clicks.some(row => row.target === 'lostfan'), false);
    });
    await step('a badge changing from blue to gold on the profile is not followed', async () => {
      await start('goldtest', ['changedgold'], [], { changedgold: { profileBadge: 'gold' } });
      const value = await waitFor(value => value.history.length && !value.busy); assert.equal(value.history[0].status, 'skipped'); assert.equal(evidence.clicks.some(row => row.target === 'changedgold'), false);
    });
    await step('another accounts blue badge in the profile header cannot qualify a gold owner', async () => {
      await start('foreignbadgetst', ['foreignfan'], [], { foreignfan: { profileBadge: 'gold', foreignBlue: true } });
      const value = await waitFor(value => value.history.length && !value.busy); assert.equal(value.history[0].status, 'skipped'); assert.equal(evidence.clicks.some(row => row.target === 'foreignfan'), false);
    });
    await step('search candidates with exactly five hundred followers fail the strict threshold', async () => {
      await start('boundarytest', [], ['boundary'], { boundary: { following: 2000, followers: 500 } });
      const value = await waitFor(value => value.history.length && !value.busy); assert.equal(value.history[0].status, 'skipped'); assert.equal(value.dayUsed, 0); assert.equal(evidence.clicks.some(row => row.target === 'boundary'), false);
    });
    await step('an already-followed profile is skipped without ever pressing Unfollow', async () => {
      await start('alreadytest', ['existingfan'], [], { existingfan: { already: true } });
      const value = await waitFor(value => value.history.length && !value.busy); assert.equal(value.history[0].status, 'already'); assert.equal(value.dayUsed, 0); assert.equal(evidence.clicks.some(row => row.target === 'existingfan'), false);
    });
    await step('a login account mismatch pauses the task without a follow', async () => {
      await start('mismatchtest', ['wrongowner'], [], { wrongowner: { mismatch: true } });
      const value = await waitFor(value => value.paused && !value.busy); assert.match(value.notice, /不一致/); assert.equal(evidence.clicks.some(row => row.target === 'wrongowner'), false);
    });
    await step('X verification or follow restrictions pause the task and clear its timer alarm', async () => {
      await start('blockedtest', ['limitedfan'], [], { limitedfan: { blocked: true } });
      const value = await waitFor(value => value.paused && !value.busy); assert.match(value.notice, /验证|限制/); assert.equal(await worker.evaluate(() => chrome.alarms.get('x-starter-auto-follow')), undefined); assert.equal(evidence.clicks.some(row => row.target === 'limitedfan'), false);
    });
    await step('an uncertain click result pauses and is never retried on resume', async () => {
      await start('unknowntest', ['unknownfan'], [], { unknownfan: { unknown: true } });
      const value = await waitFor(value => value.paused && !value.busy); assert.equal(value.history[0].status, 'uncertain'); assert.equal(value.dayUsed, 1);
      await popup.locator('#autofollow-refresh').click(); await popup.locator('#autofollow-resume').click(); await worker.evaluate(() => autoFollow.tick());
      assert.equal(evidence.clicks.filter(row => row.target === 'unknownfan').length, 1);
    });
    await step('turning the switch off while a profile loads prevents a late follow', async () => {
      await start('disabletest', ['delayedfan'], [], { delayedfan: { delay: true } });
      await waitFor(value => value.inFlight?.account === 'delayedfan'); await off(); await popup.waitForTimeout(3200);
      assert.equal(evidence.clicks.some(row => row.target === 'delayedfan'), false); assert.equal((await status()).enabled, false); assert.equal(await worker.evaluate(() => chrome.alarms.get('x-starter-auto-follow')), undefined);
    });
    await step('a user opening a temporary tab keeps that tab and pauses its pending follow', async () => {
      await start('touchtest', ['touchedfan'], [], { touchedfan: { delay: true } });
      await waitFor(value => value.inFlight?.account === 'touchedfan');
      let tabId;
      for (let i = 0; i < 60 && !tabId; i++) { tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === 'https://x.com/touchedfan')?.id); if (!tabId) await popup.waitForTimeout(50); }
      assert.ok(tabId); await worker.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), tabId);
      await waitFor(value => value.paused && !value.busy); assert.ok(await worker.evaluate(tabId => chrome.tabs.get(tabId), tabId));
      assert.equal(evidence.clicks.some(row => row.target === 'touchedfan'), false);
      await worker.evaluate(tabId => chrome.tabs.remove(tabId), tabId); await off();
    });
    await step('ordinary page scripts have no extension management bridge and no model completion was requested', async () => {
      const page = await context.newPage(); await page.goto('https://x.com/home'); await page.waitForTimeout(250);
      const result = await page.evaluate(() => new Promise(resolve => {
        // Page JavaScript has no extension API; this assertion also checks that
        // no bridge exposed an automatic-follow management capability to it.
        resolve({ hasRuntime: Boolean(globalThis.chrome?.runtime?.sendMessage) });
      }));
      assert.equal(result.hasRuntime, false); await page.close();
      assert.equal(evidence.modelCalls, 0); assert.deepEqual(evidence.pageErrors, []);
    });
    console.log(`Automatic-follow browser checks passed: ${evidence.checks.length}; synthetic clicks: ${evidence.clicks.length}; model calls: ${evidence.modelCalls}`);
  } finally {
    try { evidence.finalState = await context.serviceWorkers()[0]?.evaluate(() => autoFollow.status()); } catch { /* Preserve the original test failure. */ }
    await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(output, 'autofollow-browser-evidence.json'), JSON.stringify(evidence, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
