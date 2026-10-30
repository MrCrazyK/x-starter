/* Daily follow progress around the star, inside the dark launcher. */
(() => {
  'use strict';
  const R = globalThis.MagpieActivity;
  function create({ launcher, send, getSettings, getAccount }) {
    const style = document.createElement('style');
    style.textContent = `#launcher svg.xs-follow-ring{position:absolute;left:50%;top:50%;display:block;width:clamp(30px,calc(var(--launcher-size,55px) - 16px),38px);height:clamp(30px,calc(var(--launcher-size,55px) - 16px),38px);overflow:visible;pointer-events:none;transform:translate(-50%,-50%) rotate(-90deg)}.xs-follow-ring circle{fill:none;stroke-width:2px;vector-effect:non-scaling-stroke}.xs-follow-track{stroke:#52897945}.xs-follow-value{stroke:#79cbb4;stroke-linecap:round;transition:stroke-dashoffset .55s ease}.xs-follow-bump{position:absolute;left:50%;top:-19px;padding:2px 7px;border-radius:20px;background:#18392f;color:#c8ffe9;border:1px solid #75c7ab;font:700 14px/1.4 Inter,"Segoe UI",sans-serif;box-shadow:0 3px 12px #0003;white-space:nowrap;pointer-events:none;z-index:2;transform:translateX(-50%)}@media(prefers-reduced-motion:reduce){.xs-follow-value{transition:none}}`;
    launcher.getRootNode().append(style);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('xs-follow-ring');
    svg.setAttribute('role', 'progressbar'); svg.setAttribute('aria-label', '今日插件关注进度'); svg.setAttribute('aria-valuemin', '0'); svg.setAttribute('hidden', '');
    // Percent geometry keeps SVG units equal to screen pixels. A scaled viewBox
    // with non-scaling strokes also rescales dashes and distorts the progress.
    function circle(name) { const node = document.createElementNS(svg.namespaceURI, 'circle'); for (const [key, value] of Object.entries({ cx: '50%', cy: '50%', r: '48%', pathLength: 100 })) node.setAttribute(key, String(value)); node.classList.add(name); return node; }
    const track = circle('xs-follow-track'), arc = circle('xs-follow-value'); arc.setAttribute('stroke-dasharray', '100'); arc.setAttribute('stroke-dashoffset', '100'); svg.append(track, arc);
    const bump = document.createElement('span'); bump.className = 'xs-follow-bump'; bump.textContent = '+1'; bump.hidden = true; bump.setAttribute('aria-hidden', 'true');
    launcher.append(svg, bump);
    let stopped = true, timer = null, animation = null, hideTimer = null, fetching = false, revision = 0;
    const seen = new Set();
    function owner() { const name = R.account(getAccount()), bound = R.account(getSettings()?.xAccount); return name && (!bound || name === bound) ? name : ''; }
    function clear() { svg.setAttribute('hidden', ''); bump.hidden = true; delete launcher.dataset.followCount; delete launcher.dataset.followLimit; launcher.title = '回复灵感'; animation?.cancel(); clearTimeout(hideTimer); }
    function apply(data, event) {
      const name = owner();
      if (!name) { clear(); return; }
      if (!data || data.account !== name || data.dayAt !== R.dayAt(Date.now()) || !Number.isSafeInteger(data.total) || data.total < 0 || !Number.isSafeInteger(data.limit) || data.limit < 1 || data.limit > 400) return;
      svg.removeAttribute('hidden'); svg.setAttribute('aria-valuemax', String(data.limit)); svg.setAttribute('aria-valuenow', String(Math.min(data.total, data.limit))); svg.setAttribute('aria-valuetext', `今日 ${data.total} / ${data.limit}`);
      launcher.dataset.followCount = String(data.total); launcher.dataset.followLimit = String(data.limit);
      arc.setAttribute('stroke-dashoffset', String(100 - Math.min(1, data.total / data.limit) * 100));
      launcher.title = `回复灵感 · 今日插件关注 ${data.total} / ${data.limit}（北京时间）`;
      if (!event || event.account !== name || seen.has(event.id)) return;
      seen.add(event.id); while (seen.size > 300) seen.delete(seen.values().next().value);
      if (document.hidden || launcher.hidden || Date.now() - event.at > 15000 || Date.now() < event.at) return;
      animation?.cancel(); clearTimeout(hideTimer); bump.hidden = false;
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        animation = bump.animate([{ opacity: 0, transform: 'translate(-50%, 8px) scale(.85)' }, { opacity: 1, transform: 'translate(-50%, -4px) scale(1.08)', offset: .25 }, { opacity: 0, transform: 'translate(-50%, -24px) scale(1)' }], { duration: 1150, easing: 'ease-out' });
      }
      hideTimer = setTimeout(() => { bump.hidden = true; }, 1150);
    }
    async function refresh() {
      if (stopped || fetching) return;
      const name = owner(); if (!name) { clear(); return; }
      const version = revision; fetching = true;
      try { const data = await send({ type: 'GET_FOLLOW_ACTIVITY', account: name }); if (!stopped && version === revision) apply(data); }
      catch { /* An extension reload needs a page refresh; never replay old +1s. */ }
      finally { fetching = false; if (!stopped && version !== revision) void refresh(); }
    }
    function message(message, sender, respond) {
      if (stopped || sender.id !== chrome.runtime.id || message?.type !== 'FOLLOW_ACTIVITY_UPDATED') return;
      revision++; apply(message.data, message.event); respond({ ok: true });
    }
    function visibility() { if (!document.hidden) void refresh(); }
    function configure() {
      revision++; clear();
      if (stopped) { stopped = false; chrome.runtime.onMessage.addListener(message); document.addEventListener('visibilitychange', visibility); timer = setInterval(() => { if (!document.hidden) void refresh(); }, 30000); }
      void refresh();
    }
    function stop() {
      stopped = true; revision++; clearInterval(timer); clear();
      chrome.runtime.onMessage.removeListener(message); document.removeEventListener('visibilitychange', visibility);
    }
    return { configure, refresh, stop };
  }
  globalThis.MagpieLauncherProgress = Object.freeze({ create });
})();
