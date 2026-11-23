// Actual browser Worker: preparing statistics must yield and publish atomically.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import {engineDir} from './worker.mjs';
const [matcherFile,barsFile,activityFile]=process.argv.slice(2);
const source=fs.readFileSync(matcherFile,'utf8'),activity=fs.readFileSync(activityFile),changed=Buffer.from(activity);
// Keep the real encoded volume/trades; set every maker share to exactly 100%.
let p=6;for(let k=0;k<changed[5];k++){
  p+=1+changed[p];const n=changed.readUInt32LE(p);p+=4+3*(16+2*n);changed.fill(255,p,p+2*n);p+=2*n;
}
assert.equal(p,changed.length);
// The worker is a module that asks the shared engine, which it imports from /engine/ beside it. So it is served, with the
// probe appended, from a small origin that also serves the engine's two files.
const probe=`
  const deliver=self.postMessage.bind(self),handle=self.onmessage,originalSearch=search;let release;
  search=async(...args)=>{const result=await originalSearch(...args);if(args[1]===40){deliver({type:'held'});await new Promise(r=>release=r);}return result;};
  self.postMessage=m=>deliver(m.type==='readings'?{...m,complete:READ.length===BARS.length&&READ.every((r,k)=>r.features.length===7&&r.base.length===7&&READINGS.every(key=>r[key].length===BARS[k].n))}:m);
  self.onmessage=e=>{
    if(e.data.type==='release'){release();return;}
    if(e.data.type==='query')deliver({type:'received',id:e.data.id,readCount:READ?.length||0});
    const result=handle(e);if(e.data.type==='activity')Promise.resolve(result).then(()=>deliver({type:'prepared',serial:e.data.serial}));
  };`;
const served={'/':['text/html','<!doctype html><title>probe</title>'],'/matcher.js':['text/javascript',source+probe],
  '/engine/index.mjs':['text/javascript',fs.readFileSync(path.join(engineDir(),'index.mjs'))],'/engine/filang_engine.wasm':['application/wasm',fs.readFileSync(path.join(engineDir(),'filang_engine.wasm'))]};
const origin=http.createServer((req,res)=>{const hit=served[req.url];if(!hit){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':hit[0]});res.end(hit[1]);});
await new Promise(resolve=>origin.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${origin.address().port}/`);
  const reports=await page.evaluate(async({bars,activity,changed})=>{
    const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)).buffer;
    const prices=bytes(bars),original=bytes(activity),replacement=bytes(changed),reports=[];
    // the opening two-bar drawing as the engine's packet, with the revision the engine itself names
    const {FilangEngine}=await import('/engine/index.mjs'),revision=(await FilangEngine.create()).drawingProtocol().plain;
    const q={packet:{version:1,revision,oriented:true,bars:[{v:[30,42,56,68],d:'u'},{v:[26,38,56,68],d:'d'}],pins:[],skeleton:0,stretch:0,next:{dir:0,measure:'any',bps:10,atr:1},limit:12},tfs:[1,1,1,1,1],next:null};
    const run=async test=>{
      const worker=new Worker('/matcher.js',{type:'module'}),events=[],waiters=new Set();
      worker.onmessage=e=>{const message={...e.data,at:performance.now()};events.push(message);for(const w of waiters)if(w.match(message)){clearTimeout(w.timer);waiters.delete(w);w.resolve(message);}};
      const wait=match=>{const found=events.find(match);return found?Promise.resolve(found):new Promise((resolve,reject)=>{const w={match,resolve};w.timer=setTimeout(()=>{waiters.delete(w);reject(Error('Worker probe timed out: '+JSON.stringify(events.map(e=>[e.type,e.id,e.serial]))));},30000);waiters.add(w);});};
      const post=(type,data={},buffer)=>{const message={type,...data};if(buffer)message.buffer=buffer.slice(0);worker.postMessage(message,message.buffer?[message.buffer]:[]);};
      try{post('bars',{},prices);await wait(e=>e.type==='ready');await test({events,wait,post});}
      finally{worker.terminate();for(const w of waiters)clearTimeout(w.timer);}
    };
    {
      await run(async({wait,post})=>{
        const at=performance.now();post('activity',{serial:1},original);post('query',{id:1,q});
        const received=await wait(e=>e.type==='received'&&e.id===1),ready=await wait(e=>e.type==='readings'),early=await wait(e=>e.type==='result'&&e.id===1);
        post('query',{id:2,q});const complete=await wait(e=>e.type==='result'&&e.id===2);
        reports.push({kind:'responsive',ms:received.at-at,readCount:received.readCount,atomic:ready.complete,early:early.panes.readings,complete:complete.panes.readings,rows:complete.panes.rows.length});
      });
      for(const kind of ['activity','bars'])await run(async({events,wait,post})=>{
        post('activity',{serial:1},original);
        if(kind==='activity')post('activity',{serial:2},new ArrayBuffer(8));else post('bars',{},prices);
        post('query',{id:3,q});await wait(e=>e.type==='prepared'&&e.serial===1);
        if(kind==='activity')await wait(e=>e.type==='readings-error');
        const received=await wait(e=>e.type==='received'&&e.id===3);
        reports.push({kind:'superseded-'+kind,publications:events.filter(e=>e.type==='readings').length,readCount:received.readCount});
      });
      await run(async({events,wait,post})=>{
        post('activity',{serial:1},original);await wait(e=>e.type==='prepared'&&e.serial===1);
        post('query',{id:40,q});await wait(e=>e.type==='held');
        post('activity',{serial:2},replacement);await wait(e=>e.type==='prepared'&&e.serial===2);
        post('release');await wait(e=>e.type==='result'&&e.id===40);
        post('query',{id:41,q});const result=await wait(e=>e.type==='result'&&e.id===41),rows=result.panes.rows.filter(w=>w.key==='maker');
        reports.push({kind:'cache-generation',publications:events.filter(e=>e.type==='readings').length,maker:rows.map(w=>[w.set[0],w.all[0]])});
      });
    }
    return reports;
  },{bars:fs.readFileSync(barsFile).toString('base64'),activity:activity.toString('base64'),changed:changed.toString('base64')});
  for(const report of reports)console.log(JSON.stringify(report));
  const [responsive,...rest]=reports;
  assert.ok(responsive.ms<100,`activity preparation blocked a query for ${responsive.ms} ms`);
  assert.equal(responsive.readCount,0,'the query must run before preparation completes');
  assert.equal(responsive.atomic,true);assert.equal(responsive.early,false);assert.equal(responsive.complete,true);assert.ok(responsive.rows>0);
  for(const r of rest.filter(r=>r.kind.startsWith('superseded-')))assert.deepEqual({publications:r.publications,readCount:r.readCount},{publications:0,readCount:0},r.kind);
  const cache=rest.find(r=>r.kind==='cache-generation');assert.equal(cache.publications,2);assert.ok(cache.maker.length>0);assert.ok(cache.maker.every(([set,all])=>set===1&&all===1),'an older in-flight search must not repopulate the new activity cache');
  console.log('Activity preparation: responsive queries, atomic statistics, superseded activity/bars and cache generation passed.');
}finally{await browser.close();origin.close();}
