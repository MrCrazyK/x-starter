(() => {
  'use strict';
  const active = new WeakSet();
  const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').trim();
  const read = editor => {
    const blocks = editor.querySelectorAll('[data-block="true"]');
    if (blocks.length) return clean([...blocks].map(block => block.textContent).join('\n'));
    // A blank contenteditable line can be <div><br></div>; innerText counts it twice.
    let text = '';
    const visit = node => {
      if (node.nodeType === 3) { text += node.textContent; return; }
      if (node.nodeType !== 1) return;
      if (node.tagName === 'BR') { text += '\n'; return; }
      const block = /^(DIV|P|LI|BLOCKQUOTE|PRE)$/.test(node.tagName);
      if (block && text && !text.endsWith('\n')) text += '\n';
      for (const child of node.childNodes) visit(child);
      if (block && text && !text.endsWith('\n')) text += '\n';
    };
    for (const child of editor.childNodes) visit(child);
    return clean(text);
  };
  const pause = () => new Promise(resolve => setTimeout(resolve, 25));

  async function write(editor, text, options = {}) {
    if (!editor?.ownerDocument) return { ok: false, reason: 'changed' };
    if (active.has(editor)) return { ok: false, reason: 'busy' };
    active.add(editor);
    try {
      const doc = editor.ownerDocument, view = doc.defaultView;
      const before = read(editor), append = options.append && Boolean(before);
      const insertion = append ? `\n\n${text}` : text;
      const expected = clean(append ? `${before}\n\n${text}` : text);
      const current = () => editor.isConnected && (!options.isCurrent || options.isCurrent());
      if (!current() || (options.before !== undefined && before !== options.before)) return { ok: false, reason: 'changed' };
      if (!append && before === expected) return { ok: true, unchanged: true, expected };

      editor.focus();
      const selection = view.getSelection(), range = doc.createRange();
      range.selectNodeContents(editor);
      if (append) range.collapse(false);
      selection.removeAllRanges(); selection.addRange(range);
      // Let the controlled editor receive selectionchange before its paste handler runs.
      await pause();
      if (!current() || doc.activeElement !== editor || read(editor) !== before ||
          !selection.rangeCount || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) {
        return { ok: false, reason: 'changed' };
      }

      const data = new view.DataTransfer();
      data.setData('text/plain', insertion);
      const event = new view.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true, composed: true });
      options.onWrite?.(expected);
      editor.dispatchEvent(event);
      // Draft.js owns paste and updates its React state. A second native edit would duplicate it.
      const controlled = Boolean(editor.closest('.DraftEditor-root') || editor.matches('.public-DraftEditor-content'));
      if (!event.defaultPrevented && !controlled && read(editor) === before) {
        doc.execCommand('insertText', false, insertion);
      }
      let stable = 0;
      for (let attempt = 0; attempt < 16; attempt++) {
        await pause();
        if (!current()) return { ok: false, reason: 'changed' };
        stable = read(editor) === expected ? stable + 1 : 0;
        if (stable === 2) return { ok: true, expected };
      }
      // Never retry a handled or uncertain edit: the draft may already contain the text.
      return { ok: false, reason: 'unconfirmed' };
    } finally { active.delete(editor); }
  }
  globalThis.MagpieEditor = Object.freeze({ read, write });
})();
