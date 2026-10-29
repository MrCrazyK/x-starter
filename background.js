/* All model requests originate here, never from x.com's origin. */
importScripts('shared.js', 'memory.js', 'followback.js', 'followback-background.js');
const C = globalThis.MagpieReply;
const M = globalThis.MagpieMemory;
const APP_KEY = 'magpie-x-reply'; // Local application identity, not a vendor API secret.
const jobs = new Map();
const catalogCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;
const voiceJobs = new Map();
let memoryQueue = Promise.resolve(), generatedQueue = Promise.resolve();

async function getSettings() { return C.settings((await chrome.storage.local.get('settings')).settings); }
const followback = chrome.alarms ? MagpieFollowbackBackground.create({ getSettings }) : null;
async function hash(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function readMemory() { return M.store((await chrome.storage.local.get('voiceMemory')).voiceMemory); }
function writeMemory(action) {
  const result = memoryQueue.then(async () => {
    const saved = await readMemory(), value = await action(saved);
    await chrome.storage.local.set({ voiceMemory: saved });
    return value;
  });
  memoryQueue = result.catch(() => {});
  return result;
}
async function rememberGenerated(replies) {
  const result = generatedQueue.then(async () => {
    const hashes = await Promise.all(replies.map(row => hash(M.comparable(row.text))));
    const old = (await chrome.storage.session.get('generatedReplyHashes')).generatedReplyHashes || [];
    await chrome.storage.session.set({ generatedReplyHashes: [...new Set([...hashes, ...old])].slice(0, 500) });
  });
  generatedQueue = result.catch(() => {});
  await result;
}
async function isGenerated(text) {
  if (typeof text !== 'string' || text.length > M.LIMITS.text) return false;
  await generatedQueue;
  const fingerprints = (await chrome.storage.session.get('generatedReplyHashes')).generatedReplyHashes || [];
  return fingerprints.includes(await hash(M.comparable(text)));
}
async function invalidateReplies() {
  for (const job of jobs.values()) job.controller.abort();
  await chrome.storage.session.remove('replyCache');
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED' })));
}
async function summarizeMemory(name) {
  name = M.account(name);
  const snapshot = M.get(await readMemory(), name), samples = M.summaryInput(snapshot);
  const messages = M.summaryMessages(samples);
  if (voiceJobs.has(name)) throw new C.ReplyError('MEMORY_BUSY', '这个账号正在更新语气记忆，请稍候。');
  const job = { controller: new AbortController() };
  voiceJobs.set(name, job);
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 15000);
  const timeout = setTimeout(() => job.controller.abort('timeout'), 90000);
  try {
    const settings = await getSettings();
    const info = await catalog(settings, false, job.controller.signal), model = C.chooseModel(info.models, settings.model);
    const body = { model: model.id, stream: true, max_tokens: 4096, messages };
    if (model.reasoningLevels.includes('low')) body.reasoning_effort = 'low';
    const raw = await http('/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Magpie-Session': `x-voice-${name}` },
      body: JSON.stringify(body), consume: readChat
    }, { port: settings.port, signal: job.controller.signal, timeout: 85000 });
    const markdown = M.parseSummary(raw);
    if (job.controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const result = await writeMemory(saved => {
      if (job.controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const target = M.get(saved, name);
      if (target.documentRevision !== snapshot.documentRevision || !saved.accounts.some(row => row.account === name)) throw new C.ReplyError('MEMORY_CHANGED', '语气记忆已在其他页面修改，本次总结未覆盖它。');
      target.markdown = markdown; target.updatedAt = Date.now(); target.summaryRevision = snapshot.sampleRevision;
      target.summarySampleCount = samples.length; target.documentRevision++;
      return { profile: target, model: model.id };
    });
    await invalidateReplies();
    return result;
  } catch (error) {
    if (job.controller.signal.reason === 'timeout') throw new C.ReplyError('TIMEOUT', '语气总结超过 90 秒，请选择更快的模型重试。');
    throw error;
  } finally {
    clearInterval(keepAlive); clearTimeout(timeout);
    if (voiceJobs.get(name) === job) voiceJobs.delete(name);
  }
}
function friendly(error) {
  if (error instanceof C.ReplyError) return { code: error.code, message: error.message };
  if (error?.name === 'AbortError') return { code: 'CANCELLED', message: '已取消生成。' };
  if (error instanceof TypeError) return { code: 'CONNECT', message: '无法连接本机 Magpie。请确认 Magpie 正在运行，端口正确，并允许扩展访问本机网关。' };
  return { code: 'UNKNOWN', message: '生成失败，请重试；若持续失败，请检查 Magpie 的请求记录。' };
}
async function http(path, options = {}, { port, signal, timeout = 10000 } = {}) {
  const ctl = new AbortController();
  let timedOut = false;
  const abort = () => ctl.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) ctl.abort();
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeout);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      ...options, signal: ctl.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { 'Authorization': `Bearer ${APP_KEY}`, ...options.headers }
    });
    if (!response.ok) {
      const labels = {
        401: 'Magpie 拒绝连接。请检查 Magpie 的本机访问与网关权限设置。',
        403: 'Magpie 拒绝本机访问，请检查网络访问设置；无需在此填写厂商 API Key。',
        404: 'Magpie 接口不存在，请检查端口或升级 Magpie。',
        429: '模型额度或并发已达上限，请稍后重试或更换模型。',
        502: 'Magpie 的上游模型暂时不可用，请稍后重试。',
        503: 'Magpie 暂无可用的模型账号或额度，请在 Magpie 中检查。'
      };
      await response.body?.cancel();
      throw new C.ReplyError(`HTTP_${response.status}`, labels[response.status] || `Magpie 返回 HTTP ${response.status}。请检查其请求记录。`);
    }
    // Keep the timeout and cancellation active while the body is consumed.
    return await options.consume(response);
  } catch (error) {
    if (timedOut) throw new C.ReplyError('TIMEOUT', 'Magpie 响应超时，请重试或选择更快的模型。');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
async function catalog(settings, force = false, signal) {
  const saved = catalogCache.get(settings.port);
  if (!force && saved && Date.now() - saved.time < 60000) return saved;
  const hello = await http('/api/hello', { consume: r => r.json() }, { port: settings.port, signal, timeout: 5000 });
  if (hello?.name !== 'magpie') throw new C.ReplyError('NOT_MAGPIE', '这个端口运行的不是 Magpie，请检查端口。');
  const data = await http('/v1/models', { consume: r => r.json() }, { port: settings.port, signal });
  const result = { time: Date.now(), version: String(hello.version || ''), models: C.models(data) };
  catalogCache.set(settings.port, result);
  return result;
}
async function readChat(response) {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = await response.json();
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') throw new C.ReplyError('INCOMPLETE', '模型输出未完成，请重试或换用更快的模型。');
    return contentText(choice?.message?.content);
  }
  let text = '', ended = false, finish = '', total = 0;
  const parser = C.sseReader(raw => {
    if (raw.trim() === '[DONE]') { ended = true; return; }
    let event;
    try { event = JSON.parse(raw); } catch { throw new C.ReplyError('STREAM', '模型返回的流式数据无法解析，请重试。'); }
    if (event.error) throw new C.ReplyError('UPSTREAM', '上游模型返回错误，请查看 Magpie 的请求记录。');
    const choice = event.choices?.[0];
    if (!choice) return;
    text += contentText(choice.delta?.content ?? choice.message?.content);
    if (choice.finish_reason) { finish = choice.finish_reason; ended = true; }
    if (text.length > 24000) throw new C.ReplyError('FORMAT', '候选回复返回的数据过长，请重新生成。');
  });
  const reader = response.body.getReader(), decoder = new TextDecoder();
  try {
    while (!ended) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 2097152) throw new C.ReplyError('FORMAT', '模型返回的数据过大，请换用更快的模型。');
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode()); parser.end();
    if (finish === 'length') throw new C.ReplyError('INCOMPLETE', '模型输出未完成，请重试或更换模型。');
    if (!ended && !finish) throw new C.ReplyError('STREAM', '模型连接提前中断，请重新生成。');
    return text;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(p => p.type === 'text' ? p.text : '').join('');
  return '';
}
async function generate(message, sender) {
  const incoming = C.source(message.source);
  const angle = typeof message.angle === 'string' ? message.angle.trim().slice(0, 500) : '';
  const requestId = String(message.requestId || '');
  if (!/^[a-zA-Z0-9_-]{1,80}$/u.test(requestId)) throw new C.ReplyError('REQUEST', '生成请求无效，请刷新 X 页面。');
  const tabId = sender.tab.id;
  jobs.get(tabId)?.controller.abort();
  const job = { requestId, controller: new AbortController() };
  jobs.set(tabId, job);
  // Only keep the worker alive for a bounded, active generation request.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 15000);
  const timeout = setTimeout(() => job.controller.abort('timeout'), 90000);
  try {
    const settings = await getSettings();
    const original = { ...incoming, context: settings.contextEnabled ? incoming.context : C.context({ items: [], coverage: 'disabled' }) };
    if (original.context.items.length > settings.contextLimit) throw new C.ReplyError('CONTEXT', `上下文条数超过设置上限 ${settings.contextLimit}，请重新收集或取消部分条目。`);
    const info = await catalog(settings, false, job.controller.signal);
    const model = C.chooseModel(info.models, settings.model);
    const account = M.account(message.account);
    const voice = settings.useVoiceMemory && account ? M.get(await readMemory(), account).markdown : '';
    const key = await hash({ revision: 4, original, angle, account, voice, model: model.id, port: settings.port, language: settings.language, length: settings.length, conversational: settings.conversational,
      tone: settings.tone, strictRules: settings.strictRules, maxChars: settings.maxChars, bannedTerms: settings.bannedTerms, candidatePreferences: settings.candidatePreferences });
    const stored = (await chrome.storage.session.get('replyCache')).replyCache || {};
    const cached = stored[key];
    if (!message.force && cached && Date.now() - cached.time < CACHE_TTL) { await rememberGenerated(cached.value.replies); return { ...cached.value, cached: true }; }
    const body = { model: model.id, stream: true, max_tokens: 3072, messages: C.messages(original, settings, angle, voice) };
    if (model.reasoningLevels.includes('low')) body.reasoning_effort = 'low';
    const raw = await http('/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Magpie-Session': `x-reply-${tabId}-${requestId}` },
      body: JSON.stringify(body), consume: readChat
    }, { port: settings.port, signal: job.controller.signal, timeout: 85000 });
    if (job.controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const result = { replies: C.parseReplies(raw, settings), model: model.id, modelName: model.name, sourceURL: original.url, cached: false,
      contextCount: original.context.items.length, hasManualContext: Boolean(original.context.manual), voiceUsed: Boolean(voice), voiceAccount: voice ? account : '' };
    await rememberGenerated(result.replies);
    const recent = (await chrome.storage.session.get('replyCache')).replyCache || {};
    const entries = Object.entries(recent).filter(([, entry]) => Date.now() - entry.time < CACHE_TTL).sort((a, b) => b[1].time - a[1].time).slice(0, 19);
    await chrome.storage.session.set({ replyCache: { ...Object.fromEntries(entries), [key]: { time: Date.now(), value: result } } });
    return result;
  } catch (error) {
    if (job.controller.signal.reason === 'timeout') throw new C.ReplyError('TIMEOUT', '生成超过 90 秒，请选择更快的模型后重试。');
    throw error;
  } finally {
    clearInterval(keepAlive); clearTimeout(timeout);
    if (jobs.get(tabId) === job) jobs.delete(tabId);
  }
}
function senderType(sender) {
  if (sender.id !== chrome.runtime.id) return null;
  if (sender.url?.startsWith(chrome.runtime.getURL(''))) return 'extension';
  if (sender.tab && sender.frameId === 0 && C.xURL(sender.url)) return 'content';
  return null;
}
async function dispatch(message, sender) {
  const type = senderType(sender);
  if (!type || !message || typeof message !== 'object') throw new C.ReplyError('DENIED', '此页面无权调用扩展。');
  switch (message.type) {
    case 'FOLLOWBACK_STATUS':
    case 'FOLLOWBACK_CHECK':
    case 'FOLLOWBACK_IDENTIFY':
    case 'FOLLOWBACK_CONFIRM':
    case 'FOLLOWBACK_IGNORE': {
      if (type !== 'extension') throw new C.ReplyError('DENIED', '请在扩展设置中逐个确认回关。');
      if (!followback) throw new C.ReplyError('FOLLOWBACK_UNAVAILABLE', '请重新加载扩展，启用新版定时权限。');
      await followback.ready;
      if (message.type === 'FOLLOWBACK_STATUS') return followback.status();
      if (message.type === 'FOLLOWBACK_CHECK') return followback.scan(true);
      if (message.type === 'FOLLOWBACK_IDENTIFY') return followback.identify();
      if (message.type === 'FOLLOWBACK_IGNORE') return followback.ignore(message.account);
      return followback.confirm(message.account);
    }
    case 'GET_SETTINGS': return getSettings();
    case 'IS_GENERATED': return { generated: await isGenerated(message.text) };
    case 'MARK_ASSISTED_TEXT':
      if (type !== 'content' || typeof message.text !== 'string' || !message.text.trim() || message.text.length > M.LIMITS.text) throw new C.ReplyError('DENIED', '候选来源标记无效。');
      await rememberGenerated([{ text: message.text }]); return {};
    case 'CAPTURE_HANDWRITTEN': {
      if (type !== 'content') throw new C.ReplyError('DENIED', '请从 X 页面收集手写内容。');
      if (!(await getSettings()).collectWritingSamples || message.assisted || message.confirmed !== true) return { saved: false };
      const value = M.sample(message.sample), name = M.account(message.account);
      if (await isGenerated(value.text)) return { saved: false };
      return writeMemory(saved => {
        const target = M.get(saved, name, true), added = M.add(target, value);
        return { saved: added, count: target.samples.length, account: target.account };
      });
    }
    case 'GET_VOICE_MEMORY': {
      if (type !== 'extension') throw new C.ReplyError('DENIED', '请在设置中查看语气记忆。');
      const saved = await readMemory();
      const name = M.account(message.account) || saved.accounts[0]?.account;
      return { accounts: saved.accounts.map(row => ({ account: row.account, count: row.samples.length })), profile: name ? M.get(saved, name) : null };
    }
    case 'SUMMARIZE_VOICE_MEMORY':
      if (type !== 'extension') throw new C.ReplyError('DENIED', '请在设置中手动更新语气记忆。');
      return summarizeMemory(message.account);
    case 'SAVE_VOICE_MEMORY':
    case 'DELETE_WRITING_SAMPLE':
    case 'CLEAR_VOICE_MEMORY': {
      if (type !== 'extension') throw new C.ReplyError('DENIED', '请在设置中修改语气记忆。');
      const name = M.account(message.account);
      if (!name) throw new C.ReplyError('MEMORY_ACCOUNT', '请先选择账号。');
      voiceJobs.get(name)?.controller.abort();
      const result = await writeMemory(saved => {
        if (message.type === 'CLEAR_VOICE_MEMORY') {
          saved.accounts = saved.accounts.filter(row => row.account !== name); return {};
        }
        const target = M.get(saved, name, message.type === 'SAVE_VOICE_MEMORY');
        if (message.type === 'SAVE_VOICE_MEMORY') {
          target.markdown = M.markdown(message.markdown); target.updatedAt = Date.now(); target.summaryRevision = target.sampleRevision;
        } else {
          const url = C.postURL(message.url), before = target.samples.length;
          target.samples = target.samples.filter(row => row.url !== url);
          if (target.samples.length === before) throw new C.ReplyError('MEMORY_SAMPLE', '这个样本已不存在，请刷新列表。');
          target.sampleRevision++; target.markdown = ''; target.updatedAt = 0; target.summaryRevision = 0; target.summarySampleCount = 0;
        }
        target.documentRevision++;
        return { profile: target };
      });
      await invalidateReplies();
      return result;
    }
    case 'OPEN_SETTINGS': await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?settings=1') }); return {};
    case 'GENERATE':
      if (type !== 'content') throw new C.ReplyError('DENIED', '请从 X 的原文页面生成回复。');
      return generate(message, sender);
    case 'CANCEL': {
      const job = jobs.get(sender.tab?.id);
      if (job?.requestId === message.requestId) job.controller.abort();
      return {};
    }
    case 'SAVE_SETTINGS': {
      if (type !== 'extension') throw new C.ReplyError('DENIED', '请通过扩展设置保存。');
      const normalized = C.settings(message.settings);
      const previous = await getSettings();
      await chrome.storage.local.set({ settings: normalized });
      if (followback) { await followback.ready; await followback.configure(previous, normalized); }
      catalogCache.clear();
      for (const job of jobs.values()) job.controller.abort();
      for (const job of voiceJobs.values()) job.controller.abort();
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED' })));
      return normalized;
    }
    case 'CHECK': {
      if (type !== 'extension') throw new C.ReplyError('DENIED', '请通过扩展设置检测连接。');
      const options = C.settings({ ...(await getSettings()), port: message.port });
      const info = await catalog(options, true);
      const chosen = C.chooseModel(info.models, info.models.some(m => m.id === options.model) ? options.model : '');
      return { version: info.version, models: info.models, selected: chosen.id };
    }
    case 'CLEAR_CACHE':
      if (type !== 'extension') throw new C.ReplyError('DENIED', '请通过扩展设置清除缓存。');
      await chrome.storage.session.remove('replyCache'); return {};
    default: throw new C.ReplyError('REQUEST', '未知操作。');
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  dispatch(message, sender).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: friendly(error) }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => { jobs.get(tabId)?.controller.abort(); });
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
