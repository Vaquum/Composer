// The chain: every bar after the first opens exactly at the previous bar's close, and every colour is which way its bar
// went. Reads the page's own functions (between "the chain" markers) and checks, on random drawings, that chaining keeps
// every close, puts every later open exactly on the previous close, colours each bar by its close against its open,
// keeps the shadows around the bodies and changes nothing a second time; that moving a later bar swings it from its
// open; and that choosing the first bar's colour keeps its body and moves the next bar's open to its other end.
// Usage: node checks/chain.mjs [INDEX_HTML]
import fs from 'node:fs';
const file = process.argv[2] && process.argv[2].endsWith('.html') ? process.argv[2] : 'index.html';
const html = fs.readFileSync(file, 'utf8');
const from = html.indexOf('/* ---- the chain'), to = html.indexOf('/* ---- end of the chain ---- */');
if (from < 0 || to < from) { console.log('the chain is not marked in the page'); process.exit(1); }
const { closeOf, openOf, chainParams, chainBars, moveParams, flipParams } = new Function(`${html.slice(from, to)}; return { closeOf, openOf, chainParams, chainBars, moveParams, flipParams };`)();

const fails = [];
const fail = (what, ...why) => { if (fails.length < 30) fails.push(`${what}: ${why.join(' ')}`); };
let seed = 11;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
// prices on a coarse grid, so ties (dojis, flush shadows, shared levels) come up often
const price = () => Math.round(rand() * 40) / 4;
function drawing(n) {
  return Array.from({ length: n }, () => {
    const a = price(), b = price(), lo = Math.min(a, b), hi = Math.max(a, b);
    return { v: [Math.min(lo, price()), lo, hi, Math.max(hi, price())], d: rand() < 0.5 ? 'u' : 'd' };
  });
}
const same = (x, y) => x.length === y.length && x.every((b, i) => b.d === y[i].d && b.v.every((p, k) => p === y[i].v[k]));
function chained(what, bars) {
  bars.forEach((b, i) => {
    const [l, lo, hi, h] = b.v;
    if (!(l <= lo && lo <= hi && hi <= h)) fail(what, `bar ${i + 1} is out of order: ${b.v.join(', ')}`);
    if (i === 0) return;
    const o = openOf(b.v, b.d), c = closeOf(b.v, b.d), pc = closeOf(bars[i - 1].v, bars[i - 1].d);
    if (o !== pc) fail(what, `bar ${i + 1} opens at ${o}, not at the previous close ${pc}`);
    if ((c > o && b.d !== 'u') || (c < o && b.d !== 'd')) fail(what, `bar ${i + 1} went ${o} to ${c} but is coloured ${b.d}`);
  });
}

let drawings = 0;
for (let t = 0; t < 4000; t++) {
  const bars = drawing(2 + Math.floor(rand() * 9)), P = chainParams(bars), out = chainBars(P);
  drawings++;
  chained('chaining a drawing', out);
  out.forEach((b, i) => { if (closeOf(b.v, b.d) !== P.c[i]) fail('chaining a drawing', `bar ${i + 1}'s close moved`); });
  if (openOf(out[0].v, out[0].d) !== P.o0) fail('chaining a drawing', "the first bar's open moved");
  if (!same(chainBars(chainParams(out)), out)) fail('chaining a drawing', 'chaining again changed it');
  // moving a bar: the first moves whole, a later one swings from its open
  const i = Math.floor(rand() * out.length), dv = Math.round((rand() - 0.5) * 24) / 4, Q = chainParams(out), moved = chainBars(moveParams(Q, i, dv));
  chained('moving a bar', moved);
  if (closeOf(moved[i].v, moved[i].d) !== Q.c[i] + dv) fail('moving a bar', `bar ${i + 1}'s close did not move by ${dv}`);
  if (i > 0 && openOf(moved[i].v, moved[i].d) !== Q.c[i - 1]) fail('moving a bar', `bar ${i + 1}'s open left the previous close`);
  if (i === 0 && openOf(moved[0].v, moved[0].d) !== Q.o0 + dv) fail('moving a bar', 'the first bar did not move whole');
  moved.forEach((b, q) => { if (q !== i && q !== i + 1 && !same([b], [out[q]])) fail('moving a bar', `bar ${q + 1}, not a neighbour, changed`); });
  // choosing the first bar's colour
  if (out[0].v[1] !== out[0].v[2]) {
    const flipped = chainBars(flipParams(Q));
    chained('choosing the first colour', flipped);
    if (flipped[0].v[1] !== out[0].v[1] || flipped[0].v[2] !== out[0].v[2] || flipped[0].d === out[0].d) fail('choosing the first colour', 'the first body changed or kept its colour');
    if (openOf(flipped[1].v, flipped[1].d) !== Q.o0) fail('choosing the first colour', "the second bar does not open at the first bar's other end");
  }
}
console.log(`${drawings} random drawings of 2 to 10 bars: chaining keeps every close and puts every later open on the previous close, colours follow, shadows hold the bodies, a second chaining changes nothing, moving and choosing the first colour keep the chain: ${fails.length ? fails.length + ' failures' : 'all hold'}`);
for (const f of fails) console.log('  ' + f);
process.exit(fails.length ? 1 : 0);
