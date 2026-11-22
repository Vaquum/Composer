// The g1 dimensions, held to literal vectors that Vaquum/Filang's study engine and Rust core are held to as well.
// checks/dimension-vectors.json lists small windows of recorded bars with their counters, and the part of the g1 code
// each window has on every dimension: volume, trades, delta, size, imbalance. A part of null means a bar of the window
// has no such value. This check binds two things to every vector.
//
// The bench's encoder. Each bar is given a mark at its recorded value on each dimension, so the marks stand in the
// recorded order and in no canonical form. The bench must write the vector's own part for every dimension, and the
// price part followed by the chosen parts for every set of dimensions; with none it must write the price part alone.
// A drawing of two bars or more must carry the same code through its address and its packet.
//
// The matcher's reading. The bars go through the matcher's own decoders as a one-timeframe history: prices as bars.py
// writes them, counters as bars.py writes them. The values the matcher reads on each dimension, ranked here from
// scratch, must give the vector's part. Asked for the drawing of the window's code with a set of dimensions switched
// on, the matcher must find exactly the windows whose code, worked out here independently, is that code; a window
// that does not stand in the order asked is read and not found; and a window with a bar that has no value on a
// dimension asked about is neither found nor counted among the windows read.
// Usage: node checks/dimension-vectors.mjs   (from the repository root)
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createModel, g1, dimPart, DIMENSIONS, decodePacket } from '../bench/model.js';

const root = process.cwd();
const M = new Function('self', 'window', fs.readFileSync(root + '/matcher.js', 'utf8')
  + '\nreturn { decode, decodeCounters, dimensionValues, search, DIMENSIONS, set: (bars, counters) => { BARS = bars; COUNT = counters; }, setLatest: v => { latest = v; } };')(undefined, undefined);
const file = JSON.parse(fs.readFileSync(root + '/checks/dimension-vectors.json', 'utf8'));
const NAMES = file.dimensions, WITH_ZERO = new Set(['delta', 'imbalance']);
assert.deepEqual(DIMENSIONS.map(d => d.name), NAMES, 'the bench writes the dimensions in the order the vectors name them');
assert.deepEqual(M.DIMENSIONS, NAMES, 'the matcher reads the dimensions in the order the vectors name them');
assert.deepEqual(DIMENSIONS.filter(d => d.zero).map(d => d.name), [...WITH_ZERO], 'delta and imbalance are the dimensions ranked against zero');
assert.deepEqual(DIMENSIONS.map(d => d.label), ['Volume', 'Trades', 'Delta', 'Trade size', 'Net taker imbalance'], 'the switches carry the names the cube gives them');

// ---- written here from the rule the vectors state, and from nothing in the bench or the matcher
// a bar's value on a dimension, from [.., volume, taker-buy volume, trade count]: the float the expression gives as written
const VALUE = {
  volume: (v) => v, trades: (v, b, n) => n, delta: (v, b) => 2 * b - v,
  size: (v, b, n) => (n === 0 ? null : v / n), imbalance: (v, b) => (v === 0 ? null : (2 * b - v) / v),
};
const valuesOf = (bars, name) => bars.map(([, , , , v, b, n]) => VALUE[name](v, b, n));
// a dimension part from values: null when one is absent, else each value's rank among the distinct values, zero among them where it is ranked
function partOf(name, values) {
  if (values.some(x => x === null)) return null;
  const all = WITH_ZERO.has(name) ? [...values, 0] : values, order = [...new Set(all)].sort((a, b) => a - b), rank = x => order.indexOf(x);
  return name + ':' + values.map(rank).join(',') + (WITH_ZERO.has(name) ? '/' + rank(0) : '');
}
// the price code of bars given as [open, high, low, close, ..], read as a chain: each later bar opens at the close before it
function chainedCode(bars) {
  const ends = bars.map(([o, h, l, c], i) => { const open = i ? bars[i - 1][3] : o; return [Math.min(l, open), Math.min(open, c), Math.max(open, c), Math.max(h, open), c > open ? 'u' : c < open ? 'd' : 'z']; });
  const order = [...new Set(ends.flatMap(e => e.slice(0, 4)))].sort((a, b) => a - b);
  return 'g1:o:' + ends.map(e => [...e.slice(0, 4).map(v => order.indexOf(v)), e[4]].join(',')).join(';');
}
const subsets = names => Array.from({ length: 1 << names.length }, (_, mask) => names.filter((_, k) => mask >> k & 1));
// A part that says another order than the one given, still canonical: the first bar is put under every other mark,
// then over them all, and one of the two is another order. Null for a single bar with no zero, which has one order.
function otherPart(name, part, n) {
  const zero = WITH_ZERO.has(name), ranks = part.slice(name.length + 1).split(/[,/]/).map(Number);
  const write = levels => { const order = [...new Set(levels)].sort((a, b) => a - b), r = levels.map(x => order.indexOf(x)); return name + ':' + r.slice(0, n).join(',') + (zero ? '/' + r[n] : ''); };
  for (const to of [-1, ranks.length]) { const other = write([to, ...ranks.slice(1)]); if (other !== part) return other; }
  return null;
}

