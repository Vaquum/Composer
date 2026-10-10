// Composer's similarity ranking, re-derived by brute force from its definition, independently of the matcher's code:
// score = colours (each bar whose direction differs costs 1, against a doji 0.5)
//       + shape (both scaled to their own low..high, the mean distance of the 16 or more bar ends)
//       + 0.05 x sizes (each bar's body and range as a share of that height, compared as log ratios with a 0.02 floor)
//       + 0.3 x flipped comparisons between bar ends / all comparisons.
// For every window on the shown timeframes this check tries every placement, keeps the closest, ranks all windows,
// takes distinct moments in time, and compares counts, the rise/fall split, the shown windows and their scores,
// flips, shape and next bar with what the matcher returns.
import fs from 'node:fs';
// Usage: node checks/similarity-windows.mjs MATCHER_JS BARS_FILE (BARS_FILE as bars.py writes it)
const [matcherFile, barsFile] = process.argv.slice(2);
const M = new Function('self', 'window', fs.readFileSync(matcherFile, 'utf8') + '\nreturn { decode, search, setBars: t => { BARS = t; }, setLatest: v => { latest = v; } };')(undefined, undefined);
const buf = fs.readFileSync(barsFile);
const history = M.decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)); M.setBars(history);
const TF = ['15m', '30m', '1h', '2h', '4h'];

const eps = b => [b[2], Math.min(b[0], b[3]), Math.max(b[0], b[3]), b[1]];
const sign = x => (x > 0 ? 1 : x < 0 ? -1 : 0);
function profile(bars) {
  const e = bars.flatMap(eps), lo = Math.min(...e), hi = Math.max(...e), span = hi - lo || 1;
  const norm = e.map(x => (x - lo) / span);
  return { e, norm, dir: bars.map(b => sign(b[3] - b[0])), body: bars.map((_, i) => norm[4 * i + 2] - norm[4 * i + 1]), range: bars.map((_, i) => norm[4 * i + 3] - norm[4 * i]) };
}
function score(q, bars, oriented) {
  const w = profile(bars), n = bars.length, m = 4 * n, P = m * (m - 1) / 2;
  let colours = 0, shape = 0, size = 0, half = 0, colourHalf = 0;
  for (let i = 0; i < n; i++) if (oriented) { colours += Math.abs(w.dir[i] - q.dir[i]) / 2; colourHalf += Math.abs(w.dir[i] - q.dir[i]); }
  for (let j = 0; j < m; j++) shape += Math.abs(w.norm[j] - q.norm[j]);
  for (let i = 0; i < n; i++) size += Math.abs(Math.log(w.body[i] + 0.02) - Math.log(q.body[i] + 0.02)) + Math.abs(Math.log(w.range[i] + 0.02) - Math.log(q.range[i] + 0.02));
  for (let a = 0; a < m; a++) for (let b = a + 1; b < m; b++) half += Math.abs(sign(w.e[a] - w.e[b]) - sign(q.e[a] - q.e[b]));
  return { score: colours + shape / m + 0.05 * size / (2 * n) + 0.3 * (half / 2) / P, flips: (half + colourHalf) / 2, off: shape / m };
}
const price = (b, k) => [b[0], b[1], b[2], b[3], Math.min(b[0], b[3]), Math.max(b[0], b[3])][k];
const holdsAll = (holds, bars) => holds.every(h => h.color ? sign(bars[h.bar][3] - bars[h.bar][0]) === h.dir : sign(price(bars[h.a[0]], h.a[1]) - price(bars[h.b[0]], h.b[1])) === h.rel);
// placements of n bars on [s, e]: first on s, last on e, the rest strictly between, in order
function* placements(s, e, n) {
  if (n === 1) { if (s === e) yield [s]; return; }
  const rec = function* (from, left) { if (left === 1) { yield [e]; return; } for (let j = from; j <= e - left + 1; j++) for (const rest of rec(j + 1, left - 1)) yield [j, ...rest]; };
  for (const rest of rec(s + 1, n - 1)) yield [s, ...rest];
}
// what the next bar did, by the engine's definitions
function next(T, e) {
  if (e + 1 >= T.n || T.run[e + 1] < 2) return null;
  const move = T.C[e + 1] - T.C[e], a = T.atr[e];
  return { dir: sign(move), bps: move / T.C[e] * 1e4, atrx: a > 0 ? move / a : NaN };
}
function passes(o, f) {
  if (!f) return true;
  if (!o) return false;
  if (f.measure === 'bps') return f.dir > 0 ? o.bps >= f.value : o.bps <= -f.value;
  if (f.measure === 'atr') return o.atrx === o.atrx && (f.dir > 0 ? o.atrx >= f.value : o.atrx <= -f.value);
  return o.dir === f.dir;
}
const bar = (T, i) => [T.O[i], T.H[i], T.L[i], T.C[i]];

