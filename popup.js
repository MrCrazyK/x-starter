'use strict';
const $ = id => document.getElementById(id);
let current;
let followbackState = null, followbackBusy = false, followbackRefreshing = false;
let priorityRefreshing = false;
let autoFollowState = null, autoFollowRefreshing = false, autoFollowBusy = false;
const fullSettings = new URLSearchParams(location.search).has('settings');
document.body.classList.toggle('full-settings', fullSettings);
if (fullSettings) document.title = '提示词与上下文设置 · X-starter';
for (const [index] of MagpieReply.STYLES.entries()) {
  const card = document.createElement('section'); card.className = 'preference-card';
  const title = document.createElement('h3'); title.textContent = `候选 ${index + 1}`;
  const nameLabel = document.createElement('label'); nameLabel.htmlFor = `preference-label-${index}`; nameLabel.textContent = '名称';
  const name = document.createElement('input'); name.id = nameLabel.htmlFor; name.type = 'text'; name.maxLength = 24; name.required = true;
  const promptLabel = document.createElement('label'); promptLabel.htmlFor = `preference-prompt-${index}`; promptLabel.textContent = '这一条的写作要求';
  const prompt = document.createElement('textarea'); prompt.id = promptLabel.htmlFor; prompt.rows = 5; prompt.maxLength = 1500; prompt.required = true;
  card.append(title, nameLabel, name, promptLabel, prompt); $('candidate-preferences').append(card);
}
function setPromptFields(options) {
  $('conversational').checked = options.conversational;
  $('tone').value = options.tone; $('strict-rules').value = options.strictRules;
  $('max-chars').value = options.maxChars; $('banned-terms').value = options.bannedTerms.join('\n');
  options.candidatePreferences.forEach((preference, index) => { $(`preference-label-${index}`).value = preference.label; $(`preference-prompt-${index}`).value = preference.prompt; });
}
async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error?.message || '扩展未就绪，请重新加载扩展。');
  return response.data;
}
function feedback(message, error = false) { $('feedback').textContent = message; $('feedback').classList.toggle('error', error); }
function updateAutoNotice() {
  $('auto-generate-warning').textContent = MagpieReply.AUTO_GENERATE_NOTICE;
  $('auto-generate-warning').hidden = !$('auto-generate').checked;
}
$('auto-generate').addEventListener('change', updateAutoNotice);
function updateProfileNotice() {
  $('profile-gap-threshold').disabled = !$('profile-highlight').checked;
  const threshold = Number($('profile-gap-threshold').value);
  $('profile-formula').textContent = Number.isInteger(threshold) && threshold >= 0 && threshold <= 100
    ? `关注数 ≤ 粉丝数 × ${100 - threshold}% 时标记，包含刚好少 ${threshold}%。` : '请输入 0–100 的整数百分比。';
}
$('profile-highlight').addEventListener('change', updateProfileNotice);
$('profile-gap-threshold').addEventListener('input', updateProfileNotice);
async function check() {
  $('check').disabled = true;
  $('connection-label').textContent = '正在检测 Magpie';
  $('connection-dot').className = 'dot';
  try {
    const options = MagpieReply.settings({ ...current, port: $('port').value });
    const info = await send({ type: 'CHECK', port: options.port });
    const selected = $('model').value;
    $('model').replaceChildren(new Option('自动选择（优先路由组）', ''));
    for (const m of info.models) $('model').add(new Option(`${m.name} · ${m.id}`, m.id));
    if (selected && !info.models.some(m => m.id === selected)) {
      $('model').add(new Option(`已不可用：${selected}`, selected));
      feedback('之前的模型已不在列表中，请选择其他模型并保存。', true);
    }
    $('model').value = selected;
    $('connection-dot').className = 'dot good';
    $('connection-label').textContent = `Magpie ${info.version} 已连接`;
    $('connection-detail').textContent = `${info.models.length} 个文字模型可用。自动模式使用 ${info.models.find(m => m.id === info.selected)?.name || info.selected}。`;
  } catch (error) {
    $('connection-dot').className = 'dot bad';
    $('connection-label').textContent = '尚未连接 Magpie';
    $('connection-detail').textContent = error.message;
  } finally { $('check').disabled = false; }
}
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); $('save').disabled = true;
  feedback('正在保存…');
  try {
    const latest = await send({ type: 'GET_SETTINGS' });
    current = await send({ type: 'SAVE_SETTINGS', settings: {
      ...latest, port: $('port').value, model: $('model').value, language: $('language').value,
      length: $('length').value, autoGenerate: $('auto-generate').checked, conversational: $('conversational').checked,
      autoGenerateNoticeVersion: $('auto-generate').checked ? MagpieReply.AUTO_GENERATE_NOTICE_VERSION : latest.autoGenerateNoticeVersion,
      contextEnabled: $('context-enabled').checked, contextLimit: $('context-limit').value,
      profileHighlightEnabled: $('profile-highlight').checked, profileGapThreshold: $('profile-gap-threshold').value,
      profilePriorityEnabled: $('profile-priority').checked,
      timelinePriorityEnabled: $('timeline-priority').checked,
      followbackEnabled: $('followback-enabled').checked, followbackAccount: $('followback-account').value,
      autoFollowEnabled: $('autofollow-enabled').checked, autoFollowAccount: $('autofollow-account').value,
      autoFollowInterval: $('autofollow-interval').value, autoFollowPerRound: $('autofollow-round').value, autoFollowDaily: $('autofollow-daily').value,
      ...(fullSettings ? {
        collectWritingSamples: $('collect-writing').checked, useVoiceMemory: $('use-voice-memory').checked,
        tone: $('tone').value, strictRules: $('strict-rules').value, maxChars: $('max-chars').value, bannedTerms: $('banned-terms').value,
        candidatePreferences: MagpieReply.STYLES.map((_, index) => ({ label: $(`preference-label-${index}`).value, prompt: $(`preference-prompt-${index}`).value }))
      } : {})
    } });
    feedback('已保存，当前 X 页面会立即使用新设置。');
    await refreshFollowback();
    await refreshPriority();
    await refreshAutoFollow();
    await check();
  } catch (error) { feedback(error.message, true); }
  finally { $('save').disabled = false; }
});
$('check').addEventListener('click', check);
$('open-full-settings').addEventListener('click', async () => {
  try { await send({ type: 'OPEN_SETTINGS' }); window.close(); }
  catch (error) { feedback(error.message, true); }
});
$('restore-prompts').addEventListener('click', () => { setPromptFields(MagpieReply.settings()); feedback('已恢复默认提示词，保存后生效。'); });
$('clear-cache').addEventListener('click', async () => {
  try { await send({ type: 'CLEAR_CACHE' }); feedback('已清除本次浏览器会话的候选缓存。'); }
  catch (error) { feedback(error.message, true); }
});
$('open-panel').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('请先打开一个 X 标签页。');
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_PANEL' });
    if (!response?.ok) throw new Error(response?.error || '请先打开推文或文章详情。');
    window.close();
  } catch { feedback('请先打开 X 的推文详情；若刚安装扩展，请刷新 X 页面。', true); }
});
(async () => {
  try {
    current = await send({ type: 'GET_SETTINGS' });
    if (!Array.isArray(current.candidatePreferences) || typeof current.conversational !== 'boolean' || typeof current.autoGenerateNoticeVersion !== 'number' || typeof current.collectWritingSamples !== 'boolean' || typeof current.profileHighlightEnabled !== 'boolean' || typeof current.timelinePriorityEnabled !== 'boolean' || typeof current.autoFollowEnabled !== 'boolean') throw new Error('扩展后台仍在运行旧版。请在扩展管理页点击「重新加载」，再刷新 X 和设置页面。');
    $('port').value = current.port; $('language').value = current.language;
    $('length').value = current.length; $('auto-generate').checked = current.autoGenerate;
    updateAutoNotice();
    $('context-enabled').checked = current.contextEnabled; $('context-limit').value = current.contextLimit;
    setPromptFields(current);
    $('collect-writing').checked = current.collectWritingSamples; $('use-voice-memory').checked = current.useVoiceMemory;
    $('profile-highlight').checked = current.profileHighlightEnabled; $('profile-gap-threshold').value = current.profileGapThreshold; updateProfileNotice();
    $('profile-priority').checked = current.profilePriorityEnabled;
    $('timeline-priority').checked = current.timelinePriorityEnabled;
    $('followback-enabled').checked = current.followbackEnabled; $('followback-account').value = current.followbackAccount;
    $('autofollow-enabled').checked = current.autoFollowEnabled; $('autofollow-account').value = current.autoFollowAccount;
    $('autofollow-interval').value = current.autoFollowInterval; $('autofollow-round').value = current.autoFollowPerRound; $('autofollow-daily').value = current.autoFollowDaily;
    await refreshFollowback();
    await refreshPriority();
    await refreshAutoFollow();
    if (current.model) { $('model').add(new Option(current.model, current.model)); $('model').value = current.model; }
    $('save').disabled = false;
    await check();
    if (fullSettings) await refreshMemory();
  } catch (error) { feedback(error.message, true); }
})();

