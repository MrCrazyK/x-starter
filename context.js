/* Read only the loaded conversation region; never treat nearby feed posts as ancestors. */
(() => {
  'use strict';
  const C = globalThis.MagpieReply;
  const ARTICLE = 'article[data-testid="tweet"]';
  const QUOTE = '[data-testid="quoteTweet"], [data-testid="quoteTweet-container"]';
  const clean = value => String(value || '').replace(/\u00a0/gu, ' ').trim();
  const own = (article, selector) => [...article.querySelectorAll(selector)].filter(node => node.closest(ARTICLE) === article);
  function quoteRoot(node, article) {
    const named = node.closest(QUOTE);
    if (named && article.contains(named)) return named;
    const linked = node.closest('[role="link"]');
    return linked && linked !== article && article.contains(linked) && linked.querySelector('[data-testid="User-Name"]') ? linked : null;
  }
  function primaryText(article) {
    return own(article, '[data-testid="tweetText"]').find(node => !quoteRoot(node, article)) || null;
  }
  function articleURL(article) {
    const links = own(article, 'a[href]').filter(node => !quoteRoot(node, article));
    return C.postURL((links.find(a => a.querySelector('time') && C.postURL(a.href)) || links.find(a => C.postURL(a.href)))?.href);
  }
  function author(article) {
    return clean(own(article, '[data-testid="User-Name"]').find(node => !quoteRoot(node, article))?.innerText).replace(/\n/gu, ' · ').slice(0, 160);
  }
  function entry(article, kind) {
    const rich = own(article, '[data-testid="longformRichTextComponent"], [data-testid="twitterArticleRichTextView"]').find(node => !quoteRoot(node, article));
    let text = clean((rich || primaryText(article))?.innerText);
    if (!text && quotes(article).length) text = '（此上文引用了下方帖子，请结合引用内容理解。）';
    const url = articleURL(article);
    if (!text || !url) return null;
    return { kind, url, author: author(article), time: own(article, 'time').find(node => !quoteRoot(node, article))?.dateTime || '', text: text.slice(0, 6000), truncated: text.length > 6000 };
  }
  function quotes(article) {
    if (!article) return [];
    const roots = [...new Set(own(article, '[data-testid="tweetText"]').map(node => quoteRoot(node, article)).filter(Boolean))];
    return roots.map(root => {
      const text = [...root.querySelectorAll('[data-testid="tweetText"]')].map(node => clean(node.innerText)).filter(Boolean).join('\n');
      const link = [...root.querySelectorAll('a[href]')].find(a => C.postURL(a.href));
      return {
        kind: 'quote', url: C.postURL(link?.href) || '', author: clean(root.querySelector('[data-testid="User-Name"]')?.innerText).replace(/\n/gu, ' · ').slice(0, 160),
        time: root.querySelector('time')?.dateTime || '', text: text.slice(0, 6000), truncated: text.length > 6000
      };
    }).filter(item => item.text);
  }
  function sponsored(article) {
    return Boolean(article.closest('[data-testid="placementTracking"]') || article.querySelector('[data-testid="promotedIndicator"], [data-testid="AdBadge"]'));
  }
  function region(article, main) {
    return article?.closest('[data-testid="conversation"], [aria-label="Timeline: Conversation"], [aria-label="时间线：对话"], section') || main;
  }
  function collect(target, limit = 12, priorFocusURL = null) {
    let items = [], coverage = 'unavailable';
    let note = '时间线中无法确认主帖与上文链。请打开这条帖子的详情后重新收集，或在下方手动补充。';
    const focusURL = C.postURL(location.href) || (location.pathname.startsWith('/compose/') ? C.postURL(priorFocusURL) : null);
    const localConversation = target.article?.isConnected ? target.article.closest('[data-testid="conversation"], [aria-label="Timeline: Conversation"], [aria-label="时间线：对话"]') : null;
    const main = localConversation?.closest('[role="dialog"]') ? localConversation : document.querySelector('main [data-testid="primaryColumn"]') || document.querySelector('main');
    if (main && focusURL && !focusURL.includes('/i/article/')) {
      const activeDialog = main.closest('[role="dialog"]');
      const all = [...main.querySelectorAll(ARTICLE)].filter(article => article.closest('[role="dialog"]') === activeDialog && !sponsored(article));
      const focusIndex = all.findIndex(article => articleURL(article) === focusURL);
      const selectedIndex = all.findIndex(article => articleURL(article) === target.source.url);
      if (focusIndex !== -1 && selectedIndex !== -1) {
        const last = Math.min(focusIndex, selectedIndex), focused = all[focusIndex];
        const selectedRegion = region(focused, main);
        items = all.slice(0, last).filter(article => region(article, main) === selectedRegion).map(article => entry(article, 'ancestor')).filter(Boolean);
        if (selectedIndex > focusIndex) {
          const root = entry(focused, items.length ? 'ancestor' : 'root');
          if (root) items.push(root);
          coverage = 'limited';
          note = '已收集主会话的上文。当前选择的是分支回复，未确认属于该分支的其他回复不会自动合并，可手动补充中间对话。';
        } else {
          coverage = 'loaded';
          note = items.length ? '已按页面顺序读取主会话已加载的上文；尚未加载、隐藏或折叠的内容未读取。' : '当前详情页未显示更早的上文；如这是回复，请展开上方会话后重新收集。';
        }
        if (items[0]) items[0].kind = 'root';
      }
    }
    const mainArticle = main && [...main.querySelectorAll(ARTICLE)].find(article => articleURL(article) === target.source.url);
    const selected = mainArticle || target.article;
    // Quoted material in ancestors is also part of what the conversation refers to.
    const upstreamURLs = new Set(items.map(item => item.url));
    if (main) for (const article of main.querySelectorAll(ARTICLE)) if (upstreamURLs.has(articleURL(article))) items.push(...quotes(article));
    items.push(...quotes(selected));
    const seen = new Set();
    items = items.filter(item => {
      const key = `${item.kind === 'quote' ? 'quote' : 'post'}:${item.url || `${item.author}:${item.text}`}`;
      if ((item.kind !== 'quote' && item.url === target.source.url) || seen.has(key)) return false;
      seen.add(key); return true;
    });
    let omitted = Math.max(0, items.length - limit);
    if (items.length > limit) {
      const firstRoot = items.find(item => item.kind === 'root'), closestParent = items.findLast(item => item.kind !== 'quote');
      const priority = [...new Set([firstRoot, closestParent, ...items.filter(item => item.kind === 'quote').reverse(), ...items.slice().reverse()].filter(Boolean))].slice(0, limit);
      items = items.filter(item => priority.includes(item));
    }
    let remaining = 24000;
    items = items.flatMap(item => {
      if (!remaining) { omitted++; return []; }
      const text = item.text.slice(0, remaining); remaining -= text.length;
      return [{ ...item, text, truncated: item.truncated || text.length !== item.text.length }];
    });
    if (omitted || items.some(item => item.truncated)) { coverage = 'limited'; note += ` 已按上限省略 ${omitted} 条，较长正文可能只保留部分；可在下方查看并补充。`; }
    if (coverage === 'unavailable' && items.some(item => item.kind === 'quote')) note += ' 已提取当前帖子中能识别的引用内容。';
    return { items, manual: '', coverage, note, omitted };
  }
  const itemKey = item => `${item.kind}:${item.url || `${item.author}:${item.text}`}`;
  globalThis.MagpieContext = Object.freeze({ quoteRoot, primaryText, articleURL, author, quotes, collect, itemKey });
})();
