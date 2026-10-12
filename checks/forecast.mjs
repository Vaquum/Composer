// Independently enumerate eligible continuations and verify the complete matcher -> presentation contract.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const M = new Function('self', 'window', fs.readFileSync('matcher.js', 'utf8') + '\nreturn { search, setBars: x => { BARS=x; READ=null; }, setLatest: x => { latest=x; } };')(undefined, undefined);
const V = new Function(fs.readFileSync('forecast.js', 'utf8') + '\nreturn ForecastViews;')();
function tape(n) {
  const T = { name: '15m', sec: 900, n, O: [], H: [], L: [], C: [], ts: [], run: [], atr: [] };
  let seed = 3, previous = 10000, t = 1700000000;
  for (let j = 0; j < n; j++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const gap = j % 97 === 0, o = previous, c = o + (seed % 21) - 10;
    T.O.push(o); T.C.push(c); T.H.push(Math.max(o, c) + seed % 7); T.L.push(Math.min(o, c) - seed % 5);
    t += gap ? 1800 : 900; T.ts.push(t); T.run.push(gap ? 1 : T.run[j - 1] + 1); T.atr.push(20); previous = c;
  }
  return T;
}
function expected(T, q, fallback = false) {
  const counts = new Map(); let n = 0;
  for (let s = 0; s + 2 <= T.n; s++) for (let extra = 0; extra <= (fallback ? 0 : q.stretch); extra++) {
    const e = s + 1 + extra;
    // Compare timestamps rather than using the matcher's run counters.
    const continuous = (a, b) => { for (let j = a + 1; j <= b; j++) if (T.ts[j] - T.ts[j - 1] !== T.sec) return false; return true; };
    if (e + 6 >= T.n || !continuous(s, e + 6)) continue;
    if (!fallback && Math.sign(T.C[s] - T.O[s]) !== q.holds[0].dir) continue;
    const next = T.C[e + 1] - T.C[e];
    if (q.next && Math.sign(next) !== q.next.dir) continue;
    const lo = Math.min(T.L[s], T.L[e]), hi = Math.max(T.H[s], T.H[e]);
    if (hi === lo) continue;
    let key = '';
    for (let j = e + 1; j <= e + 6; j++) key += T.C[j] > hi ? 'U' : T.C[j] < lo ? 'D' : 'I';
    counts.set(key, (counts.get(key) || 0) + 1); n++;
  }
  return { n, sequences: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) };
}
let id = 0;
const base = { bars: [[100,110,95,105],[105,112,98,103]], holds: [{ color:true,bar:0,dir:1 }], stretch:0, x:12, tfs:[1,0,0,0,0], oriented:true, next:null };
for (const [title, T, q, fallback] of [
  ['held windows and gaps', tape(1000), base, false],
  ['stretched windows', tape(1000), {...base,stretch:2}, false],
  ['next-bar filtered windows', tape(1000), {...base,next:{dir:1,measure:'any'}}, false],
  // Impossible first-bar colour, fewer than 400 candidate windows: fallback contains every candidate.
  ['closest-window fallback resets counts', (() => { const T=tape(150); T.C=T.O.map(o=>o+1); T.H=T.C.map(c=>c+1); T.L=T.O.map(o=>o-1); return T; })(), {...base,holds:[{color:true,bar:0,dir:-1}]}, true],
  ['counts beyond the fan reservoir', tape(50000), base, false],
  ['sparse continuations withheld', tape(20), base, false],
]) {
  M.setBars([T]); M.setLatest(++id);
  const result = await M.search(q,id,()=>{}), X=expected(T,q,fallback), c=result.panes.cont;
  if (X.n<30) assert.equal(c,null,title);
  else {
    assert.equal(c.n,X.n,title);
    assert.deepEqual(c.sequences,X.sequences,title);
    assert.equal(c.sequences.reduce((sum,[,n])=>sum+n,0),c.n);
    assert.equal(c.paths[0].n,c.sequences[0][1]);
    assert.equal(c.paths[0].rate[0],c.paths[0].n/c.n);
    assert.ok(c.paths.length<=4);
    for (const [key] of c.sequences) {
      assert.equal(c.examples[key].bars.map(b=>b[3]>1?'U':b[3]<0?'D':'I').join(''),key,'historical example belongs to its group');
    }
    const before=JSON.stringify(c), all=V.outcomes(c);
    for (const column of all.grid) assert.equal(column.reduce((a,b)=>a+b,0),c.n);
    const prefix=c.sequences[0][0].slice(0,2), conditioned=V.outcomes(c,prefix);
    for (const column of conditioned.grid) assert.equal(column.reduce((a,b)=>a+b,0),conditioned.n);
    for (const draw of [V.paths(c,prefix),V.branches(c,prefix),V.grid(c,prefix)]) {
      assert.doesNotMatch(draw,/NaN|undefined|Infinity/); assert.match(draw,/windows/);
    }
    assert.equal(JSON.stringify(c),before,'presentation must not mutate the matching cohort');
    if (title.includes('reservoir')) { assert.ok(c.n>20000); assert.equal(c.sampled,20000); }
  }
  console.log(`${title}: ${X.n} complete windows, independently matched`);
}
const C={n:1000,fan:Array(6).fill([]),sequences:[['UDIIII',290],['UUUUUU',250],['IUUUUU',160],['DDDDDD',120],['UIDDDD',100],['IIIIII',80]]};
const U=V.outcomes(C,'U'); assert.equal(U.n,640); assert.deepEqual(U.grid[1],[250,100,290]);
assert.equal(V.rate(250,640)[0],.390625); assert.equal(V.rate(250,1000)[0],.25);
assert.match(V.branches(C,'U'),/39\.1%/); assert.match(V.branches(C,'U'),/25% overall/);
const sparse={n:1000,fan:C.fan,sequences:[['UUUUUU',990],['DDDDDD',10]]};
assert.equal(V.rate(10,10),null); assert.match(V.branches(sparse,'D'),/fewer than 30 supporting windows/);
assert.match(V.grid(sparse,'D'),/no probability estimate/);
assert.match(V.branches(C,'UUUUUU'),/Complete sequence: 25%/);

