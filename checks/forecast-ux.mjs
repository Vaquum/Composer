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

for (const width of [320,375,700,1200,1800]) for (const coarse of [false,true]) {
  const baseline=V.layout(width,width*.4,100,coarse);
  for (const view of ['fan','paths','branches']) for (const grid of [false,true]) for (const phase of ['loading','refreshing','ready','sparse','error']) {
    const actual=V.layout(width,width*.4,100,coarse,view,grid,phase);
    assert.deepEqual(actual,baseline,'mode, Grid and result state cannot move the plot');
    assert.ok(actual.left>=12&&actual.left+actual.width<=width-12);
    assert.ok(actual.minHeight-84-actual.reserve>=260,'enough room remains for the composition');
  }
}

// Exercise the real DOM controller with a minimal DOM: unchanged stale states must not replace content.
const html=fs.readFileSync('index.html','utf8'),a=html.indexOf('const Forecast = {'),b=html.indexOf('const Stage = {',a);
const nodes=new Map(), styles=new Map(); let replacements=0;
function element() {
  let markup='';
  return {dataset:{},style:{},hidden:false,inert:false,textContent:'',setAttribute(){},contains(){return false;},querySelector(){return null;},querySelectorAll(){return [];},
    get innerHTML(){return markup;},set innerHTML(value){markup=value;replacements++;}};
}
const $=key=>{if(!nodes.has(key))nodes.set(key,element());return nodes.get(key);};
const match={result:{panes:{cont:data}},resultKey:'a',failed:false,fresh:()=>true};
const stage={wrap:{style:{getPropertyValue:k=>styles.get(k)||'',setProperty:(k,v)=>styles.set(k,v)}},fit(){throw Error('forecast transitions may not refit the camera');}};
const F=new Function('$','ForecastViews','Match','Stage','App','document','matchMedia','calm','localStorage',html.slice(a,b)+'\nreturn Forecast;')($,V,match,stage,{redraw(){}},{querySelectorAll:()=>[],activeElement:null},()=>({matches:false}),()=>true,{setItem(){}});
const G={w:1000,N:2,bw:40,xs:[200,300],plotTop:100};
F.sync(G); const populated=$('#forecast-body').innerHTML; assert.match(populated,/High broken/);
F.prefix='UU'; F.selected='UUUUUU'; F.view='paths'; F.sync(G);
const paths=$('#forecast-body').innerHTML, initialLayout=F.reserve(1000,320,100); const count=replacements;
match.fresh=()=>false; F.sync(G); F.sync(G);
assert.equal(F.phase,'refreshing'); assert.equal(F.source,data); assert.equal($('#forecast-body').innerHTML,paths);
assert.equal(replacements,count,'refresh does not replace the populated DOM'); assert.equal(F.prefix,'UU');
assert.equal($('#forecast-body').inert,true,'stale choices are unavailable');
assert.match($('#forecast-message').textContent,/previous result/);
match.failed=true; F.sync(G); assert.equal(F.phase,'error'); assert.equal($('#forecast-retry').hidden,false);
assert.equal(F.reserve(1000,320,100),initialLayout);
match.failed=false; match.fresh=()=>true; F.sync(G); assert.equal($('#forecast-body').inert,false);
for (const view of ['fan','paths','branches']) {
  F.choose(view); F.grid=!F.grid; F.sync(G); assert.equal(F.reserve(1000,320,100),initialLayout);
}
assert.match(V.empty('paths'),/aria-hidden="true"/); assert.doesNotMatch(V.empty('paths'),/\d%/,'skeletons cannot fabricate rates');
assert.match(V.paths(data),/Whole-sequence probability/);
assert.match(html,/\.forecast-panel \{[^}]*grid-template-rows: 64px 180px 120px/);
assert.match(html,/prefers-reduced-motion/);
assert.doesNotMatch(html.slice(a,b),/offsetHeight|Stage\.fit\(/,'forecast placement never measures response content or forces a camera change');
assert.match(fs.readFileSync('forecast.js','utf8'),/preserveAspectRatio="none"/,'miniature candles span their six bar columns');
// A narrow-canvas rule must never swallow the global workspace or dock styles.
const css=html.slice(html.indexOf('<style>')+7,html.indexOf('</style>'));
let depth=0, quote='';
for (let j=0;j<css.length;j++) {
  const ch=css[j];
  if (quote) { if(ch==='\\')j++; else if(ch===quote)quote=''; continue; }
  if (ch==='"'||ch==="'") {quote=ch;continue;}
  if (ch==='/'&&css[j+1]==='*') { const end=css.indexOf('*/',j+2);assert.ok(end>=0);j=end+1;continue; }
  for (const selector of ['\n.work {','\n.dock {','\n.forecast-controls {']) if(css.startsWith(selector,j)) assert.equal(depth,0,`${selector.trim()} is a global rule`);
  if(ch==='{')depth++; if(ch==='}')depth--; assert.ok(depth>=0,'CSS braces stay balanced');
}
assert.equal(depth,0,'no unclosed media/container rule');
assert.match(css,/\.dock \{ position: absolute/,'existing canvas dock styling is retained');
console.log('All modes and states retain geometry; refresh retains DOM and choices; stale interactions, sparse results, retries, responsive fit and candle alignment pass.');
