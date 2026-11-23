// How the matcher reads a window, held to literal vectors that Vaquum/Filang's chained_g1 is held to as well.
// checks/chained-vectors.json lists small windows of recorded bars, each with the g1 code it has when read as a chain.
// For each one this check puts the bars through the matcher's own decoder as a one-timeframe history, draws the shape
// the expected code describes, and requires that the matcher finds the window as its one exact twin, shows it as that
// chain, and leaves the record as it was. Where the code as recorded differs, the shape of that code must find nothing.
// Usage: node checks/chained-vectors.mjs   (from the repository root)
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { openWorker } from './worker.mjs';

const root = process.cwd();
const M = await openWorker(root + '/matcher.js');
const { vectors } = JSON.parse(fs.readFileSync(root + '/checks/chained-vectors.json', 'utf8'));

// one timeframe of bars as bars.py writes them (CBAR1), with no gaps
function payload(bars) {
  const out = [];
  const u32 = x => out.push(x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255);
  const varint = x => { do { let b = x % 128; x = Math.floor(x / 128); if (x) b |= 128; out.push(b); } while (x); };
  const zigzag = v => varint(v < 0 ? -2 * v - 1 : 2 * v);
  for (const ch of 'CBAR1') out.push(ch.charCodeAt(0));
  out.push(1, 3, ...[...'15m'].map(ch => ch.charCodeAt(0)));
  u32(900); u32(bars.length); u32(1700000100); u32(0);   // the first bar opens on the 15m grid, as recorded bars do
  let previous = 0;
  for (const [o, h, l, c] of bars) { zigzag(o - previous); zigzag(c - o); varint(h - Math.max(o, c)); varint(Math.min(o, c) - l); previous = c; }
  return Uint8Array.from(out).buffer;
}
// the g1 code of bars given as [open, high, low, close], ranked here from scratch
function codeOf(bars) {
  const ends = bars.map(([o, h, l, c]) => [l, Math.min(o, c), Math.max(o, c), h]);
  const order = [...new Set(ends.flat())].sort((a, b) => a - b);
  return 'g1:o:' + ends.map((e, i) => [...e.map(v => order.indexOf(v)), bars[i][3] > bars[i][0] ? 'u' : bars[i][3] < bars[i][0] ? 'd' : 'z'].join(',')).join(';');
}
// a drawing whose own code is the given one: its ranks are its prices
function drawingOf(code) {
  return code.slice(5).split(';').map(row => {
    const [l, lo, hi, h, d] = row.split(','), [L, LO, HI, H] = [l, lo, hi, h].map(Number);
    return d === 'd' ? [HI, H, L, LO] : [LO, H, L, HI];
  });
}

let id = 0;
for (const v of vectors) {
  const history = v.before ? [v.before, ...v.bars] : v.bars, n = v.bars.length;
  const tables = M.decode(payload(history)); M.setBars(tables);
  assert.deepEqual(history.map((b, i) => [tables[0].O[i], tables[0].H[i], tables[0].L[i], tables[0].C[i]]), history, `${v.name}: the record is decoded as it was written`);
  assert.equal(codeOf(drawingOf(v.chained)), v.chained, `${v.name}: the drawing made from the code has that code`);
  const ask = async code => { M.setLatest(++id); return M.search({ bars: drawingOf(code), holds: [], stretch: 0, x: 12, tfs: [1, 1, 1, 1, 1], oriented: true, next: null }, id, () => {}); };
  const r = await ask(v.chained);
  assert.equal(r.exact[0], 1, `${v.name}: one exact twin of ${v.chained}`);
  const twin = r.results.find(x => x.flips === 0 && x.raw.length === n && x.start === tables[0].ts[history.length - n]);
  assert.ok(twin, `${v.name}: the window is shown as the exact twin`);
  const cents = bars => bars.map(b => b.map(x => Math.round(x * 100)));
  assert.deepEqual(cents(twin.raw), v.bars, `${v.name}: raw is the record`);
  assert.equal(codeOf(cents(twin.drawn)), v.chained, `${v.name}: drawn is the window read as a chain`);
  assert.deepEqual(cents(twin.drawn)[0], v.bars[0], `${v.name}: the first bar is as recorded`);
  for (let g = 1; g < n; g++) assert.equal(cents(twin.drawn)[g][0], v.bars[g - 1][3], `${v.name}: bar ${g + 1} opens at the close before it`);
  assert.equal(codeOf(v.bars), v.as_recorded, `${v.name}: the code as recorded is as written`);
  if (v.as_recorded !== v.chained) assert.equal((await ask(v.as_recorded)).exact[0], 0, `${v.name}: the shape of the recorded code finds no twin`);
}
console.log(`the matcher reads all ${vectors.length} shared windows as the chains written for them`);
