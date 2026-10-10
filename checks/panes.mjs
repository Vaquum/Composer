// The panes, recomputed independently of the matcher's code: every reading, the set of windows that match, what came
// next, what the next six bars did and the drawings one comparison away, from the decoded bars and activity alone,
// then compared with what matcher.js returns.
// Usage: node checks/panes.mjs MATCHER_JS BARS_FILE ACTIVITY_FILE
import fs from 'node:fs';
const [matcherFile, barsFile, activityFile] = process.argv.slice(2);
const M = new Function('self', 'window', fs.readFileSync(matcherFile, 'utf8') + '\nreturn { decode, decodeActivity, readings, search, setBars: t => { BARS = t; }, setRead: r => { READ = r; }, setLatest: v => { latest = v; } };')(undefined, undefined);
const load = f => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const tape = M.decode(load(barsFile)), act = M.decodeActivity(load(activityFile));
M.setBars(tape);
M.setRead(tape.map((T, k) => M.readings(T, act[k])));

const sgn = x => (x > 0) - (x < 0);
const eps = (o, h, l, c) => [l, Math.min(o, c), Math.max(o, c), h];
// readings, from scratch: medians of the eleven bars before, Wilder ATR14 restarting after a gap, the prior UTC day's range
function readingsOf(T, A) {
  const n = T.n, med = (f, i) => { const w = []; for (let j = i - 11; j < i; j++) w.push(f(j)); w.sort((a, b) => a - b); return w[5]; };
  const atr = new Float64Array(n).fill(NaN);
  let cnt = 0, seed = 0, st = 0;
  for (let i = 0; i < n; i++) {
    if (i === 0 || T.ts[i] - T.ts[i - 1] !== T.sec) { cnt = 0; seed = 0; st = 0; continue; }
    const tr = Math.max(T.H[i] - T.L[i], Math.abs(T.H[i] - T.C[i - 1]), Math.abs(T.L[i] - T.C[i - 1]));
    if (cnt < 14) { seed += tr; cnt++; if (cnt === 14) { st = seed / 14; atr[i] = st; } } else { st = tr / 14 + (13 / 14) * st; atr[i] = st; }
  }
  const contiguous = (i, k) => { for (let j = i - k + 1; j <= i; j++) if (j <= 0 || T.ts[j] - T.ts[j - 1] !== T.sec) return false; return true; };
  const day = new Map();
  for (let i = 0; i < n; i++) { const d = Math.floor(T.ts[i] / 86400), v = day.get(d) || [-Infinity, Infinity]; day.set(d, [Math.max(v[0], T.H[i]), Math.min(v[1], T.L[i])]); }
  const R = { vol: [], trades: [], size: [], maker: [], range: [], body: [], day: [] };
  for (let i = 0; i < n; i++) {
    const ok11 = i >= 11 && contiguous(i, 11);
    R.vol.push(ok11 ? A.vol[i] / med(j => A.vol[j], i) : NaN);
    R.trades.push(ok11 ? A.trades[i] / med(j => A.trades[j], i) : NaN);
    R.size.push(ok11 ? (A.quote[i] / A.trades[i]) / med(j => A.quote[j] / A.trades[j], i) : NaN);
    R.maker.push(A.maker[i]);
    const a = i > 0 && contiguous(i, 1) ? atr[i - 1] : NaN;
    R.range.push(a > 0 ? (T.H[i] - T.L[i]) / a : NaN);
    R.body.push(a > 0 ? Math.abs(T.C[i] - T.O[i]) / a : NaN);
    const p = day.get(Math.floor(T.ts[i] / 86400) - 1);
    R.day.push(p && p[0] > p[1] ? (T.C[i] - p[1]) / (p[0] - p[1]) : NaN);
  }
  return R;
}
const RD = tape.map((T, k) => readingsOf(T, act[k]));
const KEYS = ['vol', 'trades', 'size', 'maker', 'range', 'body', 'day'], LOG = { vol: 1, trades: 1, size: 1 };
const contig = (T, a, b) => { for (let j = a + 1; j <= b; j++) if (T.ts[j] - T.ts[j - 1] !== T.sec) return false; return true; };
const nextOf = (T, e) => (e + 1 < T.n && contig(T, e, e + 1) ? sgn(T.C[e + 1] - T.C[e]) : null);
const wilson = (k, m) => { const z = 1.959964, p = k / m, d = 1 + z * z / m, c = (p + z * z / (2 * m)) / d, h = z * Math.sqrt(p * (1 - p) / m + z * z / (4 * m * m)) / d; return [p, c - h, c + h]; };

