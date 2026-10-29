/* Observe explicit publishing and learn only confirmed, unassisted writing. */
(() => {
  'use strict';
  const C = globalThis.MagpieReply, M = globalThis.MagpieMemory, T = globalThis.MagpieContext;
  const EDITOR = '[contenteditable="true"][data-testid^="tweetTextarea_"]';
  const PUBLISH = '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]';
  const ARTICLE = 'article[data-testid="tweet"]';
  const visible = el => Boolean(el?.isConnected && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  function owner(href, status = false) {
    const url = C.xURL(new URL(href, location.href).href);
    const match = url?.pathname.match(status ? /^\/([a-zA-Z0-9_]{1,15})\/status\/\d+(?:\/|$)/u : /^\/([a-zA-Z0-9_]{1,15})\/?$/u);
    return match ? M.account(match[1]) : '';
  }
  function currentAccount() {
    const names = new Set([...document.querySelectorAll('[data-testid="AppTabBar_Profile_Link"]')].map(link => owner(link.href)).filter(Boolean));
    return names.size === 1 ? [...names][0] : '';
  }
  function create({ getSettings, send, replyTarget, onStatus, onAccountChange }) {
    const origins = new WeakMap(), known = new Set(), pending = new Map();
    let ready = false, previousAccount = null, timer = null;
    const metadata = editor => {
      let value = origins.get(editor);
      if (!value) { value = { assisted: false, checks: [] }; origins.set(editor, value); }
      return value;
    };
    function noteGenerated(texts) {
      for (const text of texts) if (typeof text === 'string' && text.trim()) known.add(M.comparable(text));
      while (known.size > 100) known.delete(known.values().next().value);
    }
    async function assistedText(text) {
      noteGenerated([text]);
      await send({ type: 'MARK_ASSISTED_TEXT', text });
    }
    function markEditor(editor, text) {
      metadata(editor).assisted = true;
      void assistedText(text).catch(() => {});
    }
    function editorFor(button) {
      for (let scope = button.parentElement; scope && scope !== document.body; scope = scope.parentElement) {
        const editors = [...scope.querySelectorAll(EDITOR)].filter(visible);
        if (editors.length === 1) return editors[0];
        if (editors.length > 1) return editors.includes(document.activeElement) ? document.activeElement : null;
      }
      return null;
    }
    function existingURLs() {
      return new Set([...document.querySelectorAll('a[href*="/status/"]')].map(link => C.postURL(link.href)).filter(Boolean));
    }
    async function arm(editor) {
      if (!ready || !getSettings().collectWritingSamples || !visible(editor)) return;
      const account = currentAccount(), text = editor.innerText.replace(/\u00a0/gu, ' ').trim(), origin = metadata(editor);
      if (!account) { onStatus('未识别当前 X 账号，这条内容暂不收集。'); return; }
      if (!text || text.length > M.LIMITS.text) { if (text) onStatus(`正文超过 ${M.LIMITS.text} 字符，这条内容未收集。`); return; }
      const record = { editor, account, text, createdAt: Date.now(), before: existingURLs(), kind: replyTarget(editor) ? 'reply' : 'post' };
      for (const [key, value] of pending) if (value.account === account) pending.delete(key);
      // Capture pre-publish state synchronously; asynchronous provenance checks must not miss a fast success toast.
      const token = crypto.randomUUID();
      pending.set(token, { ...record, checking: true });
      startTimer();
      try {
        await Promise.all(origin.checks);
        const generated = origin.assisted || known.has(M.comparable(text)) || (await send({ type: 'IS_GENERATED', text })).generated;
        if (!pending.has(token)) return;
        if (generated || !getSettings().collectWritingSamples || currentAccount() !== account) {
          pending.delete(token);
          if (generated) onStatus('这条使用了插件候选，不计入手写样本。');
          return;
        }
        pending.set(token, { ...record, checking: false }); scan();
      } catch {
        pending.delete(token); onStatus('无法确认这条内容的来源，未收集为手写样本。');
      }
    }
    function startTimer() { if (!timer) timer = setInterval(scan, 450); }
    function confirmedURL(record) {
      for (const article of document.querySelectorAll(ARTICLE)) {
        const links = [...article.querySelectorAll('a[href*="/status/"]')].filter(link => link.closest(ARTICLE) === article && !T.quoteRoot(link, article));
        const link = links.find(node => node.querySelector('time')) || links[0];
        const url = link && C.postURL(link.href);
        if (!url || record.before.has(url) || owner(link.href, true) !== record.account) continue;
        if (M.comparable(T.primaryText(article)?.innerText) === M.comparable(record.text)) return url;
      }
      // A new success link to this account plus a cleared/closed composer confirms publishing even if the new reply is outside the loaded thread.
      const cleared = !record.editor.isConnected || !record.editor.innerText.trim();
      if (cleared) for (const link of document.querySelectorAll('[data-testid="toast"] a[href*="/status/"], [role="alert"] a[href*="/status/"]')) {
        const url = C.postURL(link.href);
        if (url && !record.before.has(url) && owner(link.href, true) === record.account) return url;
      }
      return null;
    }
    function scan() {
      if (!ready) return;
      const account = currentAccount();
      if (previousAccount !== null && previousAccount !== account) { pending.clear(); onAccountChange(); }
      previousAccount = account;
      for (const [token, record] of pending) {
        if (!getSettings().collectWritingSamples || account !== record.account || Date.now() - record.createdAt > 45000) { pending.delete(token); continue; }
        if (record.checking) continue;
        const url = confirmedURL(record);
        if (!url) continue;
        pending.delete(token);
        void send({ type: 'CAPTURE_HANDWRITTEN', account, confirmed: true, assisted: false,
          sample: { url, text: record.text, kind: record.kind, createdAt: Date.now() } }).then(result => {
          if (result.saved) onStatus(`@${result.account} 已收集 ${result.count} 条手写内容，可在设置中更新语气记忆。`);
        }).catch(error => onStatus(`手写样本未保存：${error.message}`));
      }
      if (!pending.size && timer) { clearInterval(timer); timer = null; }
    }
    document.addEventListener('input', event => {
      const editor = event.target.closest?.(EDITOR);
      if (editor && !editor.innerText.trim()) origins.delete(editor);
    }, true);
    document.addEventListener('paste', event => {
      const editor = event.target.closest?.(EDITOR), text = event.clipboardData?.getData('text/plain');
      if (!editor || !text || !event.isTrusted) return;
      const origin = metadata(editor), value = M.comparable(text);
      if ([...known].some(candidate => candidate && value.includes(candidate))) origin.assisted = true;
      origin.checks.push(send({ type: 'IS_GENERATED', text }).then(result => { if (result.generated) origin.assisted = true; }).catch(() => { origin.assisted = true; }));
    }, true);
    document.addEventListener('click', event => {
      const button = event.target.closest?.(PUBLISH);
      if (!event.isTrusted || !button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      const editor = editorFor(button); if (editor) void arm(editor);
    }, true);
    document.addEventListener('keydown', event => {
      const editor = event.target.closest?.(EDITOR);
      if (event.isTrusted && editor && !event.isComposing && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void arm(editor);
    }, true);
    window.addEventListener('pagehide', () => { pending.clear(); clearInterval(timer); timer = null; });
    return { currentAccount, noteGenerated, assistedText, markEditor, scan, configure: () => { ready = true; scan(); } };
  }
  globalThis.MagpieLearning = Object.freeze({ create });
})();
