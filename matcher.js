/* Composer's worker. It runs beside the bench and does two things.

   It hands the BTCUSDT klines to the shared Filang engine and asks the engine which windows match a drawing: exact
   twins, the windows that keep what is held (with stretch), the closest-looking windows, and the shapes one
   comparison away. Composer keeps no matching of its own.

   It then describes the windows the engine returns, from its own copy of the bars: what the next bar did, what the
   next six bars did, and what traded in each bar. Those are statistics over matched windows, not matching.

   A window is read as the drawing is, as a chain: its first bar as recorded, every later bar opening at the close of
   the recorded bar just before it, with its low and high widened to include that open. The record is never changed.

   What came next uses the engine's own definitions. The next bar rose or fell by the sign of
   close[t+1] - close[t] (flat kept apart), and only when bar t+1 follows bar t with no missing bar between them.
   ATR is ATR14: true range max(high - low, |high - previous close|, |low - previous close|) smoothed with
   Wilder's 1/14, seeded by the mean of the first 14 values and started again after any missing bar. */

const TF_NAMES = ['15m', '30m', '1h', '2h', '4h'];
// One display frame per worker task keeps replacement prompt while avoiding
// excessive task rescheduling on a busy host. The worker never paints the UI.
const WORK_SLICE_MS = 16;
let BARS = null, latest = 0, pending = null, engine = null;
// what Composer reads about each bar beside its shape, once the activity has arrived (per timeframe, aligned with BARS)
let READ = null, pendingActivity = null, activityVersion = 0;
let pendingCounters = null;

// Each bar as a later bar of a window: JO is its open at the close of the recorded bar just before it, JH and JL its
// high and low widened to include that open. After a gap there is no such bar, and no window puts a later bar there:
// that bar keeps its own open. The recorded O, H, L and C are left as they are.
function links(T) {
  const n = T.n, A = T.O instanceof Int32Array ? Int32Array : Float64Array, JO = new A(n), JH = new A(n), JL = new A(n);
  for (let i = 0; i < n; i++) {
    const jo = T.run[i] >= 2 ? T.C[i - 1] : T.O[i];
    JO[i] = jo; JH[i] = T.H[i] > jo ? T.H[i] : jo; JL[i] = T.L[i] < jo ? T.L[i] : jo;
  }
  T.JO = JO; T.JH = JH; T.JL = JL;
  return T;
}

function decode(buffer) {
  const buf = new Uint8Array(buffer);
  let p = 0;
  const u8 = () => buf[p++];
  const u32 = () => { const x = (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24)) >>> 0; p += 4; return x; };
  const vu = () => { let x = 0, m = 1, b; do { b = buf[p++]; x += (b & 127) * m; m *= 128; } while (b & 128); return x; };
  const vz = () => { const x = vu(); return x % 2 ? -(x + 1) / 2 : x / 2; };
  if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3], buf[4]) !== 'CBAR1') throw new Error('This is not Composer bar data.');
  p = 5;
  const out = [], count = u8();
  for (let k = 0; k < count; k++) {
    let name = '';
    for (let i = 0, len = u8(); i < len; i++) name += String.fromCharCode(u8());
    const sec = u32(), n = u32(), t0 = u32(), g = u32(), gaps = [];
    for (let i = 0; i < g; i++) gaps.push([u32(), u32()]);
    const O = new Int32Array(n), H = new Int32Array(n), L = new Int32Array(n), C = new Int32Array(n), ts = new Float64Array(n), run = new Int32Array(n);
    let gi = 0, missing = 0;
    for (let i = 0; i < n; i++) {
      let gap = false;
      if (gi < gaps.length && gaps[gi][0] === i) { missing += gaps[gi++][1]; gap = true; }
      ts[i] = t0 + (i + missing) * sec;
      run[i] = i === 0 || gap ? 1 : run[i - 1] + 1; // bars in an unbroken run ending here; windows never cross a gap
      O[i] = vz() + (i ? C[i - 1] : 0);
      C[i] = O[i] + vz();
      H[i] = Math.max(O[i], C[i]) + vu();
      L[i] = Math.min(O[i], C[i]) - vu();
    }
    if (p > buf.length) throw new Error('The bar data is truncated.');
    const atr = new Float64Array(n).fill(NaN);
    let count = 0, seed = 0, state = 0;
    for (let i = 0; i < n; i++) {
      if (run[i] < 2) { count = 0; seed = 0; state = 0; continue; } // no previous close after a gap: true range is undefined here
      const tr = Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1]));
      if (count < 14) { seed += tr; count++; if (count === 14) { state = seed / 14; atr[i] = state; } }
      else { state = tr / 14 + (1 - 1 / 14) * state; atr[i] = state; }
    }
    out.push(links({ name, sec, n, ts, O, H, L, C, run, atr }));
  }
  return out;
}

