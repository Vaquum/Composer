// The reported regression: loading must not destroy the populated forecast or move its geometry.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const V = new Function(fs.readFileSync('forecast.js','utf8')+'\nreturn ForecastViews;')();
const data = { n:1000, fan:Array(6).fill([-.5,0,.5,1,1.5]), sequences:[['UUUUUU',700],['IIIIII',250],['DDDDDD',50]], examples:{} };
let model = { source:null,sourceKey:'',prefix:'',selected:'' };
model = V.reconcile(model,{fresh:false,failed:false,data:null,key:''}); assert.equal(model.phase,'loading');
model = V.reconcile(model,{fresh:true,failed:false,data,key:'combo-a'}); assert.equal(model.phase,'ready'); assert.equal(model.selected,'UUUUUU');
model = {...model,prefix:'UU',selected:'UUUUUU'};
const previous=model.source;
for (const failed of [false,true,false]) {
  model=V.reconcile(model,{fresh:false,failed,data:undefined,key:'combo-b'});
  assert.equal(model.source,previous,'loading/failure retain the exact snapshot');
  assert.equal(model.prefix,'UU'); assert.equal(model.selected,'UUUUUU'); assert.equal(model.current,false);
  assert.equal(model.phase,failed?'error':'refreshing');
}
model=V.reconcile(model,{fresh:true,failed:false,data:{...data},key:'combo-a'});
assert.equal(model.prefix,'UU','a retry or readings refresh preserves the chosen path');
model=V.reconcile(model,{fresh:true,failed:false,data:{...data},key:'combo-b'});
assert.equal(model.prefix,'','a changed composition resets conditional choices only at commit');
model=V.reconcile({...model,prefix:'UU'}, {fresh:true,failed:false,data:{...data,sequences:[['IIIIII',1000]]},key:'combo-b'});
assert.equal(model.prefix,''); assert.equal(model.selected,'IIIIII','a vanished path selects an existing path');
model=V.reconcile(model,{fresh:true,failed:false,data:null,key:'combo-c'});
assert.equal(model.phase,'sparse'); assert.equal(model.source,null,'a final sparse result never presents old odds as current');

// The complete ranked rows and a separate numeric gutter must survive every viewport and root count.
const html=fs.readFileSync('index.html','utf8'),a=html.indexOf('const Forecast = {'),b=html.indexOf('const Stage = {',a);
for(const width of [320,375,480,600,736,1024,1800])for(const n of [2,3,10,20]){
  const fixed=V.geometry(width,n),G={...fixed,w:width,N:n,plotTop:130,plotH:240,plotBottom:370},field=V.field(G);
  assert.ok(field.rateLeft-(fixed.xs.at(-1)+fixed.baseBw*.6)>=17.9,'numbers have a clean gap from the widest root candle');
  assert.ok(field.left-field.rateRight>=18,'numbers have a dedicated gap from future marks');
  assert.ok(field.right<=width-8,'last column has an outer margin');
  assert.ok(field.rowHeight>=25,'four rows retain vertical breathing room');
  assert.equal(field.xs.length,6);
  for(let j=1;j<6;j++)assert.ok(field.xs[j]-field.xs[j-1]>field.width,'columns cannot overlap');
}
const fixture={n:1728,sampled:480,fan:Array(6).fill([-.5,0,.5,1,1.5]),sequences:[['IIIIII',173],['DDDDDD',162],['IDDDDD',89],['UUUUUU',74],['IUDUDU',1230]]};
assert.match(V.pathTip(fixture,'DDDDDD'),/162 \/ 1,728 complete windows/);
assert.match(V.pathTip(fixture,'DDDDDD'),/entire six-bar/);
assert.match(V.stateTip(fixture,'D',1,'D'),/162 \/ 162 complete windows/);
assert.match(V.fanTip(fixture,2,4),/90th percentile/);
assert.match(V.fanTip(fixture),/480 sampled.*all 1,728/s,'sample and probability denominators are explicitly distinct');
assert.match(V.definition,/Inside includes both boundaries/);