// Drive the actual controller; presentation choices cannot trigger a new matcher search or alter the drawing.
const html=fs.readFileSync('index.html','utf8'), start=html.indexOf('const Forecast = {'), end=html.indexOf('const Stage = {',start);
const elements=new Map(), saved=[];
const buttons=['fan','paths','branches'].map(view=>({dataset:{view},setAttribute(){}}));
const $=id=>{if(!elements.has(id))elements.set(id,{hidden:true,offsetHeight:160,querySelectorAll:()=>buttons,setAttribute(){}});return elements.get(id);};
let fits=0,draws=0;
const F=new Function('$','ForecastViews','localStorage','Stage','App',html.slice(start,end)+'\nreturn Forecast;')($,V,{setItem:(key,value)=>saved.push(JSON.parse(value))},{fit:()=>fits++},{redraw:()=>draws++});
F.grid=true; F.choose('paths'); assert.equal(F.view,'paths'); assert.equal(F.grid,true);
F.choose('branches'); assert.equal(F.grid,true); F.choose('bad'); assert.equal(F.view,'branches');
F.source=C; F.select('U'); assert.equal(F.prefix,'U'); assert.equal(F.selected,'UDIIII');
F.select('XYZ'); assert.equal(F.prefix,'U'); F.select(''); assert.equal(F.prefix,'');
assert.deepEqual(saved.at(-1),{view:'branches',grid:true}); assert.equal(fits,2); assert.equal(draws,2);
console.log('Aggregate, whole-sequence and conditional rates, sparse support, immutable data and independent saved canvas controls pass.');
process.exit(0);
