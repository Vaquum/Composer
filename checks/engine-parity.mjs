// Composer on the shared engine against the matcher it replaced, on the current bars.
// The matcher and the model of Composer at bd6a0ba, the last commit that matched in its own JavaScript, are read from
// git and asked the same questions as this checkout's worker. Every figure the bench shows must be the same: counts,
// the next-bar split, the base rate, the displayed windows with their scores, picks and bars, the one-away rows, the
// panes of the cohort (readings, next bar, what followed), and every catalogue candle on every timeframe.
// Usage: python3 checks/with_bars.py checks/engine-parity.mjs   (the commit must be in the repository: git fetch origin bd6a0ba)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openWorker, ROOT } from './worker.mjs';

const ORACLE = 'bd6a0ba32e18548b641267418491bfb5f011a274';
const [matcherFile, barsFile, activityFile, , only] = process.argv.slice(2);
const show = (path) => execFileSync('git', ['show', `${ORACLE}:${path}`], { cwd: ROOT, maxBuffer: 1 << 26 }).toString();
const old = new Function('self', 'window', show('matcher.js') + ';return {decode, decodeActivity, readings, search, set: (t, r) => { BARS = t; READ = r; }, setId: id => { latest = id; }};')(undefined, undefined);
const scope = {}; new Function('globalThis', show('patterns.js'))(scope);
const oracle = mkdtempSync(join(tmpdir(), 'composer-oracle-')); writeFileSync(join(oracle, 'model.mjs'), show('bench/model.js'));
const { heldOf } = await import(pathToFileURL(join(oracle, 'model.mjs')).href);
const now = await openWorker(matcherFile);

const load = (file) => { const b = readFileSync(file); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const oldTables = old.decode(load(barsFile)); old.set(oldTables, old.decodeActivity(load(activityFile)).map((A, k) => old.readings(oldTables[k], A)));
const tables = now.decode(load(barsFile)); now.setBars(tables); now.setRead(now.decodeActivity(load(activityFile)).map((A, k) => now.readings(tables[k], A)));

const timeframes = ['15m', '30m', '1h', '2h', '4h'];
function drawing(width) { let c = 42; return Array.from({ length: width }, (_, i) => { const o = c; c += i % 3 === 1 ? -18 : 14; return [o, Math.max(o, c) + 12, Math.min(o, c) - 12, c]; }); }
const pin = { bar: 0, color: true };
const double = [[50, 51, 44, 45], [45, 46, 38, 39], [39, 40, 33, 34], [34, 35, 28, 31], [31, 38, 30, 37], [37, 42, 36, 41], [41, 41.5, 34, 35], [35, 36, 29, 33], [33, 40, 32, 39], [39, 47, 38, 46]];
const point = (text) => { const [kind, ...digits] = text; const bar = Number(digits.join('')) - 1; const up = double[bar][3] >= double[bar][0]; return { bar, part: kind === 'O' ? (up ? 'B' : 'T') : kind === 'C' ? (up ? 'T' : 'B') : kind }; };
const doublePins = ['u10', 'L4<L1', 'L4<L2', 'L4<L3', 'L4<L5', 'L4<L6', 'L4<L7', 'L4<L8', 'L4<L9', 'L4<L10', 'L8<L7', 'L8<L9', 'H6>H5', 'H6>H7', 'H6>H8', 'H6>H9', 'C10>H6'].map((text) => { if (text === 'u10') return { bar: 9, color: true }; const [a, b] = text.split(/[<>]/); return { a: point(a), b: point(b) }; });
// name, bars, pins, stretch, timeframes shown (bit k is timeframe k), directions kept, skeleton level, the drawing, the next-bar filter
const cases = [
  ['default', 2, [], 0, 31, true], ['2-bars-only-4h', 2, [], 0, 16, true], ['3-bars', 3, [], 0, 31, true], ['10-bars', 10, [], 0, 31, true], ['20-bars', 20, [], 0, 31, true], ['20-bars-shape-only', 20, [], 0, 31, false],
  ['2-bars-pin', 2, [pin], 0, 31, true], ['2-bars-pin-stretch-4', 2, [pin], 4, 31, true], ['5-bars-pin-stretch-0', 5, [pin], 0, 31, true], ['5-bars-pin-stretch-4', 5, [pin], 4, 31, true], ['10-bars-pin-stretch-4', 10, [pin], 4, 31, true],
  ['5-bars-skeleton', 5, [], 2, 31, true, 2], ['5-bars-cross-pin', 5, [{ a: { bar: 0, part: 'H' }, b: { bar: 4, part: 'H' } }], 2, 31, true],
  ['10-bars-17-pins', 10, doublePins, 2, 31, true, 0, double], ['10-bars-17-pins-filter', 10, doublePins, 0, 31, true, 0, double, { dir: 1, measure: 'atr', value: 8 }],
  ['2-bars-pin-filter', 2, [pin], 4, 13, true, 0, drawing(2), { dir: 1, measure: 'atr', value: 1 }], ['2-bars-filter-up', 2, [], 0, 31, true, 0, drawing(2), { dir: 1, measure: 'any', value: 0 }], ['3-bars-skeleton-bps', 3, [], 0, 21, true, 1, drawing(3), { dir: -1, measure: 'bps', value: 10 }],
];
// equal, with sums of floats allowed their last bits: the worker adds the readings in the engine's order
const close = (a, b, at) => {
  if (a === b || (a !== a && b !== b)) return;
  if (typeof a === 'number' && typeof b === 'number') { assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)), `${at}: ${a} against ${b}`); return; }
  if (a === null || b === null || typeof a !== 'object') { assert.deepEqual(a, b, at); return; }
  if (ArrayBuffer.isView(a)) { a = Array.from(a); b = Array.from(b); }
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), at + ' keys');
  for (const k of Object.keys(a)) close(a[k], b[k], at + '.' + k);
};

