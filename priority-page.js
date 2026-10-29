/* Read only the matching profile header. Never click, scroll, follow or call a model. */
(() => {
  'use strict';
  const P = globalThis.MagpiePriority, H = globalThis.MagpieProfile, C = globalThis.MagpieReply;
  const cancelled = new Set(), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = node => Boolean(node?.isConnected && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[aria-hidden="true"],[inert]'));
  const excluded = node => node.closest('article,[data-testid="UserCell"],aside');
  function blocked() {
    if (/^\/(?:i\/flow\/login|login|account\/access)(?:\/|$)/u.test(location.pathname)) return true;
    return [...document.querySelectorAll('[role="alert"],[data-testid="error-detail"],[data-testid="error-message"]')].filter(visible).some(node => /rate limit|temporarily restricted|verify your|unusual activity|too many|验证.*身份|请.*验证|操作.*频繁|达到.*上限|账号.*限制|账户.*限制/iu.test(node.innerText));
  }
  function snapshot(name) {
    if (!name || location.pathname.replace(/\/$/u, '').toLowerCase() !== `/${name}`) return null;
    const main = document.querySelector('main [data-testid="primaryColumn"]') || document.querySelector('main');
    if (!main) return null;
    const header = [...main.querySelectorAll('[data-testid="UserName"]')].filter(node => !excluded(node) && visible(node));
    if (header.length !== 1 || ![...header[0].querySelectorAll('span,div')].some(node => node.textContent.trim().toLowerCase() === `@${name}`)) return null;
    const links = [...main.querySelectorAll('a[href]')].filter(node => visible(node) && !excluded(node)).map(link => ({ link, info: H.countLink(link) })).filter(row => row.info?.account === name);
    const following = links.filter(row => row.info.kind === 'following'), followers = links.filter(row => row.info.kind === 'followers');
    if (following.length !== 1 || followers.length !== 1) return null;
    const followingCount = H.readCount(following[0].link), followerCount = H.readCount(followers[0].link);
    if (followingCount === null || followerCount === null) return null;
    // On profile pages X puts the owner's verified badge inside a button in UserName.
    const verified = [...header[0].querySelectorAll('[data-testid="icon-verified"],svg[aria-label="Verified account"],svg[aria-label="认证账号"],svg[aria-label="已认证账号"]')].some(visible);
    return { account: name, following: followingCount, followers: followerCount, verified, status: 'ready' };
  }
  async function read(message) {
    const name = P.account(message.account), until = Date.now() + 9000;
    while (Date.now() < until) {
      if (cancelled.has(message.token)) throw new C.ReplyError('PRIORITY_CANCELLED', '资料读取已取消。');
      if (blocked()) throw new C.ReplyError('PRIORITY_BLOCKED', 'X 需要登录、验证或显示访问限制，资料读取已暂停。');
      if (location.pathname.replace(/\/$/u, '').toLowerCase() !== `/${name}`) throw new C.ReplyError('PRIORITY_SOURCE', '资料页已变化，跳过这次读取。');
      const value = snapshot(name); if (value) return value;
      await pause(250);
    }
    throw new C.ReplyError('PRIORITY_SOURCE', '资料数量未加载，暂不标记。');
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === 'PRIORITY_READY') { respond({ ok: true }); return; }
    if (message?.type === 'PRIORITY_CANCEL_PAGE') { cancelled.add(message.token); respond({ ok: true }); return; }
    if (message?.type !== 'PRIORITY_READ_PAGE') return;
    read(message).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: { code: error.code || 'PRIORITY_SOURCE', message: error.message } })); return true;
  });
  globalThis.MagpiePriorityPage = Object.freeze({ snapshot });
})();
