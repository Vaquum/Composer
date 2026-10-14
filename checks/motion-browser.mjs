// Real UI and runtime, offline synthetic presentation fixtures; statistics have separate current-data checks.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { thumbnailBeforeBatching } from './thumbnail-reference.mjs';
const html=fs.readFileSync('index.html','utf8').replace('Panes.init();','window.__motionProbe={S,Stage,Match,Panes,Ref,Forecast,Ops,App,Flow,hist};\nPanes.init();');
const fixture=fs.readFileSync('checks/pane-designs.mjs','utf8');
const result=new Function(fixture.slice(fixture.indexOf('const row ='),fixture.indexOf('const before='))+'\nreturn r;')();
Object.assign(result.panes.cont,{fan:Array.from({length:6},(_,i)=>[-.2-i*.05,.2,.5+i*.08,1.2,1.6+i*.05]),sequences:[['UUUUUU',260],['IIIIII',100],['DDDDDD',39]],examples:{}});
Object.assign(result,{mode:'nearest',counts:[12,0,0,0,0],countsF:[12,0,0,0,0],ms:10,
  results:Array.from({length:12},(_,i)=>({tf:'15m',start:1700000000+i*900,raw:[[30,68,18,56],[56,80,18,36]],drawn:[[30,68,18,56],[56,80,18,36]],picks:[0,1],broken:[],flips:0,off:i*.01,next:null,nextWhy:'end'}))});
