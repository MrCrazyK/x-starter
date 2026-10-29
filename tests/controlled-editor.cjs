'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), extension = root;
const testOutput = path.join(root, '.test-output'); fs.mkdirSync(testOutput, { recursive: true });
const evidence = {checks: [], pageErrors: [], editor: 'Draft.js 0.11.7 / React 17.0.2', requests: 0};
const replies = ['先把标准讲明白呗🙂\n\n少走弯路。\n哈哈，哈哈。', '这代码比需求跑得还快。', '标准都没有，怎么验收？', '先确认要解决什么，再选工具。'];
const assets = ['react/umd/react.development.js', 'react-dom/umd/react-dom.development.js', 'immutable/dist/immutable.js', 'draft-js/dist/Draft.js', 'draft-js/dist/Draft.css'];
function fixture() { return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>单次填入 · 本地 Draft.js 测试</title><link rel="stylesheet" href="/__fixture/4"><style>body{font:15px/1.7 sans-serif;margin:40px;background:#edf3f3}main{width:580px}article,.DraftEditor-root{padding:18px;background:white;border:1px solid #a9bcbc;margin:20px 0}.DraftEditor-root{min-height:130px}[contenteditable]{min-height:100px;outline:none}button{padding:8px}#publish{margin-top:15px}</style><nav><a href="/testwriter" data-testid="AppTabBar_Profile_Link">@testwriter</a></nav><main><article data-testid="tweet"><div data-testid="User-Name">测试作者 @alpha</div><a href="/alpha/status/111"><time datetime="2026-10-29T00:00:00Z">今天</time></a><p data-testid="tweetText">先把需求说清楚，再让工具写代码。</p><div role="group"><button data-testid="reply">X 回复</button></div></article><div id="mount"></div></main>${assets.slice(0,4).map((_,i)=>`<script src="/__fixture/${i}"></script>`).join('')}<script>
window.stats={pastes:0,inputs:0,commands:0,published:0};window.mode='normal';
const originalCommand=document.execCommand.bind(document);document.execCommand=(...args)=>{stats.commands++;return originalCommand(...args)};
function App(){
 const [state,setState]=React.useState(Draft.EditorState.createEmpty());
 window.model=()=>state.getCurrentContent().getPlainText('\\n');
 window.reset=text=>setState(Draft.EditorState.moveFocusToEnd(Draft.EditorState.createWithContent(Draft.ContentState.createFromText(text))));
 React.useLayoutEffect(()=>{document.querySelector('[contenteditable]').dataset.testid='tweetTextarea_0'});
 const change=next=>{if(mode==='slow'&&next.getCurrentContent()!==state.getCurrentContent())setTimeout(()=>setState(next),100);else setState(next)};
 return React.createElement(React.Fragment,null,React.createElement(Draft.Editor,{editorState:state,onChange:change,handlePastedText:()=>mode==='ignore'?'handled':'not-handled'}),React.createElement('button',{id:'publish','data-testid':'tweetButtonInline',disabled:!state.getCurrentContent().hasText(),onClick:()=>stats.published++},'发布'));
}
ReactDOM.render(React.createElement(App),document.getElementById('mount'));
document.addEventListener('paste',e=>{if(e.target.closest('[contenteditable]'))stats.pastes++},true);
document.addEventListener('input',e=>{if(e.target.closest('[contenteditable]'))stats.inputs++},true);
</script></html>`; }
const server = http.createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');
 if(req.url==='/api/hello'){res.end(JSON.stringify({name:'magpie',version:'controlled-editor-test'}));return}
 if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'group/fixture'}]}));return}
 if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return}
 for await(const unused of req){} evidence.requests++;
 res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify({replies:replies.map(text=>({text}))})}}]})+'\n\ndata: [DONE]\n\n');
});
async function step(name,fn){await fn();evidence.checks.push({name,pass:true});console.log('PASS '+name)}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const context=await chromium.launchPersistentContext(path.join(testOutput,`browser-controlled-${Date.now()}`),{channel:process.env.BROWSER_CHANNEL || 'msedge',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1400,height:1000},timeout:25000});
 try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await worker.evaluate(port=>chrome.storage.local.set({settings:{port,autoGenerate:false}}),server.address().port);
 await context.route('https://x.com/**',route=>{
  const match=new URL(route.request().url()).pathname.match(/^\/__fixture\/(\d)$/);
  return route.fulfill(match?{contentType:match[1]==='4'?'text/css':'application/javascript',body:fs.readFileSync(path.join(process.env.DRAFT_FIXTURE_MODULES || path.join(root, 'node_modules'), assets[Number(match[1])]))}:{contentType:'text/html; charset=utf-8',body:fixture()});
 });
 const page=await context.newPage();page.on('pageerror',e=>evidence.pageErrors.push(e.message));
 const panel=page.locator('#magpie-x-reply-root');
 const settled=async()=>{try{await panel.locator('#status').filter({hasText:'已填入草稿'}).waitFor({timeout:3000})}catch(error){console.error(await page.evaluate(()=>({model:model(),stats,trace:window.trace,status:document.getElementById('magpie-x-reply-root').shadowRoot.getElementById('status').textContent})));throw error}};
 const expectModel=async text=>{await page.waitForFunction(text=>window.model()===text,text);assert.equal(await page.evaluate(()=>[...document.querySelectorAll('[contenteditable] [data-block=true]')].map(el=>el.textContent).join('\n')),text)};
 const reset=async text=>{await page.waitForFunction(()=>[...document.getElementById('magpie-x-reply-root').shadowRoot.querySelectorAll('.fill')].every(button=>!button.disabled));await page.evaluate(text=>{window.mode='normal';window.reset(text)},text);await expectModel(text);await page.locator('[contenteditable]').focus();await page.waitForTimeout(40);await expectModel(text);await panel.locator('#status').evaluate(el=>{el.textContent=''});};
 const fill=async index=>{await panel.locator('#status').evaluate(el=>{el.textContent=''});await panel.locator('.fill').nth(index).click()};
 await step('manual generation still waits for a click',async()=>{
  await page.goto('https://x.com/alpha/status/111');await page.locator('[data-magpie-action]').waitFor();await page.waitForTimeout(350);assert.equal(evidence.requests,0);
  await panel.locator('#launcher').click();await panel.locator('#generate').click();await panel.locator('.candidate').nth(3).waitFor();
  await panel.evaluate(host=>{window.trace=[];host.shadowRoot.addEventListener('click',e=>{if(e.target.matches('.fill'))trace.push({time:performance.now(),model:model(),mode,type:'click'})});new MutationObserver(()=>trace.push({time:performance.now(),status:host.shadowRoot.getElementById('status').textContent,type:'status'})).observe(host.shadowRoot.getElementById('status'),{childList:true,subtree:true})});
 });
 await step('one paste fills multiline emoji and intentional repetition once in both DOM and Draft state',async()=>{
  await fill(0);await settled();await expectModel(replies[0]);assert.deepEqual(await page.evaluate(()=>stats),{pastes:1,inputs:0,commands:0,published:0});
  await page.screenshot({path:path.join(root,'.test-output/v0.4.3-单次填入验证.png')});
 });
 await step('clicking an already filled candidate does not insert it again',async()=>{
  await fill(0);await panel.locator('#status').filter({hasText:'已经在回复框'}).waitFor();await expectModel(replies[0]);assert.equal(await page.evaluate(()=>stats.pastes),1);assert.equal(await panel.locator('#draft-confirm').isVisible(),false);
 });
 await step('rapid fill clicks share a lock and write only once',async()=>{
  await reset('');const before=await page.evaluate(()=>stats.pastes);
  await panel.evaluate(host=>{const buttons=host.shadowRoot.querySelectorAll('.fill');buttons[0].click();buttons[0].click();buttons[1].click()});
  await settled();await expectModel(replies[0]);assert.equal(await page.evaluate(()=>stats.pastes),before+1);
 });
 await step('cancel keeps a handwritten draft intact',async()=>{
  await reset('这是我自己写的。\n先留着🙂');await fill(1);await panel.locator('#draft-confirm').waitFor();await panel.locator('#keep').click();await expectModel('这是我自己写的。\n先留着🙂');
 });
 await step('append is consumed before a double click and preserves the original draft',async()=>{
  const before=await page.evaluate(()=>stats.pastes);await fill(0);await panel.locator('#draft-confirm').waitFor();
  await panel.evaluate(host=>{const button=host.shadowRoot.getElementById('append');button.click();button.click()});
  await settled();await expectModel('这是我自己写的。\n先留着🙂\n\n'+replies[0]);assert.equal(await page.evaluate(()=>stats.pastes),before+1);
 });
 await step('replace selects all Draft blocks and writes exactly one candidate',async()=>{
  await fill(1);await panel.locator('#draft-confirm').waitFor();await panel.locator('#replace').click();await settled();await expectModel(replies[1]);
 });
 await step('a draft changed while confirmation is open is preserved',async()=>{
  await fill(2);await panel.locator('#draft-confirm').waitFor();await reset('刚刚补写的内容');const before=await page.evaluate(()=>stats.pastes);
  await panel.locator('#replace').click();await panel.locator('#status').filter({hasText:'草稿已变化'}).waitFor();await expectModel('刚刚补写的内容');assert.equal(await page.evaluate(()=>stats.pastes),before);
 });
 await step('an edit during selection synchronization cancels the write',async()=>{
  await reset('');const before=await page.evaluate(()=>stats.pastes);
  await panel.evaluate(host=>{const editor=document.querySelector('[contenteditable]');editor.blur();editor.addEventListener('focus',()=>setTimeout(()=>window.reset('刚刚键入的新草稿'),10),{once:true});host.shadowRoot.querySelector('.fill').click()});
  await panel.locator('#status').filter({hasText:'草稿已变化'}).waitFor();await expectModel('刚刚键入的新草稿');assert.equal(await page.evaluate(()=>stats.pastes),before);
 });
 await step('a handled paste with no confirmed edit never falls back to a second write',async()=>{
  await reset('');await page.evaluate(()=>{window.mode='ignore'});const before=await page.evaluate(()=>stats.pastes);
  await fill(0);await panel.locator('#status').filter({hasText:'未确认填入'}).waitFor();await expectModel('');assert.equal(await page.evaluate(()=>stats.pastes),before+1);assert.equal(await page.evaluate(()=>stats.commands),0);
 });
 await step('an asynchronous Draft state update is awaited without retrying insertion',async()=>{
  await reset('');await page.evaluate(()=>{window.mode='slow'});const before=await page.evaluate(()=>stats.pastes);
  await fill(0);await settled();await expectModel(replies[0]);assert.equal(await page.evaluate(()=>stats.pastes),before+1);assert.equal(await page.evaluate(()=>stats.commands),0);
 });
 await step('switching pages before paste cancels the old target write',async()=>{
  await reset('');const before=await page.evaluate(()=>stats.pastes);
  await panel.evaluate(host=>{host.shadowRoot.querySelector('.fill').click();history.pushState({},'','/alpha/status/222')});
  await page.waitForTimeout(400);await expectModel('');assert.equal(await page.evaluate(()=>stats.pastes),before);
 });
 assert.equal(await page.evaluate(()=>stats.published),0);assert.deepEqual(evidence.pageErrors,[]);
 console.log(`Controlled editor checks passed: ${evidence.checks.length}; page errors: ${evidence.pageErrors.length}`);
 }finally{await context.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(testOutput,'controlled-editor-evidence-v043.json'),JSON.stringify(evidence,null,2))}
})().catch(e=>{console.error(e.stack);server.closeAllConnections();server.close();process.exitCode=1});