const nodes=new Map(),styles=new Map();let replacements=0;
function element(){let markup='';return {dataset:{},style:{},hidden:false,checked:false,textContent:'',listeners:{},addEventListener(t,fn){this.listeners[t]=fn;},setAttribute(){},contains(){return false;},querySelector(){return null;},querySelectorAll(){return [];},get innerHTML(){return markup;},set innerHTML(value){markup=value;replacements++;}};}
const $=key=>{if(!nodes.has(key))nodes.set(key,element());return nodes.get(key);};
const match={result:{panes:{cont:fixture}},resultKey:'a',failed:false,fresh:()=>true};
const stage={changeForecast(){},wrap:{style:{getPropertyValue:k=>styles.get(k)||'',setProperty:(k,v)=>styles.set(k,v)}},fit(){throw Error('modes cannot refit the camera');}};
const doc={querySelectorAll:()=>[],activeElement:null,body:{}};
const F=new Function('$','ForecastViews','Match','Stage','App','document','Flow',html.slice(a,b)+'\nreturn Forecast;')($,V,match,stage,{redraw(){}},doc,{patch(root,html){root.innerHTML=html;},switchControl(){}});
F.place=()=>{};F.context={hide(){}};
const G={...V.geometry(1000,2),w:1000,N:2,plotTop:130,plotH:240,plotBottom:370};
F.choose=()=>{}; // Mode persistence is covered by forecast.mjs; this drives the actual commit/render flow.
F.view='paths';F.sync(G);
assert.equal(($('#forecast-body').innerHTML.match(/class="forecast-path-row"/g)||[]).length,4);
assert.match($('#forecast-body').innerHTML,/9.4%/);
assert.match($('#forecast-body').innerHTML,/whole six-bar|entire six-bar/);
assert.doesNotMatch($('#forecast-body').innerHTML,/NaN|undefined|Infinity/);
F.prefix='I';const snapshot=F.source;
match.fresh=()=>false;F.sync(G);const stale=$('#forecast-body').innerHTML,count=replacements;
F.sync(G);assert.equal(replacements,count,'unchanged stale frames do not rebuild the controls');
assert.equal(F.source,snapshot);assert.equal(F.prefix,'I');assert.equal(F.current,false);
assert.match(stale,/Previous composition/);assert.match(stale,/aria-disabled="true"/);
assert.match($('#forecast-message').textContent,/previous result/);
match.failed=true;F.sync(G);assert.equal(F.phase,'error');assert.equal($('#forecast-retry').hidden,false);
match.failed=false;match.fresh=()=>true;match.resultKey='b';match.result={panes:{cont:{...fixture}}};F.sync(G);
assert.equal(F.prefix,'');assert.equal(F.current,true);
F.prefix='I';F.selected='DDDDDD';F.sync(G);
assert.equal(F.selected,'DDDDDD','Paths can select full-cohort sequences outside the retained branch');
assert.equal(F.prefix,'I','switching view does not discard the branch history');
F.view='branches';F.prefix='DDDDDD';const completeMarkup=F.markup();
assert.match(completeMarkup,/162 \/ 1,728 complete windows/);
assert.match(completeMarkup,/95% interval/,'complete branch headings and cells retain whole-cohort uncertainty');
F.view='paths';F.prefix='';
match.result={panes:{cont:null}};F.sync(G);assert.equal(F.source,null);assert.equal(F.phase,'sparse');
assert.doesNotMatch($('#forecast-body').innerHTML,/\d%/,'sparse/loading placeholders never invent probabilities');

