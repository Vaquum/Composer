// Real application, offline presentation data. Absolute budgets describe this
// automated environment; structural guards remain useful on every machine.
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import referenceThumbnail from './thumbnail-reference.mjs';

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
    results:Array.from({length:12},(_,i)=>{
      const run=raw.map(([o,h,l,c],j)=>[o,h+(i+1)*(j%3+1)*.07,l,c]);
      return{tf:'15m',start:1700000000+i*900,raw:run,drawn:run.map(([o,h,l,c])=>[l,Math.min(o,c),Math.max(o,c),h]),picks:Array.from({length:n},(_,j)=>j),broken:[],flips:0,off:i*.01,next:null,nextWhy:'end'};
    }),
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
      window.__samples={frames:[],work:[],tasks:[],calls:[],paints:[],observers:[],timers:[],presentation:{},frameTime:0,frameWork:0,mutations:0,clones:0,measures:0};
      const raf=window.requestAnimationFrame;
      window.requestAnimationFrame=callback=>raf.call(window,now=>{
        if(__samples.active&&now!==__samples.frameTime){if(__samples.frameTime){__samples.work.push(__samples.frameWork);__samples.frameWork=0;}__samples.frameTime=now;}
        const t=performance.now();try{return callback(now);}finally{if(__samples.active)__samples.frameWork+=performance.now()-t;}
      });
      const timeout=window.setTimeout;
      window.setTimeout=function(callback,delay,...args){
        if(typeof callback!=='function')return timeout.call(window,callback,delay,...args);
        return timeout.call(window,function(...values){const t=performance.now();try{return callback.apply(this,values);}finally{if(__samples.active){const ms=performance.now()-t;__samples.timers.push(ms);__samples.calls.push(ms);__samples.frameWork+=ms;}}},delay,...args);
      };
      const Observer=window.ResizeObserver;
      window.ResizeObserver=class extends Observer{constructor(callback){super((...args)=>{
        const t=performance.now();try{return callback(...args);}finally{if(__samples.active){const ms=performance.now()-t;__samples.observers.push(ms);__samples.calls.push(ms);__samples.frameWork+=ms;}}
      });}};
      if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>__samples.tasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask'});
      const clone=Node.prototype.cloneNode;
      Node.prototype.cloneNode=function(...args){__samples.clones++;return clone.apply(this,args);};
      const append=Element.prototype.append;
      Element.prototype.append=function(...nodes){__samples.measures+=nodes.filter(n=>n.nodeType===1&&n.hasAttribute('data-flow-measuring')).length;return append.apply(this,nodes);};
    });
    await page.route('https://fonts.**/**',r=>r.abort());await page.goto(base);await settle(page);
    await page.evaluate(n=>{while(__perf.S.bars.length<n)__perf.Ops.add();},n);
    const data=fixture(n);await seed(page,data);await settle(page);
    const thumbnails=await page.evaluate(async reference=>{
      const legacy=new Function('return ('+reference+')')(),props=['fill','fill-opacity','stroke','stroke-width','stroke-dasharray'],dpr=Math.min(2,devicePixelRatio);
      const raster=async markup=>{
        const host=document.createElement('div');host.inert=true;host.style.cssText='position:fixed;left:-10000px;top:0;width:132px;height:80px';host.innerHTML=markup;document.body.append(host);
        const svg=host.firstElementChild,nodes=[...svg.querySelectorAll('*')],styles=nodes.map(node=>{const style=getComputedStyle(node);return props.map(key=>[key,style.getPropertyValue(key)]);});
        nodes.forEach((node,i)=>styles[i].forEach(([key,value])=>node.style.setProperty(key,value)));
        svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('width','132');svg.setAttribute('height','80');
        const count=nodes.length,url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));host.remove();
        try{const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});const canvas=document.createElement('canvas');canvas.width=132*dpr;canvas.height=80*dpr;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,canvas.width,canvas.height);return{pixels:ctx.getImageData(0,0,canvas.width,canvas.height).data,count};}
        finally{URL.revokeObjectURL(url);}
      };
      const report=[];
      for(let theme=0;theme<2;theme++){
      for(const [count,flat]of [[2,false],[20,false],[24,false],[20,true]]){
        let close=50;const raw=Array.from({length:count},(_,i)=>{const open=close;close=flat?50:open+[7,-5,0][i%3];return flat?[50,50,50,50]:[open,Math.max(open,close)+8,Math.min(open,close)-6,close];});
        const result={raw,picks:Array.from({length:count},(_,i)=>i).filter(i=>![2,7,12,17].includes(i)),broken:[0,1]},held=[{h:{color:true,bar:0}},{h:{a:[0,3],b:[1,2]}}];
        const before=await raster(legacy(result,held)),after=await raster(__perf.Match.thumb(result,held));let max=0;
        for(let i=0;i<before.pixels.length;i++)max=Math.max(max,Math.abs(before.pixels[i]-after.pixels[i]));
        report.push({theme,count,flat,max,before:before.count,after:after.count});
      }
      document.querySelector('#theme').click();
      if(__perf.Match.presentedResults?.[0]?.raw.length>4){
        const image=document.querySelector('#emaki .card svg image'),template=document.createElement('template');
        template.innerHTML=__perf.Match.thumb(__perf.Match.presentedResults[0],__perf.Match.presentedSent.held);
        if(image?.getAttribute('href')!==template.content.querySelector('image')?.getAttribute('href'))throw Error('displayed thumbnail palette did not refresh with theme');
      }
      }
      return report;
    },referenceThumbnail.toString());
    for(const image of thumbnails){
      assert.ok(image.max<=1,`thumbnail pixels changed beyond one 8-bit raster rounding unit: ${JSON.stringify(image)}`);
      if(image.count>=20)assert.ok(image.after<=image.before/2,'large thumbnails must remove at least half their SVG nodes');
    }
    await settle(page);
    const painted=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const stillPaper=await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});
    const paperScroll=await page.evaluate(()=>{
      const candidates=[...new Set([document.body,document.scrollingElement])];
      for(const node of candidates){
        if(!node||node.scrollHeight<=node.clientHeight)continue;
        const before=node.scrollTop;node.scrollTop=1;const moves=node.scrollTop>0;node.scrollTop=before;
        if(moves)return{selector:node===document.body?'body':'html',initial:before,max:node.scrollHeight-node.clientHeight};
      }
      return{selector:'body',initial:document.body.scrollTop,max:0};
    }),viewportHeight=page.viewportSize().height;
    let previous=-1,tiles=0;
    // Full-page capture can resize a mobile viewport and change the scene itself.
    // Compare fixed viewport tiles instead, covering the complete document.
    for(let top=0;;top+=viewportHeight){
      const maximum=await page.evaluate(selector=>{const node=document.querySelector(selector);return node.scrollHeight-node.clientHeight;},paperScroll.selector);
      const target=Math.min(top,Math.max(0,maximum));
      await page.evaluate(({selector,target})=>document.querySelector(selector).scrollTo(0,target),{selector:paperScroll.selector,target});await painted();await settle(page);
      const position=await page.evaluate(selector=>{const node=document.querySelector(selector);return{top:node.scrollTop,max:node.scrollHeight-node.clientHeight,attachment:getComputedStyle(document.body).backgroundAttachment};},paperScroll.selector),scroll=position.top;
      assert.ok(Math.abs(scroll-Math.min(target,position.max))<1,'paper tiles must reach the requested offset on the actual scroller');
      assert.ok(scroll>previous,'each paper tile must advance the actual scroll offset');previous=scroll;tiles++;
      if(scroll>0)assert.equal(position.attachment,'scroll','outer body/document scrolling must restore the original paper attachment');
      const layeredPaper=await page.screenshot();
      const originalPaper=await page.addStyleTag({content:'body{background-attachment:scroll!important}'});
      try{
        await painted();const original=await page.screenshot();
        if(!layeredPaper.equals(original)){
          const difference=await page.evaluate(async({a,b})=>{
            const pixels=async src=>{const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=src;});const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,canvas.width,canvas.height).data;};
            const x=await pixels(a),y=await pixels(b);if(x.length!==y.length)return{max:255,mean:255};let max=0,total=0,worst=null;
            for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);if(d>max){max=d;worst={x:Math.floor(i/4)%Math.round(innerWidth*devicePixelRatio),y:Math.floor(Math.floor(i/4)/Math.round(innerWidth*devicePixelRatio)),channel:i%4,a:x[i],b:y[i]};}total+=d;}return{max,mean:total/x.length,worst};
          },{a:'data:image/png;base64,'+layeredPaper.toString('base64'),b:'data:image/png;base64,'+original.toString('base64')});
          // A separate compositor pass can round translucent glyph edges twice.
          assert.ok(difference.max<=2&&difference.mean<.005,`paper cache changed pixels at scroll ${scroll} beyond compositor rounding: ${JSON.stringify(difference)}`);
        }
      }finally{await originalPaper.evaluate(node=>node.remove());}
      if(scroll>=position.max-1)break;
    }
    if(paperScroll.max>0)assert.ok(tiles>1,'tall documents must compare more than the initial viewport');
    await stillPaper.evaluate(node=>node.remove());
    await page.evaluate(({selector,initial})=>document.querySelector(selector).scrollTo(0,initial),paperScroll);await painted();await settle(page);
    const graphics=await page.evaluate(()=>{
      const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl');if(!gl)return'unavailable';
      const info=gl.getExtension('WEBGL_debug_renderer_info'),renderer=info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
      gl.getExtension('WEBGL_lose_context')?.loseContext();return renderer;
    });
    let cdp;
    if(type===chromium){cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Emulation.setCPUThrottlingRate',{rate});}
    await page.evaluate(()=>{
      const A=__perf;__samples.active=false;
      const drawFan=A.Stage.drawFan;
      A.Stage.drawFan=function(...args){const before=this.fanCache;try{return drawFan.apply(this,args);}finally{if(__samples.active&&before!==this.fanCache)__samples.fanRasters++;}};
      const cohorts=new WeakMap();let cohortId=0;
      for(const [owner,names]of [[A.Stage,['move','down','up']],[A.Match,['presentResult']]])for(const name of names){
        const handler=owner[name];
        owner[name]=function(...args){const t=performance.now(),part=name==='presentResult'?['cards','right','left'][this.presentation?.tasks.length-1]:null;
          if(__samples.active&&part&&args[0]!==false){const pending=this.presentation;if(!cohorts.has(pending))cohorts.set(pending,++cohortId);__samples.presentationFrames.push({cohort:cohorts.get(pending),frame:__samples.frameTime});}
          try{return handler.apply(this,args);}finally{if(__samples.active){const duration=performance.now()-t;__samples.calls.push(duration);if(part)__samples.presentation[part]=Math.max(__samples.presentation[part]||0,duration);}}};
      }
      let previous=0;
      const frame=now=>{if(__samples.active&&previous)__samples.frames.push(now-previous);previous=__samples.active?now:0;requestAnimationFrame(frame);};requestAnimationFrame(frame);
      document.querySelector('#cv').addEventListener('pointermove',()=>{const t=performance.now();requestAnimationFrame(()=>{if(__samples.active)__samples.paints.push(performance.now()-t);});});
      new MutationObserver(list=>{if(__samples.active)__samples.mutations+=list.length;}).observe(document.querySelector('#forecast-panel'),{subtree:true,attributes:true,childList:true,characterData:true});
    });
    const measure=async(label,action)=>{
      await settle(page);
      await page.evaluate(()=>{for(const key of ['frames','work','tasks','calls','paints','observers','timers','presentationFrames'])__samples[key]=[];for(const key of ['mutations','clones','measures','frameTime','frameWork','fanRasters'])__samples[key]=0;__samples.presentation={};__samples.actions={};__samples.active=true;});
      await action();await settle(page);
      const sample=await page.evaluate(()=>{__samples.active=false;if(__samples.frameTime)__samples.work.push(__samples.frameWork);return{...__samples};});
      const p95=a=>a.length?a.slice().sort((a,b)=>a-b)[Math.floor((a.length-1)*.95)]:0;
      const report={browser:name,graphics,frameGate:controlledGraphics,bars:n,width,dpr,scenario:label,frames:sample.frames.length,
        frameP95:+p95(sample.frames).toFixed(1),workP95:+p95(sample.work).toFixed(1),callMax:+Math.max(0,...sample.calls).toFixed(1),
        paintP95:+p95(sample.paints).toFixed(1),observerMax:+Math.max(0,...sample.observers).toFixed(1),timerMax:+Math.max(0,...sample.timers).toFixed(1),taskMax:Math.max(0,...sample.tasks),presentationMax:Object.fromEntries(Object.entries(sample.presentation).map(([k,v])=>[k,+v.toFixed(1)])),actionMax:Object.fromEntries(Object.entries(sample.actions).map(([k,v])=>[k,+v.toFixed(1)])),measurements:sample.measures,mutations:sample.mutations};
      reports.push(report);console.log(JSON.stringify(report));
      const presentationFrames=new Map();for(const step of sample.presentationFrames){if(!presentationFrames.has(step.cohort))presentationFrames.set(step.cohort,new Set());const frames=presentationFrames.get(step.cohort);assert.ok(!frames.has(step.frame),'large result parts must commit in separate paint frames');frames.add(step.frame);}
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
        const r=A.Match.result,layout=value==='layout',replace=value==='replace'||layout,refreshSerial=(r.refreshSerial||0)+1;
        A.Match.onmsg({...r,type:'result',id:A.Match.id,refreshSerial,results:r.results.map(x=>({...x,start:x.start+(replace?1e6:900),raw:x.raw.map((b,j)=>b.map((v,k)=>v+(k===1?(j%3+1)*.013*refreshSerial:0))),drawn:x.drawn.map((b,j)=>b.map((v,k)=>v+(k===3?(j%3+1)*.013*refreshSerial:0)))})),
          panes:{...r.panes,rows:r.panes.rows.map((w,i)=>({...w,d:layout?(i+1)/r.panes.rows.length:w.d,set:w.set.map(v=>v+(layout?1:.001))})),cont:{...r.panes.cont,fan:r.panes.cont.fan.map(q=>q.map(v=>v+.001))}}});
      }
      const elapsed=performance.now()-t;__samples.calls.push(elapsed);
      const action=kind+':'+value;__samples.actions[action]=Math.max(__samples.actions[action]||0,elapsed);
    },{kind,value});
    await measure('pane',async()=>{for(const v of ['bars','ledger','signal']){await call('pane',v);await settle(page);await call('paneRight',v);await settle(page);}});
    const size=await measure('disclosure',async()=>{await call('disclosure');});
    assert.ok(size.measures<=3,'opening a fixed-width disclosure must not clone/measure once per animation frame');
    const framing=await measure('reference',async()=>{for(const topic of [2,3,4]){await call('reference',true);await settle(page);await call('topic',topic);await settle(page);await call('reference',false);await settle(page);}});
    assert.ok(framing.fanRasters<=12,'framing must reuse the blurred fan rather than rebuilding it every spring frame');
    const fanParity=await page.evaluate(()=>{
      const A=__perf,combined=()=>{
        const current=A.Stage.forecastSurface,C=current.flowBox,dpr=current.flowDpr,canvas=document.createElement('canvas');canvas.width=Math.round(C.w*dpr);canvas.height=Math.round(C.h*dpr);
        const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.translate(-C.x,-C.y);
        if(A.Stage.washState)A.Stage.paintWash(ctx,A.Stage.washState);
        ctx.drawImage(current,0,0,current.flowWidth,current.flowHeight,C.x,C.y,C.w,C.h);return canvas.toDataURL();
      };
      const before=combined();A.Stage.fanCache=null;A.Stage.forecastPaint=null;A.Stage.draw();
      const same=before===combined(),state=A.Stage.washState,origin=A.Stage.wrap.getBoundingClientRect();
      const aligned=!state||[...A.Stage.washRoot.children].every((part,i)=>{const box=part.getBoundingClientRect(),piece=state.pieces[i];return Math.abs(box.left-origin.left-piece[2])<.1&&Math.abs(box.top-origin.top-state.top)<.1&&Math.abs(box.width-(piece[3]-piece[2]))<.1;});
      A.Stage.changeForecast();const snapshot=A.Stage.departingForecast.toDataURL()===before;A.Stage.settle();
      return{same,aligned,snapshot};
    });
    assert.deepEqual(fanParity,{same:true,aligned:true,snapshot:true},'composited fan pixels, projected layers and departure snapshots must match a fresh native render');
    const collapsedWash=await page.evaluate(()=>{
      const A=__perf,saved=A.S.bars.map(b=>b.dv.slice());
      try{for(const b of A.S.bars)b.dv.fill(42);A.Stage.draw();return !A.Stage.washState&&(!A.Stage.washRoot||A.Stage.washRoot.hidden);}
      finally{A.S.bars.forEach((b,i)=>b.dv.set(saved[i]));A.Stage.draw();}
    });
    assert.ok(collapsedWash,'a collapsed drawing must hide the previous composited fan wash');
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
      const queued=await page.evaluate(async()=>{
        const A=__perf,r=A.Match.result,shown=document.querySelector('#emaki .card').dataset.motionKey,send=offset=>A.Match.onmsg({...r,type:'result',id:A.Match.id,results:r.results.map(x=>({...x,start:x.start+offset}))});
        // An internal canvas resize must not flush queued result presentation.
        A.Stage.resizePending=true;A.App.redraw();send(1e6);send(2e6);A.Match.setTrace(0);const trace=A.Stage.trace.key;await new Promise(requestAnimationFrame);return{keys:A.Match.result.results.map(x=>A.Match.resultKeyOf(x)),shown,trace,remaining:A.Match.presentation?.tasks.length};
      });
      assert.equal(queued.trace,queued.shown,'input during queued presentation must address the displayed historical card');
      assert.equal(queued.remaining,2,'superseding results must share one scheduled presentation callback');
      await settle(page);
      assert.deepEqual(await page.locator('#emaki .card').evaluateAll(nodes=>nodes.map(n=>n.dataset.motionKey)),queued.keys,'queued presentation must apply only the latest result');
      const accepted=await page.evaluate(()=>{const A=__perf,r=A.Match.result;A.Match.onmsg({...r,type:'result',id:A.Match.id,results:r.results.slice(1)});A.Match.sentKey='';A.Match.send();return A.Match.result.results.map(x=>A.Match.resultKeyOf(x));});
      await settle(page);
      assert.deepEqual(await page.locator('#emaki .card').evaluateAll(nodes=>nodes.map(n=>n.dataset.motionKey)),accepted,'a new search must retain the last accepted cohort even before presentation starts');
      for(const newSearch of [false,true,'unstarted']){
      const failedCohort=await page.evaluate(newSearch=>{
        const A=__perf,r=A.Match.result,next={...r,type:'result',id:A.Match.id,results:r.results.slice(1),panes:{...r.panes,rows:r.panes.rows.map(w=>({...w,set:w.set.map(v=>v+2)})),cont:{...r.panes.cont,aboveHigh:[.91,.9,.92]}}};
        const sent=A.Match.sent,tfs=A.S.tfOn.slice();A.Match.onmsg(next);if(newSearch!=='unstarted')A.Match.presentResult();
        if(newSearch){A.S.tfOn.fill(false);A.S.tfOn[sent.q.tfs[0]?1:0]=true;A.Match.sentKey='';A.Match.send();}
        const message=document.querySelector('#mmsg').textContent;
        if(newSearch===true){A.Match.presentResult();A.Match.presentResult();}
        const searching=!newSearch||document.querySelector('#prog').hidden===false&&document.querySelector('#mmsg').textContent===message&&document.querySelector('#emaki').classList.contains('stale');
        A.Match.fail('Synthetic presentation failure');A.S.tfOn=tfs;
        if(newSearch==='unstarted'){A.Panes.choose('left','ledger');A.Panes.choose('right','bars');}
        const left=document.createElement('div'),right=document.createElement('div');left.innerHTML=A.PaneDesigns.left(A.Panes.views.left,next,{barCount:sent.q.bars.length});right.innerHTML=A.PaneDesigns.right(A.Panes.views.right,next);
        const caption=document.createElement('div');caption.innerHTML=A.PaneDesigns.caption(next,{timeframes:sent.q.tfs.map((on,k)=>({on,k,label:['15m','30m','1h','2h','4h'][k]})).filter(t=>t.on),nextWords:()=>''});
        return{keys:next.results.map(x=>A.Match.resultKeyOf(x)),left:[...left.querySelectorAll('[data-reading]')].map(n=>n.textContent),right:right.textContent,caption:caption.textContent,searching};
      },newSearch);
      await settle(page);
      assert.ok(failedCohort.searching,'finishing an accepted cohort must preserve the next search status');
      assert.equal(await page.locator('#mmsg').textContent(),'Synthetic presentation failure','queued presentation must not overwrite a failure');
      assert.deepEqual(await page.locator('#emaki .card').evaluateAll(nodes=>nodes.map(n=>n.dataset.motionKey)),failedCohort.keys,'failure must retain a complete accepted cohort');
      assert.deepEqual(await page.locator('#lrows [data-reading]').evaluateAll(nodes=>nodes.map(n=>n.textContent)),failedCohort.left,'failure must keep the left pane on the accepted cohort');
      assert.equal(await page.locator('#rbecame').textContent(),failedCohort.right,'failure must keep the right pane on the accepted cohort');
      assert.equal(await page.locator('#lcap').textContent(),failedCohort.caption,'an accepted cohort must retain its original query context');
      }
      await call('pane','signal');await call('paneRight','signal');await settle(page);
    }
    for(const variant of ['bars','ledger']){
      await seed(page,data);await settle(page);await call('pane',variant);await settle(page);
      if(variant==='ledger'){
        await page.evaluate(()=>{const root=document.querySelector('#lrows');root.querySelector('details[data-detail="more"]').open=false;__perf.Flow.details(root);});
        await settle(page);
        await page.locator('#lrows tbody tr').first().scrollIntoViewIfNeeded();
        const crossing=await page.evaluate(async()=>{
          const A=__perf,root=document.querySelector('#lrows'),row=root.querySelector('tbody tr'),key=row.dataset.reading,text=row.textContent,r=A.Match.result;
          const next={...r,panes:{...r.panes,rows:r.panes.rows.map((w,i)=>({...w,d:(i+1)/r.panes.rows.length,set:w.set.map(v=>v+1)}))}};
          A.Panes.render(next,'left');
          await new Promise(resolve=>{const observer=new ResizeObserver(()=>{observer.disconnect();resolve();});observer.observe(root.closest('.pane'));});
          const copy=[...document.querySelectorAll('[data-flow-retiring] tr')].find(node=>node.dataset.reading===key),newTop=root.querySelector('tbody tr');
          const state={retained:row.isConnected&&root.querySelector('details[data-detail="more"]').contains(row),snapshot:copy?.textContent===text,arrival:!!A.Flow.value(newTop,'entry')};
          A.Flow.finish();return state;
        });
        assert.deepEqual(crossing,{retained:true,snapshot:true,arrival:true},'ledger crossings preserve node identity and motion at a closed disclosure boundary');
        await seed(page,data);await settle(page);
      }
      await page.evaluate(()=>{for(const detail of document.querySelectorAll('#lrows details'))detail.open=true;__perf.Flow.details(document.querySelector('#lrows'));});
      await settle(page);
      await measure(`refresh-${variant}`,async()=>{await call('refresh');await settle(page);await call('refresh','layout');});
      const parity=await page.evaluate(variant=>{
        const A=__perf,expected=document.createElement('div');expected.innerHTML=A.PaneDesigns.left(variant,A.Match.result,{barCount:A.S.bars.length});
        const fields=root=>[...root.querySelectorAll('[data-reading]')].map(node=>({key:node.dataset.reading,text:node.textContent,aria:node.querySelector('.trk')?.getAttribute('aria-label'),styles:[...node.querySelectorAll('.trk i')].map(i=>i.getAttribute('style'))}));
        return JSON.stringify(fields(document.querySelector('#lrows')))===JSON.stringify(fields(expected));
      },variant);
      assert.ok(parity,`${variant} refresh must match the full renderer`);
      if(variant==='ledger'){
        const normalization=await page.evaluate(()=>{
          const A=__perf,r=A.Match.result,root=document.querySelector('#lrows'),row=root.querySelector('tr[data-reading="0-vol"]');
          const next={...r,panes:{...r.panes,rows:r.panes.rows.map(w=>w.key==='vol'?{...w,log:!w.log}:w)}};
          A.Panes.render(next,'left');const expected=document.createElement('div');expected.innerHTML=A.PaneDesigns.left('ledger',next,{barCount:A.S.bars.length});
          const fields=node=>[...node.querySelectorAll('.pane-ledger tbody tr')].map(n=>n.textContent),same=JSON.stringify(fields(root))===JSON.stringify(fields(expected)),retained=row.isConnected&&root.querySelector('tr[data-reading="0-vol"]')===row;A.Flow.finish();return{same,retained};
        });
        assert.deepEqual(normalization,{same:true,retained:true},'retained ledger rows must update normalization labels as well as numeric cells');
      }
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
    const retainedRoot=await page.evaluate(()=>{
      const A=__perf,ptr=A.Stage.ptr,hov=A.Stage.hov;A.Stage.ptr=A.Stage.hov=null;
      const pixels=()=>A.Stage.cv.getContext('2d').getImageData(0,0,A.Stage.cv.width,A.Stage.cv.height).data;
      A.Stage.rootPaintKey=null;A.Stage.draw();const fresh=pixels();A.Stage.draw();const cached=pixels();
      const equal=fresh.every((v,i)=>v===cached[i]),before=A.S.bars[0].dv[0];A.S.bars[0].dv[0]-=1;A.Stage.draw();const changed=pixels();
      const invalidated=changed.some((v,i)=>v!==fresh[i]);A.S.bars[0].dv[0]=before;A.Stage.ptr=ptr;A.Stage.hov=hov;A.Stage.draw();
      return{equal,invalidated};
    });
    assert.deepEqual(retainedRoot,{equal:true,invalidated:true},'retained root pixels must match a fresh paint and update with drawing geometry');
    const quiet=await measure('stationary-forecast',async()=>{
      await page.evaluate(async()=>{for(let i=0;i<24;i++){__perf.Forecast.sync(__perf.Stage.geom());await new Promise(requestAnimationFrame);}});
    });
    assert.equal(quiet.mutations,0,'stationary forecast frames must not rewrite semantic or hit-target DOM');
    if(cdp){
      const density=dpr===1?2:1;
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:density,mobile:false});
      await page.evaluate(()=>__perf.App.redraw());await settle(page);
      assert.equal(await page.evaluate(()=>__perf.Stage.forecastSurface.flowDpr),density,'a display-density change must repaint the forecast at native density');
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:dpr,mobile:false});
      await page.evaluate(()=>__perf.App.redraw());await settle(page);
    }
    const fontPaint=await page.evaluate(()=>{
      const A=__perf,version=A.Stage.paintVersion||0;document.fonts.dispatchEvent(new Event('loadingdone'));
      return (A.Stage.paintVersion||0)>version;
    });
    assert.ok(fontPaint,'late font loading must invalidate cached forecast glyphs');
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
    const unmappedWrapper=await page.evaluate(()=>{
      const F=__perf.Flow,root=document.createElement('div');root.style.cssText='position:fixed;left:10px;top:10px;width:220px';document.body.append(root);
      const full='<section data-motion-key="outer"><div data-motion-key="wrapper"><div class="prow" data-reading="wrapped">Wrapped reading</div></div></section>';F.patch(root,full,false);
      const section=root.firstElementChild,wrapper=section.firstElementChild,reading=wrapper.firstElementChild;
      F.batch(root,()=>{F.patch(section,'');F.patch(root,full);});
      const restored=section.firstElementChild===wrapper&&wrapper.firstElementChild===reading&&reading.isConnected;
      F.batch(root,()=>F.patch(section,''));const copies=document.querySelectorAll('[data-flow-retiring] [data-reading="wrapped"]').length;
      F.finish();root.remove();return{restored,copies};
    });
    assert.deepEqual(unmappedWrapper,{restored:true,copies:1},'unmapped wrapper removal must retire captured readings once and permit restoration within a batch');
    const deferredLayout=await page.evaluate(async()=>{
      const F=__perf.Flow,root=document.createElement('div');root.style.cssText='position:fixed;left:10px;top:10px;width:220px;height:60px;overflow:auto;overflow-anchor:none;display:flex;flex-direction:column';document.body.append(root);
      const a='<button data-motion-key="a" style="height:40px;flex:none">A</button>',b='<button data-motion-key="b" style="height:40px;flex:none">B</button>';F.patch(root,a+b,false);
      const button=root.firstElementChild,top=button.getBoundingClientRect().top;button.focus();let pending=false;
      const firstPaint=await new Promise(resolve=>{
        const probe=new ResizeObserver(()=>{probe.disconnect();resolve(Math.abs(button.getBoundingClientRect().top-(top-root.scrollTop))<.5&&!!F.value(button,'layout'));});
        F.batch(root,()=>F.patch(root,b+a),true,true);pending=F.active();root.scrollTop=20;probe.observe(root);
      });
      F.finish(root);F.batch(root,()=>F.patch(root,a+b),true,true);F.finish(root);
      const state={pending,firstPaint,retained:root.firstElementChild===button,focused:document.activeElement===button,settled:!F.value(button,'layout')};root.remove();return state;
    });
    assert.deepEqual(deferredLayout,{pending:true,firstPaint:true,retained:true,focused:true,settled:true},'deferred layout must preserve the first painted position, focus, identity and immediate lifecycle settlement');
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
    for(const warmed of [false,true]){
    const nestedArrival=await page.evaluate(async warmed=>{
      const F=__perf.Flow,root=document.createElement('div');root.style.cssText='position:fixed;left:10px;top:10px;width:220px;height:70px;overflow:hidden';document.body.append(root);
      const space='<div data-motion-key="space" style="height:140px"></div>',group='<section class="pane-group" data-motion-key="group"><div class="prow" data-reading="arrival-a" style="height:80px">A</div><div class="prow" data-reading="arrival-b" style="height:80px">B</div></section>';
      F.patch(root,space+group,warmed);F.finish();for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);
      const section=root.lastElementChild,reading=section.firstElementChild;F.patch(root,group+space);
      for(let i=0;i<3&&!F.value(section,'entry');i++)await new Promise(requestAnimationFrame);
      const state={parent:!!F.value(section,'entry'),child:!!F.value(reading,'entry'),childOpacity:+getComputedStyle(reading).opacity};F.finish();root.remove();return state;
    },warmed);
    assert.deepEqual(nestedArrival,{parent:true,child:false,childOpacity:1},'nested cached-offscreen arrivals must have one entry owner and one opacity/translation');
    }
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
    const reduced=await measure('reduced-motion',async()=>{await call('reference',true);await call('pane','bars');await call('forecast','states');await call('reference',false);
      // Reference resize is an explicit settlement boundary; test refresh after it.
      await settle(page);await call('refresh','layout');});
    if(n>10)assert.equal(reduced.presentationFrames.length,3,'reduced-motion refresh must still yield between all three result parts');
    assert.equal(reduced.measures,0,'reduced motion must bypass intrinsic measurement clones');
    const resizeFrame=await page.evaluate(async()=>{
      const A=__perf,draw=A.Stage.draw;let paints=0;A.Stage.draw=function(...args){paints++;return draw.apply(this,args);};
      try{A.Stage.resizePending=true;A.App.redraw();await new Promise(requestAnimationFrame);return{paints,settled:A.Stage.plot.ready,temporary:!!A.Stage.frameBox};}
      finally{A.Stage.draw=draw;}
    });
    assert.deepEqual(resizeFrame,{paints:1,settled:true,temporary:false},'resize settlement must draw one complete frame and release its geometry snapshot');
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