// Exact USDT volume, taker-buy USDT and trade counts for the engine, packed by bars.py.
function decodeCounters(buffer) {
  const dv = new DataView(buffer), size = buffer.byteLength;
  if (size < 6 || String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3), dv.getUint8(4)) !== 'CCNT1') throw new Error('This is not Composer counter data.');
  let p = 5;
  const out = [], count = dv.getUint8(p++);
  for (let k = 0; k < count; k++) {
    let name = '';
    if (p >= size) throw new Error('The counter data is truncated.');
    const len = dv.getUint8(p++);
    if (p + len + 4 > size) throw new Error('The counter data is truncated.');
    for (let i = 0; i < len; i++) name += String.fromCharCode(dv.getUint8(p++));
    const n = dv.getUint32(p, true); p += 4;
    if (p + n * 20 > size) throw new Error('The counter data is truncated.');
    const vol = new Float64Array(n), tbvol = new Float64Array(n), cnt = new Float64Array(n);
    for (let i = 0; i < n; i++, p += 8) vol[i] = dv.getFloat64(p, true);
    for (let i = 0; i < n; i++, p += 8) tbvol[i] = dv.getFloat64(p, true);
    for (let i = 0; i < n; i++, p += 4) cnt[i] = dv.getUint32(p, true);
    for (let i = 0; i < n; i++) if (!(vol[i] >= 0 && vol[i] < Infinity && tbvol[i] >= 0 && tbvol[i] <= vol[i])) throw new Error(`The ${name} counters are not amounts: taker buys must lie within what traded.`);
    out.push({ name, n, vol, tbvol, cnt });
  }
  if (p !== size) throw new Error('The counter data has trailing bytes.');
  return out;
}


function decodeActivity(buffer) {
  const dv = new DataView(buffer);
  if (buffer.byteLength < 6 || String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3), dv.getUint8(4)) !== 'CACT1') throw new Error('This is not Composer activity data.');
  let p = 5;
  const out = [], count = dv.getUint8(p++);
  for (let k = 0; k < count; k++) {
    let name = '';
    for (let i = 0, len = dv.getUint8(p++); i < len; i++) name += String.fromCharCode(dv.getUint8(p++));
    const n = dv.getUint32(p, true); p += 4;
    if (p + n * 2 * 4 + 48 > buffer.byteLength) throw new Error('The activity data is truncated.');
    const column = () => {
      const lo = dv.getFloat64(p, true), step = dv.getFloat64(p + 8, true), a = new Float64Array(n);
      p += 16;
      for (let i = 0; i < n; i++, p += 2) a[i] = Math.exp(lo + (dv.getUint16(p, true) - 1) * step);
      return a;
    };
    const vol = column(), quote = column(), trades = column(), maker = new Float64Array(n);
    for (let i = 0; i < n; i++, p += 2) maker[i] = dv.getUint16(p, true) / 65535;
    out.push({ name, n, vol, quote, trades, maker });
  }
  return out;
}

