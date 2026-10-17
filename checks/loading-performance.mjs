// Real Worker and payloads: cold first-result latency, warm cache reuse and loading stability.
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const [,barsFile,activityFile]=process.argv.slice(2);
const html=fs.readFileSync('index.html','utf8').replace('Panes.init();','window.__loading={Match,Panes,App,Flow};Panes.init();');
const payloads=new Map([['bars',fs.readFileSync(barsFile)],['activity',fs.readFileSync(activityFile)]]);
const assets=new Set(['matcher.js','motion.js','motion.css','panes.css','pane-designs.js','forecast.js','context.js']);
const requests=[];
const server=http.createServer((req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname.slice(1);
  res.setHeader('Cache-Control','private, no-cache');
  if(payloads.has(file)){
    const bytes=payloads.get(file),etag='"'+createHash('sha256').update(bytes).digest('hex')+'"',status=req.headers['if-none-match']===etag?304:200;
    requests.push({file,status});res.setHeader('ETag',etag);res.setHeader('Content-Type','application/octet-stream');res.writeHead(status);res.end(status===304?undefined:bytes);
  }else if(!file){res.setHeader('Content-Type','text/html');res.end(html);}
  else if(assets.has(file)){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'application/javascript');res.end(fs.readFileSync(file));}
  else{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({viewport:{width:1600,height:1000},deviceScaleFactor:2}),page=await context.newPage(),cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['*fonts.googleapis.com*','*fonts.gstatic.com*']});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:1250000,uploadThroughput:500000});
  await page.addInitScript(()=>{
    window.__loadEvents=[];window.__loadShifts=[];const Native=Worker;
    window.Worker=class extends Native{constructor(...a){super(...a);window.__loadWorker=this;this.addEventListener('message',e=>{if(e.data.type==='result')__loadEvents.push({id:e.data.id,at:performance.now(),readings:e.data.panes.readings});});}};
    new PerformanceObserver(list=>__loadShifts.push(...list.getEntries().filter(e=>!e.hadRecentInput).map(e=>({value:e.value,at:e.startTime,sources:e.sources.map(s=>({node:s.node?.id||s.node?.className,before:s.previousRect.toJSON(),after:s.currentRect.toJSON()}))})))).observe({type:'layout-shift',buffered:true});
  });
  for(const kind of ['cold','warm']){
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__loading&&__loading.Match.fresh()&&__loading.Match.result?.panes.readings&&__loading.Panes.readings==='ready'&&!__loading.App.running&&!__loading.Flow.active(),{},{timeout:20000});
    const result=await page.evaluate(()=>({first:__loadEvents[0]?.at,complete:__loadEvents.find(e=>e.readings)?.at,cls:__loadShifts.reduce((a,b)=>a+b.value,0),shifts:__loadShifts,resources:performance.getEntriesByType('resource').filter(e=>/\/(bars|activity)$/.test(e.name)).map(e=>({path:e.name.split('/').at(-1),start:e.startTime,end:e.responseEnd,bytes:e.transferSize}))}));
    console.log(JSON.stringify({kind,...result}));
    assert.ok(result.first<(kind==='cold'?4000:2000),`${kind}: first matches exceeded their loading budget (${result.first})`);
    assert.ok(result.complete<(kind==='cold'?7500:2500),`${kind}: complete results exceeded their loading budget (${result.complete})`);
    assert.ok(result.cls<.02,`${kind}: initial results moved established content (${result.cls})`);
    const bars=result.resources.find(r=>r.path==='bars'),activity=result.resources.find(r=>r.path==='activity');
    assert.ok(activity.start>=bars.end,'activity must not compete with the first matching payload');
  }
  assert.deepEqual(requests.slice(-2).map(r=>r.status),[304,304],'warm reload must revalidate both large payloads without downloading them');
  const cancelled=await page.evaluate(async()=>{
    let c=42;const bars=Array.from({length:20},(_,i)=>{const o=c;c+=i%3===1?-18:14;return[o,Math.max(o,c)+12,Math.min(o,c)-12,c];});
    __loadWorker.postMessage({type:'query',id:999,q:{bars,holds:[{color:true,bar:0,dir:1}],stretch:4,tfs:[1,1,1,1,1],oriented:true,x:48}});
    await new Promise(r=>setTimeout(r,20));const at=performance.now();
    __loadWorker.postMessage({type:'query',id:1000,q:{bars:bars.slice(0,2),holds:[],stretch:0,tfs:[0,0,0,0,1],oriented:true,x:12}});
    return at;
  });
  await page.waitForFunction(()=>__loadEvents.some(e=>e.id===1000));
  const replacement=await page.evaluate(at=>({ms:__loadEvents.find(e=>e.id===1000).at-at,obsolete:__loadEvents.some(e=>e.id===999)}),cancelled);
  console.log(JSON.stringify({kind:'worker-cancellation',...replacement}));
  assert.ok(!replacement.obsolete&&replacement.ms<250,'a real worker must replace an expensive query promptly');
  console.log('Real loading: prioritized first matches, cached reload, complete readings and stable controls passed.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