// ---- the matcher's own payloads, as bars.py writes them
function barsPayload(bars) {
  const out = [];
  const u32 = x => out.push(x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255);
  const varint = x => { do { let b = x % 128; x = Math.floor(x / 128); if (x) b |= 128; out.push(b); } while (x); };
  const zigzag = v => varint(v < 0 ? -2 * v - 1 : 2 * v);
  for (const ch of 'CBAR1') out.push(ch.charCodeAt(0));
  out.push(1, 3, ...[...'15m'].map(ch => ch.charCodeAt(0)));
  u32(900); u32(bars.length); u32(1700000000); u32(0);
  let previous = 0;
  for (const [o, h, l, c] of bars) { zigzag(o - previous); zigzag(c - o); varint(h - Math.max(o, c)); varint(Math.min(o, c) - l); previous = c; }
  return Uint8Array.from(out).buffer;
}
function countersPayload(bars) {
  const n = bars.length, buffer = new ArrayBuffer(5 + 1 + 1 + 3 + 4 + n * 20), dv = new DataView(buffer);
  let p = 0;
  for (const ch of 'CCNT1') dv.setUint8(p++, ch.charCodeAt(0));
  dv.setUint8(p++, 1); dv.setUint8(p++, 3); for (const ch of '15m') dv.setUint8(p++, ch.charCodeAt(0));
  dv.setUint32(p, n, true); p += 4;
  for (const b of bars) { dv.setFloat64(p, b[4], true); p += 8; }
  for (const b of bars) { dv.setFloat64(p, b[5], true); p += 8; }
  for (const b of bars) { dv.setUint32(p, b[6], true); p += 4; }
  return buffer;
}
// a drawing whose own price code is the given one: its ranks are its prices
const drawingOf = code => code.slice(5).split(';').map(row => { const [l, lo, hi, h, d] = row.split(','); return { v: [l, lo, hi, h].map(Number), d: d === 'd' ? 'd' : 'u' }; });
const rowsOf = drawing => drawing.map(({ v: [l, lo, hi, h], d }) => (d === 'd' ? [hi, h, l, lo] : [lo, h, l, hi]));

