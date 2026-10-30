/* Public-page reads and one worker-authorized follow. Never uses private X APIs. */
(() => {
  'use strict';
  if (globalThis.__magpieAutoFollowLoaded) return;
  globalThis.__magpieAutoFollowLoaded = true;
  const A = globalThis.MagpieAutoFollow, C = globalThis.MagpieReply, H = globalThis.MagpieProfile;
  const cancelled = new Set(), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = node => Boolean(node?.isConnected && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[aria-hidden="true"],[inert]'));
  const fail = (code, message) => new C.ReplyError('AUTOFOLLOW_' + code, message);
  const excluded = node => node.closest('article,[data-testid="UserCell"],aside');
  function profile(link) {
    const url = C.xURL(link.href);
    return url && /^\/[a-zA-Z0-9_]{1,15}\/?$/u.test(url.pathname) ? A.account(url.pathname.replaceAll('/', '')) : '';
  }
  function currentAccount() {
    const owners = new Set([...document.querySelectorAll('[data-testid="AppTabBar_Profile_Link"]')].filter(visible).map(profile).filter(Boolean));
    return owners.size === 1 ? [...owners][0] : '';
  }
  function check(message) {
    if (cancelled.has(message.token)) throw fail('CANCELLED', '已停止本次自动关注。');
    if (/^\/(?:i\/flow\/login|login|account\/access)(?:\/|$)/u.test(location.pathname) || document.querySelector('iframe[src*="arkoselabs"],iframe[src*="captcha"]')) throw fail('BLOCKED', 'X 需要登录或验证，自动关注已暂停。');
    const notices = [...document.querySelectorAll('[role="alert"],[data-testid="toast"],[data-testid="error-detail"],[data-testid="error-message"]')].filter(visible).map(node => node.innerText).join(' ');
    if (/rate limit|temporarily restricted|unable to follow|cannot follow|can['’]t follow|could(?:n['’]t| not) follow|follow.*(?:failed|limit|error)|something went wrong|try again later|account.*(?:locked|suspended)|unusual activity|verify your|too many|达到.*上限|操作.*频繁|账户.*(?:限制|锁定)|账号.*(?:限制|锁定)|验证.*身份|请.*验证|关注失败|无法关注|不能关注|禁止.*关注|发生.*错误|出了.*问题|出错|请求失败|稍后.*重试/iu.test(notices)) throw fail('BLOCKED', 'X 显示关注错误、验证或操作限制，自动关注已暂停。');
    if (currentAccount() !== message.account) throw fail('ACCOUNT', `当前登录账号与 @${message.account} 不一致，自动关注已暂停。`);
  }
  async function ready(message) {
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      if (currentAccount() || /^\/(?:i\/flow\/login|login|account\/access)(?:\/|$)/u.test(location.pathname)) { check(message); return; }
      if (cancelled.has(message.token)) throw fail('CANCELLED', '已停止本次自动关注。');
      await pause(200);
    }
    throw fail('ACCOUNT', '未确认当前登录账号，自动关注已暂停。');
  }
  function blue(scope, name, header = false) {
    return [...scope.querySelectorAll('svg[data-testid="icon-verified"],svg[aria-label="Verified account"],svg[aria-label="认证账号"],svg[aria-label="已认证账号"]')].some(badge => {
      if (!visible(badge) || badge.closest('[data-testid="UserDescription"]')) return false;
      const link = badge.closest('a[href]');
      if (header && link && profile(link) !== name) return false;
      if (!header && (!badge.closest('a[href]') || profile(badge.closest('a[href]')) !== name)) return false;
      // Gold/grey badges share icon-verified. Require a rendered blue foreground.
      const fills = [...badge.querySelectorAll('path'), badge].map(node => getComputedStyle(node).fill);
      return fills.some(fill => {
        const rgb = fill.match(/^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/u)?.slice(1).map(Number);
        return rgb && rgb[0] <= 80 && rgb[1] >= 110 && rgb[1] <= 190 && rgb[2] >= 200 && rgb[2] > rgb[1];
      });
    });
  }
  function relationship(scope) {
    const buttons = [...scope.querySelectorAll('button,[role="button"]')].filter(node => visible(node) && !excluded(node));
    if (buttons.some(node => (node.getAttribute('data-testid') || '').endsWith('-unfollow') || /^(?:Following|正在关注|已关注|跟隨中)$/iu.test(node.innerText.trim()))) return 'followed';
    if (buttons.some(node => /-(?:cancel|pending)$/u.test(node.getAttribute('data-testid') || '') || /^(?:Requested|Pending|已请求|已申请|待批准|已申請)$/iu.test(node.innerText.trim()))) return 'requested';
    return '';
  }
  function cellFollowing(cell) {
    return [...cell.querySelectorAll('button,[role="button"]')].some(node => /-(?:unfollow|cancel|pending)$/u.test(node.getAttribute('data-testid') || '') || /^(?:Following|Requested|Pending|正在关注|已关注|已请求|已申请|待批准|已申請)$/iu.test(node.innerText.trim()));
  }
  function identity(scope) {
    const links = [...scope.querySelectorAll('a[href]')].filter(link => visible(link) && profile(link));
    const own = links.find(link => link.querySelector('[data-testid^="UserAvatar-Container-"],img')) || links.find(link => link.innerText.trim().startsWith('@'));
    const name = own && profile(own);
    if (!name) return null;
    const label = links.find(link => link !== own && !link.querySelector('img,[data-testid^="UserAvatar-Container-"]') && profile(link) === name && link.innerText.trim() && !link.innerText.trim().startsWith('@'));
    return { account: name, name: label?.innerText.trim() || `@${name}` };
  }
  function sourceMatches(source, owner) {
    if (source === 'followers') return location.pathname.replace(/\/$/u, '').toLowerCase() === `/${owner}/followers`;
    return source === 'search' && location.pathname === '/search' && new URLSearchParams(location.search).get('q') === '"蓝v互关"' && new URLSearchParams(location.search).get('f') === 'live';
  }
  async function scan(message) {
    const owner = A.account(message.account), source = message.source, limit = Math.min(A.TARGET, Math.max(1, Number(message.limit) || A.TARGET));
    if (!owner || !sourceMatches(source, owner)) throw fail('SOURCE', '候选来源页面不匹配，停止读取。');
    await ready(message);
    const omitted = new Set((Array.isArray(message.exclude) ? message.exclude : []).map(A.account)), found = new Map(), seen = new Set();
    const until = Date.now() + 12000;
    let stable = 0, lastSize = -1, region;
    while (Date.now() < until) {
      check(message);
      if (!sourceMatches(source, owner)) throw fail('SOURCE', '页面已切换，停止读取候选。');
      const regions = [...document.querySelectorAll('main [aria-label]')].filter(node => visible(node) && /^Timeline:|^时间线[:：]|^時間軸[:：]/iu.test(node.getAttribute('aria-label') || '') && (source === 'search' ? /search|搜索|搜尋/iu : /follower|粉丝|粉絲|关注者|關注者|跟隨者/iu).test(node.getAttribute('aria-label') || ''));
      region = regions.length === 1 ? regions[0] : null;
      if (!region) { await pause(250); continue; }
      const cells = [...region.querySelectorAll(source === 'followers' ? '[data-testid="UserCell"]' : 'article[data-testid="tweet"]')];
      for (const cell of cells) {
        if (!visible(cell)) continue;
        const header = source === 'followers' ? cell : cell.querySelector('[data-testid="User-Name"]');
        const value = header && identity(header);
        if (!value || value.account === owner) continue;
        seen.add(value.account);
        if (omitted.has(value.account) || !blue(header, value.account) || source === 'followers' && cellFollowing(cell)) continue;
        if (source === 'search') {
          const body = [...cell.querySelectorAll('[data-testid="tweetText"]')].find(node => node.closest('article') === cell && !node.closest('[data-testid="quoteTweet"],[role="link"][tabindex="0"]'));
          if (!body?.innerText.replace(/\s/gu, '').toLowerCase().includes('蓝v互关')) continue;
        }
        found.set(value.account, { ...value, source });
      }
      if (found.size >= limit) break;
      const loading = [...region.querySelectorAll('[role="progressbar"]')].some(visible);
      stable = seen.size === lastSize && !loading ? stable + 1 : 0; lastSize = seen.size;
      if (stable >= 3) break;
      cells.at(-1)?.scrollIntoView({ block: 'end' }); window.scrollBy(0, Math.max(500, innerHeight * .8));
      await pause(350);
    }
    if (!region) throw fail('SOURCE', '候选列表未加载，已停止本轮读取。');
    return { account: owner, source, items: [...found.values()].slice(0, limit), scanned: seen.size, partial: true };
  }
  function header(target) {
    const main = document.querySelector('main [data-testid="primaryColumn"]') || document.querySelector('main');
    if (!main) return null;
    const names = [...main.querySelectorAll('[data-testid="UserName"]')].filter(node => visible(node) && !excluded(node));
    if (names.length !== 1 || ![...names[0].querySelectorAll('span,div')].some(node => node.textContent.trim().toLowerCase() === `@${target}`)) return null;
    const links = [...main.querySelectorAll('a[href]')].filter(node => visible(node) && !excluded(node)).map(node => ({ node, value: H.countLink(node) })).filter(row => row.value?.account === target);
    const following = links.filter(row => row.value.kind === 'following'), followers = links.filter(row => row.value.kind === 'followers');
    if (following.length !== 1 || followers.length !== 1) return null;
    for (let node = names[0].parentElement; node && main.contains(node); node = node.parentElement) {
      const hasControl = [...node.querySelectorAll('button,[role="button"]')].some(button => visible(button) && !excluded(button) && (/-(?:follow|unfollow|cancel|pending)$/u.test(button.getAttribute('data-testid') || '') || /^(?:Follow|Follow back|Following|Requested|Pending|关注|回关|正在关注|已关注|已请求|已申请|關注|跟隨)$/iu.test(button.innerText.trim())));
      if (hasControl && node.contains(following[0].node) && node.contains(followers[0].node)) return { scope: node, blue: blue(names[0], target, true),
        following: H.readCount(following[0].node), followers: H.readCount(followers[0].node),
        followsYou: [...node.querySelectorAll('[data-testid="userFollowIndicator"],[data-testid="UserFollowIndicator"]')].some(value => visible(value) && !excluded(value) && /^(?:Follows you|关注了你|已关注你|跟随你|跟隨你|正在關注你)$/iu.test(value.innerText.trim())) };
      if (node === main) break;
    }
    return null;
  }
  async function follow(message) {
    const target = A.account(message.target);
    if (!target || target === message.account || location.pathname.replace(/\/$/u, '').toLowerCase() !== `/${target}`) throw fail('SOURCE', '关注目标不匹配，未点击。');
    await ready(message);
    let info;
    const until = Date.now() + 7000;
    while (Date.now() < until) { check(message); info = header(target); if (info) break; await pause(200); }
    check(message);
    if (!info) return { status: 'skipped', clicked: false, reason: '未能确认资料区或数量，跳过。' };
    const existing = relationship(info.scope);
    if (existing) return { status: 'already', clicked: false, reason: existing === 'followed' ? '已经关注。' : '已经发送关注申请。' };
    if (!A.qualifies(info, message.source)) return { status: 'skipped', clicked: false, reason: message.source === 'followers' ? '蓝 V 或仍关注你的关系不再符合。' : '蓝 V、关注数或粉丝数不符合条件。' };
    // The worker checks the tab, token, current setting, account and reservation
    // immediately before this one action; scan messages cannot authorize a click.
    const permission = await chrome.runtime.sendMessage({ type: 'AUTOFOLLOW_AUTHORIZE', token: message.token, account: message.account, target });
    if (!permission?.ok || permission.data?.allowed !== true) throw fail('CANCELLED', '自动关注已停止，未获得执行许可。');
    check(message);
    info = header(target);
    if (!info || !A.qualifies(info, message.source) || relationship(info.scope) || location.pathname.replace(/\/$/u, '').toLowerCase() !== `/${target}`) return { status: 'skipped', clicked: false, reason: '资料或关注关系已变化，跳过。' };
    const buttons = [...info.scope.querySelectorAll('button,[role="button"]')].filter(node => visible(node) && !excluded(node) && ((node.getAttribute('data-testid') || '').endsWith('-follow') || /^(?:Follow|Follow back|关注|回关|關注|跟隨)$/iu.test(node.innerText.trim())));
    if (buttons.length !== 1 || buttons[0].disabled || buttons[0].getAttribute('aria-disabled') === 'true') return { status: 'skipped', clicked: false, reason: '没有唯一可用的关注按钮，跳过。' };
    buttons[0].click();
    try {
      let confirmed = '', stableAt = 0;
      for (let count = 0; count < 32; count++) {
        await pause(250); check(message);
        if (location.pathname.replace(/\/$/u, '').toLowerCase() !== `/${target}`) throw fail('SOURCE', '页面已切换，请手动核实关注结果。');
        const current = header(target), result = current && relationship(current.scope);
        if (!result && confirmed) throw fail('BLOCKED', 'X 的关注状态已回退，自动关注已暂停，请核实。');
        if (result !== confirmed) { confirmed = result || ''; stableAt = Date.now(); }
        if (result && Date.now() - stableAt >= 1500) return { status: result, clicked: true };
      }
    } catch (error) { error.clicked = true; throw error; }
    return { status: 'uncertain', clicked: true, reason: '关注结果未确认，不会自动重试。' };
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !['AUTOFOLLOW_READY', 'AUTOFOLLOW_SCAN_PAGE', 'AUTOFOLLOW_FOLLOW_PAGE', 'AUTOFOLLOW_CANCEL_PAGE'].includes(message?.type)) return;
    if (message.type === 'AUTOFOLLOW_READY') { respond({ ok: true, data: { account: currentAccount() } }); return; }
    if (message.type === 'AUTOFOLLOW_CANCEL_PAGE') { cancelled.add(message.token); respond({ ok: true }); return; }
    let clicked = false;
    const task = message.type === 'AUTOFOLLOW_SCAN_PAGE' ? scan(message) : follow(message);
    task.then(data => respond({ ok: true, data }), error => { clicked = error.clicked === true; respond({ ok: false, error: { code: error.code || 'AUTOFOLLOW_SOURCE', message: error.message, clicked } }); });
    return true;
  });
})();