// What Composer reads about every bar, the way the cube explorer reads a cell: its volume, trades and trade size (USDT per
// trade) against the median of the eleven bars before it, the maker share of its volume, its range and body (open to close,
// either way: the colour already says which) in the ATR at the bar before it, and where it closed in the prior UTC day's range. The first three compare as ratios,
// so their means and spreads are taken over logs. Each timeframe also keeps every reading's count, sum and sum of
// squares over its whole history, for the comparison. The body is the one reading that belongs to the shape: for a later
// bar of a window it is measured from the previous close, as that bar is read, and kept beside the recorded one.
const READINGS = ['vol', 'trades', 'size', 'maker', 'range', 'body', 'day'];
const BODY = READINGS.indexOf('body');
const AS_LOG = [true, true, true, false, false, false, false];
function* readingsWork(T, A) {
  const n = T.n, R = {};
  if (!T.JO) links(T);
  if (A.n !== n) throw new Error(`The ${T.name} activity does not cover its bars.`);
  for (const key of READINGS) R[key] = new Float32Array(n).fill(NaN);
  const size = new Float64Array(n), laterBody = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i++) { size[i] = A.quote[i] / A.trades[i]; if ((i & 1023) === 1023) yield; }
  const w = new Float64Array(11);
  const median = (a, i) => { for (let j = 0; j < 11; j++) w[j] = a[i - 11 + j]; w.sort(); return w[5]; };
  for (let i = 0; i < n; i++) {
    R.maker[i] = A.maker[i];
    if (T.run[i] >= 12) { R.vol[i] = A.vol[i] / median(A.vol, i); R.trades[i] = A.trades[i] / median(A.trades, i); R.size[i] = size[i] / median(size, i); }
    const a = i ? T.atr[i - 1] : NaN;
    if (T.run[i] >= 2 && a > 0) { R.range[i] = (T.H[i] - T.L[i]) / a; R.body[i] = Math.abs(T.C[i] - T.O[i]) / a; laterBody[i] = Math.abs(T.C[i] - T.JO[i]) / a; }
    if ((i & 1023) === 1023) yield;
  }
  const days = new Map();
  for (let i = 0; i < n; i++) {
    const d = Math.floor(T.ts[i] / 86400), h = days.get(d);
    if (!h) days.set(d, [T.H[i], T.L[i]]);
    else { if (T.H[i] > h[0]) h[0] = T.H[i]; if (T.L[i] < h[1]) h[1] = T.L[i]; }
    if ((i & 1023) === 1023) yield;
  }
  for (let i = 0; i < n; i++) {
    const h = days.get(Math.floor(T.ts[i] / 86400) - 1);
    if (h && h[0] > h[1]) R.day[i] = (T.C[i] - h[1]) / (h[0] - h[1]);
    if ((i & 1023) === 1023) yield;
  }
  // Keep the exact log of each Float32 reading once, rather than repeating it
  // for every admitted placement in every search.
  R.features = []; R.base = [];
  for (let f = 0; f < READINGS.length; f++) {
    const values = AS_LOG[f] ? new Float64Array(n) : R[READINGS[f]];
    if (AS_LOG[f]) for (let i = 0; i < n; i++) { values[i] = Math.log(R[READINGS[f]][i]); if ((i & 1023) === 1023) yield; }
    R.features.push(values);
    let c = 0, sum = 0, sq = 0;
    for (let i = 0; i < n; i++) {
      const x = values[i]; if (x === x) { c++; sum += x; sq += x * x; }
      if ((i & 1023) === 1023) yield;
    }
    R.base.push([c, sum, sq]);
  }
  {
    let c = 0, sum = 0, sq = 0;
    for (let i = 0; i < n; i++) {
      const x = laterBody[i]; if (x === x) { c++; sum += x; sq += x * x; }
      if ((i & 1023) === 1023) yield;
    }
    R.laterBody = laterBody; R.laterBodyBase = [c, sum, sq];
  }
  return R;
}
function readings(T, A) {
  const work = readingsWork(T, A); let step;
  do { step = work.next(); } while (!step.done);
  return step.value;
}
async function prepareReadings(tables, activity, current) {
  const prepared = []; let deadline = performance.now() + WORK_SLICE_MS;
  for (let k = 0; k < tables.length; k++) {
    const work = readingsWork(tables[k], activity[k]);
    for (;;) {
      const step = work.next();
      if (step.done) { prepared.push(step.value); break; }
      if (performance.now() >= deadline) {
        await tick(); if (!current()) return null;
        deadline = performance.now() + WORK_SLICE_MS;
      }
    }
  }
  return current() ? prepared : null;
}

// Grid's statistics: 95% intervals, Wilson for rates and t for means, and nothing for fewer than 30 windows
const Z95 = 1.959964;
function wilson(k, m) {
  if (m < 30) return null;
  const p = k / m, d = 1 + Z95 * Z95 / m, c = (p + Z95 * Z95 / (2 * m)) / d, h = Z95 * Math.sqrt(p * (1 - p) / m + Z95 * Z95 / (4 * m * m)) / d;
  return [p, c - h, c + h, m];
}
function tMean(c, sum, sq) {
  if (c < 30) return null;
  const m = sum / c, sd = Math.sqrt(Math.max(0, (sq - sum * sum / c) / (c - 1))), df = c - 1;
  // Student's t at 97.5% from its expansion in 1/df: within 0.001 of the table from 30 rows up
  const t = Z95 + (Z95 ** 3 + Z95) / (4 * df) + (5 * Z95 ** 5 + 16 * Z95 ** 3 + 3 * Z95) / (96 * df * df);
  const h = t * sd / Math.sqrt(c);
  return [m, m - h, m + h, c, sd];
}
// what the next bar did after a window ending at bar e, written into a reusable record
function outcomeInto(T, e, o) {
  if (e + 1 >= T.n) { o.why = 'end'; return o; }
  if (T.run[e + 1] < 2) { o.why = 'gap'; return o; }
  const move = T.C[e + 1] - T.C[e], a = T.atr[e];
  o.why = ''; o.dir = move > 0 ? 1 : move < 0 ? -1 : 0; o.bps = move / T.C[e] * 1e4; o.atrx = a > 0 ? move / a : NaN;
  return o;
}
function passes(o, f) {
  if (!f) return true;
  if (o.why) return false;
  if (f.measure === 'bps') return f.dir > 0 ? o.bps >= f.value : o.bps <= -f.value;
  if (f.measure === 'atr') return o.atrx === o.atrx && (f.dir > 0 ? o.atrx >= f.value : o.atrx <= -f.value);
  return o.dir === f.dir;
}

