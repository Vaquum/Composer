// Real application, offline presentation data. Absolute budgets describe this
// automated environment; structural guards remain useful on every machine.
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const html=fs.readFileSync('index.html','utf8').replace('Panes.init();','window.__perf={S,Stage,Match,Panes,Ref,Forecast,Ops,App,Flow,PaneDesigns};\nPanes.init();');
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
const settle=page=>page.waitForFunction(()=>!__perf.Match.presentation&&!__perf.App.running&&!__perf.Flow.active()&&!document.getAnimations().some(a=>a.playState==='running'));
const seed=(page,result)=>page.evaluate(r=>{
  const A=__perf;A.Match.ready=true;A.Match.failed=false;A.Match.sent=A.Match.query();A.Match.sentKey=A.Match.key();
  A.Match.onmsg({...r,type:'result',id:A.Match.id});
},result);
const reports=[];
// Shared GitHub runners have no controlled display/GPU cadence. Keep application
// and input budgets there; native frame delivery is enforced on the local host.
const controlledGraphics=process.env.GITHUB_ACTIONS!=='true';
try{
for(const [name,type,rate] of [['Chromium native',chromium,1],['Chromium 4x CPU',chromium,4],['WebKit',webkit,1]]){
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
    const graphics=await page.evaluate(()=>{
      const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl');if(!gl)return'unavailable';
      const info=gl.getExtension('WEBGL_debug_renderer_info'),renderer=info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
      gl.getExtension('WEBGL_lose_context')?.loseContext();return renderer;
    });
    let cdp;
    if(type===chromium){cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Emulation.setCPUThrottlingRate',{rate});}
    await page.evaluate(()=>{
      const A=__perf;__samples.active=false;
      const step=A.Stage.step,draw=A.Stage.draw;let work=0;
      A.Stage.step=function(...args){const t=performance.now();try{return step.apply(this,args);}finally{work+=performance.now()-t;}};
      A.Stage.draw=function(...args){const t=performance.now();try{return draw.apply(this,args);}finally{if(__samples.active)__samples.work.push(work+performance.now()-t);work=0;}};
      for(const [owner,names]of [[A.Stage,['move','down','up']],[A.Match,['presentResult']]])for(const name of names){
        const handler=owner[name];
        owner[name]=function(...args){const t=performance.now();try{return handler.apply(this,args);}finally{if(__samples.active)__samples.calls.push(performance.now()-t);}};
      }
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
      const report={browser:name,graphics,frameGate:controlledGraphics,bars:n,width,dpr,scenario:label,frames:sample.frames.length,
        frameP95:+p95(sample.frames).toFixed(1),workP95:+p95(sample.work).toFixed(1),callMax:+Math.max(0,...sample.calls).toFixed(1),
        paintP95:+p95(sample.paints).toFixed(1),taskMax:Math.max(0,...sample.tasks),measurements:sample.measures,mutations:sample.mutations};
      reports.push(report);console.log(JSON.stringify(report));
      // CI contention can stretch rAF intervals, so timing gates use measured application
      // work and input handlers. Frame delivery is reported, never hidden by idle samples.
      assert.ok(report.callMax<100,`${label}: an input/result task exceeded 100 ms (${report.callMax})`);
      assert.ok(report.workP95<16.7*rate,`${label}: application work exceeded its native-frame budget scaled by ${rate}× CPU (${report.workP95})`);
      if(controlledGraphics&&rate===1&&label!=='reduced-motion')assert.ok(report.frameP95<25,`${label}: native frame delivery exceeded its budget (${report.frameP95})`);
      if(controlledGraphics)assert.ok(report.paintP95<100,`${label}: pointer input waited more than 100 ms for its next paint (${report.paintP95})`);
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
        const r=A.Match.result,layout=value==='layout',replace=value==='replace'||layout;
        A.Match.onmsg({...r,type:'result',id:A.Match.id,results:r.results.map(x=>({...x,start:x.start+(replace?1e6:900),raw:x.raw.map(b=>b.slice())})),
          panes:{...r.panes,rows:r.panes.rows.map((w,i)=>({...w,d:layout?(i+1)/r.panes.rows.length:w.d,set:w.set.map(v=>v+(layout?1:.001))})),cont:{...r.panes.cont,fan:r.panes.cont.fan.map(q=>q.map(v=>v+.001))}}});
      }
      __samples.calls.push(performance.now()-t);
    },{kind,value});
    await measure('pane',async()=>{for(const v of ['bars','ledger','signal']){await call('pane',v);await settle(page);await call('paneRight',v);await settle(page);}});
    const size=await measure('disclosure',async()=>{await call('disclosure');});
    assert.ok(size.measures<=3,'opening a fixed-width disclosure must not clone/measure once per animation frame');
    await measure('reference',async()=>{for(const topic of [2,3,4]){await call('reference',true);await settle(page);await call('topic',topic);await settle(page);await call('reference',false);await settle(page);}});
    await measure('forecast',async()=>{for(const v of ['paths','branches','states']){await call('forecast',v);await settle(page);}await call('fan',false);await settle(page);await call('fan',true);});
    await measure('refresh',async()=>{for(let i=0;i<3;i++){await call('refresh');await settle(page);}});
    await measure('refresh-replace',async()=>{await call('refresh','replace');});
    await measure('refresh-layout',async()=>{await call('refresh','layout');});
    const reorderedParity=await page.evaluate(()=>{
      const A=__perf,expected=document.createElement('div');expected.innerHTML=A.PaneDesigns.left('signal',A.Match.result,{barCount:A.S.bars.length});
      const fields=root=>[...root.querySelectorAll('[data-reading]')].map(node=>({key:node.dataset.reading,text:node.textContent,aria:node.querySelector('.trk')?.getAttribute('aria-label'),styles:[...node.querySelectorAll('.trk i')].map(i=>i.getAttribute('style'))}));
      return JSON.stringify(fields(document.querySelector('#lrows')))===JSON.stringify(fields(expected));
    });
    assert.ok(reorderedParity,'retained reordered reading updates must match the full renderer in text, order, semantics and chart geometry');
    if(n===20){
      const queued=await page.evaluate(()=>{
        const A=__perf,r=A.Match.result,shown=document.querySelector('#emaki .card').dataset.motionKey,send=offset=>A.Match.onmsg({...r,type:'result',id:A.Match.id,results:r.results.map(x=>({...x,start:x.start+offset}))});
        send(1e6);send(2e6);A.Match.setTrace(0);return{keys:A.Match.result.results.map(x=>A.Match.resultKeyOf(x)),shown,trace:A.Stage.trace.key};
      });
      assert.equal(queued.trace,queued.shown,'input during queued presentation must address the displayed historical card');
      await settle(page);
      assert.deepEqual(await page.locator('#emaki .card').evaluateAll(nodes=>nodes.map(n=>n.dataset.motionKey)),queued.keys,'queued presentation must apply only the latest result');
      const before=await page.locator('#emaki .card').evaluateAll(nodes=>nodes.map(n=>n.dataset.motionKey));
      await page.evaluate(()=>{const A=__perf,r=A.Match.result;A.Match.onmsg({...r,type:'result',id:A.Match.id,results:r.results.slice(1)});A.Match.id++;});
      await settle(page);
      assert.deepEqual(await page.locator('#emaki .card').evaluateAll(nodes=>nodes.map(n=>n.dataset.motionKey)),before,'a new search must cancel obsolete queued presentation');
    }
    for(const variant of ['bars','ledger']){
      await seed(page,data);await settle(page);await call('pane',variant);await settle(page);
      await page.evaluate(()=>{for(const detail of document.querySelectorAll('#lrows details'))detail.open=true;__perf.Flow.details(document.querySelector('#lrows'));});
      await settle(page);
      await measure(`refresh-${variant}`,async()=>{await call('refresh');await settle(page);await call('refresh','layout');});
      const parity=await page.evaluate(variant=>{
        const A=__perf,expected=document.createElement('div');expected.innerHTML=A.PaneDesigns.left(variant,A.Match.result,{barCount:A.S.bars.length});
        const fields=root=>[...root.querySelectorAll('[data-reading]')].map(node=>({key:node.dataset.reading,text:node.textContent,aria:node.querySelector('.trk')?.getAttribute('aria-label'),styles:[...node.querySelectorAll('.trk i')].map(i=>i.getAttribute('style'))}));
        return JSON.stringify(fields(document.querySelector('#lrows')))===JSON.stringify(fields(expected));
      },variant);
      assert.ok(parity,`${variant} refresh must match the full renderer`);
    }
    await call('pane','signal');await settle(page);
    await seed(page,data);await settle(page);
    const refreshedDisclosure=await page.evaluate(async()=>{
      const A=__perf;A.S.tfOn.fill(false);A.S.tfOn[0]=true;A.Match.sent=A.Match.query();A.Panes.render(A.Match.result);A.Flow.finish();
      const summary=document.querySelector('#lnext details summary'),detail=summary.parentElement;
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
    const readout=await page.evaluate(()=>{
      const A=__perf,mark=document.querySelector('#lrows .trk .bd'),before=mark.style.left,rect=Element.prototype.getBoundingClientRect;let reads=0;
      Element.prototype.getBoundingClientRect=function(...args){if(this.classList.contains('pane-body'))reads++;return rect.apply(this,args);};
      let parity=false;
      try{
        const r=A.Match.result,next={...r,panes:{...r.panes,rows:r.panes.rows.map(w=>({...w,set:w.set.map(v=>v+.001)}))}};A.Panes.render(next);
        const expected=document.createElement('div');expected.innerHTML=A.PaneDesigns.left('signal',next,{barCount:A.S.bars.length});
        const fields=root=>[...root.querySelectorAll('[data-reading]')].map(node=>({key:node.dataset.reading,text:node.textContent,aria:node.querySelector('.trk')?.getAttribute('aria-label'),styles:[...node.querySelectorAll('.trk i')].map(i=>i.getAttribute('style'))}));
        parity=JSON.stringify(fields(document.querySelector('#lrows')))===JSON.stringify(fields(expected));
      }
      finally{Element.prototype.getBoundingClientRect=rect;}
      return {reads,updated:mark.style.left!==before,parity};
    });
    assert.deepEqual(readout,{reads:0,updated:true,parity:true},'equal-width updates must retain chart/semantic parity with the full renderer without remeasuring pane bodies');
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
      const row=body.querySelector('.prow'),root=row.parentElement,markup=[...root.children].filter(r=>r!==row).map(r=>r.outerHTML).join('');A.Flow.patch(root,markup);
      const ghost=[...document.querySelectorAll('[data-flow-retiring]')].at(-1),copy=ghost?.querySelector('.prow'),shell=copy?.closest('details');
      const visible=!!copy&&copy.getBoundingClientRect().height>0&&shell?.hasAttribute('data-flow-details');A.Flow.finish();return visible;
    });
    assert.ok(closing,'a reading retired during disclosure close must remain presented');
    const priority=await page.evaluate(()=>{
      const F=__perf.Flow,root=document.createElement('div');document.body.append(root);F.patch(root,'<div data-motion-key="priority">Style priority</div>',false);
      const node=root.firstElementChild,properties={height:'40px',width:'70px',opacity:'0.5',overflow:'hidden',translate:'0 4px','--flow-test':'3px'};
      F.spring(node,'priority',{from:{x:0},to:{x:1},write:()=>{for(const [key,value]of Object.entries(properties))node.style.setProperty(key,value);}});
      const before=Object.fromEntries(Object.keys(properties).map(key=>[key,node.style.getPropertyValue(key)]));
      const markup=`<div data-motion-key="priority" style="${Object.entries(properties).map(([key,value])=>`${key}:${value}!important`).join(';')};color:red!important">Style priority</div>`;
      F.patch(root,markup,false);
      const differences=Object.entries(before).filter(([key,value])=>node.style.getPropertyValue(key)!==value||node.style.getPropertyPriority(key)).map(([key])=>({key,value:node.style.getPropertyValue(key),priority:node.style.getPropertyPriority(key)})),ordinary=node.style.getPropertyPriority('color')==='important';F.finish();
      F.patch(root,markup,false);
      const restored=Object.keys(properties).filter(key=>!key.startsWith('--flow-')).every(key=>node.style.getPropertyPriority(key)==='important');
      root.remove();return{differences,ordinary,restored};
    });
    assert.deepEqual(priority,{differences:[],ordinary:true,restored:true},'active temporary styles remain owned until settlement; repeated markup must then apply deferred styles');
    const entryReads=await page.evaluate(()=>{
      const F=__perf.Flow,root=document.createElement('div');document.body.append(root);
      const rect=Element.prototype.getBoundingClientRect,rects=Element.prototype.getClientRects;let reads=0;
      Element.prototype.getBoundingClientRect=function(...args){if(this.dataset?.motionKey==='new-result')reads++;return rect.apply(this,args);};
      Element.prototype.getClientRects=function(...args){if(this.dataset?.motionKey==='new-result')reads++;return rects.apply(this,args);};
      try{F.patch(root,'<button data-motion-key="new-result"><svg viewBox="0 0 132 80"><rect width="132" height="80"/></svg>New result</button>');}
      finally{Element.prototype.getBoundingClientRect=rect;Element.prototype.getClientRects=rects;F.finish(root);root.remove();}
      return reads;
    });
    assert.equal(entryReads,0,'new result actors must not force synchronous post-insertion geometry during their entry');
    const lateRetirementReads=await page.evaluate(()=>{
      const F=__perf.Flow,root=document.createElement('div');root.style.cssText='position:fixed;top:20px;left:20px;width:220px';document.body.append(root);
      const markup=suffix=>[1,2].map(i=>`<section data-motion-key="section-${i}"><div class="prow" data-reading="${i}-${suffix}">Reading ${i}</div></section>`).join('');
      F.patch(root,markup('old'),false);
      const computed=window.getComputedStyle,insert=Node.prototype.insertBefore;let wrote=false,reads=0;
      window.getComputedStyle=function(node,...args){if(wrote&&root.contains(node)&&node.dataset?.reading?.endsWith('-old'))reads++;return computed.call(this,node,...args);};
      Node.prototype.insertBefore=function(...args){if(root.contains(this))wrote=true;return insert.apply(this,args);};
      try{F.patch(root,markup('new'));}
      finally{window.getComputedStyle=computed;Node.prototype.insertBefore=insert;F.finish(root);F.finish();root.remove();}
      return reads;
    });
    assert.equal(lateRetirementReads,0,'nested retirement styles must be captured before the first retained DOM insertion');
    const restoredBatch=await page.evaluate(()=>{
      const F=__perf.Flow,root=document.createElement('div');document.body.append(root);
      const full='<button data-motion-key="a">A</button><button data-motion-key="b">B</button>';F.patch(root,full);F.finish(root);
      const a=root.firstElementChild;a.focus();
      F.batch(root,()=>{F.patch(root,'<button data-motion-key="b">B</button>');F.patch(root,full);});
      const state={keys:[...root.children].map(n=>n.dataset.motionKey),retained:root.firstElementChild===a&&a.isConnected,focused:document.activeElement===a};
      F.finish(root);root.remove();return state;
    });
    assert.deepEqual(restoredBatch,{keys:['a','b'],retained:true,focused:true},'restoring an actor within a batch must cancel its queued retirement');
    const batchCache=await page.evaluate(()=>{
      const F=__perf.Flow,root=document.createElement('div');document.body.append(root);
      const keep='<button data-motion-key="a">A</button>';F.patch(root,keep+'<button data-motion-key="b">B</button>');F.finish(root);
      F.batch(root,()=>F.patch(root,keep));const valid=F.update(root,keep,()=>({}));
      F.finish();root.remove();return valid;
    });
    assert.equal(batchCache,true,'queued tail retirement must leave the markup cache bound to the final requested bookends');
    const restoredAncestor=await page.evaluate(()=>{
      const F=__perf.Flow,root=document.createElement('div');Object.assign(root.style,{position:'fixed',left:'10px',top:'10px',width:'200px'});document.body.append(root);
      const full='<section data-motion-key="parent"><div class="prow" data-motion-key="child">Child</div></section>';F.patch(root,full,false);
      const parent=root.firstElementChild,child=parent.firstElementChild;
      F.batch(root,()=>{F.patch(parent,'');F.patch(root,full);});
      const retained=parent.firstElementChild===child&&child.isConnected;F.finish();root.remove();return retained;
    });
    assert.equal(restoredAncestor,true,'restoring an equal ancestor must cancel its descendants queued for retirement');
    const repeatedRemoval=await page.evaluate(()=>{
      const F=__perf.Flow,root=document.createElement('div');Object.assign(root.style,{position:'fixed',left:'10px',top:'10px',width:'200px'});document.body.append(root);
      const a='<div class="prow" data-motion-key="a">A</div>',b='<div class="prow" data-motion-key="b">B</div>',cut=`<div data-motion-key="wrapper">${a}</div>`;
      const full=`<section data-motion-key="ancestor"><div data-motion-key="container"><div data-motion-key="wrapper">${a}${b}</div></div></section>`;F.patch(root,full,false);
      const container=root.firstElementChild.firstElementChild,reading=container.querySelector('[data-motion-key="b"]');
      F.batch(root,()=>{F.patch(container,cut);F.patch(root,full);});const restored=reading.isConnected;
      F.patch(container,cut);const removed=!reading.isConnected;F.finish();root.remove();return{restored,removed};
    });
    assert.deepEqual(repeatedRemoval,{restored:true,removed:true},'restored ancestor paths must invalidate nested caches before a repeated tail removal');
    const hierarchy=await page.evaluate(()=>{
      const F=__perf.Flow,root=document.createElement('div');Object.assign(root.style,{position:'fixed',left:'10px',top:'10px',width:'200px'});document.body.append(root);
      F.patch(root,'<section class="pane-group" data-motion-key="group"><div class="prow" data-motion-key="nested-reading">Nested retirement</div></section>');F.finish(root);
      const group=root.firstElementChild;F.batch(root,()=>{F.patch(group,'');F.patch(root,'');});
      const copies=document.querySelectorAll('[data-flow-retiring] [data-motion-key="nested-reading"]').length;
      F.finish();root.remove();return copies;
    });
    assert.equal(hierarchy,1,'nested removals must paint a reading once when its ancestor also retires');
    const viewport=await page.evaluate(async()=>{
      const F=__perf.Flow,root=document.createElement('div');Object.assign(root.style,{position:'fixed',left:'10px',top:'10px',width:'200px',height:'60px',overflow:'hidden'});document.body.append(root);
      const row=k=>`<div data-motion-key="${k}" style="height:80px">${k}</div>`;F.patch(root,row('a')+row('b')+row('c'));F.finish(root);
      for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);
      F.patch(root,row('b')+row('a')+row('c'));
      for(let i=0;i<3&&!F.value(root.firstElementChild,'entry');i++)await new Promise(requestAnimationFrame);
      const b=root.firstElementChild,c=root.lastElementChild,state={visibleEntry:!!F.value(b,'entry'),visibleLayout:!!F.value(b,'layout'),hiddenLayout:!!F.value(c,'layout')};
      F.finish(root);root.remove();return state;
    });
    assert.deepEqual(viewport,{visibleEntry:true,visibleLayout:false,hiddenLayout:false},'newly visible readings enter locally; unseen readings do not run position springs');
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
    await page.waitForFunction(()=>__perf.Flow.reduced());
    const reduced=await measure('reduced-motion',async()=>{await call('reference',true);await call('pane','bars');await call('forecast','states');await call('reference',false);});
    assert.equal(reduced.measures,0,'reduced motion must bypass intrinsic measurement clones');
    const focus=await page.evaluate(()=>{
      const F=__perf.Flow,root=document.createElement('div');Object.assign(root.style,{position:'fixed',left:'10px',top:'10px'});document.body.append(root);
      F.patch(root,'<button data-motion-key="a">A</button><button data-motion-key="b">B</button>');
      const button=root.firstElementChild;button.focus();F.patch(root,'<button data-motion-key="b">B</button><button data-motion-key="a">A</button>');
      const state={retained:button.isConnected,focused:document.activeElement===button,reordered:root.firstElementChild.dataset.motionKey==='b'};root.remove();return state;
    });
    assert.deepEqual(focus,{retained:true,focused:true,reordered:true},'reduced-motion reorders must retain live keyboard focus');
    const nested=await page.evaluate(()=>{
      const F=__perf.Flow,root=document.createElement('div');document.body.append(root);
      const inside='<strong>Original</strong><p>Foot</p>',outer=`<section data-motion-key="child">${inside}</section>`;F.patch(root,outer);
      const child=root.firstElementChild;F.patch(child,'<strong>Nested update</strong><p>Foot</p>');F.patch(root,outer);
      const ancestorRestored=child===root.firstElementChild&&child.innerHTML===inside;
      F.patch(child,inside);F.patch(root,'<section data-motion-key="child"><strong>Parent update</strong><p>Foot</p></section>');F.patch(child,inside);
      const descendantRestored=child.innerHTML===inside;root.remove();return{ancestorRestored,descendantRestored};
    });
    assert.deepEqual(nested,{ancestorRestored:true,descendantRestored:true},'nested patches must invalidate enclosing and retained descendant markup caches');
    const stable=await page.evaluate(()=>{
      const F=__perf.Flow,root=document.createElement('div');document.body.append(root);
      F.patch(root,'<button data-motion-key="a" aria-label="11" style="color:red"><span>11</span></button><button data-motion-key="b">B</button>',false);
      const a=root.firstElementChild,text=a.firstElementChild.firstChild;
      F.patch(root,'<button data-motion-key="a" aria-label="12" style="color:blue!important"><span>12</span></button><button data-motion-key="b">B</button>',false,true);
      const updated=root.firstElementChild===a&&a.firstElementChild.firstChild===text&&text.nodeValue==='12'&&a.getAttribute('aria-label')==='12'&&a.style.getPropertyPriority('color')==='important';
      a.focus();F.batch(root,()=>F.patch(root,'<button data-motion-key="b">B</button><button data-motion-key="a" aria-label="12" style="color:blue!important"><span>12</span></button>',true,true),false);
      const reordered=root.lastElementChild===a&&document.activeElement===a;
      root.remove();return{updated,reordered};
    });
    assert.deepEqual(stable,{updated:true,reordered:true},'stable readouts must retain nodes and update semantics/styles, with keyed reconciliation on a structure change');
    assert.deepEqual(errors,[]);
    }finally{await context.close();}
  }
  }finally{await browser.close();}
}
console.log(`Motion performance: ${reports.length} browser/workload samples passed; input/render budgets, bounded measurements/raster area, idle DOM, pixel reuse, retained styling and cleanup.`);
}finally{await new Promise(resolve=>server.close(resolve));}
