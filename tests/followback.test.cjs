const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const folder=path.resolve(__dirname,'..');
async function harness(options={}){
 let clock=1000000,settings={followbackEnabled:false,followbackAccount:'writer'},alarm,alarmHandler,id=0;
 const local={followbackState:options.initial},tabs=new Map(),actions=[],closed=[];
 const sandbox=vm.createContext({URL,crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,console,chrome:{
  storage:{local:{get:async key=>({[key]:local[key]}),set:async values=>Object.assign(local,values)}},
  alarms:{get:async()=>alarm,create:async(name,value)=>{alarm={name,...value,scheduledTime:value.when}},clear:async()=>{alarm=null},onAlarm:{addListener:fn=>alarmHandler=fn}},
  tabs:{create:async input=>{const tab={id:++id,...input};tabs.set(id,tab);return tab},get:async id=>tabs.get(id),remove:async id=>{closed.push(id);tabs.delete(id)},query:async()=>[],sendMessage:async(id,message)=>{
   if(message.type==='FOLLOWBACK_ACCOUNT')return{ok:true,data:{account:'writer'}};
   if(message.type==='FOLLOWBACK_CANCEL_PAGE')return{ok:true,data:{}};
   actions.push(message);
   if(options.respond)return options.respond(message);
   return message.type==='FOLLOWBACK_SCAN_PAGE'?{ok:true,data:{account:'writer',items:Array.from({length:7},(_,i)=>({account:'person'+i,name:'Person '+i})),scanned:12,partial:true}}:{ok:true,data:{status:'followed',clicked:true}};
  }}
 }});
 for(const file of ['shared.js','followback.js','followback-background.js'])vm.runInContext(fs.readFileSync(path.join(folder,file),'utf8'),sandbox);
 const manager=sandbox.MagpieFollowbackBackground.create({getSettings:async()=>settings,onFollow:options.onFollow,now:()=>clock});await manager.ready;
 return{manager,local,actions,tabs,closed,alarm:()=>alarm,advance:ms=>clock+=ms,F:sandbox.MagpieFollowback,C:sandbox.MagpieReply,
  enable:async(value=true,account='writer')=>{const prev=settings;settings={followbackEnabled:value,followbackAccount:account};await manager.configure(prev,settings)},automatic:(value=true,account='writer')=>{settings={...settings,autoFollowEnabled:value,autoFollowAccount:account}},fire:()=>alarmHandler({name:'magpie-followback-scan'})};
}
test('new and migrated settings keep scheduled follow-back reads off until an account is explicitly bound',async()=>{
 const h=await harness();assert.equal(h.C.settings().followbackEnabled,false);assert.equal(h.alarm(),null);
 assert.throws(()=>h.C.settings({followbackEnabled:true}),{code:'PREFERENCES'});
 assert.equal(h.C.settings({followbackAccount:'@Writer',followbackEnabled:true}).followbackAccount,'writer');
 assert.equal(h.F.account('../other'),'');assert.equal(h.F.item({account:'x',url:'javascript:alert(1)'}).url,'https://x.com/x');
});
test('enabling schedules a thirty-minute alarm and scans existing followers without ever following automatically',async()=>{
 const h=await harness();await h.enable();assert.equal(h.alarm().periodInMinutes,30);
 const result=await h.manager.scan();assert.equal(result.items.length,5);assert.equal(result.scanned,12);assert.equal(result.partial,true);assert.equal(result.busy,false);
 assert.deepEqual(h.actions.map(row=>row.type),['FOLLOWBACK_SCAN_PAGE']);assert.equal(h.tabs.size,0);
});
test('the alarm callback can only refresh the list and never dispatches a follow confirmation',async()=>{
 const h=await harness();await h.enable();h.fire();
 for(let i=0;i<30&&!h.local.followbackState.checkedAt;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.actions.filter(row=>row.type==='FOLLOWBACK_CONFIRM_PAGE').length,0);assert.equal(h.local.followbackState.items.length,5);
});
test('per-person confirmation, persisted ten-second spacing and five-person round limit are enforced in the background',async()=>{
 const h=await harness();await h.enable();await h.manager.scan();
 await assert.rejects(h.manager.confirm('someoneelse'),{code:'FOLLOWBACK_STALE'});
 await h.manager.confirm('person0');await assert.rejects(h.manager.confirm('person0'),{code:'FOLLOWBACK_STALE'});
 await assert.rejects(h.manager.confirm('person1'),{code:'FOLLOWBACK_COOLDOWN'});
 for(let i=1;i<5;i++){h.advance(10000);await h.manager.confirm('person'+i)}
 assert.equal((await h.manager.status()).confirmed,5);h.advance(10000);await h.manager.scan();
 await assert.rejects(h.manager.confirm('person0'),{code:'FOLLOWBACK_LIMIT'});
 assert.equal(h.actions.filter(row=>row.type==='FOLLOWBACK_CONFIRM_PAGE').length,5);
 h.advance(30*60*1000);await h.manager.confirm('person0');assert.equal((await h.manager.status()).confirmed,1);
});
test('duplicate confirmations are rejected while the first person is in progress',async()=>{
 let resolve;const h=await harness({respond:message=>message.type==='FOLLOWBACK_SCAN_PAGE'?{ok:true,data:{account:'writer',items:[{account:'person0'}]}}:new Promise(done=>resolve=done)});
 await h.enable();await h.manager.scan();const task=h.manager.confirm('person0');
 for(let i=0;i<30&&!resolve;i++)await new Promise(done=>setImmediate(done));
 await assert.rejects(h.manager.confirm('person0'),{code:'FOLLOWBACK_BUSY'});resolve({ok:true,data:{status:'followed',clicked:true}});await task;
 assert.equal(h.actions.filter(row=>row.type==='FOLLOWBACK_CONFIRM_PAGE').length,1);
});
test('a lost follow response is never resent and its result remains uncertain',async()=>{
 const h=await harness({respond:message=>{if(message.type==='FOLLOWBACK_SCAN_PAGE')return{ok:true,data:{account:'writer',items:[{account:'person0'}]}};throw new Error('message port closed')}});
 await h.enable();await h.manager.scan();await assert.rejects(h.manager.confirm('person0'));
 const value=await h.manager.status();assert.equal(value.items[0].status,'uncertain');assert.equal(value.confirmed,1);
 await assert.rejects(h.manager.confirm('person0'),{code:'FOLLOWBACK_STALE'});assert.equal(h.actions.filter(row=>row.type==='FOLLOWBACK_CONFIRM_PAGE').length,1);
});
test('account mismatch and X restrictions pause future timer reads until an explicit manual check',async()=>{
 const h=await harness({respond:()=>({ok:false,error:{code:'FOLLOWBACK_BLOCKED',message:'X requires verification',clicked:false}})});
 await h.enable();await assert.rejects(h.manager.scan(),{code:'FOLLOWBACK_BLOCKED'});assert.equal((await h.manager.status()).paused,true);
 const before=h.actions.length;await h.manager.scan();assert.equal(h.actions.length,before);
 await assert.rejects(h.manager.scan(true),{code:'FOLLOWBACK_BLOCKED'});assert.equal(h.actions.length,before+1);
});
test('disabling clears the alarm and no further read or follow can run',async()=>{
 const h=await harness();await h.enable();await h.manager.scan();await h.enable(false);assert.equal(h.alarm(),null);
 const before=h.actions.length;await h.manager.scan();await assert.rejects(h.manager.confirm('person0'),{code:'FOLLOWBACK_CANCELLED'});assert.equal(h.actions.length,before);
});
test('ignores persist, account changes cannot reuse old candidates, and interrupted confirmation needs manual verification',async()=>{
 const h=await harness();await h.enable();await h.manager.scan();await h.manager.ignore('person0');await h.manager.scan();
 assert.equal((await h.manager.status()).items.some(row=>row.account==='person0'),false);
 await h.enable(true,'other');assert.equal((await h.manager.status()).items.length,0);
 const resumed=await harness({initial:{account:'writer',items:[{account:'person0',status:'confirming'}]}});
 assert.equal((await resumed.manager.status()).items[0].status,'uncertain');
 assert.equal((await resumed.manager.status()).confirmed,1);
 assert.ok((await resumed.manager.status()).nextAllowedAt >= 1010000);
});
test('the same account cannot manually confirm a follow while automatic following is enabled',async()=>{
 const h=await harness();await h.enable();await h.manager.scan();h.automatic();
 assert.equal((await h.manager.status()).automaticLocked,true);
 await assert.rejects(h.manager.confirm('person0'),{code:'FOLLOWBACK_BUSY'});assert.equal(h.actions.filter(row=>row.type==='FOLLOWBACK_CONFIRM_PAGE').length,0);
 h.automatic(false);await h.manager.confirm('person0');assert.equal((await h.manager.status()).items[0].status,'followed');
});
test('manual confirmation emits +1 only for an actual successful click, not an existing relationship',async()=>{
 const events=[],h=await harness({onFollow:event=>events.push(event)});await h.enable();await h.manager.scan();await h.manager.confirm('person0');
 assert.equal(events.length,1);assert.equal(events[0].source,'manual');assert.equal(events[0].target,'person0');
 const existing=await harness({onFollow:event=>events.push(event),respond:message=>message.type==='FOLLOWBACK_SCAN_PAGE'?{ok:true,data:{account:'writer',items:[{account:'person0'}]}}:{ok:true,data:{status:'followed',clicked:false}}});
 await existing.enable();await existing.manager.scan();await existing.manager.confirm('person0');assert.equal(events.length,1);
});