let tickChannel = null, tickWaiters = [], onYield = null;
function tick() {
  if (onYield) onYield();
  // Node's MessagePort can drain its own queue ahead of timers; its native
  // check-phase yield preserves the same replacement opportunity as a worker task.
  if (typeof setImmediate === 'function') return new Promise(resolve => setImmediate(resolve));
  if (!tickChannel) { tickChannel = new MessageChannel(); tickChannel.port1.onmessage = () => { const w = tickWaiters.shift(); if (w) w(); }; }
  return new Promise(r => { tickWaiters.push(r); tickChannel.port2.postMessage(0); });
}

/* ---- the bars, as the engine takes them ---- */
const cents = (v) => { if (v < 100) { const a = v < 0 ? -v : v; return `${v < 0 ? '-' : ''}${Math.trunc(a / 100)}.${a % 100 < 10 ? '0' : ''}${a % 100}`; } const s = '' + v; return s.slice(0, -2) + '.' + s.slice(-2); };
// One timeframe as the engine's CSV, and the way back from the engine's grid slots to this copy's bars: the engine
// counts every bar interval since the first bar, missing or not, and Composer keeps only the bars that exist.
function frameCsv(T, counters = null) {
  const rows = new Array(T.n + 1); rows[0] = counters ? 'open_ms,open,high,low,close,base_volume,volume,taker_buy_volume,trade_count' : 'open_ms,open,high,low,close,volume';
  for (let i = 0; i < T.n; i++) rows[i + 1] = `${T.ts[i] * 1000},${cents(T.O[i])},${cents(T.H[i])},${cents(T.L[i])},${cents(T.C[i])},${counters ? `0,${counters.vol[i]},${counters.tbvol[i]},${counters.cnt[i]}` : 0}`;
  return rows.join('\n') + '\n';
}
function gridOf(T) {
  const slots = (T.ts[T.n - 1] - T.ts[0]) / T.sec + 1, at = new Int32Array(slots).fill(-1);
  for (let i = 0; i < T.n; i++) at[(T.ts[i] - T.ts[0]) / T.sec] = i;
  T.slots = slots; T.at = at;
  return T;
}
/** Hand every timeframe to the engine. Throws when the engine reads a different grid than Composer does. */
function give(filang, tables) {
  for (const T of tables) {
    if (!T.JO) links(T);
    gridOf(T);
    const { slots } = filang.loadComposerFrameTicks(T.sec * 1000, { times: T.ts, timeUnit: 's', open: T.O, high: T.H, low: T.L, close: T.C });
    if (slots !== T.slots) throw new Error(`The engine reads ${slots} ${T.name} slots where Composer reads ${T.slots}.`);
  }
  studied = null;
}

/** Give exact counters to the engine only after the first dimension is requested. */
function giveCounters(filang, tables, counters) {
  if (counters.length !== tables.length || counters.some((C, k) => C.name !== tables[k].name || C.n !== tables[k].n)) throw new Error('The counters do not cover every bar.');
  for (const [k, T] of tables.entries()) {
    const { slots } = filang.loadComposerFrame(frameCsv(T, counters[k]), T.sec * 1000);
    if (slots !== T.slots) throw new Error('The counters changed the engine grid.');
  }
}

/* ---- named candles ---- */
// The engine's Study counts a catalogue candle on one timeframe at a time, on recorded opens. That timeframe is handed
// to it when the bench first counts on it, and stays until the bench counts on another.
let studied = null;
/** How often a catalogue candle occurs on one timeframe, on how many bars it could, and its eight latest occurrences. */
function named(filang, T, id) {
  const p = filang.catalogue().patterns.find((x) => x.id === id);
  if (!p || !T) throw new Error('Pattern or timeframe unavailable in the recording.');
  if (studied !== T) { filang.loadCsv(frameCsv(T), T.sec * 1000); studied = T; }
  const found = filang.study(`on BTCUSDT ${T.name}\nfind ${p.function}`, { candidate: 0 }).results[0];
  const samples = [];
  for (let q = found.anchors.length - 1; q >= 0 && samples.length < 8; q--) {
    const i = T.at[found.anchors[q] / (T.sec * 1000) - T.ts[0] / T.sec - 1], bars = [];
    for (let j = i - p.bars + 1; j <= i; j++) bars.push([T.O[j], T.H[j], T.L[j], T.C[j]]);
    samples.push({ close: T.ts[i] + T.sec, bars });
  }
  return { count: found.counts.event, eligible: T.n - found.unknown.event.length, samples };
}
// The next-bar filter is Composer's: it tells the engine which windows may end where, one character per grid slot.
const maskMemo = new Map();
function endMasks(tables, f) {
  const key = JSON.stringify(f);
  if (maskMemo.get('tables') !== tables) { maskMemo.clear(); maskMemo.set('tables', tables); }
  if (maskMemo.has(key)) return maskMemo.get(key);
  const o = {}, text = new TextDecoder();
  const masks = tables.map((T) => {
    const mask = new Uint8Array(T.slots).fill(48);
    for (let i = 0; i < T.n; i++) if (passes(outcomeInto(T, i, o), f)) mask[(T.ts[i] - T.ts[0]) / T.sec] = 49;
    return text.decode(mask);
  });
  if (maskMemo.size > 8) maskMemo.delete([...maskMemo.keys()][1]);
  maskMemo.set(key, masks);
  return masks;
}
// The bars a window's drawn bars took, as offsets from its start: bit n of the engine's mask is the bar n after it.
// The list is reused from one window to the next.
const offsets = [];
function picked(mask) {
  offsets.length = 0;
  for (; mask; mask &= mask - 1) offsets.push(31 - Math.clz32(mask & -mask));
  return offsets;
}
/**
 * Every window of one kind on one timeframe, in the engine's order, read in one piece: fn(start bar, span, picks).
 * `picks` is given only when asked for, and only until the next window. A long list gives way to other tasks through
 * `pause`, and stops with false when a newer question has replaced this one.
 */