const screenshots=fs.mkdtempSync(path.join(os.tmpdir(),'composer-motion-'));
const assets=new Set(['motion.js','motion.css','panes.css','pane-designs.js','forecast.js','context.js']);
const server=http.createServer((request,response)=>{
  const path=new URL(request.url,'http://localhost').pathname.slice(1);
  if(!path){response.setHeader('Content-Type','text/html');response.end(html);return;}
  if(assets.has(path)){response.setHeader('Content-Type',path.endsWith('.css')?'text/css':'application/javascript');response.end(fs.readFileSync(path));return;}
  if(path==='bars'||path==='activity'){response.end(path==='bars'?'CBAR1x':'');return;}
  response.writeHead(404);response.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const settled=page=>page.waitForFunction(()=>!window.__motionProbe.App.running&&!window.__motionProbe.Flow.active()&&!document.getAnimations().some(a=>a.playState==='running'));
const seed=page=>page.evaluate(r=>{
  const M=window.__motionProbe.Match;M.ready=true;M.failed=false;M.sent=M.query();M.sentKey=M.key();
  M.onmsg({...r,type:'result',id:M.id});
},result);
try {
for(const [name,type] of [['Chromium',chromium],['WebKit',webkit]]){
 const browser=await type.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.stack||error.message));
  await page.addInitScript(()=>{window.Worker=class{postMessage(){} terminate(){}};});
  await page.route('https://fonts.**/**',route=>route.abort());
  await page.goto(base);await settled(page);await seed(page);await settled(page);
  const thumbnails=[2,20,24].map(n=>{
    // Maximum composition plus four skipped bars; up/down/flat, thin bodies,
    // faint skipped candles and both forms of broken-relation annotation.
    const shapes=[[30,68,18,56],[56,80,18,36],[40,70,20,40],[40,40.1,39.9,40.02],[40,40.1,39.9,39.98],[40,40,40,40]];
    const r={raw:Array.from({length:n},(_,i)=>shapes[i%shapes.length]),picks:Array.from({length:n},(_,i)=>i).filter(i=>i%4<2),broken:[0,1]};
    const held=[{h:{color:true,bar:0}},{h:{a:[0,1],b:[n-1,2]}}];
    return {r,held,expected:thumbnailBeforeBatching(r,held)};
  });
  const thumbnailPixels=await page.evaluate(async fixtures=>{
    const root=getComputedStyle(document.documentElement),color=v=>root.getPropertyValue(v).trim();
    const css=`.cu{fill:${color('--up')}}.cd{fill:${color('--down')}}.cz{fill:${color('--flat')}}.skip{fill-opacity:.22}.mk{fill:none;stroke:${color('--shu')};stroke-width:1.3}.mkl{fill:none;stroke:${color('--shu')};stroke-width:1;stroke-dasharray:2 2}`;
    const pixels=async(svg,dpr)=>{
      const source=svg.replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" width="132" height="80" ').replace('aria-hidden="true">',`aria-hidden="true"><style>${css}</style>`);
      const url=URL.createObjectURL(new Blob([source],{type:'image/svg+xml'}));
      try{
        const image=new Image();image.src=url;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=132*dpr;canvas.height=80*dpr;
        const context=canvas.getContext('2d');context.drawImage(image,0,0,canvas.width,canvas.height);
        return context.getImageData(0,0,canvas.width,canvas.height).data;
      }finally{URL.revokeObjectURL(url);}
    };
    const results=[];
    for(const {r,held,expected}of fixtures){
      const actual=window.__motionProbe.Match.thumb(r,held),documentOf=s=>new DOMParser().parseFromString(s,'image/svg+xml');
      const nodes=documentOf(actual),markers=s=>[...documentOf(s).querySelectorAll('.mk,.mkl')].map(n=>n.outerHTML);
      for(const dpr of[1,2]){
        const [a,b]=await Promise.all([pixels(actual,dpr),pixels(expected,dpr)]);let total=0,max=0;
        for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);total+=delta;max=Math.max(max,delta);}
        results.push({bars:r.raw.length,dpr,max,mean:total/a.length,paths:nodes.querySelectorAll('path').length,markers:JSON.stringify(markers(actual))===JSON.stringify(markers(expected))});
      }
    }
    return results;
  },thumbnails);
  for(const r of thumbnailPixels){
    assert.ok(r.paths<=12&&r.markers,`${name}: bounded thumbnail paths and unchanged broken-relation markers`);
    assert.ok(r.max<=8&&r.mean<=.02,`${name}: candle SVG raster parity at ${r.bars} bars/DPR ${r.dpr}: ${JSON.stringify(r)}`);
  }
  console.log(`${name} thumbnail raster parity: ${JSON.stringify(thumbnailPixels)}`);
  await page.screenshot({path:path.join(screenshots,name+'.png')});
  console.log(`${name} resting scene: ${path.join(screenshots,name+'.png')}`);
  const feedback=await page.evaluate(()=>['.seg button','.icon','.chip','.pane-step','.prog i'].map(s=>getComputedStyle(document.querySelector(s)).transitionDuration));
  assert.ok(feedback.every(d=>d.split(',').every(n=>parseFloat(n)===.1)),`${name}: common 100 ms feedback`);
  const channels=await page.evaluate(async()=>{
    const F=window.__motionProbe.Flow,node=document.querySelector('#copy');let old=0,latest=0;
    const write=({x})=>node.style.setProperty('--probe-x',String(x));
    F.spring(node,'probe',{from:{x:0},to:{x:100},write,done:()=>old++});
    for(let i=0;i<6;i++)await new Promise(requestAnimationFrame);
    const before=F.value(node,'probe').x;
    F.spring(node,'probe',{from:{x:0},to:{x:0},write,done:()=>latest++});
    const after=F.value(node,'probe').x;F.finish(node);node.style.removeProperty('--probe-x');return{before,after,old,latest};
  });
  assert.ok(channels.before>0);assert.equal(channels.after,channels.before);assert.equal(channels.old,0);assert.equal(channels.latest,1);
  const detached=await page.evaluate(()=>{
    const F=window.__motionProbe.Flow,node=document.createElement('div');document.body.append(node);let cleaned=0;
    F.spring(node,'detachment',{from:{height:0},to:()=>({height:F.value(node,'detachment')?10:20}),write:()=>{},done:()=>cleaned++});
    node.remove();F.finish();return{cleaned,active:F.active()};
  });
  assert.deepEqual(detached,{cleaned:1,active:false});
  const retained=await page.evaluate(()=>{
    const A=window.__motionProbe,chip=document.querySelector('.chip'),card=document.querySelector('#emaki .card');chip.focus();
    A.Match.render();return{chip:chip.isConnected,card:card.isConnected,focus:document.activeElement===chip};
  });
  assert.deepEqual(retained,{chip:true,card:true,focus:true},`${name}: refresh retains semantic actors and focus`);
  const retainedDetails=await page.evaluate(async()=>{
    const A=window.__motionProbe,detail=document.querySelector('#lnext details');detail.open=true;
    await new Promise(requestAnimationFrame);const body=detail.querySelector('.flow-detail-body');
    A.Panes.render(A.Match.result);const live=document.querySelector('#lnext details'),liveBody=live.querySelector('.flow-detail-body');
    const state={open:live.open,detailRetained:live===detail&&detail.isConnected,bodyRetained:liveBody===body&&body.isConnected,available:!liveBody.inert};
    detail.open=false;A.Flow.finish();return state;
  });
  assert.deepEqual(retainedDetails,{open:true,detailRetained:true,bodyRetained:true,available:true},`${name}: an open disclosure stays accessible on data refresh`);
  const reference=await page.evaluate(async()=>{
    const A=window.__motionProbe,width=A.Stage.wrap.clientWidth;document.querySelector('#reftoggle').focus();A.Ref.open();const initial=A.Stage.wrap.clientWidth;
    for(let i=0;i<6;i++)await new Promise(requestAnimationFrame);
    const before=A.Stage.wrap.clientWidth;A.Ref.close();const after=A.Stage.wrap.clientWidth,closed={hidden:A.Ref.pane.hidden,inert:A.Ref.pane.inert,focus:document.activeElement.id};
    A.Ref.open();const reopened=A.Stage.wrap.clientWidth;A.Flow.finish();return{width,initial,before,after,reopened,closed};
  });
  assert.ok(Math.abs(reference.initial-reference.width)<=1,`${name}: opening preserves presented geometry`);
  assert.ok(reference.before<reference.width);assert.ok(Math.abs(reference.before-reference.after)<=1);assert.ok(Math.abs(reference.after-reference.reopened)<=1);
  assert.deepEqual(reference.closed,{hidden:true,inert:true,focus:'reftoggle'});
  await page.evaluate(()=>window.__motionProbe.Ref.close());await settled(page);
  const spotlight=await page.evaluate(()=>{
    const A=window.__motionProbe;A.Ref.open();A.Flow.finish();document.querySelector('#ref-targets button').click();A.Ref.paint();A.Flow.finish();
    const decorative=A.Ref.spot.getAttribute('aria-hidden')==='true';A.Ref.clear();
    const state={decorative,hidden:A.Ref.spot.hasAttribute('hidden'),pointer:getComputedStyle(A.Ref.shade).pointerEvents,y:A.Ref.spot.style.getPropertyValue('--flow-enter-y')};
    A.Flow.finish();A.Ref.close();A.Flow.finish();return state;
  });
  assert.deepEqual(spotlight,{decorative:true,hidden:true,pointer:'none',y:'0px'},`${name}: spotlight exit releases input and preserves target geometry`);
  const disclosure=await page.evaluate(async()=>{
    const summary=document.querySelector('.lpane details summary'),detail=summary.parentElement,body=detail.querySelector('.flow-detail-body'),F=window.__motionProbe.Flow;
    const initial=detail.getBoundingClientRect().height;summary.click();const immediate=detail.open;
    for(let i=0;i<6;i++)await new Promise(requestAnimationFrame);
    const before=body.getBoundingClientRect().height;summary.click();const after=body.getBoundingClientRect().height,inert=body.inert;F.finish();
    return{initial,immediate,before,after,inert,closed:!detail.open,clean:!body.style.height};
  });
  assert.ok(disclosure.immediate&&disclosure.before>0&&disclosure.inert&&disclosure.closed&&disclosure.clean);
  assert.ok(Math.abs(disclosure.before-disclosure.after)<1,`${name}: disclosure reversal is continuous`);
  const menu=await page.evaluate(async()=>{
    const A=window.__motionProbe,pill=document.querySelector('.lpane .pane-current'),menu=document.querySelector('.lpane .pane-menu');pill.click();
    for(let i=0;i<4;i++)await new Promise(requestAnimationFrame);
    const before=Number(getComputedStyle(menu).opacity);A.Panes.closeMenus();const after=Number(getComputedStyle(menu).opacity),closed={hidden:menu.hidden,inert:menu.inert,aria:menu.getAttribute('aria-hidden')};
    pill.click();const reopen=Number(getComputedStyle(menu).opacity);A.Flow.finish();A.Panes.closeMenus();A.Flow.finish();return{before,after,reopen,closed};
  });
  assert.equal(menu.after,menu.before);assert.equal(menu.reopen,menu.after);assert.deepEqual(menu.closed,{hidden:true,inert:true,aria:'true'});
  const tooltip=await page.evaluate(async()=>{
    const A=window.__motionProbe,node=document.querySelector('#forecast-modes [data-view="states"]'),box=document.querySelector('#forecast-tooltip');
    node.focus();for(let i=0;i<4;i++)await new Promise(requestAnimationFrame);
    const described=node.getAttribute('aria-describedby'),before=Number(getComputedStyle(box).opacity);A.Forecast.context.hide();
    const state={described,before,after:Number(getComputedStyle(box).opacity),hidden:box.hidden,inert:box.inert,removed:!node.hasAttribute('aria-describedby')};A.Flow.finish();return state;
  });
  assert.equal(tooltip.described,'forecast-tooltip');assert.ok(tooltip.before>0);assert.equal(tooltip.before,tooltip.after);assert.ok(tooltip.hidden&&tooltip.inert&&tooltip.removed);
  const retirement=await page.evaluate(()=>{
    const A=window.__motionProbe,removed=document.querySelector('#emaki .card'),count=document.querySelectorAll('#emaki .card').length;
    const saved=A.Match.result.results;A.Match.result={...A.Match.result,results:saved.slice(1)};A.Match.render();
    const ghosts=[...document.querySelectorAll('[data-flow-retiring]')],state={detached:!removed.isConnected,count:document.querySelectorAll('#emaki .card').length,before:count,ghosts:ghosts.length,inert:ghosts.every(g=>g.inert&&g.getAttribute('aria-hidden')==='true'&&!g.querySelector('[id]'))};
    A.Flow.finish();A.Match.result={...A.Match.result,results:saved};A.Match.render();return state;
  });
  assert.ok(retirement.detached&&retirement.inert);assert.equal(retirement.count,retirement.before-1);assert.ok(retirement.ghosts>0);
  await settled(page);
  const unpresented=await page.evaluate(()=>{
    const A=window.__motionProbe,count=A.S.bars.length;A.Ops.add();A.Ops.remove();A.Ops.add();A.Ops.undo();return{count:A.S.bars.length,original:count};
  });
  assert.equal(unpresented.count,unpresented.original,`${name}: add/remove/undo before a frame is safe`);
  await settled(page);
  const forecast=await page.evaluate(async()=>{
    const A=window.__motionProbe,root=A.S.bars.map(b=>Array.from(b.v)),width=A.Stage.wrap.clientWidth;
    A.Forecast.choose('paths');for(let i=0;i<6;i++)await new Promise(requestAnimationFrame);
    const before=A.Stage.modeMix;A.Forecast.choose('states');const after=A.Stage.modeMix;
    A.Forecast.choose('branches');await new Promise(requestAnimationFrame);const departing=!!A.Stage.departingForecast;
    A.Forecast.select('U');A.App.redraw();await new Promise(requestAnimationFrame);const prefix=A.Forecast.prefix;
    A.Forecast.fan=false;A.Forecast.remember();A.App.redraw();
    return{before,after,departing,prefix,rootUnchanged:JSON.stringify(root)===JSON.stringify(A.S.bars.map(b=>Array.from(b.v))),widthUnchanged:width===A.Stage.wrap.clientWidth};
  });
  assert.ok(forecast.before>0);assert.equal(forecast.after,forecast.before);assert.ok(forecast.departing&&forecast.rootUnchanged&&forecast.widthUnchanged);assert.equal(forecast.prefix,'U');
  await settled(page);
  const captions=await page.evaluate(async()=>{
    const A=window.__motionProbe;document.querySelector('#emaki .card').click();const trace=A.Stage.trace,original=A.Match.result;
    const updated={...original,results:original.results.map((r,i)=>i?r:{...r,off:.2,flips:3})};
    A.Match.onmsg({...updated,type:'result',id:A.Match.id});
    const fresh=trace===A.Stage.trace&&A.Stage.trace.caption.includes('20.0% off · 3 flips')&&document.querySelector('#emaki .card .fl').textContent.includes('20.0% off');
    for(let i=0;i<4;i++)await new Promise(requestAnimationFrame);
    A.Match.setTrace(1);const ctx=A.Stage.cv.getContext('2d'),fill=ctx.fillText,painted=[];
    ctx.fillText=function(text,...args){if(String(text).startsWith('写し'))painted.push(text);return fill.call(this,text,...args);};
    try{for(const t of A.Stage.traces)A.Stage.drawTrace(ctx,A.Stage.geom(),t);A.Stage.drawTrace(ctx,A.Stage.geom());}finally{ctx.fillText=fill;}
    const current=A.Stage.trace.caption;A.Match.result=original;A.Match.sticky=-1;A.Match.render();A.Flow.finish();return{fresh,painted,current};
  });
  assert.ok(captions.fresh,`${name}: a retained pinned trace refreshes its statistics`);
  assert.deepEqual(captions.painted,[`写し · ${captions.current}`],`${name}: only the active trace paints a caption`);
  const trace=await page.evaluate(async()=>{
    const A=window.__motionProbe;A.Match.setTrace(0);for(let i=0;i<6;i++)await new Promise(requestAnimationFrame);
    const opacity=A.Stage.trace.a;A.Match.setTrace(-1);const leaving=A.Stage.traces.at(-1)?.a;A.Flow.finish();return{opacity,leaving,clean:A.Stage.traces.length===0};
  });
  assert.ok(trace.opacity>0);assert.equal(trace.leaving,trace.opacity);assert.ok(trace.clean);
  await page.evaluate(()=>{const A=window.__motionProbe;A.Forecast.choose('states');A.Ops.nudge(0,35);});
  const point=await page.evaluate(async()=>{
    const A=window.__motionProbe;for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);
    const G=A.Stage.geom(),b=A.S.bars[0],box=A.Stage.cv.getBoundingClientRect();return{x:box.left+b.x,y:box.top+A.Stage.Y((b.dv[1]+b.dv[2])/2,G)};
  });
  await page.mouse.move(point.x,point.y);await page.mouse.down();
  const held=await page.evaluate(()=>{const A=window.__motionProbe;return{drag:!!A.Stage.drag,y:A.Stage.Y((A.S.bars[0].dv[1]+A.S.bars[0].dv[2])/2,A.Stage.geom())};});
  await page.mouse.move(point.x,point.y+1);
  const moved=await page.evaluate(()=>{const A=window.__motionProbe;return A.Stage.Y((A.S.bars[0].dv[1]+A.S.bars[0].dv[2])/2,A.Stage.geom());});
  await page.mouse.up();assert.ok(held.drag);assert.ok(Math.abs(moved-held.y)<2,`${name}: direct input takes over the presented candle`);
  await settled(page);
  const undo=await page.evaluate(async()=>{
    const A=window.__motionProbe;A.Ops.nudge(0,35);for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);
    const before=A.S.bars.map(b=>({v:Array.from(b.v),d:b.d})),past=A.hist.past.length,G=A.Stage.geom();
    A.Stage.view.tgt.set(A.Stage.view.cur);A.Stage.view.vel.fill(0);
    const presented=A.S.bars.map(b=>({v:Array.from(b.dv),d:b.d})),y=A.Stage.Y((presented[0].v[1]+presented[0].v[2])/2,G);
    A.Stage.drag={kind:'move',bar:0,y0:y,base:presented.map(b=>Float64Array.from(b.v)),P:{o0:presented[0].d==='u'?presented[0].v[1]:presented[0].v[2],c:presented.map(b=>b.d==='u'?b.v[2]:b.v[1]),l:presented.map(b=>b.v[0]),h:presented.map(b=>b.v[3]),d:presented.map(b=>b.d)},start:{bars:before,pins:JSON.parse(JSON.stringify(A.S.pins))},moved:false};
    A.Stage.dragTo({x:0,y:y+12},true);A.Stage.dragTo({x:0,y},true);A.Stage.up();const recorded=A.hist.past.length===past+1;
    A.Ops.undo();return{recorded,restored:JSON.stringify(before)===JSON.stringify(A.S.bars.map(b=>({v:Array.from(b.v),d:b.d})))};
  });
  assert.deepEqual(undo,{recorded:true,restored:true},`${name}: a round-trip drag during easing restores the pre-drag logical state`);
  const collapse=await page.evaluate(()=>{
    const A=window.__motionProbe,saved={bars:A.S.bars.map(b=>({v:Array.from(b.v),d:b.d})),pins:JSON.parse(JSON.stringify(A.S.pins))};
    A.S.bars.forEach(b=>b.v.fill(30));A.Stage.fit(true);let minimum=Infinity;
    for(let i=0;i<160;i++){A.Stage.step(.016);minimum=Math.min(minimum,A.Stage.view.hi-A.Stage.view.lo);}
    A.Ops.restore(saved);return minimum;
  });
  assert.ok(collapse>0,`${name}: a one-price composition keeps a positive frame`);
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>window.__motionProbe.Flow.reduced());await settled(page);
  const reduced=await page.evaluate(()=>{
    const A=window.__motionProbe;A.Ops.add();A.Stage.step(.016);const b=A.S.bars.at(-1),exact=b.a===1&&b.x===A.Stage.geom().xs.at(-1)&&b.dv.every((v,i)=>v===b.v[i]);
    A.Ops.remove();const ghosts=A.Stage.ghosts.length;A.Forecast.choose('states');A.Stage.step(.016);
    return{exact,ghosts,mode:A.Stage.modeMix,css:['.seg button','.icon','.chip','.card','.prog i'].map(s=>getComputedStyle(document.querySelector(s)).transitionDuration)};
  });
  assert.ok(reduced.exact);assert.equal(reduced.ghosts,0);assert.equal(reduced.mode,0);assert.ok(reduced.css.every(d=>d.split(',').every(n=>parseFloat(n)===0)));
  await page.emulateMedia({reducedMotion:'no-preference'});await seed(page);await settled(page);
  for(const lifecycle of ['resize','beforeprint','visibilitychange','pagehide']){
    const cleaned=await page.evaluate(async lifecycle=>{
      const A=window.__motionProbe;A.Ref.open();document.querySelector('.lpane details summary').click();A.Ops.add();
      await new Promise(requestAnimationFrame);
      if(lifecycle==='visibilitychange')Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
      (lifecycle==='visibilitychange'?document:window).dispatchEvent(new Event(lifecycle));
      const state={active:A.Flow.active(),ghosts:A.Stage.ghosts.length,temporary:document.querySelectorAll('[data-flow-sizing],[data-flow-retiring],[data-motion-running]').length,exact:A.S.bars.every(b=>b.a===1&&b.dv.every((v,i)=>v===b.v[i]))};
      if(lifecycle==='visibilitychange'){delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));}
      if(lifecycle==='beforeprint')window.dispatchEvent(new Event('afterprint'));
      if(lifecycle==='pagehide')window.dispatchEvent(new Event('pageshow'));
      A.Ref.close();A.Flow.finish();A.Ops.remove();return state;
    },lifecycle);
    assert.deepEqual(cleaned,{active:false,ghosts:0,temporary:0,exact:true},`${name}: ${lifecycle} releases geometry and visuals`);
    await settled(page);
  }
  for(const width of [1180,900,700,600,390]){
    await page.setViewportSize({width,height:900});await settled(page);
    const responsive=await page.evaluate(()=>{
      const A=window.__motionProbe;A.Ref.open();A.Flow.finish();const state={fixed:getComputedStyle(A.Ref.pane).position==='fixed',width:A.Ref.pane.getBoundingClientRect().width,canvas:A.Stage.wrap.clientWidth};A.Ref.close();A.Flow.finish();return state;
    });
    assert.equal(responsive.fixed,width<=700);assert.ok(responsive.width>0&&responsive.canvas>0);
  }
  assert.deepEqual(errors,[],`${name}: no page errors`);
  console.log(`${name}: retained actors/focus, reversal ownership, inert retirement, disclosures, forecast/trace continuity, reduced motion, lifecycle and 390–1600px geometry pass.`);
 } finally {await browser.close();}
}
} finally {await new Promise(resolve=>server.close(resolve));}
