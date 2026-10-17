// The similarity search drops a placement or window as soon as what it has already cost passes the best it could
// still beat. That must change nothing but the time: compare matcher.js with the same matcher with
// every such bound removed, on held, stretched, filtered, shape-only, nearest and fallback searches, and time the
// heaviest one.
import fs from 'node:fs';
import assert from 'node:assert/strict';
// Usage: node checks/similarity-equivalence.mjs MATCHER_JS BARS_FILE (BARS_FILE as bars.py writes it)
const [matcherFile, barsFile] = process.argv.slice(2);
const source = fs.readFileSync(matcherFile, 'utf8');
const BOUNDS = [
  ['endLimits=endGroups.length?new Int32Array(n):null', 'endLimits=null'],
  ['    for (const h of endHolds[g]) if (!holdOk(h, MO, MH, ML, MC)) return 0;\n', ''],
  [' || scoring && colours[g] + lower / 2 + FLIP_WEIGHT * differences[g] / (2 * cq.P) > Math.min(best.bound(), bestHere ? bestHere.d : Infinity)', ''],
  ['      if (floor > limit) continue;\n', ''],
  ['closeness(cq, MO, MH, ML, MC, W, best.bound())', 'closeness(cq, MO, MH, ML, MC, W, Infinity)'],
  ['closeness(cq, MO, MH, ML, MC, W, near.bound())', 'closeness(cq, MO, MH, ML, MC, W, Infinity)'],
];
let open = source;
for (const [from, to] of BOUNDS) {
  if (open.split(from).length !== 2) throw new Error(`the bound ${JSON.stringify(from)} is not where this check expects it`);
  open = open.replace(from, to);
}
const load = src => new Function('self', 'window', src + '\nreturn { decode, search, setBars: t => { BARS = t; }, setLatest: v => { latest = v; } };')(undefined, undefined);
const bounded = load(source), exhaustive = load(open);
const buf = fs.readFileSync(barsFile);
for (const M of [bounded, exhaustive]) M.setBars(M.decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)));
const DOUBLE = [[50, 51, 44, 45], [45.3, 46, 38, 39], [39.2, 40, 33, 34], [34.1, 35, 28, 31], [31.2, 38, 30, 37], [37.1, 42, 36, 41], [41, 41.5, 34, 35], [35.2, 36, 29, 33], [33.1, 40, 32, 39], [39.2, 47, 38, 46]];
const K = { O: 0, H: 1, L: 2, C: 3 };
const pin = p => { if (p[0] === 'u' || p[0] === 'd') return { color: true, bar: +p.slice(1) - 1, dir: p[0] === 'u' ? 1 : -1 }; const m = p.match(/^([LHOC])(\d+)([<>])([LHOC])(\d+)$/); return { a: [+m[2] - 1, K[m[1]]], b: [+m[5] - 1, K[m[4]]], rel: m[3] === '<' ? -1 : 1 }; };
const PINS17 = ['u10', 'L4<L1', 'L4<L2', 'L4<L3', 'L4<L5', 'L4<L6', 'L4<L7', 'L4<L8', 'L4<L9', 'L4<L10', 'L8<L7', 'L8<L9', 'H6>H5', 'H6>H7', 'H6>H8', 'H6>H9', 'C10>H6'].map(pin);
const TWO = [[42, 68, 30, 56], [62, 80, 18, 36]], TINY = [[50, 51.2, 49.7, 51], [51, 51.5, 39, 40]];
const cases = [
  ['two bars, nothing held', { bars: TINY, holds: [] }, true],
  ['ten bars, nothing held', { bars: DOUBLE, holds: [] }, true],
  ['ten bars, nothing held, shape only, next bar down 1 ATR, 15m hidden', { bars: DOUBLE, holds: [], oriented: false, next: { dir: -1, measure: 'atr', value: 1 }, tfs: [0, 1, 1, 1, 1] }, true],
  ['two bars, first colour held, stretch 4', { bars: TWO, holds: [pin('u1')], stretch: 4 }, true],
  ['two bars, first colour held, stretch 4, next bar up 1 ATR, 30m and 4h hidden', { bars: TWO, holds: [pin('u1')], stretch: 4, next: { dir: 1, measure: 'atr', value: 1 }, tfs: [1, 0, 1, 1, 0] }, true],
  ['double bottom, 17 pins, stretch 0', { bars: DOUBLE, holds: PINS17, stretch: 0 }, true],
  ['double bottom, 17 pins, stretch 2', { bars: DOUBLE, holds: PINS17, stretch: 2 }, true],
  ['double bottom, 17 pins, stretch 4, shape only', { bars: DOUBLE, holds: PINS17, stretch: 4, oriented: false }, true],
  ['double bottom, 17 pins, next bar up 8 ATR: nothing passes, nearest shown', { bars: DOUBLE, holds: PINS17, stretch: 0, next: { dir: 1, measure: 'atr', value: 8 } }, true],
  ['double bottom, one pin, stretch 2', { bars: DOUBLE, holds: [PINS17[16]], stretch: 2 }, true],
  ['double bottom, one pin, stretch 4', { bars: DOUBLE, holds: [PINS17[16]], stretch: 4 }, false, 5000],
];
let id = 0, mismatches = 0;
const key = r => JSON.stringify({ mode: r.mode, exact: r.exact, exactF: r.exactF, counts: r.counts, countsF: r.countsF, split: r.split, base: r.base, results: r.results.map(x => [x.tf, x.start, x.end, x.picks.join('.'), x.flips, x.off, x.score]) });
for (const [label, q, compare, budget] of cases) {
  const query = { x: 48, tfs: [1, 1, 1, 1, 1], oriented: true, next: null, stretch: 0, ...q };
  bounded.setLatest(++id); const cpuStart=process.cpuUsage();let t = Date.now(); const a = await bounded.search(query, id, () => {}); const tb = Date.now() - t;
  const cpu=process.cpuUsage(cpuStart),cpuMs=Math.round((cpu.user+cpu.system)/1000);
  let line = `${label}: ${a.mode}, bounded ${tb} ms wall (${cpuMs} ms CPU)`;
  if (compare) {
    exhaustive.setLatest(++id); t = Date.now(); const b = await exhaustive.search(query, id, () => {}); const te = Date.now() - t;
    const same = key(a) === key(b);
    if (!same) mismatches++;
    line += `, unbounded ${te} ms, identical ${same}`;
  }
  console.log(line + `; ${a.results.length} shown`);
  if(budget)assert.ok(tb<budget,`${label}: exact search exceeded ${budget} ms (${tb})`);
}
console.log(mismatches ? `${mismatches} case(s) differ` : 'bounded search identical to the unbounded one on every compared case');
process.exit(mismatches ? 1 : 0);