let id = 0, encoded = 0, asked = 0, absent = 0;
for (const v of file.vectors) {
  const n = v.bars.length, parts = Object.fromEntries(NAMES.map(name => [name, partOf(name, valuesOf(v.bars, name))]));
  assert.deepEqual(parts, v.parts, `${v.name}: the parts follow from the bars by the rule the vectors state`);
  assert.equal(chainedCode(v.bars), v.chained, `${v.name}: the chained price code follows from the bars`);
  const present = NAMES.filter(name => v.parts[name] !== null);
  absent += NAMES.length - present.length;

  // ---- the bench's encoder
  const drawing = drawingOf(v.chained);
  assert.equal(g1(drawing, true), v.chained, `${v.name}: with every dimension off the bench writes the price code alone`);
  for (const name of present) assert.equal(dimPart(name, valuesOf(v.bars, name)), v.parts[name], `${v.name}: the bench writes ${v.parts[name]} for marks in the recorded order`);
  for (const on of subsets(present)) {
    const marked = drawing.map((b, i) => ({ ...b, m: Object.fromEntries(on.map(name => [name, valuesOf(v.bars, name)[i]])) }));
    const want = v.chained + on.map(name => '|' + v.parts[name]).join('');
    assert.equal(g1(on.length ? marked : drawing, true), want, `${v.name}: the bench writes ${want}`);
    encoded++;
    if (n < 2) continue;   // the bench draws two bars or more: a one-bar window is held to its code alone
    // the same drawing made through the model, as the bench makes it: switches, marks, then the address and the packet
    const a = createModel(); a.setBars(drawing, false);
    for (const name of on) { assert.ok(a.setDim(name, true)); valuesOf(v.bars, name).forEach((value, i) => assert.ok(a.placeMark(name, i, value))); }
    a.settle();
    assert.equal(g1(a.state.bars, true), want, `${v.name}: the model draws ${want}`);
    assert.deepEqual(a.query().dims, on.length ? on.map(name => v.parts[name]) : undefined, `${v.name}: the question carries the parts, and no dimensions at all when none is on`);
    const b = createModel(); assert.ok(b.readAddress('#' + a.address()), `${v.name}: the address reads back`);
    assert.equal(g1(b.state.bars, b.state.oriented), want, `${v.name}: the address carries ${want}`);
    const text = JSON.stringify(a.toPacket()), c = createModel();
    assert.deepEqual(decodePacket(text).dimensions, on.length ? on.map(name => v.parts[name]) : undefined, `${v.name}: the packet carries the parts`);
    assert.equal(c.readPacket(text), null); assert.equal(g1(c.state.bars, c.state.oriented), want, `${v.name}: the packet carries ${want}`);
  }

  // ---- the matcher's reading: the window, then one more bar so that it has a next bar and is counted as read
  const last = v.bars[n - 1], after = [last[3], last[3] + 700, last[3] - 500, last[3] + 300, 5000, 2600, 50];
  const history = [...v.bars, after], tables = M.decode(barsPayload(history)), counters = M.decodeCounters(countersPayload(history));
  M.set(tables, counters);
  assert.deepEqual(history.map((b, i) => [tables[0].O[i], tables[0].H[i], tables[0].L[i], tables[0].C[i], counters[0].vol[i], counters[0].tbvol[i], counters[0].cnt[i]]), history, `${v.name}: the record is decoded as it was written`);
  for (const name of NAMES) {
    const read = Array.from(M.dimensionValues(counters[0], name)).slice(0, n).map(x => (Number.isNaN(x) ? null : x));
    assert.deepEqual(read, valuesOf(v.bars, name), `${v.name}: the matcher reads the values of ${name} the rule gives`);
    assert.equal(partOf(name, read), v.parts[name], `${v.name}: the matcher's values of ${name} rank to ${v.parts[name]}`);
  }
  // every window of the history, read here: its chained code, its parts, and whether it has a next bar
  const windows = Array.from({ length: history.length - n + 1 }, (_, s) => { const bars = history.slice(s, s + n); return { code: chainedCode(bars), parts: Object.fromEntries(NAMES.map(name => [name, partOf(name, valuesOf(bars, name))])), next: s + n < history.length }; });
  const ask = async dims => { M.setLatest(++id); asked++; return M.search({ bars: rowsOf(drawing), holds: [], stretch: 0, x: 12, tfs: [1, 1, 1, 1, 1], oriented: true, next: null, ...(dims ? { dims } : {}) }, id, () => {}); };
  const expect = (dims) => {   // dims: { name: part asked }
    const names = Object.keys(dims), read = windows.filter(w => names.every(name => w.parts[name] !== null));
    return { twins: read.filter(w => w.code === v.chained && names.every(name => w.parts[name] === dims[name])).length, counted: read.filter(w => w.next).length };
  };
  const plain = await ask(null);
  assert.equal(plain.exact[0], windows.filter(w => w.code === v.chained).length, `${v.name}: with every dimension off the matcher counts the price twins`);
  assert.equal(plain.base.n, windows.filter(w => w.next).length);
  for (const on of subsets(present)) {
    if (!on.length) continue;
    const dims = Object.fromEntries(on.map(name => [name, v.parts[name]])), want = expect(dims), r = await ask(on.map(name => v.parts[name]));
    assert.ok(want.twins >= 1, `${v.name}: the window is a twin of its own code`);
    assert.equal(r.exact[0], want.twins, `${v.name}: ${on.map(name => v.parts[name]).join('|')} finds the window`);
    assert.equal(r.base.n, want.counted, `${v.name}: every window with its values is counted as read`);
    assert.ok(r.results.some(x => x.flips === 0 && x.start === tables[0].ts[0]), `${v.name}: the window is shown as the exact twin`);
  }
  for (const name of present) {
    // another order on one dimension: the window is read, and is not found
    const other = otherPart(name, v.parts[name], n); if (!other) continue;
    const want = expect({ [name]: other }), r = await ask([other]);
    assert.equal(r.exact[0], want.twins, `${v.name}: ${other} is not the window's order, so it is not found`);
    assert.ok(!r.results.some(x => x.start === tables[0].ts[0]), `${v.name}: a window that does not stand in ${other} is no candidate at all`);
    assert.equal(r.base.n, want.counted, `${v.name}: a window that does not stand in ${other} is still counted as read`);
    assert.equal(want.counted, plain.base.n);
  }
  for (const name of NAMES.filter(x => v.parts[x] === null)) {
    // a bar has no value here: whatever order is asked, the window is neither found nor counted as read
    const some = name + ':' + Array(n).fill(0).join(',') + (WITH_ZERO.has(name) ? '/0' : ''), want = expect({ [name]: some }), r = await ask([some]);
    assert.equal(r.exact[0], 0, `${v.name}: a window without a value of ${name} is not found`);
    assert.equal(r.results.length, 0, `${v.name}: a window without a value of ${name} is no candidate`);
    assert.equal(r.base.n, want.counted, `${v.name}: a window without a value of ${name} is not counted as read`);
    assert.ok(want.counted < plain.base.n, `${v.name}: the same window is counted when ${name} is off`);
  }
}
assert.ok(absent > 0, 'the vectors include a window without a value');

