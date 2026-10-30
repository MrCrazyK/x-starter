(() => {
  'use strict';
  if (globalThis.__magpieXReplyLoaded) return;
  globalThis.__magpieXReplyLoaded = true;
  const C = globalThis.MagpieReply;
  const T = globalThis.MagpieContext;
  const E = globalThis.MagpieEditor;
  const ARTICLE = 'article[data-testid="tweet"]';
  const EDITOR = '[contenteditable="true"][data-testid^="tweetTextarea_"]';
  const LONG_TEXT = '[data-testid="longformRichTextComponent"], [data-testid="twitterArticleRichTextView"], [data-testid="article-content"]';
  const state = { settings: { ...C.DEFAULTS }, target: null, requestId: null, sequence: 0, busy: false, filling: false, route: location.pathname, attempted: new Set(), dismissed: new Set(), editor: null, draftAction: null };
  state.closedRoute = null;
  state.threadURL = null;
  state.context = C.context(); state.contextSignature = ''; state.contextExcluded = new Set(); state.contextEdits = new Map();
  state.pendingReply = null;
  const replyDialogs = new WeakMap();
  let scanTimer, autoTimer, pendingAutoSignature = null, stopped = false;

  const host = document.createElement('div');
  host.id = 'magpie-x-reply-root';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
  <style>
    :host{all:initial;font-family:Inter,"Segoe UI","Microsoft YaHei",sans-serif;color:#eaf0f2;font-size:13px;color-scheme:dark}
    *{box-sizing:border-box} [hidden]{display:none!important} button,input,textarea{font:inherit}button{cursor:pointer}button:disabled{opacity:.45;cursor:wait}
    button:focus-visible,input:focus,textarea:focus,summary:focus-visible,a:focus-visible{outline:2px solid #78cec0;outline-offset:3px}button{border:0}textarea{resize:vertical}
    #launcher{position:fixed;right:var(--launcher-right,20px);bottom:var(--launcher-bottom,146px);width:var(--launcher-size,55px);height:var(--launcher-size,55px);z-index:2147483000;display:grid;place-items:center;padding:0;background:#202d32;color:#9bdbcb;border:1px solid #4d7068;border-radius:var(--launcher-radius,16px);box-shadow:0 4px 24px #0004}
    #launcher:hover{background:#2d423f}#launcher svg{display:block;width:28px;height:28px;pointer-events:none}
    #panel{position:fixed;right:20px;top:76px;z-index:2147483001;width:370px;max-height:calc(100vh - 100px);border:1px solid #3a494e;border-radius:16px;background:#192329;box-shadow:0 14px 70px #0006;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#4c5e65 transparent}
    header{display:flex;align-items:center;gap:11px;padding:20px 18px 17px;border-bottom:1px solid #2c3b42}.mark{background:#a7dece;color:#203b33;width:33px;height:33px;border-radius:10px;display:grid;place-items:center;font-size:23px}
    h2{font-size:16px;letter-spacing:-.2px;margin:0}header p{color:#8d9fa7;font-size:10px;margin:5px 0 0;letter-spacing:.6px}.header-actions{display:flex;gap:3px;margin-left:auto}.icon{color:#9caeb6;background:transparent;padding:5px 7px;border-radius:6px;font-size:17px}.icon:hover{background:#2e3e46;color:#fff}
    .body{padding:16px 18px 18px}.context-top{display:flex;align-items:center;justify-content:space-between;gap:9px;color:#a4b7c0;font-size:11px;margin-bottom:8px}#source-author{max-width:235px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}#source-link{color:#9acbbc;text-decoration:none;font-size:10px}
    details{background:#202d34;border:1px solid #2e3f47;border-radius:9px;margin-bottom:13px;padding:11px}summary{cursor:pointer;display:flex;justify-content:space-between;color:#a9bac1;font-size:11px}#source-count{color:#748b96}#source{display:block;width:100%;margin-top:11px;padding:9px;border:1px solid #41555e;border-radius:6px;background:#172329;color:#c5d1d6;font-size:12px;line-height:1.65;min-height:120px;max-height:260px}details p{font-size:10px;color:#8a9fa9;line-height:1.7;margin:9px 0 0}
    #source-warning{font-size:11px;color:#d2b287;background:#40372b;border-radius:6px;padding:9px;line-height:1.6;margin:0 0 12px}.angle-label{display:block;font-size:11px;color:#a5b7bf;margin-bottom:7px}#angle{width:100%;background:#202d34;color:#d9e3e7;border:1px solid #354750;padding:10px 11px;border-radius:8px;font-size:12px;margin-bottom:12px}#angle::placeholder{color:#708892}
    .context-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:11px 0}.context-toolbar button{background:#30473e;color:#b4d8c7;border-radius:5px;padding:5px 7px;font-size:10px}#context-note{font-size:10px;color:#a0b6bf;line-height:1.7;margin:0 0 10px}#context-items{display:grid;gap:9px}.context-item{border:1px solid #3b515b;border-radius:7px;padding:9px}.context-item label{display:flex;gap:7px;align-items:start;color:#b9cbd1;font-size:10px;line-height:1.6}.context-item input{accent-color:#9cd5bc;margin:2px 0}.context-item time{display:block;color:#7e97a3;font-size:9px;padding-left:20px}.context-text,#context-manual{display:block;width:100%;margin-top:8px;padding:8px;border:1px solid #3a505b;border-radius:5px;background:#18262e;color:#bacbd2;font-size:11px;line-height:1.7;min-height:66px;max-height:220px}.context-item.excluded{opacity:.55}.manual-label{display:block;font-size:10px;color:#a4bac5;margin-top:13px}#context-count{color:#7fa999}#context-manual{min-height:80px}#context-toolbar-count{color:#8aa5b2;font-size:10px}
    .generate-row{display:flex;gap:8px}.primary{background:#a5dece;color:#153a30;border-radius:8px;font-size:12px;padding:10px 13px;font-weight:650}.primary:hover{background:#bcebdc}#generate{flex:1}.secondary{background:#2a3b44;color:#a8bcc6;border:1px solid #3d525d;border-radius:8px;padding:9px 12px;font-size:12px}.secondary:hover{background:#344b55}
    #status{font-size:11px;color:#99b8bc;line-height:1.7;min-height:19px;margin:11px 0 13px}#status.error{color:#e5b79f}#status.success{color:#a2d8c1}.loading{display:inline-block;width:11px;height:11px;border:2px solid #a5dece44;border-top-color:#a5dece;border-radius:50%;animation:spin 1s linear infinite;margin-right:6px;vertical-align:-1px}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.loading{animation:none}}
    #empty{padding:22px 12px;text-align:center;border:1px dashed #3a4b54;border-radius:10px;color:#90a7b2;line-height:1.8;font-size:12px}#empty strong{display:block;color:#c4d2d9;font-weight:500;margin-bottom:5px}#cards{display:grid;gap:10px}.candidate{border:1px solid #344750;border-radius:10px;padding:12px;background:#202e35}.candidate-head{display:flex;align-items:center;gap:7px;margin-bottom:9px}h3{font-size:11px;margin:0;color:#b5dcce;font-weight:600}.candidate:nth-child(2) h3{color:#b2c6e6}.candidate:nth-child(3) h3{color:#dbc8a0}.candidate:nth-child(4) h3{color:#c7b8e0}.index{color:#718b97;font-size:10px;letter-spacing:1px}.reply-count{color:#718b97;margin-left:auto;font-size:10px}.reply-count.long{color:#edb299}.reply-text{display:block;width:100%;border:0;outline:none!important;border-radius:4px;background:transparent;color:#e1e8eb;resize:vertical;font-size:13px;line-height:1.7;min-height:62px;max-height:220px;padding:0}.reply-text:focus{box-shadow:0 0 0 1px #6b9286}.candidate-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:9px}.fill{background:#334e46;color:#b6e1cd;border:1px solid #4d6c61;border-radius:6px;padding:6px 10px;font-size:11px}.copy{background:transparent;color:#9db2bd;border:1px solid #3b515b;border-radius:6px;padding:6px 10px;font-size:11px}
    #draft-confirm{margin-top:13px;border:1px solid #77613e;background:#3b3428;border-radius:9px;padding:12px;font-size:11px;color:#e1cfaa;line-height:1.7}#draft-confirm p{margin:0 0 10px}#draft-confirm>div{display:flex;gap:7px;flex-wrap:wrap}#draft-confirm button{font-size:11px}
    .bottom{border-top:1px solid #304049;margin-top:16px;padding-top:12px;display:flex;gap:12px;align-items:center;justify-content:space-between}.bottom p{font-size:10px;color:#7e959f;line-height:1.6;margin:0}.bottom button{font-size:10px;color:#9bcbb9;background:transparent;padding:3px 0}#model-note{font-size:10px;color:#748d99;line-height:1.6;margin:9px 0 0;overflow-wrap:anywhere}
    @media(max-width:720px){#panel{top:auto;bottom:14px;right:12px;width:calc(100vw - 24px);max-height:78vh}}
  </style>
  <button id="launcher" type="button" aria-label="打开 X-starter 回复候选" title="回复灵感"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.5 14.8 9.2 22.5 12 14.8 14.8 12 22.5 9.2 14.8 1.5 12 9.2 9.2Z"/></svg></button>
  <section id="panel" hidden aria-label="X-starter 回复候选">
    <header><div class="mark" aria-hidden="true">✦</div><div><h2>四个角度，由你表达</h2><p>X-STARTER / REPLY</p></div><div class="header-actions"><button class="icon" id="settings" title="打开设置" aria-label="打开设置" type="button">⚙</button><button class="icon" id="close" title="关闭面板" aria-label="关闭面板" type="button">×</button></div></header>
    <div class="body">
      <div class="context-top"><span id="source-author">选择一条推文或文章</span><a id="source-link" target="_blank" rel="noopener noreferrer" hidden>查看原文 ↗</a></div>
      <details><summary>用于生成的原文 <span id="source-count">尚未读取</span></summary><textarea id="source" aria-label="用于生成的原文" placeholder="打开推文详情，或点击推文下的「4条回复」。"></textarea><p>可补充已展开的正文；仅发送这里的文字，不识别图片、视频或外链全文。</p></details>
      <details id="context-details"><summary>对话上下文 <span id="context-count">尚未读取</span></summary><div class="context-toolbar"><span id="context-toolbar-count">主帖 · 上文回复 · 引用帖</span><button id="refresh-context" type="button">重新收集</button></div><p id="context-note"></p><div id="context-items"></div><label for="context-manual" class="manual-label">补充未加载的对话（可选，注明作者和顺序）</label><textarea id="context-manual" maxlength="12000" rows="3" placeholder="例如：A 最初说……；B 接着回复……；当前这条是 A 对 B 的回应。"></textarea></details>
      <p id="source-warning" hidden></p>
      <label class="angle-label" for="angle">想表达的观点 <span style="color:#6e8793">/ 可选</span></label>
      <input id="angle" maxlength="500" placeholder="例如：赞同，但想讨论小团队的适用条件">
      <div class="generate-row"><button id="generate" class="primary" type="button">生成 4 条回复</button><button id="cancel" class="secondary" type="button" hidden>取消</button></div>
      <p id="status" role="status" aria-live="polite"></p>
      <div id="empty"><strong>让第一句话更容易</strong><span id="preference-labels">简短寒暄 · 幽默打趣 · 严厉批评 · 理性分析</span></div>
      <div id="cards"></div>
      <div id="draft-confirm" hidden role="group" aria-label="处理已有草稿"><p>回复框已有文字，选择如何处理：</p><div><button class="primary" id="append" type="button">追加到草稿</button><button class="secondary" id="replace" type="button">替换草稿</button><button class="secondary" id="keep" type="button">取消</button></div></div>
      <div class="bottom"><p>候选可以编辑，填入后由你发布。</p><button id="settings-link" type="button">模型与偏好 ↗</button></div>
      <p id="model-note"></p>
      <p id="voice-note" style="font-size:10px;color:#8fa8ac;line-height:1.7">语气记忆：在设置中查看手写样本、更新总结。</p>
    </div>
  </section>`;
  document.documentElement.append(host);
  const $ = id => shadow.getElementById(id);
  const visible = el => Boolean(el?.isConnected && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const active = el => visible(el) && !el.closest('[aria-hidden="true"], [inert]');
  const own = (el, selector) => [...el.querySelectorAll(selector)].filter(node => node.closest(ARTICLE) === el);
  const clean = text => String(text || '').replace(/\u00a0/gu, ' ').replace(/\r\n/gu, '\n').trim();
  let launcherFrame = 0, launcherWatched = [];
  const launcherResize = new ResizeObserver(scheduleLauncher);
  const launcherMutations = new MutationObserver(scheduleLauncher);
  function scheduleLauncher() {
    if (stopped || launcherFrame) return;
    launcherFrame = requestAnimationFrame(() => { launcherFrame = 0; positionLauncher(); });
  }
  function positionLauncher() {
    const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
    const nodes = [...document.querySelectorAll('[data-testid="GrokDrawerHeader"], [data-testid="chat-drawer-main"]')];
    const watched = [...new Set([...nodes.flatMap(node => [node, node.parentElement, node.parentElement?.parentElement]), document.body, document.documentElement].filter(Boolean))];
    if (watched.length !== launcherWatched.length || watched.some((node, i) => node !== launcherWatched[i])) {
      launcherResize.disconnect(); launcherMutations.disconnect(); launcherWatched = watched;
      for (const node of watched) { launcherResize.observe(node); launcherMutations.observe(node, { attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'], childList: true }); }
    }
    const controls = nodes.filter(visible).map(node => ({ node, box: node.getBoundingClientRect() })).filter(({ box }) => box.width >= 32 && box.width <= 96 && box.height >= 32 && box.height <= 96 && Math.abs(box.width - box.height) <= 8 && box.right > width - 180 && box.bottom > height / 2);
    const reference = controls.toSorted((a, b) => b.box.bottom - a.box.bottom)[0];
    let size = 55, right = 20, bottom = 24;
    if (reference) {
      size = Math.round(reference.box.width * 100) / 100;
      const column = controls.filter(({ box }) => Math.abs(box.right - reference.box.right) <= 8).sort((a, b) => a.box.top - b.box.top);
      const gaps = column.slice(1).map((item, i) => item.box.top - column[i].box.bottom).filter(gap => gap >= 4 && gap <= 32);
      const gap = Math.max(14, gaps.length ? Math.min(...gaps) : 12);
      let top = column[0].box.top - gap - size;
      right = width - reference.box.right;
      if (top < 8) { right += size + gap; top = Math.max(8, column[0].box.top); }
      right = Math.max(8, Math.min(width - size - 8, right));
      bottom = Math.max(8, height - top - size);
      $('launcher').style.setProperty('--launcher-radius', getComputedStyle(reference.node).borderRadius);
    }
    $('launcher').style.setProperty('--launcher-size', `${size}px`);
    $('launcher').style.setProperty('--launcher-right', `${right}px`);
    $('launcher').style.setProperty('--launcher-bottom', `${bottom}px`);
  }
  async function send(message) {
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (!response?.ok) throw Object.assign(new Error(response?.error?.message || '扩展未就绪，请刷新 X 页面。'), { code: response?.error?.code });
      return response.data;
    } catch (error) {
      if (/context invalidated|receiving end|message port closed/iu.test(error.message)) throw new Error('扩展已更新或后台已重启，请刷新 X 页面。');
      throw error;
    }
  }
  function status(message, type = '') { $('status').textContent = message; $('status').className = type; }
  const learning = MagpieLearning.create({ getSettings: () => state.settings, send,
    replyTarget: editor => targetForEditor(editor)?.source.url,
    onStatus: message => { $('voice-note').textContent = message; },
    onAccountChange: () => { clearAuto(); cancel(); clearCandidates(); followProgress.configure(); status('当前 X 账号已变化，请重新生成。'); }
  });
  const profiles = MagpieProfile.create({ onRead: profile => { if (state.settings?.timelinePriorityEnabled) void send({ type: 'OBSERVED_PRIORITY_PROFILE', profile }).catch(() => {}); } });
  const followProgress = MagpieLauncherProgress.create({ launcher: $('launcher'), send, getSettings: () => state.settings, getAccount: () => learning.currentAccount() });
  const priorityTimeline = MagpiePriorityTimeline.create({ send });
  function busy(value) {
    state.busy = value; $('generate').disabled = value; $('cancel').hidden = !value;
    $('source').disabled = value; $('angle').disabled = value;
    $('context-manual').disabled = value || !state.settings.contextEnabled; $('refresh-context').disabled = value;
    for (const input of $('context-items').querySelectorAll('input, textarea')) input.disabled = value;
    if (value) { status('正在通过 Magpie 生成，最长等待 90 秒…'); const spin = document.createElement('span'); spin.className = 'loading'; $('status').prepend(spin); }
  }
  function cancel() {
    if (state.requestId) void send({ type: 'CANCEL', requestId: state.requestId }).catch(() => {});
    state.sequence++; state.requestId = null; busy(false);
  }
  function clearCandidates() {
    $('cards').replaceChildren(); $('empty').hidden = false; $('draft-confirm').hidden = true; state.draftAction = null; $('model-note').textContent = '';
    $('generate').textContent = '生成 4 条回复';
  }
  function clearAuto() { clearTimeout(autoTimer); autoTimer = null; pendingAutoSignature = null; }
  function articleURL(article) {
    return T.articleURL(article);
  }
  function extract(article) {
    if (!article?.isConnected) return null;
    const url = articleURL(article);
    if (!url) return null;
    const rich = own(article, LONG_TEXT).filter(node => !T.quoteRoot(node, article)).sort((a, b) => b.innerText.length - a.innerText.length)[0];
    const plain = T.primaryText(article);
    const title = rich?.parentElement?.querySelector('h1, [data-testid="twitterArticleTitle"]');
    let text = clean((rich || plain)?.innerText);
    if (!text && T.quotes(article).length) text = '（此推文引用了下方帖子，请结合引用内容回复。）';
    if (title && !text.startsWith(clean(title.innerText))) text = `${clean(title.innerText)}\n\n${text}`.trim();
    return { article, source: { url, text, author: T.author(article), kind: rich ? 'article' : 'post', incomplete: Boolean(article.querySelector('[data-testid="tweet-text-show-more-link"]')) } };
  }
  function detailTarget() {
    const url = C.postURL(location.href);
    if (!url) return null;
    if (/\/i\/article\//u.test(url)) {
      const main = document.querySelector('main');
      const rich = main?.querySelector(LONG_TEXT) || main?.querySelector('[data-testid="twitterArticleReadView"]');
      if (!rich) return null;
      const title = main.querySelector('h1, [data-testid="twitterArticleTitle"]');
      let text = clean(rich.innerText);
      if (title && !text.startsWith(clean(title.innerText))) text = `${clean(title.innerText)}\n\n${text}`.trim();
      return { article: rich.closest(ARTICLE), source: { url, text, author: '', kind: 'article', incomplete: false } };
    }
    const articles = [...document.querySelectorAll(ARTICLE)].filter(active).sort((a, b) => Number(Boolean(b.closest('#layers, [role="dialog"]'))) - Number(Boolean(a.closest('#layers, [role="dialog"]'))));
    return articles.map(extract).find(target => target?.source.url === url) || null;
  }
  function previewMatches(target, preview, allowEmpty = false) {
    const known = articleURL(preview);
    if (known) return known === target.source.url;
    const handle = text => text.match(/@[a-zA-Z0-9_]{1,15}/u)?.[0].toLowerCase();
    const expectedAuthor = handle(target.source.author), actualAuthor = handle(T.author(preview));
    if (expectedAuthor && expectedAuthor !== actualAuthor) return false;
    const text = value => clean(value).replace(/https?:\/\/\S+/gu, '').replace(/\s+/gu, ' ').trim();
    const originalText = target.source.text.startsWith('（此推文引用了下方帖子') ? '' : target.source.text;
    const expected = text(originalText), actual = text(T.primaryText(preview)?.innerText || '');
    if (expected && actual) return expected === actual || allowEmpty && Math.min(expected.length, actual.length) >= 10 && (actual.startsWith(expected) || expected.startsWith(actual));
    return allowEmpty && !expected && !actual && Boolean(expectedAuthor && actualAuthor);
  }
  function targetForDialog(dialog) {
    const previews = [...dialog.querySelectorAll(ARTICLE)].filter(active);
    const focusURL = C.postURL(location.href);
    const focusedPreview = previews.find(article => focusURL && articleURL(article) === focusURL);
    const cached = replyDialogs.get(dialog);
    if (cached && (!focusedPreview || focusedPreview === cached.preview) && previews.includes(cached.preview) && previewMatches(cached.target, cached.preview, true)) return cached.target;
    const preview = focusedPreview || previews[0];
    if (!preview) return null;
    let target = extract(preview);
    const pending = state.pendingReply;
    if (!target && pending && !pending.dialogs.has(dialog) && Date.now() - pending.time < 15000 && previewMatches(pending.target, preview, true)) target = pending.target;
    if (!target) {
      // A reply modal can already be open when this script starts. Recover only a unique matching post.
      const matches = [...document.querySelectorAll(ARTICLE)].filter(article => !dialog.contains(article)).map(extract).filter(item => item && previewMatches(item, preview));
      const unique = new Map(matches.map(item => [item.source.url, item]));
      if (unique.size === 1) target = unique.values().next().value;
    }
    if (target) {
      replyDialogs.set(dialog, { target, preview });
      if (pending?.target.source.url === target.source.url && !pending.dialogs.has(dialog)) state.pendingReply = null;
    }
    return target;
  }
  function targetForEditor(editor) {
    if (!active(editor)) return null;
    const inArticle = editor.closest(ARTICLE), direct = inArticle && extract(inArticle);
    if (direct) return direct;
    const dialog = editor.closest('[role="dialog"]');
    if (dialog) return targetForDialog(dialog);
    return detailTarget();
  }
  function currentReplyTarget() {
    const focused = document.activeElement?.closest?.(EDITOR);
    const editors = [...new Set([focused, state.editor, ...document.querySelectorAll(`[role="dialog"] ${EDITOR}`)].filter(Boolean))];
    for (const editor of editors) {
      const target = targetForEditor(editor);
      if (target) return { target, editor };
    }
    return null;
  }
  function select(target) {
    if (!target) return;
    const changed = state.target?.source.url !== target.source.url;
    if (changed) {
      cancel(); clearCandidates(); state.editor = null;
      state.contextSignature = ''; state.contextExcluded.clear(); state.contextEdits.clear(); $('context-manual').value = '';
      $('source').value = target.source.text; $('angle').value = '';
      status(target.source.text ? '选好角度，再点击生成。' : '原文暂无文字，请展开文章或补充正文。');
    } else if ($('source').value === state.target.source.text && target.source.text !== state.target.source.text) {
      cancel(); clearCandidates(); $('source').value = target.source.text;
      status('原文内容已更新，点击生成新的候选。');
    }
    state.target = target;
    const focusURL = C.postURL(location.href);
    if (focusURL) state.threadURL = focusURL;
    else if (!location.pathname.startsWith('/compose/')) state.threadURL = null;
    refreshContext(target);
    $('source-author').textContent = target.source.author || (target.source.kind === 'article' ? 'X 长文章' : '当前推文');
    $('source-link').href = target.source.url; $('source-link').hidden = false;
    updateSourceCount();
    const warning = target.source.incomplete ? '原文尚未展开，候选只依据当前可见文字。建议先点 X 的「显示更多」。' : '';
    $('source-warning').textContent = warning; $('source-warning').hidden = !warning;
    $('panel').hidden = false; $('launcher').hidden = true;
  }
  function updateSourceCount() { $('source-count').textContent = `${$('source').value.length.toLocaleString()} 字符`; }
  function contextPayload() {
    if (!state.settings.contextEnabled) return { items: [], manual: '', coverage: 'disabled', note: '已在设置中关闭上下文。', omitted: 0 };
    return { ...state.context, manual: $('context-manual').value, items: state.context.items.filter(item => !state.contextExcluded.has(T.itemKey(item))).map(item => ({ ...item, text: state.contextEdits.get(T.itemKey(item)) ?? item.text })) };
  }
  function requestSignature() { return JSON.stringify({ url: state.target?.source.url, text: $('source').value, angle: $('angle').value, context: contextPayload() }); }
  function contextChanged() { clearAuto(); cancel(); clearCandidates(); updateContextCount(); status('上下文已修改，点击生成新的候选。'); }
  function updateContextCount() {
    const count = contextPayload().items.length, manual = state.settings.contextEnabled && $('context-manual').value.trim();
    $('context-count').textContent = state.settings.contextEnabled ? `${count} 条${manual ? ' + 手动补充' : ''}` : '已关闭';
  }
  function renderContext() {
    $('context-items').replaceChildren(); $('context-note').textContent = state.context.note;
    for (const item of state.context.items) {
      const key = T.itemKey(item), card = document.createElement('div'); card.className = 'context-item'; card.classList.toggle('excluded', state.contextExcluded.has(key));
      const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = !state.contextExcluded.has(key);
      const text = document.createElement('span'); text.textContent = `${item.kind === 'quote' ? '引用帖' : item.kind === 'root' ? '主帖 / 最早上文' : '上文回复'} · ${item.author || '作者未显示'}${item.truncated ? '（部分正文）' : ''}`;
      label.append(check, text); card.append(label);
      if (item.time) { const time = document.createElement('time'); time.textContent = item.time; card.append(time); }
      const body = document.createElement('textarea'); body.className = 'context-text'; body.rows = 3; body.maxLength = 6000; body.value = state.contextEdits.get(key) ?? item.text; body.setAttribute('aria-label', text.textContent);
      check.addEventListener('change', () => { if (check.checked) state.contextExcluded.delete(key); else state.contextExcluded.add(key); card.classList.toggle('excluded', !check.checked); contextChanged(); });
      body.addEventListener('input', () => { state.contextEdits.set(key, body.value); contextChanged(); });
      card.append(body); $('context-items').append(card);
    }
    $('context-manual').disabled = !state.settings.contextEnabled || state.busy;
    updateContextCount();
  }
  function refreshContext(target, force = false) {
    const context = state.settings.contextEnabled ? T.collect(target, state.settings.contextLimit, state.threadURL) : C.context({ items: [], coverage: 'disabled', note: '已在设置中关闭上下文。' });
    if (!force && location.pathname.startsWith('/compose/') && state.contextSignature && context.coverage === 'unavailable' && state.context.coverage !== 'unavailable') return;
    if (!force && location.pathname.startsWith('/compose/') && state.contextSignature && context.items.length < state.context.items.length && context.items.every(item => state.context.items.some(old => JSON.stringify(old) === JSON.stringify(item)))) return;
    const signature = JSON.stringify(context);
    if (!force && signature === state.contextSignature) return;
    const changed = Boolean(state.contextSignature);
    state.contextSignature = signature; state.context = context; renderContext();
    if (changed) { cancel(); clearCandidates(); status('已加载的对话上下文发生变化，点击生成新的候选。'); }
  }
  function autoGenerate(target) {
    if (!target || !state.settings.autoGenerate || state.dismissed.has(target.source.url) || state.closedRoute === location.pathname) return;
    const signature = requestSignature();
    if (!target.source.text || state.attempted.has(signature)) return;
    if (pendingAutoSignature === signature) return;
    clearAuto(); pendingAutoSignature = signature;
    autoTimer = setTimeout(() => {
      autoTimer = null; pendingAutoSignature = null;
      if (state.target?.source.url !== target.source.url || state.busy || $('panel').hidden) return;
      state.attempted.add(signature); void generate(false);
    }, 1100);
  }
  async function generate(force) {
    if (!state.target) {
      const reply = currentReplyTarget(), target = reply?.target || detailTarget();
      if (target) { select(target); if (reply) state.editor = reply.editor; }
    }
    if (!state.target) { status('未识别到原帖。请先点原帖的回复按钮，或点击推文下的「✦ 4条回复」。', 'error'); return; }
    let original;
    try { original = C.source({ ...state.target.source, text: $('source').value, context: contextPayload() }); }
    catch (error) { status(error.message, 'error'); return; }
    state.attempted.add(requestSignature());
    clearAuto(); cancel(); clearCandidates();
    const sequence = state.sequence;
    const requestId = crypto.randomUUID(); state.requestId = requestId; busy(true);
    const requestText = $('source').value, requestAngle = $('angle').value, requestContext = JSON.stringify(contextPayload()), account = learning.currentAccount();
    try {
      const result = await send({ type: 'GENERATE', requestId, source: original, angle: requestAngle, account, force });
      if (sequence !== state.sequence || learning.currentAccount() !== account || state.target?.source.url !== result.sourceURL || $('source').value !== requestText || $('angle').value !== requestAngle || JSON.stringify(contextPayload()) !== requestContext) return;
      render(result);
      status(result.cached ? '已读取本次会话缓存，未再次调用模型。' : `4 条候选已就绪${result.contextCount || result.hasManualContext ? `（已结合 ${result.contextCount} 条上下文${result.hasManualContext ? '及手动补充' : ''}）` : ''}，可编辑后填入。`, 'success');
    } catch (error) {
      if (sequence === state.sequence) status(error.code === 'CANCELLED' ? '已取消生成。' : error.message, error.code === 'CANCELLED' ? '' : 'error');
    } finally {
      if (sequence === state.sequence) { state.requestId = null; busy(false); }
    }
  }
  function render(result) {
    learning.noteGenerated(result.replies.map(reply => reply.text));
    $('empty').hidden = true; $('generate').textContent = '换一组 4 条回复';
    $('model-note').textContent = `模型：${result.modelName} · ${result.model}${result.voiceUsed ? ` · 已参考 @${result.voiceAccount} 的语气记忆` : ''}`;
    for (const [index, reply] of result.replies.entries()) {
      const card = document.createElement('article'); card.className = 'candidate';
      const head = document.createElement('div'); head.className = 'candidate-head';
      const number = document.createElement('span'); number.className = 'index'; number.textContent = `0${index + 1}`;
      const title = document.createElement('h3'); title.textContent = reply.label;
      const count = document.createElement('span'); count.className = 'reply-count';
      head.append(number, title, count);
      const input = document.createElement('textarea'); input.className = 'reply-text'; input.value = reply.text; input.rows = 3; input.setAttribute('aria-label', `${title.textContent}回复候选`); input.maxLength = 1000;
      const actions = document.createElement('div'); actions.className = 'candidate-actions';
      const copy = document.createElement('button'); copy.className = 'copy'; copy.type = 'button'; copy.textContent = '复制';
      const fill = document.createElement('button'); fill.className = 'fill'; fill.type = 'button'; fill.textContent = '填入回复';
      const update = () => {
        const size = C.weightedLength(input.value); let violation = '';
        try { C.validateReply(input.value, state.settings); } catch (error) { violation = error.message; }
        count.textContent = `约 ${size}/280 · ${[...input.value].length}/${state.settings.maxChars}字`; count.classList.toggle('long', Boolean(violation));
        fill.disabled = state.filling || Boolean(violation); copy.disabled = Boolean(violation); count.title = violation; fill.title = violation;
      };
      input.addEventListener('input', update); update();
      input.addEventListener('copy', () => { void learning.assistedText(input.value).catch(() => {}); });
      copy.addEventListener('click', async () => {
        try { await learning.assistedText(input.value); await navigator.clipboard.writeText(input.value); status('已复制，可在 X 回复框中粘贴。', 'success'); }
        catch { input.focus(); input.select(); status('浏览器未允许复制，候选已选中，请按 Ctrl+C。', 'error'); }
      });
      fill.addEventListener('click', () => void fillReply(input.value));
      actions.append(copy, fill); card.append(head, input, actions); $('cards').append(card);
    }
  }
  function boundEditor() {
    const url = state.target?.source.url;
    if (!url) return null;
    const editors = [...new Set([state.editor, ...document.querySelectorAll(`[role="dialog"] ${EDITOR}`), ...document.querySelectorAll(`main ${EDITOR}`)].filter(Boolean))];
    return editors.find(editor => targetForEditor(editor)?.source.url === url) || null;
  }
  async function waitEditor(url) {
    const until = Date.now() + 4500;
    while (Date.now() < until && state.target?.source.url === url) {
      const editor = boundEditor();
      if (editor) return editor;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
  }
  function filling(value) {
    state.filling = value;
    for (const card of $('cards').children) {
      let invalid = false;
      try { C.validateReply(card.querySelector('.reply-text').value, state.settings); } catch { invalid = true; }
      card.querySelector('.fill').disabled = value || invalid;
    }
    $('append').disabled = value; $('replace').disabled = value;
  }
  async function fillReply(text) {
    if (!state.target || state.filling) return;
    try { C.validateReply(text, state.settings); } catch (error) { status(error.message, 'error'); return; }
    const url = state.target.source.url;
    filling(true); $('draft-confirm').hidden = true; state.draftAction = null;
    try {
      let editor = boundEditor();
      if (!editor) {
        let article = state.target.article;
        if (!article?.isConnected) article = [...document.querySelectorAll(ARTICLE)].find(el => articleURL(el) === url);
        const replyButton = article?.querySelector('[data-testid="reply"]');
        if (replyButton) { replyButton.click(); editor = await waitEditor(url); }
      }
      if (state.target?.source.url !== url) return;
      if (!editor) { status('未找到这条原文的回复框。请先点 X 的回复按钮，或复制候选后粘贴。', 'error'); return; }
      state.editor = editor;
      const before = E.read(editor);
      if (before === clean(text)) { status('这条候选已经在回复框里了。', 'success'); return; }
      if (before) {
        state.draftAction = { text, url, editor, before };
        $('draft-confirm').hidden = false; status('已有草稿，请选择追加、替换或取消。');
        $('draft-confirm').scrollIntoView({ block: 'nearest' });
      } else await insert(editor, text, false, url, before);
    } catch { status('未能填入，请复制候选并粘贴到 X 的回复框。', 'error'); }
    finally { filling(false); }
  }
  async function insert(editor, text, append, url, before) {
    try { C.validateReply(text, state.settings); } catch (error) { status(error.message, 'error'); return; }
    if (!visible(editor) || state.target?.source.url !== url || boundEditor() !== editor) { status('原文或回复框已变化，请重新选择候选。', 'error'); return; }
    const sequence = state.sequence, route = location.pathname;
    const result = await E.write(editor, text, {
      append, before,
      isCurrent: () => !stopped && sequence === state.sequence && location.pathname === route && visible(editor) && state.target?.source.url === url && boundEditor() === editor,
      onWrite: expected => learning.markEditor(editor, expected)
    });
    if (!result.ok) {
      status(result.reason === 'changed' ? '原文或草稿已变化，请重新选择候选。' : '编辑器未确认填入，请先检查草稿；也可复制候选手动粘贴。', 'error');
      return;
    }
    status('已填入草稿，请检查后在 X 点击发布。', 'success');
    $('draft-confirm').hidden = true; state.draftAction = null;
  }
  for (const [id, append] of [['append', true], ['replace', false]]) $(id).addEventListener('click', async () => {
    const action = state.draftAction;
    if (!action || state.filling) return;
    state.draftAction = null; $('draft-confirm').hidden = true; filling(true);
    try { await insert(action.editor, action.text, append, action.url, action.before); }
    catch { status('未能确认填入，请先检查草稿；也可复制候选手动粘贴。', 'error'); }
    finally { filling(false); }
  });
  $('keep').addEventListener('click', () => { $('draft-confirm').hidden = true; state.draftAction = null; status('已保留原有草稿。'); });
  $('generate').addEventListener('click', () => void generate(true));
  $('cancel').addEventListener('click', () => { cancel(); status('已取消生成。'); });
  $('close').addEventListener('click', () => {
    if (state.target) state.dismissed.add(state.target.source.url);
    state.closedRoute = location.pathname;
    clearAuto(); cancel(); $('panel').hidden = true; $('launcher').hidden = false; scheduleLauncher();
  });
  function showPanel() {
    state.closedRoute = null;
    const reply = currentReplyTarget(), target = reply?.target || state.target || detailTarget();
    if (reply) state.editor = reply.editor;
    if (target) { select(target); state.dismissed.delete(target.source.url); autoGenerate(target); }
    else { $('panel').hidden = false; $('launcher').hidden = true; status('请打开推文详情，或点击推文下的「4条回复」。'); }
  }
  $('launcher').addEventListener('click', showPanel);
  for (const id of ['settings', 'settings-link']) $(id).addEventListener('click', () => void send({ type: 'OPEN_SETTINGS' }).catch(error => status(error.message, 'error')));
  $('source').addEventListener('input', () => { clearAuto(); cancel(); clearCandidates(); updateSourceCount(); status('原文已修改，点击生成新的候选。'); });
  $('angle').addEventListener('input', () => { clearAuto(); cancel(); clearCandidates(); status('观点已更新，点击生成候选。'); });
  $('context-manual').addEventListener('input', contextChanged);
  $('refresh-context').addEventListener('click', () => {
    if (!state.target) { status('请先选择一条推文或文章。'); return; }
    clearAuto(); cancel(); clearCandidates(); state.contextExcluded.clear(); state.contextEdits.clear();
    refreshContext(state.target, true); status('已重新收集当前已加载的对话，手动补充内容已保留。');
  });
  $('angle').addEventListener('keydown', event => { if (event.key === 'Enter' && !state.busy && !event.isComposing) void generate(true); });

  function decorate(article) {
    if (article.querySelector('[data-magpie-action]')) return;
    const group = own(article, '[role="group"]').find(node => node.querySelector('[data-testid="reply"]'));
    if (!group) return;
    const button = document.createElement('button'); button.type = 'button'; button.dataset.magpieAction = 'reply';
    button.textContent = '✦ 4条回复'; button.title = '通过本机 Magpie 生成 4 条回复候选';
    button.setAttribute('aria-label', '通过 Magpie 生成 4 条回复候选');
    button.style.cssText = 'background:transparent;border:0;border-radius:12px;color:#639f8e;font:500 11px/1.5 system-ui,sans-serif;padding:4px 7px;white-space:nowrap;cursor:pointer;flex-shrink:0';
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      const target = extract(article);
      if (!target) return;
      state.closedRoute = null;
      select(target); state.dismissed.delete(target.source.url); void generate(false);
    });
    group.append(button);
  }
  function scan() {
    if (stopped) return;
    scheduleLauncher();
    learning.scan();
    profiles.scan();
    if (state.route !== location.pathname) {
      const before = C.postURL(`https://x.com${state.route}`), after = C.postURL(location.href);
      state.route = location.pathname;
      if (!location.pathname.startsWith('/compose/') && before !== after) {
        state.closedRoute = null;
        state.threadURL = null;
        clearAuto(); cancel(); clearCandidates(); state.target = null; state.editor = null; state.pendingReply = null;
        $('source').value = ''; $('source-author').textContent = '选择一条推文或文章'; $('source-link').hidden = true;
        state.context = C.context(); state.contextSignature = ''; state.contextExcluded.clear(); state.contextEdits.clear(); $('context-manual').value = ''; renderContext();
        $('source-warning').hidden = true; $('source-count').textContent = '尚未读取';
        if (!after) { $('panel').hidden = true; $('launcher').hidden = false; }
      }
    }
    if (state.pendingReply || document.activeElement?.closest?.(EDITOR)) {
      const reply = currentReplyTarget();
      if (reply && (state.editor !== reply.editor || state.target?.source.url !== reply.target.source.url)) {
        select(reply.target); state.editor = reply.editor; autoGenerate(reply.target);
      }
    }
    for (const article of document.querySelectorAll(ARTICLE)) decorate(article);
    const target = detailTarget();
    if (state.target && !$('panel').hidden) {
      const activeURL = state.target.source.url;
      const liveArticle = [...document.querySelectorAll(`main ${ARTICLE}`)].find(article => articleURL(article) === activeURL);
      const active = target?.source.url === activeURL ? target : liveArticle ? extract(liveArticle) : state.target;
      // Context changes invalidate drafts even when automatic model calls are off.
      // Keep an explicitly selected branch instead of reverting to the route's focal post.
      select(active); autoGenerate(active);
    } else if (target && state.settings.autoGenerate && !state.dismissed.has(target.source.url) && state.closedRoute !== location.pathname && !document.querySelector('[role="dialog"]')) {
      select(target); autoGenerate(target);
    }
  }
  function scheduleScan() { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 300); }
  const observer = new MutationObserver(records => {
    if (records.some(r => !host.contains(r.target) && !r.target.closest?.('[data-magpie-action]') && (r.type === 'characterData' || r.type === 'attributes' && r.target.matches('[data-testid="AppTabBar_Profile_Link"]') || [...r.addedNodes, ...r.removedNodes].some(node => node !== host && !node.dataset?.magpieAction)))) scheduleScan();
  });
  document.addEventListener('focusin', event => {
    const editor = event.target.closest?.(EDITOR);
    if (!editor) return;
    const target = targetForEditor(editor);
    if (target) { select(target); state.editor = editor; autoGenerate(target); }
  });
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-testid="reply"]');
    if (!button || !active(button)) return;
    const target = extract(button.closest(ARTICLE)) || detailTarget();
    if (!target) return;
    // React may replace the tweet and omit its status link in the composer preview.
    state.pendingReply = { target, time: Date.now(), dialogs: new Set(document.querySelectorAll('[role="dialog"]')) };
    state.closedRoute = null; state.dismissed.delete(target.source.url); select(target);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('panel').hidden && !state.busy) $('close').click();
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id === chrome.runtime.id && message.type === 'SHOW_PANEL') { showPanel(); respond({ ok: true }); }
  });
  function reloadSettings() {
    void send({ type: 'GET_SETTINGS' }).then(options => {
      if (!Array.isArray(options.candidatePreferences) || typeof options.conversational !== 'boolean' || typeof options.autoGenerateNoticeVersion !== 'number' || typeof options.collectWritingSamples !== 'boolean' || typeof options.profileHighlightEnabled !== 'boolean' || typeof options.timelinePriorityEnabled !== 'boolean') throw new Error('扩展后台仍是旧版，请重新加载扩展并刷新 X。');
      state.settings = options; state.attempted.clear(); clearAuto(); cancel(); clearCandidates();
      learning.configure();
      followProgress.configure();
      profiles.configure(options);
      priorityTimeline.configure(options);
      $('preference-labels').textContent = options.candidatePreferences.map(item => item.label).join(' · ');
      state.contextSignature = ''; if (state.target) refreshContext(state.target, true); else renderContext();
      status('设置已更新，点击生成使用新模型。');
    }).catch(error => status(error.message, 'error'));
  }
  chrome.runtime.onMessage.addListener(message => { if (message?.type === 'SETTINGS_UPDATED') reloadSettings(); });
  let routeTimer = setInterval(() => { if (state.route !== location.pathname) scheduleScan(); }, 700);
  window.addEventListener('resize', scheduleLauncher);
  window.visualViewport?.addEventListener('resize', scheduleLauncher);
  window.addEventListener('pagehide', () => { stopped = true; profiles.stop(); priorityTimeline.stop(); followProgress.stop(); launcherResize.disconnect(); launcherMutations.disconnect(); launcherWatched = []; cancelAnimationFrame(launcherFrame); launcherFrame = 0; observer.disconnect(); clearInterval(routeTimer); clearTimeout(scanTimer); clearAuto(); cancel(); });
  window.addEventListener('pageshow', event => {
    if (event.persisted && stopped) {
      stopped = false; observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href'] });
      profiles.configure(state.settings);
      followProgress.configure();
      priorityTimeline.configure(state.settings);
      scheduleLauncher();
      routeTimer = setInterval(() => { if (state.route !== location.pathname) scheduleScan(); }, 700);
      scheduleScan();
    }
  });
  void send({ type: 'GET_SETTINGS' }).then(options => { if (!Array.isArray(options.candidatePreferences) || typeof options.conversational !== 'boolean' || typeof options.autoGenerateNoticeVersion !== 'number' || typeof options.collectWritingSamples !== 'boolean' || typeof options.profileHighlightEnabled !== 'boolean' || typeof options.timelinePriorityEnabled !== 'boolean') throw new Error('扩展后台仍是旧版，请重新加载扩展并刷新 X。'); state.settings = options; learning.configure(); followProgress.configure(); profiles.configure(options); priorityTimeline.configure(options); $('preference-labels').textContent = options.candidatePreferences.map(item => item.label).join(' · '); scan(); }).catch(error => status(error.message, 'error'));
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href'] });
})();
