// Real Worker and payloads: cold first-result latency, warm cache reuse and loading stability.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {chromium} from 'playwright';
const [,barsFile,activityFile,python]=process.argv.slice(2);
assert.ok(python,'run through checks/with_bars.py to use its Python runtime');
const rawSizes={bars:fs.statSync(barsFile).size,activity:fs.statSync(activityFile).size};
const requests=[];
const origin=spawn(python,['checks/loading_origin.py',barsFile,activityFile],{stdio:['ignore','pipe','pipe']});
let stderr='',startupTimer,browser;
origin.stderr.on('data',bytes=>{stderr+=bytes;});
const exited=new Promise(resolve=>{origin.once('exit',resolve);origin.once('error',resolve);});
const lines=createInterface({input:origin.stdout});
const ready=new Promise((resolve,reject)=>{
  startupTimer=setTimeout(()=>reject(new Error(`loading origin did not start: ${stderr}`)),20000);
  origin.once('error',reject);
  origin.once('exit',code=>reject(new Error(`loading origin exited (${code}): ${stderr}`)));
  lines.on('line',line=>{
    try{
      const event=JSON.parse(line);
      if(event.type==='ready'){clearTimeout(startupTimer);resolve(event.port);}
      else if(event.type==='request')requests.push(event);
    }catch(error){reject(error);}
  });
});
try{
  const port=await ready;
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1600,height:1000},deviceScaleFactor:2}),page=await context.newPage(),cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['*fonts.googleapis.com*','*fonts.gstatic.com*']});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:1250000,uploadThroughput:500000});
  await page.addInitScript(()=>{
    window.__loadEvents=[];window.__loadShifts=[];window.__loadActivity=[];window.__loadRefusals=0;const Native=Worker;
    window.Worker=class extends Native{constructor(...a){super(...a);window.__loadWorker=this;const post=this.postMessage.bind(this);
      this.postMessage=(m,t)=>{
        if(m.type==='activity')__loadActivity.push(performance.now());
        if(m.type==='query'&&sessionStorage.getItem('refuseFirst')==='1'){
          sessionStorage.removeItem('refuseFirst');m={...m,q:{...m.q,packet:{...m.q.packet,revision:'refuse-first'}}};
        }
        return post(m,t);
      };
      this.addEventListener('message',e=>{if(e.data.type==='refused')__loadRefusals++;if(e.data.type==='result')__loadEvents.push({id:e.data.id,at:performance.now(),readings:e.data.panes.readings});});}};
    new PerformanceObserver(list=>__loadShifts.push(...list.getEntries().filter(e=>!e.hadRecentInput).map(e=>({value:e.value,at:e.startTime,sources:e.sources.map(s=>({node:s.node?.id||s.node?.className,before:s.previousRect.toJSON(),after:s.currentRect.toJSON()}))})))).observe({type:'layout-shift',buffered:true});
  });
  for(const kind of ['cold','warm']){
    await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#canvas[data-readings="ready"][data-answer="current"][data-waiting="0"]',{timeout:20000});
    const result=await page.evaluate(()=>({first:__loadEvents[0]?.at,firstReadings:__loadEvents[0]?.readings,activityPosted:__loadActivity[0],complete:__loadEvents.find(e=>e.readings)?.at,cls:__loadShifts.reduce((a,b)=>a+b.value,0),shifts:__loadShifts,resources:performance.getEntriesByType('resource').filter(e=>/\/(bars|activity)$/.test(e.name)).map(e=>({path:e.name.split('/').at(-1),start:e.startTime,end:e.responseEnd,bytes:e.transferSize,encoded:e.encodedBodySize,decoded:e.decodedBodySize}))}));
    console.log(JSON.stringify({kind,...result,responses:requests.slice(-2)}));
    if(kind==='cold'){
      assert.deepEqual(requests.map(r=>[r.status,r.encoding]),[[200,'gzip'],[200,'gzip']],'the production handler must compress both real payloads');
      for(const resource of result.resources){
        assert.equal(resource.decoded,rawSizes[resource.path],'HTTP decoding must preserve the complete binary payload');
        assert.ok(resource.encoded<resource.decoded,'compression must reduce actual browser transfer');
      }
    }
    assert.ok(result.activityPosted>=result.first,`${kind}: activity must be sent after the first answer`);
    assert.equal(result.firstReadings,false,`${kind}: activity preparation must follow the first answer`);
    assert.ok(result.first<(kind==='cold'?4000:2000),`${kind}: first matches exceeded their loading budget (${result.first})`);
    assert.ok(result.complete<(kind==='cold'?7500:2500),`${kind}: complete results exceeded their loading budget (${result.complete})`);
    assert.ok(result.cls<.02,`${kind}: initial results moved established content (${result.cls})`);
    const bars=result.resources.find(r=>r.path==='bars'),activity=result.resources.find(r=>r.path==='activity');
    assert.ok(activity.start>=bars.end,'activity must not compete with the first matching payload');
  }
  assert.deepEqual(requests.slice(-2).map(r=>r.status),[304,304],'warm reload must revalidate both large payloads without downloading them');
  const matchCount=await page.locator('#readout > b').textContent();
  const cancelled=await page.evaluate(async()=>{
    let c=42;const bars=Array.from({length:20},(_,i)=>{const o=c;c+=i%3===1?-18:14;return[o,Math.max(o,c)+12,Math.min(o,c)-12,c];});
    // the worker takes a drawing as the engine's packet: the bars, what is pinned, the stretch and how many windows to show
    const {DRAWING_REVISION:revision}=await import('/bench/filang.js');
    const packet=(rows,pins,stretch,limit)=>({version:1,revision,oriented:true,bars:rows.map(([o,h,l,c])=>({v:[l,Math.min(o,c),Math.max(o,c),h],d:c<o?'d':'u'})),pins,skeleton:0,stretch,next:{dir:0,measure:'any',bps:10,atr:1},limit});
    __loadWorker.postMessage({type:'query',id:999,q:{packet:packet(bars,[{bar:0,color:true}],4,48),tfs:[1,1,1,1,1],next:null}});
    await new Promise(r=>setTimeout(r,20));const at=performance.now();
    __loadWorker.postMessage({type:'query',id:1000,q:{packet:packet(bars.slice(0,2),[],0,12),tfs:[0,0,0,0,1],next:null}});
    return at;
  });
  await page.waitForFunction(()=>__loadEvents.some(e=>e.id===1000));
  const replacement=await page.evaluate(at=>({ms:__loadEvents.find(e=>e.id===1000).at-at,obsolete:__loadEvents.some(e=>e.id===999)}),cancelled);
  console.log(JSON.stringify({kind:'worker-cancellation',...replacement}));
  assert.ok(!replacement.obsolete&&replacement.ms<250,'a real worker must replace an expensive query promptly');
  await cdp.send('Network.setBlockedURLs',{urls:['*fonts.googleapis.com*','*fonts.gstatic.com*','*/activity']});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#canvas[data-readings="failed"][data-answer="current"][data-waiting="0"]');
  assert.match(await page.locator('#status').textContent(),/readings unavailable/,'the status must report failed activity');
  assert.equal(await page.locator('#readout > b').textContent(),matchCount,'activity failure must retain the match count');
  // A refused first query must release activity too, so its preparation can trigger a fresh valid question.
  await cdp.send('Network.setBlockedURLs',{urls:['*fonts.googleapis.com*','*fonts.gstatic.com*']});
  await page.evaluate(()=>sessionStorage.setItem('refuseFirst','1'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#canvas[data-readings="ready"][data-answer="current"][data-waiting="0"]');
  assert.equal(await page.evaluate(()=>__loadRefusals),1,'the first question must actually be refused');
  assert.equal(await page.locator('#readout > b').textContent(),matchCount,'a refused first question must recover after activity arrives');
  console.log('Refused first query: activity preparation and a fresh answer recovered.');
  console.log('Real loading: prioritized first matches, cached reload, complete readings and stable controls passed.');
}finally{
  clearTimeout(startupTimer);
  try{await browser?.close();}
  finally{
    if(origin.exitCode===null&&origin.signalCode===null){origin.kill();await exited;}
    lines.close();
  }
}