let id = 0; const rows = [];
for (const [name, width, pins, stretch, tf, oriented, skeleton = 0, bars = drawing(width), next = null] of cases) {
  if (only && name !== only) continue;
  const packet = now.packet({ bars, pins, skeleton, stretch, oriented });
  const holds = heldOf(bars, { pins, skel: skeleton, oriented }).map(({ h }) => h);
  const tfs = timeframes.map((_, i) => Boolean(tf & (1 << i)));
  old.setId(++id); let t = performance.now(); const was = await old.search({ bars, holds, stretch, x: 12, tfs, oriented, next }, id, () => {}); const oldMs = performance.now() - t;
  now.setLatest(id); t = performance.now(); const is = await now.ask({ packet, tfs, next }, id, () => {}); const newMs = performance.now() - t;
  const { ms: _a, ...mine } = is; const { ms: _b, ...theirs } = was;
  close(mine, theirs, name);
  rows.push({ name, mode: is.mode, cohort: is.panes.kind, windows: is.panes.n, oldMs: +oldMs.toFixed(0), newMs: +newMs.toFixed(0) });
}

// every catalogue candle on every timeframe: how often it occurs, on how many bars it could, and its latest examples
let candles = 0;
if (!only) for (const p of scope.CandlePatterns.patterns) {
  const test = scope.CandlePatterns.compile(p.id);
  for (const [k, T] of oldTables.entries()) {
    const samples = []; let count = 0, eligible = 0;
    for (let i = T.n - 1; i >= 0; i--) {
      if (T.run[i] < p.bars) continue;
      eligible++;
      if (!test(T.O, T.H, T.L, T.C, i)) continue;
      count++;
      if (samples.length < 8) { const bars = []; for (let j = i - p.bars + 1; j <= i; j++) bars.push([T.O[j], T.H[j], T.L[j], T.C[j]]); samples.push({ close: T.ts[i] + T.sec, bars }); }
    }
    assert.deepEqual(now.named(now.filang, tables[k], p.id), { count, eligible, samples }, `${p.id} on ${T.name}`);
    candles++;
  }
}

console.table(rows);
console.log(`Composer on the engine agrees with the matcher at ${ORACLE.slice(0, 7)} on every figure of ${rows.length} questions${candles ? ` and on ${candles} candle counts` : ''}.`);