async function eachWindow(filang, T, kind, fn, withPicks, pause) {
  const { starts, spans, picks } = filang.composerPositionsPacked(T.sec * 1000, { kind });
  for (let i = 0; i < starts.length; i++) {
    if ((i & 2047) === 2047 && !(await pause())) return false;
    fn(T.at[starts[i]], spans[i], withPicks ? picked(picks[i]) : null);
  }
  return true;
}

/**
 * Ask the engine about a drawing and describe what it finds.
 * q: { packet, tfs, next } — the drawing packet (bars, pins, skeleton, stretch, limit), the timeframes shown, and
 * Composer's next-bar filter. The engine decides which windows match; everything computed here is read off those
 * windows in Composer's own bars.
 */
async function search(q, id, report) {
  const read = READ, tables = BARS, filang = engine;
  const t0 = Date.now(), packet = q.packet, n = packet.bars.length;
  const f = q.next && q.next.dir ? q.next : null, oo = {}, o0 = {};
  // the engine numbers the timeframes 15m to 4h; only the ones Composer holds and shows are asked for
  const shown = tables.reduce((m, T, k) => m | (q.tfs[k] ? 1 << TF_NAMES.indexOf(T.name) : 0), 0);
  let deadline = performance.now() + WORK_SLICE_MS;
  const pause = async () => { if (performance.now() < deadline) return true; await tick(); deadline = performance.now() + WORK_SLICE_MS; return id === latest; };

  filang.composerStart(packet, { timeframes: shown, endMasks: f ? endMasks(tables, f) : undefined });
  let found, units = 1024;
  for (;;) {
    const began = performance.now();
    found = filang.composerStep(units);
    if (found.done) break;
    units = Math.max(64, Math.min(8192, units * 2, Math.floor(6 * units / Math.max(performance.now() - began, 0.1))));
    report(found.scanned / found.total);
    await tick(); if (id !== latest) return null;
  }
  deadline = performance.now() + WORK_SLICE_MS;
  const mode = found.mode, held = mode !== 'nearest', stretch = held ? packet.stretch : 0;

  // the whole history's own rate, for comparison: every window of this length on the timeframes shown
  const base = { n: 0, up: 0, down: 0, flat: 0, pass: 0 };
  for (let k = 0; k < tables.length; k++) {
    if (!q.tfs[k]) continue;
    const T = tables[k];
    for (let e = n - 1; e < T.n; e++) {
      if ((e & 8191) === 0 && !(await pause())) return null;
      if (T.run[e] < n) continue;
      outcomeInto(T, e, o0);
      if (!o0.why) { base.n++; if (o0.dir > 0) base.up++; else if (o0.dir < 0) base.down++; else base.flat++; if (f && passes(o0, f)) base.pass++; }
    }
  }
  // what the next bar did after every window that holds, before the next-bar filter
  const split = { n: 0, up: 0, down: 0, flat: 0, none: 0 };

  // The panes: the set of windows that match (exact twins with nothing held, the windows that hold otherwise, on the
  // timeframes shown and through the next-bar filter), summed as the engine lists them. For each drawn bar, the
  // readings of the BTCUSDT bar it took; the next bar; and what the next six bars did in the shape's own scale (its
  // low 0, its high 1), with a fixed-seed sample of their closes for the fan.
  const NR = READINGS.length, AFTER = 6, SAMPLE = 20000;
  let acc = new Float64Array(n * NR * 3), setN = 0, setTf = TF_NAMES.map(() => [0, 0]);
  let fan = new Float32Array(SAMPLE * AFTER), cont = [0, 0, 0, 0], seed = 0x9e3779b9;
  let sequences = new Map();
  const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const addSet = (k, T, s, ps, e, o) => {
    setN++;
    const R = read && read[k];
    if (R) {
      for (let g = 0; g < n; g++) {
        const j = s + (ps ? ps[g] : g);
        for (let r = 0; r < NR; r++) {
          // where a window closed in the prior day's range is read on its last bar only
          if (r === NR - 1 && g !== n - 1) continue;
          const x = g && r === BODY ? R.laterBody[j] : R.features[r][j];
          if (x !== x) continue;
          const a = (g * NR + r) * 3;
          acc[a]++; acc[a + 1] += x; acc[a + 2] += x * x;
        }
      }
    }
    if (!o.why) { setTf[k][0]++; if (o.dir > 0) setTf[k][1]++; }
    if (e + AFTER >= T.n || T.run[e + AFTER] < AFTER + 1) return;
    let lo = Infinity, hi = -Infinity;
    // the shape's low and high, as its bars are read
    for (let g = 0; g < n; g++) { const j = s + (ps ? ps[g] : g), l = g ? T.JL[j] : T.L[j], h = g ? T.JH[j] : T.H[j]; if (l < lo) lo = l; if (h > hi) hi = h; }
    if (!(hi > lo)) return;
    const m = ++cont[0];
    let up = false, down = false, sequenceCode = 0;
    for (let j = 1; j <= AFTER; j++) {
      if (T.H[e + j] > hi) up = true;
      if (T.L[e + j] < lo) down = true;
      // Classify exact integer prices before scaling: a close on either boundary is inside.
      sequenceCode = sequenceCode * 3 + (T.C[e + j] > hi ? 0 : T.C[e + j] < lo ? 2 : 1);
    }
    let sequence = sequences.get(sequenceCode);
    if (!sequence) {
      let code = sequenceCode, key = '';
      for (let j = 0; j < AFTER; j++) { key = 'UID'[code % 3] + key; code = Math.floor(code / 3); }
      const scale = v => (v - lo) / (hi - lo);
      const bars = Array.from({ length: AFTER }, (_, j) => [T.O[e + j + 1], T.H[e + j + 1], T.L[e + j + 1], T.C[e + j + 1]].map(scale));
      sequence = { key, n: 0, bars, start: scale(T.C[e]) };
      sequences.set(sequenceCode, sequence);
    }
    sequence.n++;
    if (up) cont[1]++;
    if (down) cont[2]++;
    if (T.C[e + AFTER] > T.C[e]) cont[3]++;
    const slot = m <= SAMPLE ? m - 1 : Math.floor(rand() * m);
    if (slot < SAMPLE) for (let j = 1; j <= AFTER; j++) fan[slot * AFTER + j - 1] = (T.C[e + j] - lo) / (hi - lo);
  };
  let setKind = mode === 'held' ? 'hold' : 'twins';
  // The engine lists every window that matches once. Composer reads the list once: each window's next bar goes into
  // the split, and the windows that pass Composer's own next-bar filter are the set. The engine applied the same
  // filter through the end masks, so the set is its qualified windows, and its counts say how many there are.
  for (let k = 0; k < tables.length; k++) {
    if (!q.tfs[k]) continue;
    const T = tables[k];
    if (!(await eachWindow(filang, T, held ? 'held' : 'exact', (s, span, picks) => {
      const e = s + span - 1; outcomeInto(T, e, oo);
      if (held) { split.n++; if (oo.why) split.none++; else if (oo.dir > 0) split.up++; else if (oo.dir < 0) split.down++; else split.flat++; }
      if (mode !== 'fallback' && passes(oo, f)) addSet(k, T, s, picks, e, oo);
    }, held, pause))) return null;
  }
  if (mode !== 'fallback' && setN !== TF_NAMES.reduce((a, _, k) => a + (q.tfs[k] ? (held ? found.qualified_held : found.qualified_exact)[k] : 0), 0)) throw new Error('Composer and the engine disagree on which windows pass the next-bar filter.');
  // with nothing held, or nothing holding, and fewer than 30 exact twins, the set is the closest windows instead
  if (setN < 30 && setKind === 'twins' || mode === 'fallback') {
    acc = new Float64Array(n * NR * 3); setN = 0; setTf = TF_NAMES.map(() => [0, 0]); fan = new Float32Array(SAMPLE * AFTER); cont = [0, 0, 0, 0]; seed = 0x9e3779b9; sequences = new Map();
    // the engine's whole ranking, closest first across the timeframes, overlapping windows included
    const { starts, spans, picks, frames } = filang.composerPositionsPacked(null, { kind: 'ranked' });
    for (let i = 0; i < starts.length; i++) {
      const k = frames[i], T = tables[k], s = T.at[starts[i]], e = s + spans[i] - 1;
      addSet(k, T, s, picked(picks[i]), e, outcomeInto(T, e, oo));
    }
    setKind = 'closest';
  }
  const panes = { kind: setKind, n: setN, readings: !!read, rows: [], next: null, byTf: setTf.map(([m, k]) => wilson(k, m)), tfN: setTf.map(([m]) => m), after: AFTER, cont: null, near: [] };
  if (read) {
    for (let g = 0; g < n; g++) for (let r = 0; r < NR; r++) {
      if (r === NR - 1 && g !== n - 1) continue;
      const a = (g * NR + r) * 3, set = tMean(acc[a], acc[a + 1], acc[a + 2]);
      let c = 0, sum = 0, sq = 0;
      for (let k = 0; k < tables.length; k++) if (q.tfs[k]) { const b = g && r === BODY ? read[k].laterBodyBase : read[k].base[r]; c += b[0]; sum += b[1]; sq += b[2]; }
      const all = tMean(c, sum, sq);
      if (set && all) panes.rows.push({ bar: g, key: READINGS[r], log: AS_LOG[r], set, all, d: all[4] > 0 ? (set[0] - all[0]) / all[4] : 0 });
    }
  }
  const outs = setTf.reduce((a, [m, k]) => [a[0] + m, a[1] + k], [0, 0]);
  panes.next = wilson(outs[1], outs[0]);
  if (cont[0] >= 30) {
    const m = Math.min(cont[0], SAMPLE), col = new Float32Array(m), qs = [];
    for (let j = 0; j < AFTER; j++) {
      for (let i = 0; i < m; i++) col[i] = fan[i * AFTER + j];
      col.sort();
      qs.push([0.1, 0.25, 0.5, 0.75, 0.9].map(p => col[Math.round(p * (m - 1))]));
    }
    const ordered = [...sequences.values()].sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
    panes.cont = {
      n: cont[0], sampled: m, fan: qs,
      aboveHigh: wilson(cont[1], cont[0]), belowLow: wilson(cont[2], cont[0]), aboveClose: wilson(cont[3], cont[0]),
      // At most 3^6 mutually exclusive sequences. Counts cover every complete window, not the fan sample.
      sequences: ordered.map(({ key, n }) => [key, n]),
      paths: ordered.slice(0, 4).map(s => ({ ...s, rate: wilson(s.n, cont[0]) })),
      examples: Object.fromEntries(ordered.map(({ key, bars, start }) => [key, { bars, start }])),
    };
  }
  // a window's bars as they were compared with the drawing: the first as recorded, each later one as a chain link
  const chained = (T, s, picks) => picks.map((p, g) => { const j = s + p; return g ? [T.JO[j] / 100, T.JH[j] / 100, T.JL[j] / 100, T.C[j] / 100] : [T.O[j] / 100, T.H[j] / 100, T.L[j] / 100, T.C[j] / 100]; });
  // one comparison away: the engine names each change and lists its windows; what followed them is read here
  for (const [i, v] of found.near.entries()) {
    let out = 0, up = 0;
    for (let k = 0; k < tables.length; k++) {
      if (!q.tfs[k]) continue;
      const T = tables[k];
      if (!(await eachWindow(filang, T, 'near:' + i, (s, span) => { outcomeInto(T, s + span - 1, oo); if (!oo.why) { out++; if (oo.dir > 0) up++; } }, false, pause))) return null;
    }
    const T = tables.find((t) => t.sec * 1000 === v.timeframe);
    panes.near.push({ a: v.a, b: v.b, was: v.was, rel: v.relation, n: v.count, up: wilson(up, out), bars: chained(T, T.at[v.example.start], v.example.picks) });
  }

  const results = found.results.map((r) => {
    const k = tables.findIndex((T) => T.sec * 1000 === r.timeframe), R = tables[k], s = R.at[r.window.start], span = r.window.span, ps = r.window.picks, raw = [];
    // raw is the record, bar for bar. drawn is the shape: the picked bars as they were compared with the drawing.
    for (let i = 0; i < span; i++) { const j = s + i; raw.push([R.O[j] / 100, R.H[j] / 100, R.L[j] / 100, R.C[j] / 100]); }
    const e = s + span - 1, o = outcomeInto(R, e, {});
    const next = o.why ? null : { dir: o.dir, bps: o.bps, atrx: o.atrx, bar: [R.O[e + 1] / 100, R.H[e + 1] / 100, R.L[e + 1] / 100, R.C[e + 1] / 100] };
    return { tf: TF_NAMES[k], start: R.ts[s], end: R.ts[e] + R.sec, flips: r.half_flips / 2, off: r.off, score: r.score, extra: span - n, picks: ps, raw, drawn: chained(R, s, ps), broken: r.broken, next, nextWhy: o.why };
  });
  return { mode, exact: found.exact, exactF: found.qualified_exact, counts: found.held, countsF: found.qualified_held, split, base, filter: f, results, holds: filang.decodeDrawing(JSON.stringify(packet)).held_rules.length, stretch, panes, ms: Date.now() - t0 };
}

