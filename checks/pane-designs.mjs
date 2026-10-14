// The six presentations must preserve the matcher statistics and handle sparse
// or outcome-filtered cohorts without inventing estimates.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source = fs.readFileSync('pane-designs.js','utf8');
const D = new Function(source + '\nreturn PaneDesigns;')();
const row = (bar,key,set,all,d,log=false) => ({bar,key,set,all,d,log});
const r = {
  exact:[0,0,0,0,0],exactF:[0,0,0,0,0],filter:null,stretch:0,base:{n:2000,up:1000},
  panes:{kind:'closest',n:400,readings:true,after:6,near:[],
    rows:[row(0,'body',[1.4,1.3,1.5],[.5,.48,.52],3),row(0,'vol',[Math.log(1.6),Math.log(1.4),Math.log(1.8)],[Math.log(1.05),0,.1],2,true),row(1,'maker',[.48,.46,.5],[.51,.5,.52],-1)],
    next:[.43,.38,.48],byTf:[[.43,.38,.48],null],tfN:[400,12],
    cont:{n:399,sampled:399,aboveHigh:[.82,.78,.86],belowLow:[.27,.23,.31],aboveClose:[.52,.47,.57],fan:[[0,.43,.88,1.35,2]]}}
};
const ctx={barCount:2,timeframes:[{label:'15m',k:0},{label:'30m',k:1}],readings:'ready',note:'',nextWords:()=> 'rose at least 1 ATR'};
const before=JSON.stringify(r);
for (const {id} of D.variants) {
  const left=D.left(id,r,ctx),right=D.right(id,r);
  for (const w of r.panes.rows) assert.ok(left.includes(`data-reading="${w.bar}-${w.key}"`),`${id} retains bar ${w.bar+1} ${w.key}`);
  assert.match(left,/1\.40/); assert.match(left,/1\.60×/); assert.match(left,/0\.50/);
  for (const rate of ['82.0%','27.0%','52.0%']) assert.ok(right.includes(rate),`${id} preserves ${rate}`);
  assert.match(right,/A window can break both levels/);
  assert.doesNotMatch(left+right,/NaN|undefined|Infinity/);
}
assert.equal(JSON.stringify(r),before,'rendering cannot mutate matcher results');
assert.match(D.caption(r,ctx),/400 closest windows/);
assert.match(D.caption(r,ctx),/0 exact matches/);
assert.match(D.next(r,ctx),/−7\.0 pp/);
assert.match(D.next(r,ctx),/43\.0%/);
assert.match(D.next(r,ctx),/Fewer than 30 next bars/);
const filtered={...r,filter:{dir:1,measure:'atr',value:1}};
assert.match(D.next(filtered,ctx),/No rise-rate comparison/);
assert.doesNotMatch(D.next(filtered,ctx),/43\.0%|−7\.0 pp/);
const sparse={...r,panes:{...r.panes,n:29,next:null,cont:null}};
for (const {id} of D.variants) {
  assert.match(D.left(id,sparse,ctx),/no estimate/);
  assert.match(D.right(id,sparse),/no estimate/);
}
assert.equal(D.terminal(sparse.panes),'');
assert.match(D.left('signal',{...r,panes:{...r.panes,readings:false}}, {...ctx,readings:'failed',note:'<unavailable>'}),/&lt;unavailable&gt;/);
assert.match(D.left('signal',{...r,panes:{...r.panes,rows:[]}},ctx),/Not enough measured activity/);
const wide={...r.panes,cont:{...r.panes.cont,fan:[[0,-5,-1,20,30]]}};
const terminal=D.terminal(wide);
assert.match(terminal,/−1\.00/); assert.match(terminal,/−5\.00–20\.00/);
for (const [,n] of terminal.matchAll(/(?:left|width):([\d.]+)%/g)) assert.ok(Number(n)>=0&&Number(n)<=100,'terminal marks stay within their scale');

// Exercise the actual independent selection controller without changing the
// matcher. DOM rendering has its own browser verification.
const html=fs.readFileSync('index.html','utf8'),start=html.indexOf('const Panes = {'),end=html.indexOf("$('#rnear').addEventListener",start);
const stored=[],rendered=[];
const P=new Function('PaneDesigns','localStorage','Match','Flow',html.slice(start,end)+'\nreturn Panes;')(D,{setItem:(key,value)=>stored.push(JSON.parse(value))},{result:r},{});
P.remember=()=>{}; P.controls=()=>{}; P.closeMenus=()=>{}; P.render=(result,side)=>rendered.push(side);
P.choose('left','bars'); assert.deepEqual(P.views,{left:'bars',right:'signal'});
P.choose('right','ledger'); assert.deepEqual(P.views,{left:'bars',right:'ledger'});
assert.deepEqual(stored.at(-1),{left:'bars',right:'ledger'});
assert.deepEqual(rendered,['left','right'],'switching renders only the changed pane');
console.log('Six pane presentations preserve live statistics; sparse/filter cases, terminal scale and independent saved selection pass.');
