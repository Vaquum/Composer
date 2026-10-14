// Real UI and runtime, offline synthetic presentation fixtures; statistics have separate current-data checks.
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
const html=fs.readFileSync('index.html','utf8').replace('Panes.init();','window.__motionProbe={S,Stage,Match,Panes,Ref,Forecast,Ops,App,Flow};\nPanes.init();');
const fixture=fs.readFileSync('checks/pane-designs.mjs','utf8');
const result=new Function(fixture.slice(fixture.indexOf('const row ='),fixture.indexOf('const before='))+'\nreturn r;')();
Object.assign(result.panes.cont,{fan:Array.from({length:6},(_,i)=>[-.2-i*.05,.2,.5+i*.08,1.2,1.6+i*.05]),sequences:[['UUUUUU',260],['IIIIII',100],['DDDDDD',39]],examples:{}});
Object.assign(result,{mode:'nearest',counts:[12,0,0,0,0],countsF:[12,0,0,0,0],ms:10,
  results:Array.from({length:12},(_,i)=>({tf:'15m',start:1700000000+i*900,raw:[[30,68,18,56],[56,80,18,36]],drawn:[[30,68,18,56],[56,80,18,36]],picks:[0,1],broken:[],flips:0,off:i*.01,next:null,nextWhy:'end'}))});
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
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.Worker=class{postMessage(){} terminate(){}};});
  await page.route('https://fonts.**/**',route=>route.abort());
  await page.goto(base);await settled(page);await seed(page);await settled(page);
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
  const trace=await page.evaluate(async()=>{
    const A=window.__motionProbe;A.Match.setTrace(0);for(let i=0;i<6;i++)await new Promise(requestAnimationFrame);
    const opacity=A.Stage.trace.a;A.Match.setTrace(-1);const leaving=A.Stage.traces.at(-1)?.a;A.Flow.finish();return{opacity,leaving,clean:A.Stage.traces.length===0};
  });
  assert.ok(trace.opacity>0);assert.equal(trace.leaving,trace.opacity);assert.ok(trace.clean);
  await page.emulateMedia({reducedMotion:'reduce'});await settled(page);
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