const DOUBLE = [[50, 51, 44, 45], [45.3, 46, 38, 39], [39.2, 40, 33, 34], [34.1, 35, 28, 31], [31.2, 38, 30, 37], [37.1, 42, 36, 41], [41, 41.5, 34, 35], [35.2, 36, 29, 33], [33.1, 40, 32, 39], [39.2, 47, 38, 46]];
const K = { O: 0, H: 1, L: 2, C: 3 };
const pin = p => { if (p[0] === 'u' || p[0] === 'd') return { color: true, bar: +p.slice(1) - 1, dir: p[0] === 'u' ? 1 : -1 }; const m = p.match(/^([LHOC])(\d+)([<>])([LHOC])(\d+)$/); return { a: [+m[2] - 1, K[m[1]]], b: [+m[5] - 1, K[m[4]]], rel: m[3] === '<' ? -1 : 1 }; };
const PINS17 = ['u10', 'L4<L1', 'L4<L2', 'L4<L3', 'L4<L5', 'L4<L6', 'L4<L7', 'L4<L8', 'L4<L9', 'L4<L10', 'L8<L7', 'L8<L9', 'H6>H5', 'H6>H7', 'H6>H8', 'H6>H9', 'C10>H6'].map(pin);
const ENGULF = [[42, 68, 30, 56], [62, 80, 18, 36]], TINY = [[50, 51.2, 49.7, 51], [51, 51.5, 39, 40]];
const ALL = [1, 1, 1, 1, 1];
const cases = [
  ['green then a larger red, nothing held', { bars: ENGULF, holds: [], stretch: 0, tfs: ALL }],
  ['small green then a 10x larger red, nothing held', { bars: TINY, holds: [], stretch: 0, tfs: ALL }],
  ['small green then a 10x larger red, shape only, next bar down 10 bps, 15m hidden', { bars: TINY, holds: [], stretch: 0, tfs: [0, 1, 1, 1, 1], oriented: false, next: { dir: -1, measure: 'bps', value: 10 } }],
  ['green then a larger red, first colour held, stretch 4', { bars: ENGULF, holds: [pin('u1')], stretch: 4, tfs: ALL }],
  ['green then a larger red, first colour held, stretch 4, next bar up 1 ATR, 30m and 4h hidden', { bars: ENGULF, holds: [pin('u1')], stretch: 4, tfs: [1, 0, 1, 1, 0], next: { dir: 1, measure: 'atr', value: 1 } }],
  ['double bottom, 17 pins, stretch 1', { bars: DOUBLE, holds: PINS17, stretch: 1, tfs: ALL }],
  ['double bottom, 17 pins, next bar up 8 ATR: nothing passes, nearest shown', { bars: DOUBLE, holds: PINS17, stretch: 0, tfs: ALL, next: { dir: 1, measure: 'atr', value: 8 } }],
];
const X = 48, TOL = 1e-9;
let id = 0, bad = 0;
for (const [label, c] of cases) {
  const q = { x: X, oriented: true, next: null, ...c }, f = q.next && q.next.dir ? q.next : null, qp = profile(q.bars), n = q.bars.length, held = q.holds.length > 0;
  M.setLatest(++id);
  const t = Date.now(), r = await M.search(q, id, () => {}), ms = Date.now() - t;
  const counts = [0, 0, 0, 0, 0], split = { n: 0, up: 0, down: 0, flat: 0, none: 0 }, ranked = [], bestOf = new Map();
  let countsF = 0;
  history.forEach((T, k) => {
    for (let s = 0; s + n <= T.n; s++) for (let extra = 0; extra <= (held ? q.stretch : 0); extra++) {
      const e = s + n - 1 + extra;
      if (e >= T.n || T.run[e] < e - s + 1) break;
      const o = next(T, e);
      if (!held) { if (q.tfs[k] && passes(o, f)) ranked.push({ k, s, e, extra, ...score(qp, [...Array(n)].map((_, i) => bar(T, s + i)), q.oriented) }); continue; }
      let best = null;
      for (const pl of placements(s, e, n)) {
        const w = pl.map(i => bar(T, i));
        if (!holdsAll(q.holds, w)) continue;
        const sc = score(qp, w, q.oriented);
        if (!best || sc.score < best.score - TOL) best = { ...sc, pl };
      }
      if (!best) continue;
      counts[k]++;
      if (q.tfs[k]) { split.n++; if (!o) split.none++; else if (o.dir > 0) split.up++; else if (o.dir < 0) split.down++; else split.flat++; }
      if (!passes(o, f)) continue;
      countsF++;
      bestOf.set(`${k}:${s}:${e}`, best);
      if (q.tfs[k]) ranked.push({ k, s, e, extra, score: best.score, flips: best.flips, off: best.off });
    }
  });
  const fallback = held && countsF === 0;
  if (fallback) {
    // nothing holds and passes: the nearest windows that pass, scored as if nothing were held
    history.forEach((T, k) => {
      if (!q.tfs[k]) return;
      for (let s = 0; s + n <= T.n; s++) {
        const e = s + n - 1;
        if (T.run[e] < n || !passes(next(T, e), f)) continue;
        ranked.push({ k, s, e, extra: 0, ...score(qp, [...Array(n)].map((_, i) => bar(T, s + i)), q.oriented) });
      }
    });
  }
  // the matcher keeps the closest max(400, 40 x) windows, then takes them in order skipping any that overlap an earlier one in time
  ranked.sort((a, b) => a.score - b.score || a.extra - b.extra || history[b.k].ts[b.e] - history[a.k].ts[a.e]);
  const kept = ranked.slice(0, Math.max(400, X * 40)), chosen = [], spans = [];
  for (const w of kept) {
    const T = history[w.k], a = T.ts[w.s], b = T.ts[w.e] + T.sec;
    if (spans.some(([x, y]) => a < y && b > x)) continue;
    spans.push([a, b]); chosen.push(w);
    if (chosen.length >= X) break;
  }
  const sameMode = r.mode === (fallback ? 'fallback' : held ? 'held' : 'nearest');
  const sameCounts = !held || fallback || JSON.stringify(counts) === JSON.stringify(r.counts);
  const sameSplit = !held || fallback || JSON.stringify(split) === JSON.stringify(r.split);
  // a different window at the same rank is only acceptable where two windows score the same to within rounding
  const tied = v => ranked.filter(w => Math.abs(w.score - v) < TOL).length > 1;
  let shownOk = 0, sameAsBrute = r.results.length === chosen.length;
  r.results.forEach((x, i) => {
    const k = TF.indexOf(x.tf), T = history[k], s = T.ts.indexOf(x.start), e = s + x.raw.length - 1, w = chosen[i];
    const sc = score(qp, x.picks.map(p => bar(T, s + p)), q.oriented), o = next(T, e);
    const placementBest = !held || fallback || Math.abs(bestOf.get(`${k}:${s}:${e}`).score - sc.score) < TOL;
    const nextOk = o ? !!x.next && x.next.dir === o.dir : !x.next;
    if (Math.abs(sc.score - x.score) < TOL && sc.flips === x.flips && Math.abs(sc.off - x.off) < TOL && placementBest && nextOk && x.end === T.ts[e] + T.sec) shownOk++;
    if (!w || Math.abs(w.score - x.score) > TOL || ((w.k !== k || w.s !== s || w.e !== e) && !tied(w.score))) sameAsBrute = false;
  });
  const ok = sameMode && sameCounts && sameSplit && shownOk === r.results.length && sameAsBrute;
  if (!ok) bad++;
  console.log(`${label}: ${r.mode}${held && !fallback ? `, counts match ${sameCounts} (${r.counts.join('/')}), split matches ${sameSplit} (up ${split.up}, down ${split.down}, flat ${split.flat}, none ${split.none})` : ''}, shown windows right ${shownOk}/${r.results.length}, same ${r.results.length} windows in the same order as brute force ${sameAsBrute}; ${ms} ms`);
}
console.log(bad ? `${bad} case(s) disagree` : 'every shown window is the closest by the ranking\'s definition, in order, with its own counts and next bar');
process.exit(bad ? 1 : 0);
