/* Read a dedicated followers page; follow only one explicitly confirmed account. */
(() => {
  'use strict';
  if (globalThis.__magpieFollowersLoaded) return;
  globalThis.__magpieFollowersLoaded = true;
  const F = globalThis.MagpieFollowback, C = globalThis.MagpieReply;
  const cancelled = new Set();
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = node => Boolean(node?.isConnected && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[aria-hidden="true"], [inert]'));
  function profile(link) {
    try { const url = C.xURL(link.href); return url && /^\/[a-zA-Z0-9_]{1,15}\/?$/u.test(url.pathname) ? F.account(url.pathname.replaceAll('/', '')) : ''; } catch { return ''; }
  }
  function currentAccount() {
    const owners = new Set([...document.querySelectorAll('[data-testid="AppTabBar_Profile_Link"]')].map(profile).filter(Boolean));
    return owners.size === 1 ? [...owners][0] : '';
  }
  function check(owner, token) {
    if (cancelled.has(token)) throw new C.ReplyError('FOLLOWBACK_CANCELLED', '已取消本次回关操作。');
    if (/^\/(?:i\/flow\/login|login|account\/access)(?:\/|$)/u.test(location.pathname)) throw new C.ReplyError('FOLLOWBACK_BLOCKED', 'X 需要登录或验证，已暂停。');
    const alerts = [...document.querySelectorAll('[role="alert"], [data-testid="toast"], [data-testid="error-detail"], [data-testid="error-message"]')].filter(visible).map(node => node.innerText).join(' ');
    if (/rate limit|temporarily restricted|unable to follow|cannot follow|can['’]t follow|could(?:n['’]t| not) follow|follow.*(?:failed|limit|error)|something went wrong|try again later|account.*(?:locked|suspended)|unusual activity|verify your|too many|达到.*上限|操作.*频繁|账户.*(?:限制|锁定)|账号.*(?:限制|锁定)|验证.*身份|请.*验证|关注失败|无法关注|不能关注|禁止.*关注|发生.*错误|出了.*问题|出错|请求失败|稍后.*重试/iu.test(alerts)) throw new C.ReplyError('FOLLOWBACK_BLOCKED', 'X 显示关注错误、验证或操作限制，已暂停，请先在 X 处理。');
    if (currentAccount() !== owner) throw new C.ReplyError('FOLLOWBACK_ACCOUNT', `当前登录账号与 @${owner} 不一致，已暂停。`);
  }
  function followButton(scope, name) {
    const buttons = [...scope.querySelectorAll('button, [role="button"]')].filter(visible).filter(button => {
      const id = button.getAttribute('data-testid') || '', text = button.innerText.trim();
      return id.endsWith('-follow') || /^(?:Follow|关注|關注|跟隨)$/iu.test(text) || (button.getAttribute('aria-label') || '').toLowerCase() === `follow @${name}`;
    });
    return buttons.length === 1 && !buttons[0].disabled && buttons[0].getAttribute('aria-disabled') !== 'true' ? buttons[0] : null;
  }
  function relationship(scope) {
    const buttons = [...scope.querySelectorAll('button, [role="button"]')].filter(visible);
    if (buttons.some(button => (button.getAttribute('data-testid') || '').endsWith('-unfollow') || /^(?:Following|正在关注|已关注|跟隨中)$/iu.test(button.innerText.trim()))) return 'followed';
    if (buttons.some(button => /^(?:Requested|Pending|已请求|已申请|待批准|已申請)$/iu.test(button.innerText.trim()) || /-(?:cancel|pending)$/u.test(button.getAttribute('data-testid') || ''))) return 'requested';
    return '';
  }
  async function ready(owner, token) {
    const until = Date.now() + 12000;
    while (Date.now() < until) {
      if (currentAccount()) { check(owner, token); return; }
      if (/^\/(?:i\/flow\/login|login|account\/access)(?:\/|$)/u.test(location.pathname)) check(owner, token);
      await pause(250);
    }
    throw new C.ReplyError('FOLLOWBACK_ACCOUNT', '未确认当前登录账号，已暂停，请先登录 X。');
  }
  function timeline() {
    const regions = [...document.querySelectorAll('main [aria-label]')].filter(node => /^Timeline:|^时间线[:：]|^時間軸[:：]/iu.test(node.getAttribute('aria-label') || '') && /follower|粉丝|粉絲|关注者|關注者|跟隨者|跟随者/iu.test(node.getAttribute('aria-label') || '') && visible(node));
    return regions.length === 1 ? regions[0] : null;
  }
  function cellIdentity(cell) {
    const links = [...cell.querySelectorAll('a[href]')].filter(link => profile(link));
    const primary = links.find(link => link.querySelector('img, [data-testid^="UserAvatar-Container-"]')) || links.find(link => link.innerText.includes(`@${profile(link)}`));
    if (!primary) return null;
    const name = profile(primary), labels = links.filter(link => link !== primary && profile(link) === name && link.innerText.trim());
    const label = labels.find(link => !link.innerText.trim().startsWith('@')) || labels[0];
    return F.item({ account: name, name: label?.innerText || `@${name}` });
  }
  async function scan(message) {
    const owner = F.account(message.account), ignored = new Set((message.ignored || []).map(F.account)), found = new Map(), seen = new Set();
    if (!owner || location.pathname.replace(/\/$/u, '').toLowerCase() !== `/${owner}/followers`) throw new C.ReplyError('FOLLOWBACK_SOURCE', '当前页面不是已绑定账号的粉丝列表。');
    await ready(owner, message.token);
    let region, stable = 0, previousSize = -1;
    const until = Date.now() + 18000;
    while (Date.now() < until) {
      check(owner, message.token);
      if (location.pathname.replace(/\/$/u, '').toLowerCase() !== `/${owner}/followers`) throw new C.ReplyError('FOLLOWBACK_SOURCE', '粉丝页已切换，停止整理。');
      region = timeline();
      if (!region) { await pause(300); continue; }
      for (const cell of region.querySelectorAll('[data-testid="UserCell"]')) {
        if (!visible(cell)) continue;
        const value = cellIdentity(cell);
        if (!value || value.account === owner) continue;
        seen.add(value.account);
        if (!ignored.has(value.account) && !relationship(cell) && followButton(cell, value.account)) found.set(value.account, value);
      }
      if (found.size >= F.LIMIT) break;
      const loading = [...region.querySelectorAll('[role="progressbar"]')].some(visible);
      stable = seen.size === previousSize && !loading ? stable + 1 : 0; previousSize = seen.size;
      if (stable >= 4 && seen.size) break;
      const cells = region.querySelectorAll('[data-testid="UserCell"]');
      cells[cells.length - 1]?.scrollIntoView({ block: 'end' });
      window.scrollBy(0, Math.max(500, innerHeight * .8));
      await pause(450);
    }
    if (!region || !seen.size && !region.innerText.trim()) throw new C.ReplyError('FOLLOWBACK_SOURCE', '粉丝列表未加载，稍后可点「立即检查」重试。');
    return { account: owner, items: [...found.values()].slice(0, F.LIMIT), scanned: seen.size, partial: true };
  }
  function headerScope(name) {
    const main = document.querySelector('main [data-testid="primaryColumn"]') || document.querySelector('main');
    if (!main) return null;
    const stats = [...main.querySelectorAll('a[href]')].filter(link => {
      try { const url = C.xURL(link.href); return url && new RegExp(`^/${name}/(?:following|followers|verified_followers)/?$`, 'i').test(url.pathname) && visible(link); } catch { return false; }
    });
    let common = stats[0];
    if (!common || stats.length < 2) return null;
    while (common && !stats.every(link => common.contains(link))) common = common.parentElement;
    for (let node = common; node && main.contains(node); node = node.parentElement) {
      const buttons = [...node.querySelectorAll('button, [role="button"]')].filter(button => !button.closest('article, [data-testid="UserCell"], aside'));
      if (buttons.some(button => /-(?:follow|unfollow|cancel|pending)$/u.test(button.getAttribute('data-testid') || '') || /^(?:Follow|Following|Requested|关注|正在关注|已关注|已请求)$/iu.test(button.innerText.trim()))) return node;
      if (node === main) break;
    }
    return null;
  }
  async function confirm(message) {
    const owner = F.account(message.account), target = F.account(message.target);
    if (!owner || !target || target === owner || location.pathname.replace(/\/$/u, '').toLowerCase() !== `/${target}`) throw new C.ReplyError('FOLLOWBACK_SOURCE', '未能确认回关目标，未点击关注。');
    await ready(owner, message.token);
    let scope;
    const until = Date.now() + 8000;
    while (Date.now() < until) { check(owner, message.token); scope = headerScope(target); if (scope) break; await pause(250); }
    check(owner, message.token);
    if (!scope || location.pathname.replace(/\/$/u, '').toLowerCase() !== `/${target}`) throw new C.ReplyError('FOLLOWBACK_SOURCE', '未能确认该用户的资料区，未点击关注。');
    const existing = relationship(scope);
    if (existing) return { status: existing, clicked: false };
    const followsYou = [...scope.querySelectorAll('[data-testid="userFollowIndicator"], [data-testid="UserFollowIndicator"]')].some(node => visible(node) && /^(?:Follows you|关注了你|已关注你|跟随你|跟隨你|正在關注你)$/iu.test(node.innerText.trim()));
    if (!followsYou) throw new C.ReplyError('FOLLOWBACK_NOT_FOLLOWER', '资料页未确认对方仍关注你，未执行回关，请重新检查名单。');
    const button = followButton(scope, target);
    if (!button || button.closest('article, [data-testid="UserCell"], aside')) throw new C.ReplyError('FOLLOWBACK_SOURCE', '未找到明确的关注按钮，未执行回关。');
    // This is the only follow click. It runs only after a per-person settings-page confirmation.
    button.click();
    try {
      let confirmed = '', stableAt = 0;
      for (let attempt = 0; attempt < 32; attempt++) {
        await pause(250); check(owner, message.token);
        if (location.pathname.replace(/\/$/u, '').toLowerCase() !== `/${target}`) throw new C.ReplyError('FOLLOWBACK_SOURCE', '页面已切换，请手动核实关注结果。');
        const current = headerScope(target), status = current && relationship(current);
        if (!status && confirmed) throw new C.ReplyError('FOLLOWBACK_BLOCKED', 'X 的关注状态已回退，已暂停，请核实。');
        if (status !== confirmed) { confirmed = status || ''; stableAt = Date.now(); }
        if (status && Date.now() - stableAt >= 1500) return { status, clicked: true };
      }
    } catch (error) { error.clicked = true; throw error; }
    return { status: 'uncertain', clicked: true };
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !['FOLLOWBACK_ACCOUNT', 'FOLLOWBACK_SCAN_PAGE', 'FOLLOWBACK_CONFIRM_PAGE', 'FOLLOWBACK_CANCEL_PAGE'].includes(message?.type)) return;
    if (message.type === 'FOLLOWBACK_CANCEL_PAGE') { cancelled.add(message.token); respond({ ok: true, data: {} }); return; }
    if (message.type === 'FOLLOWBACK_ACCOUNT') { respond({ ok: true, data: { account: currentAccount() } }); return; }
    const task = message.type === 'FOLLOWBACK_SCAN_PAGE' ? scan(message) : confirm(message);
    task.then(data => respond({ ok: true, data }), error => respond({ ok: false, error: { code: error.code || 'FOLLOWBACK_SOURCE', message: error.message, clicked: error.clicked === true } }));
    return true;
  });
})();