// Execute the real draw method: the reported narrow layout must draw all 24 marks, never one selected row.
const drawStart=html.indexOf('  drawPaths(ctx,G){'),drawEnd=html.indexOf('  drawBranches(ctx,G){',drawStart);
const painter=new Function('Forecast','ForecastViews','COL','FONT_UI','rgbOf','rgbStr','return ({'+html.slice(drawStart,drawEnd)+'});')({source:fixture,view:'paths',current:true,selected:'IIIIII',field:V.field,outcomes:prefix=>V.outcomes(fixture,prefix)},V,{paper:'#eee',up:'#080',flat:'#888',down:'#800',ink:'#111','ink-2':'#555'},'sans-serif',()=>[128,128,128],()=> '#888');
for(const width of [320,600,736,1024]){
  const shapes=[],ctx={save(){},restore(){},fillText(){},fillRect(...r){shapes.push(r);}};
  painter.modeMix=1;painter.drawStateGlyph=()=>{};
  painter.drawPaths(ctx,{...V.geometry(width,2),w:width,N:2,plotTop:130,plotH:240,plotBottom:370});
  assert.equal(shapes.length,24,'four complete six-bar paths stay visible at '+width);
}
assert.match(html,/Forecast\.fan \? 1 : 0/,'fan is independently toggled');
assert.doesNotMatch(html,/F\.small|if\(!on\)return/,'no compact single-sequence fallback');
assert.match(fs.readFileSync('motion.css','utf8'),/prefers-reduced-motion/);
assert.doesNotMatch(html.slice(a,b),/offsetHeight|Stage\.fit\(/,'mode/loading changes do not refit the camera');

// Real context runtime with a deterministic clock: dwell repeats, cancellation works, focus/touch explain immediately.
let clock=0,nextId=0;const timers=new Map();
const timeout=(fn,delay)=>{timers.set(++nextId,{fn,due:clock+delay});return nextId;};
const cancel=id=>timers.delete(id),advance=ms=>{clock+=ms;for(const [id,t]of [...timers])if(t.due<=clock){timers.delete(id);t.fn();}};
const target=()=>({isConnected:true,dataset:{tip:'Full-cohort measurement'},attrs:new Map(),closest(){return this;},getAttribute(k){return this.attrs.get(k)??null;},setAttribute(k,v){this.attrs.set(k,v);},removeAttribute(k){this.attrs.delete(k);},getBoundingClientRect(){return {left:10,bottom:20};}});
const root={events:{},addEventListener(k,fn){this.events[k]=fn;},contains(){return true;}};
const documentStub={events:{},addEventListener(k,fn){this.events[k]=fn;}};
const windowStub={innerWidth:400,innerHeight:400,events:{},addEventListener(k,fn){this.events[k]=fn;}};
const box={id:'forecast-tooltip',hidden:true,style:{},textContent:'',getBoundingClientRect(){return {width:200,height:100};}};
const Context=new Function('document','window','setTimeout','clearTimeout',fs.readFileSync('context.js','utf8')+'\nreturn ForecastContext;')(documentStub,windowStub,timeout,cancel);
Context.install(root,box,{visible(el,open){el.hidden=!open;}});const T=target(),event={target:T,relatedTarget:null,clientX:10,clientY:20,pointerType:'mouse'};
root.events.pointerover(event);advance(499);assert.equal(box.hidden,true);advance(1);assert.equal(box.hidden,false);assert.equal(T.attrs.get('aria-describedby'),'forecast-tooltip');
root.events.pointerout(event);assert.equal(box.hidden,true);assert.equal(T.attrs.has('aria-describedby'),false);
root.events.pointerover(event);advance(499);assert.equal(box.hidden,true,'every hover waits 500 ms');advance(1);assert.equal(box.hidden,false);
root.events.pointerout(event);root.events.pointerover(event);documentStub.events.scroll();advance(500);assert.equal(box.hidden,true,'scroll cancels pending dwell');
root.events.focusin(event);assert.equal(box.hidden,false,'focus is immediate');
documentStub.events.keydown({key:'Escape'});assert.equal(box.hidden,true);
root.events.pointerdown({...event,pointerType:'touch'});assert.equal(box.hidden,false,'touch gets the same measurement');
root.events.pointerout({...event,pointerType:'touch'});assert.equal(box.hidden,false,'lifting a touch leaves the explanation readable');
documentStub.events.keydown({key:'Escape'});assert.equal(box.hidden,true);
const label=target(),input=target();input.closest=()=>label;
root.events.focusin({...event,target:input});
assert.equal(input.attrs.get('aria-describedby'),'forecast-tooltip','nested control receives the accessible explanation');
assert.equal(label.attrs.has('aria-describedby'),false,'description is not attached only to the surrounding label');
windowStub.events.resize();assert.equal(box.hidden,true);
console.log('Four ranked paths, shared geometry, numeric gutters, tooltip evidence/timing and stale snapshots pass.');

// Exercise the real retry and worker-generation guards, including late errors from the discarded request.
const mStart=html.indexOf('const Match = {'),mEnd=html.indexOf('// a day as the cards write it',mStart);
const workers=[],barLoads=[],activityLoads=[]; let failures=0;
class Worker {
  constructor(){this.messages=[];workers.push(this);}
  postMessage(m){this.messages.push(m);}
  terminate(){this.terminated=true;}
}
const deferred=list=>new Promise((resolve,reject)=>list.push({resolve,reject}));
const panes={readings:'ready',render(){throw Error('an obsolete activity request cannot change panes');}};
const R=new Function('$','Worker','document','loadBars','fetch','Panes','App','Stage',html.slice(mStart,mEnd)+'\nreturn Match;')($,Worker,{getElementById:()=>null},()=>deferred(barLoads),()=>deferred(activityLoads),panes,{redraw(){}},{drag:null});
R.schedule=()=>{}; R.key=()=> 'same-combo'; R.fail=()=>failures++; R.result={panes:{cont:data}};R.resultKey='same-combo';R.drawnKey='same-combo';
R.start(); const retained=R.result; R.failed=true; R.retry();
assert.equal(workers[0].terminated,true); assert.equal(R.result,retained);assert.equal(R.resultKey,'');assert.equal(R.failed,false);assert.equal(panes.readings,'loading');
barLoads[0].reject(Error('obsolete request')); activityLoads[0].reject(Error('obsolete activity'));
barLoads[1].resolve(new ArrayBuffer(1)); activityLoads[1].resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(failures,0,'late errors cannot undo a retry'); assert.equal(workers[0].messages.length,0);
assert.deepEqual(workers[1].messages.map(m=>m.type),['bars','activity']);
console.log('All modes and states retain geometry; refresh retains DOM and choices; stale interactions, sparse results, retries, responsive fit and candle alignment pass.');

