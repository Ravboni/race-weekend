'use strict';
const assert = require('assert');
const test = require('node:test');
const https = require('https');
const http = require('http');
const stream = require('stream');
const EventEmitter = require('events');
const createPip = require('../service/pip-service');
const fixture = '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic" minimumUpdatePeriod="PT2S"><Period><AdaptationSet mimeType="video/mp4" codecs="avc1.640028" frameRate="50"><Representation id="small" width="1280" height="720"/><Representation id="large" width="1920" height="1080"/></AdaptationSet></Period></MPD>';
function serviceHarness() {
 const handlers = {}; const pip = createPip({appId:'app',port:18741});
 pip.register({register:(name,fn)=>{handlers[name]=fn;}}, cb=>cb(true));
 return {pip, call:(name,payload,sender='app')=>new Promise(resolve=>handlers[name]({sender,payload,respond:resolve}))};
}
function mockFetch(callback) {
 const original = https.request;
 https.request = (options, reply) => {
   const request = new EventEmitter(); request.setTimeout=()=>{}; request.destroy=()=>{};
   request.end=()=>process.nextTick(()=>{ const response=new stream.PassThrough(); const data=callback(options); response.statusCode=data.status||200; response.headers=data.headers||{}; reply(response); response.end(data.body===undefined?fixture:data.body); });
   return request;
 };
 return ()=>{https.request=original;};
}
function get(server,path) {return new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port:server.address().port,path},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body}));}).on('error',reject);});}
test('same-app authorization, fresh bounded live manifest, release and revoked route', async()=>{
 let calls=0; const restore=mockFetch(()=>{calls++;return {};}); const {pip,call}=serviceHarness(); const server=http.createServer((req,res)=>{if(!pip.handle(req,res)){res.writeHead(404);res.end();}}); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
   assert.equal((await call('pipPrepare',{url:'https://f1prodlive.akamaized.net/a.mpd',role:'sub',maxHeight:720,maxFrameRate:50},'attacker')).returnValue,false); assert.equal(calls,0);
   const prepared=await call('pipPrepare',{url:'https://f1prodlive.akamaized.net/a.mpd',role:'sub',maxHeight:720,maxFrameRate:50}); assert.equal(prepared.returnValue,true);assert.equal(prepared.height,720);
   const path=new URL(prepared.url).pathname; assert.match(path,/^\/pip\/[a-f0-9]{64}\.mpd$/);
   const result=await get(server,path);assert.equal(result.status,200);assert.doesNotMatch(result.body,/id="large"/);assert.equal(calls,2);
   assert.equal((await call('pipRelease',{id:prepared.id},'attacker')).returnValue,false); assert.equal((await get(server,path)).status,200);
   assert.equal((await call('pipRelease',{id:prepared.id})).returnValue,true);assert.equal((await get(server,path)).status,404);
 } finally {restore();await new Promise(resolve=>server.close(resolve));pip.clear();}
});
test('rejects a redirect outside the CDN allowlist, without following it',async()=>{
 let calls=0;const restore=mockFetch(()=>{calls++;return {status:302,headers:{location:'http://127.0.0.1/private'}};});const {pip,call}=serviceHarness();
 try {const result=await call('pipPrepare',{url:'https://f1prodlive.akamaized.net/a.mpd',role:'main',maxHeight:1080,maxFrameRate:50});assert.equal(result.returnValue,false);assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(result),/127\.0\.0\.1|private/);}finally{restore();pip.clear();}
});
test('releaseAll invalidates a pending prepare and rejects unsupported limits before fetch',async()=>{
 const restore=mockFetch(()=>({}));const {pip,call}=serviceHarness();
 try {
   assert.equal((await call('pipPrepare',{url:'https://f1prodlive.akamaized.net/a.mpd',role:'sub',maxHeight:2160,maxFrameRate:50})).returnValue,false);
   const pending=call('pipPrepare',{url:'https://f1prodlive.akamaized.net/a.mpd',role:'sub',maxHeight:720,maxFrameRate:50});
   assert.equal((await call('pipReleaseAll',{})).returnValue,true);assert.equal((await pending).returnValue,false);
 }finally{restore();pip.clear();}
});