async function refreshPriority() {
  if (priorityRefreshing) return;
  priorityRefreshing = true;
  try {
    const value = await send({ type: 'PRIORITY_STATUS' });
    $('priority-status').textContent = `${value.enabled ? '已开启' : '未开启'} · 已缓存 ${value.cached || 0} 位${value.busy ? ' · 正在读取资料' : ''}${value.pending ? ` · 等待 ${value.pending} 位` : ''}${value.pausedUntil > Date.now() ? `。${value.notice} 处理后可清除缓存重试。` : ''}`;
  } catch (error) { $('priority-status').textContent = error.message; }
  finally { priorityRefreshing = false; }
}
$('clear-priority-cache').addEventListener('click', async () => {
  $('clear-priority-cache').disabled = true;
  try { await send({ type: 'CLEAR_PRIORITY_CACHE' }); await refreshPriority(); }
  catch (error) { $('priority-status').textContent = error.message; }
  finally { $('clear-priority-cache').disabled = false; }
});

function updateAutoFollowButtons() {
  const value = autoFollowState, busy = autoFollowBusy || value?.busy;
  $('autofollow-pause').disabled = autoFollowBusy || !value?.enabled || value.paused;
  $('autofollow-resume').disabled = busy || !value?.enabled || !value.paused;
  $('autofollow-refresh').disabled = autoFollowBusy;
  for (const button of $('autofollow-queue').querySelectorAll('button')) button.disabled = busy;
}
function renderAutoFollow(value) {
  autoFollowState = value;
  $('autofollow-status').textContent = value.notice || (value.enabled ? '已启用，等待整理候选。' : '尚未启用。勾选、绑定账号并保存后才执行自动关注。');
  $('autofollow-status').classList.toggle('error', value.paused);
  const next = value.enabled && value.nextAt && !value.paused ? new Date(value.nextAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
  $('autofollow-meta').textContent = `${value.account ? `@${value.account} · ` : ''}本轮 ${value.roundUsed}/${value.perRound} · 今日 ${value.dayUsed}/${value.daily} · 队列 ${value.queue.length}/20${value.busy ? ' · 正在处理' : ''}${value.paused ? ' · 已暂停' : ''} · 下次 ${next}（北京时间）`;
  $('autofollow-queue-label').textContent = `候选队列 · ${value.queue.length}/20`;
  $('autofollow-queue').replaceChildren();
  for (const row of value.queue) {
    const card = document.createElement('article'); card.className = 'autofollow-item';
    const link = document.createElement('a'); link.href = `https://x.com/${row.account}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `${row.name || row.account} · @${row.account}`;
    const info = document.createElement('p'); info.textContent = row.source === 'followers' ? '优先 · 蓝 V 粉丝，执行前复查关系' : '搜索“蓝v互关” · 执行前核验关注数与粉丝数';
    const ignore = document.createElement('button'); ignore.type = 'button'; ignore.className = 'text-button'; ignore.textContent = '移除并忽略';
    ignore.addEventListener('click', () => void autoFollowAction({ type: 'AUTOFOLLOW_IGNORE', account: row.account }));
    card.append(link, info, ignore); $('autofollow-queue').append(card);
  }
  $('autofollow-history').replaceChildren();
  for (const row of value.history) {
    const card = document.createElement('article'); card.className = 'autofollow-item';
    const link = document.createElement('a'); link.href = `https://x.com/${row.account}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `@${row.account}`;
    const info = document.createElement('p'), state = { followed: '已关注', requested: '已发送申请', already: '已经关注或申请', skipped: '已跳过', uncertain: '结果待核实', interrupted: '中断，待核实' }[row.status] || '已处理';
    info.textContent = `${new Date(row.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} · ${state}${row.reason ? ` · ${row.reason}` : ''}`;
    card.append(link, info); $('autofollow-history').append(card);
  }
  if (!value.history.length) { const empty = document.createElement('p'); empty.className = 'field-help'; empty.textContent = '还没有执行记录。'; $('autofollow-history').append(empty); }
  updateAutoFollowButtons();
}
async function refreshAutoFollow() {
  if (autoFollowRefreshing) return;
  autoFollowRefreshing = true;
  try { renderAutoFollow(await send({ type: 'AUTOFOLLOW_STATUS' })); }
  catch (error) { $('autofollow-status').textContent = error.message; }
  finally { autoFollowRefreshing = false; }
}
async function autoFollowAction(message) {
  if (autoFollowBusy) return;
  autoFollowBusy = true; updateAutoFollowButtons();
  try { renderAutoFollow(await send(message)); }
  catch (error) { $('autofollow-status').textContent = error.message; }
  finally { autoFollowBusy = false; updateAutoFollowButtons(); }
}
$('autofollow-pause').addEventListener('click', () => void autoFollowAction({ type: 'AUTOFOLLOW_PAUSE' }));
$('autofollow-resume').addEventListener('click', () => void autoFollowAction({ type: 'AUTOFOLLOW_RESUME' }));
$('autofollow-refresh').addEventListener('click', () => void refreshAutoFollow());
$('autofollow-identify').addEventListener('click', async () => {
  try { const result = await send({ type: 'FOLLOWBACK_IDENTIFY' }); $('autofollow-account').value = result.account; $('autofollow-status').textContent = `已识别 @${result.account}，保存后绑定此账号。`; }
  catch (error) { $('autofollow-status').textContent = error.message; }
});

function updateFollowbackButtons() {
  const value = followbackState, busy = followbackBusy || value?.busy;
  $('followback-check').disabled = busy || !value?.enabled;
  $('followback-identify').disabled = busy;
  for (const button of $('followback-list').querySelectorAll('.followback-confirm')) {
    const seconds = Math.max(0, Math.ceil(((value?.nextAllowedAt || 0) - Date.now()) / 1000));
    button.disabled = busy || !value?.enabled || value.paused || value.automaticLocked || button.dataset.status !== 'pending' || value.confirmed >= 5 || seconds > 0;
    button.textContent = button.dataset.status === 'pending' ? seconds > 0 ? `等待 ${seconds} 秒` : '确认回关' : ({ followed: '已回关', requested: '已发送请求', uncertain: '请手动核实', confirming: '正在确认' }[button.dataset.status] || '已处理');
  }
  for (const button of $('followback-list').querySelectorAll('.followback-ignore')) button.disabled = busy;
}
function renderFollowback(value) {
  followbackState = value;
  $('followback-status').textContent = value.notice || (value.enabled ? '已启用，等待首次检查。' : '尚未启用，勾选并保存后开始整理名单。');
  $('followback-status').classList.toggle('error', value.paused);
  const last = value.checkedAt ? new Date(value.checkedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '尚未检查';
  const next = value.enabled && value.nextAt && !value.paused ? new Date(value.nextAt).toLocaleTimeString('zh-CN', { hour12: false }) : '—';
  $('followback-meta').textContent = `${value.account ? `@${value.account} · ` : ''}上次 ${last} · 下次 ${next} · 本轮已确认 ${value.confirmed}/5${value.paused ? ' · 已暂停，处理后点立即检查继续' : ''}${value.automaticLocked ? ' · 此账号已开启自动关注，手动回关暂不可用' : ''}`;
  $('followback-list').replaceChildren();
  for (const row of value.items) {
    const card = document.createElement('article'); card.className = 'followback-item'; card.dataset.account = row.account;
    const link = document.createElement('a'); link.href = row.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = row.name || `@${row.account}`;
    const handle = document.createElement('p'); handle.textContent = `@${row.account}`;
    const actions = document.createElement('div'); actions.className = 'followback-item-actions';
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'secondary followback-confirm'; confirm.dataset.status = row.status; confirm.setAttribute('aria-label', `确认回关 @${row.account}`);
    confirm.addEventListener('click', () => void followbackAction({ type: 'FOLLOWBACK_CONFIRM', account: row.account }));
    const ignore = document.createElement('button'); ignore.type = 'button'; ignore.className = 'text-button followback-ignore'; ignore.textContent = '忽略';
    ignore.addEventListener('click', () => void followbackAction({ type: 'FOLLOWBACK_IGNORE', account: row.account }));
    actions.append(confirm, ignore); card.append(link, handle, actions); $('followback-list').append(card);
  }
  updateFollowbackButtons();
}
async function refreshFollowback() {
  if (followbackRefreshing) return;
  followbackRefreshing = true;
  try { renderFollowback(await send({ type: 'FOLLOWBACK_STATUS' })); }
  catch (error) { $('followback-status').textContent = error.message; }
  finally { followbackRefreshing = false; }
}
async function followbackAction(message) {
  if (followbackBusy) return;
  followbackBusy = true; updateFollowbackButtons();
  $('followback-status').textContent = message.type === 'FOLLOWBACK_CONFIRM' ? `正在确认 @${message.account}，请稍候…` : '正在整理粉丝列表…';
  try { await send(message); await refreshFollowback(); }
  catch (error) { await refreshFollowback(); $('followback-status').textContent = error.message; }
  finally { followbackBusy = false; updateFollowbackButtons(); }
}
$('followback-check').addEventListener('click', () => void followbackAction({ type: 'FOLLOWBACK_CHECK' }));
$('followback-refresh').addEventListener('click', () => void refreshFollowback());
$('followback-identify').addEventListener('click', async () => {
  try { const result = await send({ type: 'FOLLOWBACK_IDENTIFY' }); $('followback-account').value = result.account; $('followback-status').textContent = `已识别 @${result.account}，保存后绑定此账号。`; }
  catch (error) { $('followback-status').textContent = error.message; }
});
const followbackPoll = setInterval(() => { if (!document.hidden && !followbackBusy) { void refreshFollowback(); void refreshPriority(); void refreshAutoFollow(); } }, 5000);
const followbackCountdown = setInterval(updateFollowbackButtons, 1000);
window.addEventListener('pagehide', () => { clearInterval(followbackPoll); clearInterval(followbackCountdown); });

let memoryProfile = null, memoryBusy = false;
function memoryFeedback(message, error = false) { $('memory-feedback').textContent = message; $('memory-feedback').classList.toggle('error', error); }
function memoryButtons() {
  $('memory-account').disabled = memoryBusy || !$('memory-account').value;
  $('memory-markdown').disabled = memoryBusy || !memoryProfile;
  $('memory-refresh').disabled = memoryBusy;
  $('memory-update').disabled = memoryBusy || !memoryProfile?.samples.length;
  $('memory-export').disabled = memoryBusy || !memoryProfile || !$('memory-markdown').value.trim();
  $('memory-save').disabled = memoryBusy || !memoryProfile;
  $('memory-clear').disabled = memoryBusy || !memoryProfile;
  for (const button of $('memory-samples').querySelectorAll('button')) button.disabled = memoryBusy;
  $('memory-update').textContent = memoryBusy ? '正在处理…' : '更新语气记忆';
}
async function refreshMemory(account = $('memory-account').value) {
  const info = await send({ type: 'GET_VOICE_MEMORY', account });
  memoryProfile = info.profile;
  $('memory-account').replaceChildren(...info.accounts.map(row => new Option(`@${row.account} · ${row.count} 条样本`, row.account)));
  if (!info.accounts.length) { memoryProfile = null; $('memory-account').add(new Option('尚未收集到手写内容', '')); }
  if (memoryProfile) $('memory-account').value = memoryProfile.account;
  $('memory-markdown').value = memoryProfile?.markdown || '';
  $('memory-meta').textContent = memoryProfile
    ? `${memoryProfile.samples.length} 条本地手写样本。${memoryProfile.markdown ? `总结更新于 ${new Date(memoryProfile.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}。${memoryProfile.sampleRevision > memoryProfile.summaryRevision ? '有新样本尚未总结。' : ''}` : '还没有语气总结，点击下方按钮更新。'}`
    : '先在 X 手写并发布一条帖子或回复，再点刷新样本。';
  $('memory-samples').replaceChildren();
  for (const row of memoryProfile?.samples || []) {
    const card = document.createElement('article'); card.className = 'writing-sample';
    const header = document.createElement('header'), link = document.createElement('a');
    link.href = row.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `${row.kind === 'reply' ? '回复' : '帖子'} · ${new Date(row.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })} ↗`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button danger'; remove.textContent = '删除';
    remove.addEventListener('click', () => void memoryAction(async () => {
      const account = memoryProfile.account;
      await send({ type: 'DELETE_WRITING_SAMPLE', account, url: row.url }); await refreshMemory(account);
      memoryFeedback('样本已删除，原总结已清空。可手动更新语气记忆。');
    }));
    const text = document.createElement('p'); text.textContent = row.text;
    header.append(link, remove); card.append(header, text); $('memory-samples').append(card);
  }
  memoryButtons();
}
async function memoryAction(action) {
  if (memoryBusy) return;
  memoryBusy = true; memoryButtons();
  try { await action(); }
  catch (error) { memoryFeedback(error.message, true); }
  finally { memoryBusy = false; memoryButtons(); }
}
$('memory-refresh').addEventListener('click', () => void memoryAction(async () => { await refreshMemory(); memoryFeedback('已刷新本地手写样本。'); }));
$('memory-account').addEventListener('change', () => void memoryAction(async () => { await refreshMemory(); memoryFeedback(''); }));
$('memory-markdown').addEventListener('input', memoryButtons);
$('memory-update').addEventListener('click', () => void memoryAction(async () => {
  if (!memoryProfile) return;
  const account = memoryProfile.account;
  memoryFeedback('正在用已保存的回复模型整理语气，最长等待 90 秒…');
  const result = await send({ type: 'SUMMARIZE_VOICE_MEMORY', account });
  await refreshMemory(account); memoryFeedback(`语气记忆已更新。模型：${result.model}。`);
}));
$('memory-save').addEventListener('click', () => void memoryAction(async () => {
  if (!memoryProfile) return;
  const account = memoryProfile.account;
  await send({ type: 'SAVE_VOICE_MEMORY', account, markdown: $('memory-markdown').value });
  await refreshMemory(account); memoryFeedback('语气记忆已保存。');
}));
$('memory-clear').addEventListener('click', () => void memoryAction(async () => {
  if (!memoryProfile || !window.confirm(`清空 @${memoryProfile.account} 的所有手写样本和语气记忆？`)) return;
  await send({ type: 'CLEAR_VOICE_MEMORY', account: memoryProfile.account });
  await refreshMemory(''); memoryFeedback('这个账号的语气记忆与手写样本已清空。');
}));
$('memory-export').addEventListener('click', () => {
  if (!memoryProfile) return;
  try {
    const value = MagpieMemory.document(memoryProfile.account, $('memory-markdown').value, memoryProfile.samples.length);
    const url = URL.createObjectURL(new Blob([value], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `x-voice-${memoryProfile.account}.md`; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); memoryFeedback('已导出 Markdown。');
  } catch (error) { memoryFeedback(error.message, true); }
});
