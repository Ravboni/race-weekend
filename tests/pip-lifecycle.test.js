'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
function app() {
  const nodes = new Map();
  const node = () => ({textContent:'',hidden:false,readyState:4,paused:false,currentTime:60,
    focus(){},pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},load(){},removeAttribute(){},replaceChildren(){},
    addEventListener(){},removeEventListener(){}});
  const intervals=[];
  const window={clearTimeout(){},clearInterval(){},setTimeout(){return 1;},setInterval(fn){intervals.push(fn);return intervals.length;},localStorage:{getItem(){return null;}},RaceWeekendPip:require('../pip-platform')};
  const document={hidden:false,addEventListener(){},getElementById(id){if(!nodes.has(id)) nodes.set(id,node()); return nodes.get(id);}};
  const context={window,document,navigator:{userAgent:''},console};
  vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../app.js'),'utf8'),context);
  const state=vm.runInContext('state',context);
  return {context,state,window,nodes,intervals,run:(s)=>vm.runInContext(s,context)};
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve};}
test('late secondary manifest after close is released, not attached',async()=>{
  const a=app(), pending=deferred(),requested=deferred(),released=[];
  const pip={channelId:'1009',seq:0,loading:false,box:null};
  Object.assign(a.state,{pip,currentView:'player',lastEngine:'native',selectedItem:{id:'race'},tvCapabilities:{pip:{maxSubHeight:720}},session:{play:async()=>({drmType:'clear',manifest:'https://f1prodlive.akamaized.net/a.mpd'})},pipClient:{prepare:()=>{requested.resolve();return pending.promise;},release:id=>released.push(id)}});
  const play=a.run('startPipVideo()');await requested.promise;
  a.state.pip=null;pending.resolve({id:'late',url:'http://127.0.0.1:18741/pip/late.mpd'});await play;
  assert.deepEqual(released,['late']);assert.equal(pip.box,null);
});
test('closing while root begin is pending ends the lease and creates no heartbeat',async()=>{
  const a=app(),pending=deferred(),calls=[];
  const pip={};Object.assign(a.state,{pip,currentView:'player',tvCapabilities:{pip:{mode:'root-c9'}},pipClient:{rootCommand(action){calls.push(action);return action==='begin'?pending.promise:Promise.resolve({});}}});
  const starting=a.run('beginPipSession(state.pip)');
  a.state.pip=null;a.run('endPipSession()');pending.resolve({ready:true,active:true});
  await assert.rejects(starting,/cancelled/);await a.state.pipEnding;
  assert.deepEqual(calls,['begin','end']);assert.equal(a.intervals.length,0);assert.equal(a.state.pipRootSession,false);
});
test('failed deterministic preparation falls back to ordinary full-screen playback',async()=>{
  const a=app(),opened=[],toasts=[];
  const dash={updateSettings(){},on(){},initialize(_video,url,_auto,time){opened.push({url,time});},attachTTMLRenderingDiv(){}};
  const MediaPlayer=()=>({create:()=>dash});MediaPlayer.events={};a.window.dashjs={MediaPlayer};
  a.context.showToast=message=>toasts.push(message);
  a.run('stopPlayback=function(){}; freshPlayerVideo=function(){}; showPlayerChrome=function(){}; hidePipHint=function(){}; setView=function(v){state.currentView=v;};');
  Object.assign(a.state,{pip:{channelId:'1009',seq:0},pipCapable:true,currentView:'player',selectedItem:{id:'race'},tvCapabilities:{pip:{mode:'native',mainHeight:1080}},session:{play:async()=>({drmType:'clear',manifest:'https://f1prodlive.akamaized.net/original.mpd'})},pipClient:{prepare:async()=>{throw Error('bad manifest');},release(){}}});
  await a.run('startPlayback(state.selectedItem,{resumeAt:123})');
  assert.equal(a.state.pip,null);assert.equal(a.state.lastEngine,'dash');
  assert.deepEqual(opened,[{url:'https://f1prodlive.akamaized.net/original.mpd',time:123}]);
  assert.ok(toasts.some(t=>t.includes('Playing one feed')));
});
test('root begin is shared across overlapping starts',async()=>{
  const a=app(),pending=deferred(),calls=[];
  Object.assign(a.state,{pip:{},currentView:'player',tvCapabilities:{pip:{mode:'root-c9'}},pipClient:{rootCommand(action){calls.push(action);return pending.promise;}}});
  const first=a.run('beginPipSession(state.pip)'), second=a.run('beginPipSession(state.pip)');
  pending.resolve({ready:true,active:true});await Promise.all([first,second]);
  assert.deepEqual(calls,['begin']);assert.equal(a.intervals.length,1);
});
test('native playing events do not pause players that are already synchronized',()=>{
  const a=app(); let pauses=0;
  const sub={currentTime:600.1,pause(){pauses++;}};
  const main={currentTime:600,paused:false,pause(){pauses++;}};
  Object.assign(a.state,{pip:{box:{querySelector:()=>sub}},currentView:'player',tvCapabilities:{pip:{mode:'root-c9'}},playerLive:false});
  a.context.main=main;
  a.run('seekPipToMain(main)');
  assert.equal(pauses,0);
  assert.equal(a.state.pip.syncing,undefined);
});
test('changing the PiP feed during coordinated seek resumes the main feed',()=>{
  const a=app();
  const sub={currentTime:595,pause(){},play(){return Promise.resolve();},load(){},replaceChildren(){},addEventListener(){},removeEventListener(){}};
  const main={currentTime:600,paused:false,pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},addEventListener(){},removeEventListener(){}};
  a.nodes.set('player-video',main);
  Object.assign(a.state,{pip:{seq:0,box:{querySelector:()=>sub,remove(){}}},currentView:'player',tvCapabilities:{pip:{mode:'root-c9'}},playerLive:false});
  a.context.main=main;
  a.run('seekPipToMain(main)');assert.equal(main.paused,true);
  a.run('removePipVideo(state.pip)');assert.equal(main.paused,false);
});

test('closing while service reset is pending never begins a root lease',async()=>{
  const a=app(),pending=deferred(),calls=[];
  Object.assign(a.state,{pip:{},currentView:'player',pipServiceReset:pending.promise,tvCapabilities:{pip:{mode:'root-c9'}},pipClient:{rootCommand:async action=>{calls.push(action);return {ready:true,active:true};}}});
  const starting=a.run('beginPipSession(state.pip)');
  a.state.pip=null;pending.resolve();
  await assert.rejects(starting,/cancelled/);assert.deepEqual(calls,[]);
});

test('main API failure closes the secondary and ends the root session',async()=>{
  const a=app(),calls=[];
  a.run('stopPlayback=function(){}; freshPlayerVideo=function(){}; showPlayerChrome=function(){}; hidePipHint=function(){}; setView=function(v){state.currentView=v;};');
  Object.assign(a.state,{pip:{channelId:'1009',seq:0},pipRootSession:true,pipCapable:true,currentView:'player',selectedItem:{id:'race'},tvCapabilities:{pip:{mode:'root-c9',mainHeight:1080}},session:{play:async()=>{throw Error('upstream unavailable');}},pipClient:{rootCommand:async action=>{calls.push(action);return {};},release(){}}});
  await a.run('startPlayback(state.selectedItem,{resumeAt:123})');
  await a.state.pipEnding;
  assert.equal(a.state.pip,null);assert.equal(a.state.pipRootSession,false);assert.deepEqual(calls,['end']);
});