// with a colour held and stretch, a two-bar window is its first bar and any bar up to stretch + 1 later, with no gap between
function expected(q) {
  const n = q.bars.length, E = q.bars.flatMap(b => eps(...b)), D = q.bars.map(b => sgn(b[3] - b[0])), held = q.holds.length > 0;
  const pairs = []; for (let a = 0; a < 4 * n; a++) for (let b = a + 1; b < 4 * n; b++) pairs.push([a, b, sgn(E[a] - E[b])]);
  const set = [], groups = new Map(), all = Object.fromEntries(KEYS.map(k => [k, []]));
  tape.forEach((T, k) => {
    if (!q.tfs[k]) return;
    for (const key of KEYS) for (const v of RD[k][key]) if (v === v) all[key].push(LOG[key] ? Math.log(v) : v);
    for (let s = 0; s + n <= T.n; s++) {
      const e = s + n - 1;
      if (!contig(T, s, e)) continue;
      const W = [], C = [];
      for (let g = 0; g < n; g++) { W.push(...eps(T.O[s + g], T.H[s + g], T.L[s + g], T.C[s + g])); C.push(sgn(T.C[s + g] - T.O[s + g])); }
      const colours = C.every((c, g) => c === D[g]);
      let diff = 0, at = -1;
      for (let p = 0; p < pairs.length && diff < 2; p++) { const r = sgn(W[pairs[p][0]] - W[pairs[p][1]]); if (r !== pairs[p][2]) { diff++; at = p * 3 + r + 1; } }
      const nx = nextOf(T, e);
      if (colours && diff === 0 && !held) set.push({ k, s, e, nx, picks: null });
      if (held) for (let x = 0; x <= q.stretch; x++) {
        const e2 = s + 1 + x, h = q.holds[0];
        if (e2 >= T.n || !contig(T, s, e2)) break;
        if (sgn(T.C[s] - T.O[s]) === h.dir) set.push({ k, s, e: e2, nx: nextOf(T, e2), picks: [0, 1 + x] });
      }
      if (colours && diff === 1) { const v = groups.get(at) || { n: 0, out: 0, up: 0 }; v.n++; if (nx !== null) { v.out++; if (nx > 0) v.up++; } groups.set(at, v); }
    }
  });
  const stat = xs => { const m = xs.reduce((a, b) => a + b, 0) / xs.length, sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); return [m, sd, xs.length]; };
  const rows = [];
  for (let g = 0; g < n; g++) for (const key of KEYS) {
    if (key === 'day' && g !== n - 1) continue;
    const xs = set.map(w => RD[w.k][key][w.s + (w.picks ? w.picks[g] : g)]).filter(v => v === v).map(v => (LOG[key] ? Math.log(v) : v));
    if (xs.length >= 30) rows.push({ bar: g, key, set: stat(xs), all: stat(all[key]) });
  }
  const outs = set.filter(w => w.nx !== null);
  // the next six bars, in each window's own scale
  const cont = [];
  for (const w of set) {
    const T = tape[w.k];
    if (w.e + 6 >= T.n || !contig(T, w.e, w.e + 6)) continue;
    let lo = Infinity, hi = -Infinity;
    for (let g = 0; g < n; g++) { const j = w.s + (w.picks ? w.picks[g] : g); lo = Math.min(lo, T.L[j]); hi = Math.max(hi, T.H[j]); }
    if (!(hi > lo)) continue;
    const closes = [], his = [], los = [];
    for (let j = 1; j <= 6; j++) { closes.push((T.C[w.e + j] - lo) / (hi - lo)); his.push(T.H[w.e + j]); los.push(T.L[w.e + j]); }
    cont.push({ closes, up: Math.max(...his) > hi, down: Math.min(...los) < lo, above: T.C[w.e + 6] > T.C[w.e] });
  }
  const quant = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.round(p * (s.length - 1))]; };
  const fan = [0, 1, 2, 3, 4, 5].map(j => [0.1, 0.25, 0.5, 0.75, 0.9].map(p => quant(cont.map(c => c.closes[j]), p)));
  const near = [...groups].sort((a, b) => b[1].n - a[1].n).slice(0, 6).map(([at, v]) => ({ at, n: v.n, up: v.out >= 30 ? wilson(v.up, v.out) : null }));
  return { n: set.length, rows, next: wilson(outs.filter(w => w.nx > 0).length, outs.length), cont: { n: cont.length, fan, up: cont.filter(c => c.up).length, down: cont.filter(c => c.down).length, above: cont.filter(c => c.above).length }, near, pairs };
}

