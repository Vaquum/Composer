// Real application, offline presentation data. Absolute budgets describe this
// automated environment; structural guards remain useful on every machine.
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const html=fs.readFileSync('index.html','utf8').replace('Panes.init();','window.__perf={S,Stage,Match,Panes,Ref,Forecast,Ops,App,Flow};\nPanes.init();');
const assets=new Set(['motion.js','motion.css','panes.css','pane-designs.js','forecast.js','context.js']);
function fixture(n){
  const keys=['vol','trades','size','maker','range','body','day'];
  const sequences=Array.from({length:729},(_,i)=>{
    let k=i,key='';for(let j=0;j<6;j++){key='UID'[k%3]+key;k=Math.floor(k/3);}return[key,1+i%7];
  }).sort((a,b)=>b[1]-a[1]);
  const count=sequences.reduce((sum,[,n])=>sum+n,0),raw=Array.from({length:n},()=>[30,68,18,56]);
  return{mode:'nearest',exact:[0,0,0,0,0],exactF:[0,0,0,0,0],filter:null,stretch:0,base:{n:20000,up:10000},
    counts:[12,0,0,0,0],countsF:[12,0,0,0,0],ms:10,
    results:Array.from({length:12},(_,i)=>({tf:'15m',start:1700000000+i*900,raw,drawn:raw.map(()=>[18,30,56,68]),picks:Array.from({length:n},(_,j)=>j),broken:[],flips:0,off:i*.01,next:null,nextWhy:'end'})),
    panes:{kind:'closest',n:count,readings:true,after:6,near:[],next:[.43,.38,.48],byTf:Array.from({length:5},()=>[.43,.38,.48]),tfN:Array(5).fill(count),
      rows:Array.from({length:7*n},(_,i)=>({bar:Math.floor(i/7),key:keys[i%7],set:[1.4,1.3,1.5],all:[.5,.48,.52],d:3-i*.01,log:i%7<3})),
      cont:{n:count,sampled:count,aboveHigh:[.82,.78,.86],belowLow:[.27,.23,.31],aboveClose:[.52,.47,.57],
        fan:Array.from({length:6},(_,i)=>[-.2-i*.05,.2,.5+i*.08,1.2,1.6+i*.05]),sequences,examples:{}}}};
}
const server=http.createServer((req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname.slice(1);
  if(!file){res.setHeader('Content-Type','text/html');res.end(html);}
  else if(assets.has(file)){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'application/javascript');res.end(fs.readFileSync(file));}
  else if(file==='bars'||file==='activity')res.end(file==='bars'?'CBAR1x':'');
  else{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const settle=page=>page.waitForFunction(()=>!__perf.App.running&&!__perf.Flow.active()&&!document.getAnimations().some(a=>a.playState==='running'));
const seed=(page,result)=>page.evaluate(r=>{
  const A=__perf;A.Match.ready=true;A.Match.failed=false;A.Match.sent=A.Match.query();A.Match.sentKey=A.Match.key();
  A.Match.onmsg({...r,type:'result',id:A.Match.id});
},result);
const reports=[];
try{
for(const [name,type] of [['Chromium',chromium],['WebKit',webkit]]){
  const browser=await type.launch({headless:true});
  try{
  for(const [n,width,dpr] of [[2,1600,1],[20,1600,2],[20,390,2]]){
    const context=await browser.newContext({viewport:{width,height:1000},deviceScaleFactor:dpr,hasTouch:width===390});
    try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.Worker=class{postMessage(){} terminate(){}};
      window.__samples={frames:[],work:[],tasks:[],calls:[],paints:[],mutations:0,clones:0,measures:0};
      if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>__samples.tasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask'});
      const clone=Node.prototype.cloneNode;
      Node.prototype.cloneNode=function(...args){__samples.clones++;return clone.apply(this,args);};
      const append=Element.prototype.append;
      Element.prototype.append=function(...nodes){__samples.measures+=nodes.filter(n=>n.nodeType===1&&n.hasAttribute('data-flow-measuring')).length;return append.apply(this,nodes);};
    });
    await page.route('https://fonts.**/**',r=>r.abort());await page.goto(base);await settle(page);
    await page.evaluate(n=>{while(__perf.S.bars.length<n)__perf.Ops.add();},n);
    const data=fixture(n);await seed(page,data);await settle(page);
    let cdp;
    if(name==='Chromium'){cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});}
    await page.evaluate(()=>{
      const A=__perf;__samples.active=false;
      const step=A.Stage.step,draw=A.Stage.draw;let work=0;
      A.Stage.step=function(...args){const t=performance.now();try{return step.apply(this,args);}finally{work+=performance.now()-t;}};
      A.Stage.draw=function(...args){const t=performance.now();try{return draw.apply(this,args);}finally{if(__samples.active)__samples.work.push(work+performance.now()-t);work=0;}};
      let previous=0;
      const frame=now=>{if(__samples.active&&previous)__samples.frames.push(now-previous);previous=__samples.active?now:0;requestAnimationFrame(frame);};requestAnimationFrame(frame);
      document.querySelector('#cv').addEventListener('pointermove',()=>{const t=performance.now();requestAnimationFrame(()=>{if(__samples.active)__samples.paints.push(performance.now()-t);});});
      new MutationObserver(list=>{if(__samples.active)__samples.mutations+=list.length;}).observe(document.querySelector('#forecast-panel'),{subtree:true,attributes:true,childList:true,characterData:true});
    });
    const measure=async(label,action)=>{
      await settle(page);
      await page.evaluate(()=>{for(const key of ['frames','work','tasks','calls','paints'])__samples[key]=[];for(const key of ['mutations','clones','measures'])__samples[key]=0;__samples.active=true;});
      await action();await settle(page);
      const sample=await page.evaluate(()=>{__samples.active=false;return{...__samples};});
      const p95=a=>a.length?a.slice().sort((a,b)=>a-b)[Math.floor((a.length-1)*.95)]:0;
      const report={browser:name,bars:n,width,dpr,scenario:label,frames:sample.frames.length,
        frameP95:+p95(sample.frames).toFixed(1),workP95:+p95(sample.work).toFixed(1),callMax:+Math.max(0,...sample.calls).toFixed(1),
        paintP95:+p95(sample.paints).toFixed(1),taskMax:Math.max(0,...sample.tasks),measurements:sample.measures,mutations:sample.mutations};
      reports.push(report);console.log(JSON.stringify(report));
      // CI contention can stretch rAF intervals, so timing gates use measured application
      // work and input handlers. Frame delivery is reported, never hidden by idle samples.
      assert.ok(report.callMax<100,`${label}: an input/result task exceeded 100 ms (${report.callMax})`);
      assert.ok(report.workP95<33.4,`${label}: application work exceeded two 60-Hz frames (${report.workP95})`);
      assert.ok(report.paintP95<100,`${label}: pointer input waited more than 100 ms for its next paint (${report.paintP95})`);
      return sample;
    };
    const call=async(kind,value)=>page.evaluate(({kind,value})=>{
      const A=__perf,t=performance.now();
      if(kind==='pane')A.Panes.choose('left',value);
      if(kind==='paneRight')A.Panes.choose('right',value);
      if(kind==='forecast')A.Forecast.choose(value);
      if(kind==='reference')value?A.Ref.open():A.Ref.close();
      if(kind==='topic')A.Ref.render(value);
      if(kind==='disclosure')document.querySelector('#lrows details summary').click();
      if(kind==='fan'){A.Forecast.fan=value;A.Forecast.remember();A.App.redraw();}
      if(kind==='refresh'){
        const r=A.Match.result;A.Match.onmsg({...r,type:'result',id:A.Match.id,results:r.results.map(x=>({...x,start:x.start+900})),
          panes:{...r.panes,rows:r.panes.rows.map(w=>({...w,set:w.set.map(v=>v+.001)})),cont:{...r.panes.cont,fan:r.panes.cont.fan.map(q=>q.map(v=>v+.001))}}});
      }
      __samples.calls.push(performance.now()-t);
    },{kind,value});
    await measure('pane',async()=>{for(const v of ['bars','ledger','signal']){await call('pane',v);await settle(page);await call('paneRight',v);await settle(page);}});
    const size=await measure('disclosure',async()=>{await call('disclosure');});
    assert.ok(size.measures<=3,'opening a fixed-width disclosure must not clone/measure once per animation frame');
    await measure('reference',async()=>{await call('reference',true);await settle(page);await call('topic',2);await settle(page);await call('reference',false);});
    await measure('forecast',async()=>{for(const v of ['paths','branches','states']){await call('forecast',v);await settle(page);}await call('fan',false);await settle(page);await call('fan',true);});
    await measure('refresh',async()=>{for(let i=0;i<3;i++){await call('refresh');await settle(page);}});
    const refreshedDisclosure=await page.evaluate(async()=>{
      const A=__perf,summary=document.querySelector('#lnext details summary'),detail=summary.parentElement;
      if(detail.open){summary.click();A.Flow.finish();}summary.click();
      for(let i=0;i<5;i++)await new Promise(requestAnimationFrame);
      A.S.tfOn.fill(true);A.Match.sent=A.Match.query();A.Panes.render(A.Match.result);
      const body=detail.querySelector('.flow-detail-body');let last=body.getBoundingClientRect().height,previous=last;
      for(let i=0;i<180&&A.Flow.value(body,'disclosure');i++){await new Promise(requestAnimationFrame);previous=last;last=body.getBoundingClientRect().height;}
      const natural=body.getBoundingClientRect().height,rows=body.querySelectorAll('table tbody tr').length;
      detail.open=false;A.Flow.finish();return{natural,rows,jump:Math.abs(natural-previous)};
    });
    assert.equal(refreshedDisclosure.rows,5);assert.ok(refreshedDisclosure.natural>100,'refreshed disclosure must include every timeframe');
    assert.ok(refreshedDisclosure.jump<1,'a refreshed opening disclosure must release height without a final jump');
    await page.locator('#cv').scrollIntoViewIfNeeded();
    const point=await page.evaluate(()=>{
      const A=__perf,G=A.Stage.geom(),b=A.S.bars[0],box=A.Stage.cv.getBoundingClientRect();
      return{x:box.left+b.x,y:box.top+A.Stage.Y((b.dv[1]+b.dv[2])/2,G)};
    });
    await measure('pointer-drag',async()=>{
      await page.mouse.move(point.x,point.y);await page.mouse.down();
      assert.ok(await page.evaluate(()=>!!__perf.Stage.drag),'the workload must take hold of a real candle');
      for(let i=1;i<=18;i++)await page.mouse.move(point.x,point.y+i);
      await page.mouse.up();
    });
    await seed(page,data);await settle(page);
    // Bitmap reuse must be exact, and source/camera/theme changes must refresh it.
    const raster=await page.evaluate(()=>{
      const A=__perf,G=A.Stage.geom(),canvas=document.createElement('canvas');canvas.width=A.Stage.cv.width;canvas.height=A.Stage.cv.height;
      const ctx=canvas.getContext('2d'),dpr=Math.min(2,devicePixelRatio);ctx.scale(dpr,dpr);
      const pixels=()=>ctx.getImageData(0,0,canvas.width,canvas.height).data;
      const paint=()=>{ctx.clearRect(0,0,G.w,G.h);A.Stage.drawFan(ctx,G);return pixels();};
      A.Stage.fanCache=null;const fresh=paint(),cached=paint(),equal=fresh.every((v,i)=>v===cached[i]);
      A.Stage.view.cur[0]-=10;A.Stage.view.cur[1]+=10;const changed=paint(),different=changed.some((v,i)=>v!==fresh[i]);A.Stage.fit(true);A.Flow.finish();
      return{equal,different,pixels:A.Stage.forecastSurface.width*A.Stage.forecastSurface.height,full:A.Stage.cv.width*A.Stage.cv.height};
    });
    assert.ok(raster.equal&&raster.different,'fan raster reuse must preserve pixels and refresh after camera changes');
    assert.ok(raster.pixels<raster.full*.85,'forecast transitions must not rasterize a full canvas');
    const quiet=await measure('stationary-forecast',async()=>{
      await page.evaluate(async()=>{for(let i=0;i<24;i++){__perf.Forecast.sync(__perf.Stage.geom());await new Promise(requestAnimationFrame);}});
    });
    assert.equal(quiet.mutations,0,'stationary forecast frames must not rewrite semantic or hit-target DOM');
    await page.locator('#emaki .card').first().scrollIntoViewIfNeeded();
    const retiring=await page.evaluate(()=>{
      const A=__perf,card=document.querySelector('#emaki .card'),read=node=>{
        const s=getComputedStyle(node);return[s.fontFamily,s.fontSize,s.color,s.backgroundColor,s.padding,s.borderRadius];
      },before=read(card);A.Match.result={...A.Match.result,results:A.Match.result.results.slice(1)};A.Match.render();
      const copy=document.querySelector('[data-flow-retiring] .card'),after=copy&&read(copy);A.Flow.finish();return{before,after};
    });
    assert.deepEqual(retiring.after,retiring.before,'retirement must retain context-dependent visual styles');
    const interrupted=await page.evaluate(async()=>{
      const A=__perf,root=document.createElement('div');document.querySelector('.lpane .pane-body').prepend(root);
      A.Flow.patch(root,'<div data-motion-key="entering" class="prow"><span>Retiring reading</span></div>');
      root.scrollIntoView();
      for(let i=0;i<5;i++)await new Promise(requestAnimationFrame);
      const actor=root.firstElementChild,opacity=+getComputedStyle(actor).opacity;
      A.Flow.patch(root,'');const wrapper=[...document.querySelectorAll('[data-flow-retiring]')].at(-1),copy=wrapper.querySelector('.prow');
      const presented=+getComputedStyle(wrapper).opacity*+getComputedStyle(copy).opacity;A.Flow.finish();root.remove();return{opacity,presented};
    });
    assert.ok(interrupted.opacity>0&&interrupted.opacity<1);assert.ok(Math.abs(interrupted.presented-interrupted.opacity)<.001,'interrupted entry must transfer opacity once');
    await call('pane','ledger');await settle(page);
    await page.locator('#lrows tbody tr').nth(1).scrollIntoViewIfNeeded();
    const rowRetirement=await page.evaluate(()=>{
      const A=__perf,root=document.querySelector('#lrows tbody'),row=root.children[1],cell=row.firstElementChild;
      const border=getComputedStyle(cell).borderTop,markup=[...root.children].filter(r=>r!==row).map(r=>r.outerHTML).join('');
      A.Flow.patch(root,markup);const copy=[...document.querySelectorAll('[data-flow-retiring]')].at(-1)?.querySelector('td');
      const after=copy&&getComputedStyle(copy).borderTop;A.Flow.finish();return{border,after};
    });
    assert.equal(rowRetirement.after,rowRetirement.border,'a retiring ledger row must retain its sibling separator');
    await call('pane','bars');await settle(page);
    await page.locator('#lrows details').first().locator('.prow').first().scrollIntoViewIfNeeded();
    const closing=await page.evaluate(async()=>{
      const A=__perf,detail=document.querySelector('#lrows details'),body=detail.querySelector('.flow-detail-body');detail.querySelector('summary').click();
      for(let i=0;i<4;i++)await new Promise(requestAnimationFrame);
      const row=body.querySelector('.prow'),markup=[...body.children].filter(r=>r!==row).map(r=>r.outerHTML).join('');A.Flow.patch(body,markup);
      const ghost=[...document.querySelectorAll('[data-flow-retiring]')].at(-1),copy=ghost?.querySelector('.prow'),shell=copy?.closest('details');
      const visible=!!copy&&copy.getBoundingClientRect().height>0&&shell?.hasAttribute('data-flow-details');A.Flow.finish();return visible;
    });
    assert.ok(closing,'a reading retired during disclosure close must remain presented');
    const priority=await page.evaluate(()=>{
      const F=__perf.Flow,root=document.createElement('div');document.body.append(root);F.patch(root,'<div data-motion-key="priority">Style priority</div>',false);
      const node=root.firstElementChild,properties={height:'40px',width:'70px',opacity:'0.5',overflow:'hidden',translate:'0 4px','--flow-test':'3px'};
      F.spring(node,'priority',{from:{x:0},to:{x:1},write:()=>{for(const [key,value]of Object.entries(properties))node.style.setProperty(key,value);}});
      const before=Object.fromEntries(Object.keys(properties).map(key=>[key,node.style.getPropertyValue(key)]));
      F.patch(root,`<div data-motion-key="priority" style="${Object.entries(properties).map(([key,value])=>`${key}:${value}!important`).join(';')};color:red!important">Style priority</div>`,false);
      const preserved=Object.entries(before).every(([key,value])=>node.style.getPropertyValue(key)===value&&!node.style.getPropertyPriority(key)),ordinary=node.style.getPropertyPriority('color')==='important';F.finish();root.remove();return{preserved,ordinary};
    });
    assert.deepEqual(priority,{preserved:true,ordinary:true},'priority-only updates must preserve active temporary styles and update ordinary styles');
    await seed(page,data);await settle(page);
    // Warm allocation pools before the retained-node and heap bounds.
    for(let i=0;i<2;i++){await call('reference',true);await call('reference',false);await settle(page);}
    if(cdp)await cdp.send('HeapProfiler.collectGarbage');
    const retained=await page.evaluate(()=>document.querySelectorAll('*').length),heap=cdp?(await cdp.send('Performance.getMetrics')).metrics.find(m=>m.name==='JSHeapUsedSize').value:0;
    for(let i=0;i<6;i++){await call('reference',true);await call('reference',false);await call('forecast',i%2?'paths':'states');await call('refresh');await settle(page);}
    if(cdp)await cdp.send('HeapProfiler.collectGarbage');
    const cleanup=await page.evaluate(()=>({nodes:document.querySelectorAll('*').length,temporary:document.querySelectorAll('[data-flow-retiring],[data-flow-measuring],[data-flow-sizing],[data-motion-running]').length,running:__perf.App.running||__perf.Flow.active()}));
    assert.ok(cleanup.nodes<=retained+30,`repeated transitions retained DOM (${retained} → ${cleanup.nodes})`);
    assert.equal(cleanup.temporary,0);assert.equal(cleanup.running,false);
    if(cdp){const after=(await cdp.send('Performance.getMetrics')).metrics.find(m=>m.name==='JSHeapUsedSize').value;assert.ok(after-heap<2e6,`transition heap grew by ${after-heap} bytes after GC`);}
    await page.emulateMedia({reducedMotion:'reduce'});
    const reduced=await measure('reduced-motion',async()=>{await call('reference',true);await call('pane','bars');await call('forecast','states');await call('reference',false);});
    assert.equal(reduced.measures,0,'reduced motion must bypass intrinsic measurement clones');
    assert.deepEqual(errors,[]);
    }finally{await context.close();}
  }
  }finally{await browser.close();}
}
console.log(`Motion performance: ${reports.length} browser/workload samples passed; input/render budgets, bounded measurements/raster area, idle DOM, pixel reuse, retained styling and cleanup.`);
}finally{await new Promise(resolve=>server.close(resolve));}