export { TF_NAMES, READINGS, decode, decodeActivity, decodeCounters, giveCounters, readings, prepareReadings, give, search, named, wilson, tMean, outcomeInto, passes };
/** For the worker's own messages and for checks that drive these functions directly. */
export const state = {
  set engine(v) { engine = v; }, get engine() { return engine; },
  set bars(v) { BARS = v; }, get bars() { return BARS; },
  set readings(v) { READ = v; }, get readings() { return READ; },
  set latest(v) { latest = v; }, get latest() { return latest; },
  /** Called each time the worker gives way to other tasks. */
  set onYield(fn) { onYield = fn; },
};

/* ---- the worker ---- */
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  const memo = new Map();
  // The engine's browser package is served beside this file. The page hands over the module it compiled, so the
  // engine is downloaded once; a worker started without one fetches it itself. Nothing can be asked before it is here.
  let provide; const compiled = new Promise((resolve) => { provide = resolve; });
  const filang = Promise.all([import('/engine/index.mjs'), compiled]).then(([{ FilangEngine }, module]) => FilangEngine.create(module)).then((e) => { engine = e; return e; });
  const run = async m => {
    const read = READ, tables = BARS, key = JSON.stringify([!!read, m.q]);
    if (memo.has(key)) { if (m.id === latest) self.postMessage({ type: 'result', id: m.id, ...memo.get(key), ms: 0 }); return; }
    try {
      const r = await search(m.q, m.id, f => self.postMessage({ type: 'progress', id: m.id, f }));
      if (r) { if (read === READ && tables === BARS) { if (memo.size >= 6) memo.delete(memo.keys().next().value); memo.set(key, r); } self.postMessage({ type: 'result', id: m.id, ...r }); }
    } catch (err) { if (m.id === latest) self.postMessage({ type: 'refused', id: m.id, message: String(err.message || err) }); }
  };
  self.onmessage = async e => {
    const m = e.data;
    if (m.type === 'engine') { provide(m.module); return; }
    if (m.type === 'bars') {
      provide(undefined);   // no module was handed over before the bars: the engine fetches its own file
      try {
        const tables = decode(m.buffer);
        give(await filang, tables);
        BARS = tables; READ = null; activityVersion++; memo.clear();
        self.postMessage({ type: 'ready', bars: BARS.reduce((a, T) => a + T.n, 0), from: BARS[0].ts[0], to: BARS[0].ts[BARS[0].n - 1] + BARS[0].sec });
        if (pendingCounters) { const c = pendingCounters; pendingCounters = null; await self.onmessage({ data: { type: 'counters', buffer: c } }); }
        if (pendingActivity) { const a = pendingActivity; pendingActivity = null; self.onmessage({ data: { type: 'activity', buffer: a } }); }
        if (pending) { const p = pending; pending = null; run(p); }
      } catch (err) { self.postMessage({ type: 'error', message: String(err.message || err) }); }
      return;
    }
    if (m.type === 'counters') {
      if (!BARS) { pendingCounters = m.buffer; return; }
      try {
        const loaded = await filang; latest++; giveCounters(loaded, BARS, decodeCounters(m.buffer)); memo.clear();
        self.postMessage({ type: 'counters' });
      } catch (err) { self.postMessage({ type: 'counters-error', message: String(err.message || err) }); }
      return;
    }
    if (m.type === 'activity') {
      if (!BARS) { pendingActivity = m.buffer; return; }
      const tables = BARS, version = ++activityVersion;
      try {
        const A = decodeActivity(m.buffer);
        if (A.length !== tables.length) throw new Error('The activity does not cover every timeframe.');
        const prepared = await prepareReadings(tables, A, () => version === activityVersion && tables === BARS);
        if (!prepared) return;
        READ = prepared; memo.clear();
        self.postMessage({ type: 'readings' });
      } catch (err) { if (version === activityVersion && tables === BARS) self.postMessage({ type: 'readings-error', message: String(err.message || err) }); }
      return;
    }
    if (m.type === 'named-pattern') {
      try { self.postMessage({ type: 'named-pattern', id: m.id, ...named(await filang, BARS?.find(t => t.name === m.timeframe), m.pattern) }); }
      catch (err) { self.postMessage({ type: 'named-pattern', id: m.id, error: String(err.message || err) }); }
      return;
    }
    if (m.type === 'query') {
      latest = m.id;
      if (!BARS) { pending = m; return; }
      run(m);
    }
  };
}