const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const cases = [
  ['green, then a larger red', [[42, 68, 30, 56], [62, 80, 18, 36]]],
  ['small green, then a 10x larger red', [[50, 51.2, 49.7, 51], [51, 51.5, 39, 40]]],
  ['red hammer, then a green, 15m and 4h hidden', [[50, 50.3, 44, 49], [49, 53, 48.6, 52.6]], [0, 1, 1, 1, 0]],
  ['green, then a larger red, first colour held, stretch 2', [[42, 68, 30, 56], [62, 80, 18, 36]], [1, 1, 1, 1, 1], [{ color: true, bar: 0, dir: 1 }], 2],
];
let id = 0, bad = 0;
for (const [label, bars, tfs = [1, 1, 1, 1, 1], holds = [], stretch = 0] of cases) {
  const q = { bars, holds, stretch, x: 12, tfs, oriented: true, next: null };
  M.setLatest(++id);
  const r = await M.search(q, id, () => {});
  const P = r.panes, X = expected(q), why = [];
  if (P.kind !== (holds.length ? 'hold' : 'twins') || P.n !== X.n) why.push(`set ${P.kind} ${P.n} vs ${X.n}`);
  for (const w of X.rows) {
    const got = P.rows.find(x => x.bar === w.bar && x.key === w.key);
    if (!got || !close(got.set[0], w.set[0], 1e-6) || !close(got.all[0], w.all[0], 1e-6) || !close(got.all[4], w.all[1], 1e-4) || got.set[3] !== w.set[2]) why.push(`reading bar ${w.bar + 1} ${w.key}`);
    else if (!close((got.set[2] - got.set[1]) / 2, 1.96 * w.set[1] / Math.sqrt(w.set[2]), 0.05)) why.push(`interval bar ${w.bar + 1} ${w.key}`);
  }
  if (P.rows.length !== X.rows.length) why.push(`${P.rows.length} readings vs ${X.rows.length}`);
  if (!P.next || !close(P.next[0], X.next[0], 1e-9) || !close(P.next[1], X.next[1], 1e-9)) why.push('next bar');
  const c = P.cont;
  if (!c || c.n !== X.cont.n || Math.round(c.aboveHigh[0] * c.n) !== X.cont.up || Math.round(c.belowLow[0] * c.n) !== X.cont.down || Math.round(c.aboveClose[0] * c.n) !== X.cont.above) why.push('what it became');
  // a fan drawn from a sample sits within a few hundredths of the shape's height of the whole set's
  else if (c.fan.some((qs, j) => qs.some((v, i) => !close(v, X.cont.fan[j][i], c.sampled === c.n ? 1e-6 : 0.03)))) why.push('fan');
  const gotNear = P.near.map(x => `${x.a}.${x.b}.${x.rel}:${x.n}:${x.up ? x.up[0].toFixed(6) : '-'}`).sort();
  const wantNear = X.near.map(x => { const [a, b] = X.pairs[Math.floor(x.at / 3)]; return `${a}.${b}.${x.at % 3 - 1}:${x.n}:${x.up ? x.up[0].toFixed(6) : '-'}`; }).sort();
  if (JSON.stringify(gotNear) !== JSON.stringify(wantNear)) why.push(`one comparison away: ${gotNear.join(' ')} vs ${wantNear.join(' ')}`);
  if (why.length) bad++;
  console.log(`${label}: ${why.length ? 'DIFFERS: ' + why.join('; ') : `same: ${P.n} windows, ${P.rows.length} readings, next bar ${(P.next[0] * 100).toFixed(1)}%, ${c.n} continuations, ${P.near.length} neighbours`}`);
}
console.log(bad ? `${bad} case(s) differ` : 'the panes match an independent recomputation on every case');
process.exit(bad ? 1 : 0);