test('static manifests remain available for a long replay and slots are explicitly released', async()=>{
 let calls=0;const restore=mockFetch(()=>{calls++;return {body:fixture.replace('type="dynamic"','type="static"')};});const {pip,call}=serviceHarness();const server=http.createServer((req,res)=>pip.handle(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const originalNow=Date.now;
 try {
  const prepared=await call('pipPrepare',{url:'https://f1prodlive.akamaized.net/a.mpd',role:'main',maxHeight:1080,maxFrameRate:50});const path=new URL(prepared.url).pathname;
  Date.now=()=>originalNow()+4*60*60*1000;
  assert.equal((await get(server,path)).status,200);assert.equal(calls,1);
  for(let i=0;i<7;i++) assert.equal((await call('pipPrepare',{url:'https://f1prodlive.akamaized.net/a.mpd',role:'sub',maxHeight:720,maxFrameRate:50})).returnValue,true);
  assert.equal((await call('pipPrepare',{url:'https://f1prodlive.akamaized.net/a.mpd',role:'sub',maxHeight:720,maxFrameRate:50})).returnValue,false);
  await call('pipReleaseAll',{});assert.equal((await get(server,path)).status,404);
 }finally{Date.now=originalNow;restore();await new Promise(resolve=>server.close(resolve));pip.clear();}
});
test('live refresh refuses a changed protected ladder instead of serving unfiltered media',async()=>{
 let calls=0;const restore=mockFetch(()=>({body:++calls===1?fixture:fixture.replace('<Period>','<Period><ContentProtection/>')}));const {pip,call}=serviceHarness();const server=http.createServer((req,res)=>pip.handle(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const prepared=await call('pipPrepare',{url:'https://f1prodlive.akamaized.net/a.mpd',role:'sub',maxHeight:720,maxFrameRate:50});assert.equal(prepared.returnValue,true);const reply=await get(server,new URL(prepared.url).pathname);assert.equal(reply.status,502);assert.equal(reply.body,'');}finally{restore();await new Promise(resolve=>server.close(resolve));pip.clear();}
});

test('prepares waiting for the HTTP listener still count toward the stream limit', async()=>{
 const restore=mockFetch(()=>({}));const callbacks=[],handlers={};
 const pip=createPip({appId:'app',port:18741});pip.register({register:(name,fn)=>handlers[name]=fn},cb=>callbacks.push(cb));
 const request=()=>new Promise(resolve=>handlers.pipPrepare({sender:'app',payload:{url:'https://f1prodlive.akamaized.net/a.mpd',role:'sub',maxHeight:720,maxFrameRate:50},respond:resolve}));
 try {
  const results=Array.from({length:8},request);await new Promise(setImmediate);
  results.push(request());await new Promise(setImmediate);
  callbacks.forEach(cb=>cb(true));
  const replies=await Promise.all(results);
  assert.equal(replies.filter(reply=>reply.returnValue).length,8);
 }finally{restore();pip.clear();}
});

test('a transient live refresh failure serves the last filtered manifest',async()=>{
 let calls=0;const restore=mockFetch(()=>(++calls===1?{}:{status:500,body:''}));const {pip,call}=serviceHarness();const server=http.createServer((req,res)=>pip.handle(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const prepared=await call('pipPrepare',{url:'https://f1prodlive.akamaized.net/a.mpd',role:'sub',maxHeight:720,maxFrameRate:50});const reply=await get(server,new URL(prepared.url).pathname);assert.equal(reply.status,200);assert.match(reply.body,/id="small"/);assert.doesNotMatch(reply.body,/id="large"/);assert.equal(calls,2);}finally{restore();await new Promise(resolve=>server.close(resolve));pip.clear();}
});