// ---- beyond the vectors: something held, and stretch. The drawn bars then pick themselves out of a longer run, and a
// run counts when some placement keeps what is held and stands in the order of the dimensions on the bars it picked.
// A run with a bar that has no value on a dimension asked about is not read. Each case is counted here from scratch,
// over random histories whose prices and counters tie often and whose bars sometimes did not trade.
{
  let seed = 20261122; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296, pick = a => a[Math.floor(rnd() * a.length)];
  const weak = (name, n) => { const levels = Array.from({ length: n }, () => Math.floor(rnd() * 3) - 1); return partOf(name, WITH_ZERO.has(name) ? levels : levels.map(x => x + 1)); };
  let cases = 0, held = 0, unread = 0, stretched = 0;
  for (let t = 0; t < 160; t++) {
    const n = 2 + Math.floor(rnd() * 2), stretch = Math.floor(rnd() * 3), length = 40 + Math.floor(rnd() * 30), history = [];
    let close = 1000;
    for (let i = 0; i < length; i++) {
      const o = close + pick([0, 0, 1, -1]), c = o + pick([-2, -1, 0, 1, 2]), traded = rnd() < 0.93, vol = traded ? pick([100, 200, 300]) : 0;
      history.push([o, Math.max(o, c) + pick([0, 1, 2]), Math.min(o, c) - pick([0, 1, 2]), c, vol, traded ? vol * pick([0.25, 0.5, 0.75]) : 0, traded ? pick([1, 2, 4]) : 0]);
      close = c;
    }
    const names = NAMES.filter(() => rnd() < 0.4); if (!names.length) names.push(pick(NAMES));
    const asking = Object.fromEntries(names.map(name => [name, weak(name, n)])), rel = pick([-1, 0, 1]);
    M.set(M.decode(barsPayload(history)), M.decodeCounters(countersPayload(history))); M.setLatest(++id); asked++;
    const drawing = Array.from({ length: n }, (_, g) => [10 + g, 14 + g, 8 + g, 11 + g]);   // any chain will do: only what is held and the dimensions are counted here
    const r = await M.search({ bars: drawing, holds: [{ a: [0, 1], b: [n - 1, 1], rel }], stretch, x: 12, tfs: [1, 1, 1, 1, 1], oriented: true, next: null, dims: names.map(name => asking[name]) }, id, () => {});
    // from scratch: the high of a later bar is read with the open it has in the chain, the close of the bar just before it
    const high = (j, first) => (first ? history[j][1] : Math.max(history[j][1], history[j - 1][3])), sign = x => (x > 0 ? 1 : x < 0 ? -1 : 0);
    const hasValue = j => names.every(name => valuesOf([history[j]], name)[0] !== null);
    let runs = 0, base = 0;
    for (let s = 0; s + n <= length; s++) for (let extra = 0; extra <= stretch; extra++) {
      const e = s + n - 1 + extra; if (e >= length) break;
      if (!Array.from({ length: e - s + 1 }, (_, k) => s + k).every(hasValue)) { unread++; break; }
      if (!extra && e + 1 < length) base++;
      // every way to pick the n bars out of the run, the first on its first bar and the last on its last
      const placements = [[0]];
      for (let g = 1; g < n; g++) for (const part of placements.splice(0)) for (let at = part[g - 1] + 1; at <= (g === n - 1 ? n - 1 + extra : part[g - 1] + 1 + extra); at++) if (g < n - 1 || at === n - 1 + extra) placements.push([...part, at]);
      const fits = placements.filter(ps => ps[n - 1] - (n - 1) <= extra).some(ps => sign(high(s + ps[0], true) - high(s + ps[n - 1], false)) === rel
        && names.every(name => partOf(name, valuesOf(ps.map(k => history[s + k]), name)) === asking[name]));
      if (fits) { runs++; if (extra) stretched++; }
    }
    assert.equal(r.counts[0], runs, `held with stretch ${stretch}, ${n} bars, ${names.map(name => asking[name]).join('|')}: the runs that hold and stand in the order`);
    assert.equal(r.base.n, base, 'every run with its values and a next bar is counted as read');
    assert.equal(r.mode, runs ? 'held' : 'fallback');
    cases++; held += runs;
  }
  assert.ok(held > 100 && unread > 100 && stretched > 20, `the random cases must hold, skip bars and meet bars without a value (${held}, ${unread}, ${stretched})`);
  console.log(`${cases} random held drawings with stretch and dimensions: the matcher counts the ${held} runs counted here from scratch`);
}
// what the matcher refuses: parts that are not canonical g1 text, and counters that are not amounts
M.set(M.decode(barsPayload([[100, 110, 90, 105, 1, 1, 1], [105, 120, 100, 110, 1, 1, 1]])), M.decodeCounters(countersPayload([[0, 0, 0, 0, 10, 5, 1], [0, 0, 0, 0, 10, 5, 1]])));
for (const bad of [['volume:0,2'], ['volume:1,0,0'], ['delta:0,1'], ['volume:0,1/1'], ['delta:0,1/1', 'volume:0,1'], ['volume:0,1', 'volume:0,1'], ['volume:00,1'], ['price:0,1'], ['size:0']]) {
  M.setLatest(++id);
  await assert.rejects(M.search({ bars: [[1, 3, 0, 2], [2, 5, 1, 4]], holds: [], stretch: 0, x: 12, tfs: [1, 1, 1, 1, 1], oriented: true, next: null, dims: bad }, id, () => {}), Error, `the matcher must refuse ${bad.join('|')}`);
  const m = createModel();
  assert.equal(m.readAddress(`#s=30,42,56,68,u;18,36,56,80,d&dim=${bad.join('|')}`), false, `the bench must refuse ${bad.join('|')} in an address`);
}
for (const bad of [[10, 11, 1], [-1, 0, 1], [10, -1, 1], [Infinity, 1, 1], [NaN, 1, 1]]) assert.throws(() => M.decodeCounters(countersPayload([[0, 0, 0, 0, ...bad]])), /not amounts/, `counters ${bad} must be refused`);
console.log(`the bench writes, and the matcher reads, all ${file.vectors.length} shared windows to the dimension parts written for them: ${encoded} codes encoded, ${asked} questions asked, ${absent} parts without a value kept apart`);
