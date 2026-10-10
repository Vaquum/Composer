'use strict';
/* Ashi matcher. Runs in a Web Worker beside the composer.
   It reads the BTCUSDT klines, served by Composer's server from the Vaquum HuggingFace files, as exact integer cents and compares prices exactly as the engine's encoder
   does: low <= body bottom <= body top <= high, ties only on exact equality, direction from open and close.

   One query mixes the three ways of matching however the composer sets them:
     held relations (pins and the skeleton) must hold exactly on a window;
     stretch lets the drawn bars pick themselves out of a longer run of BTCUSDT bars, in order: the first
       drawn bar is the run's first bar, the last drawn bar its last, and up to `stretch` bars between
       them are skipped and ignored; the run itself never crosses a gap in the data;
     every candidate is ranked by how close it looks: first its colours (each bar whose direction differs
       costs a whole height, half against a doji), then its shape (both scaled to the same height, the mean
       distance of the bar ends, as a fraction of that height), then its sizes (each bar's body and range
       against the drawing's, as ratios, so a small body twice too big counts), plus a small charge for each
       comparison it flips. Flips (making or breaking a tie counts half) are still counted and shown: zero
       flips means the exact g1 pattern.

   What came next uses the engine's own definitions. The next bar rose or fell by the sign of
   close[t+1] - close[t] (the direction run's primary target, flat kept apart), and only when bar t+1
   follows bar t with no missing bar between them. ATR is the engine's ATR14: true range
   max(high - low, |high - previous close|, |low - previous close|) smoothed with Wilder's 1/14,
   seeded by the mean of the first 14 values and started again after any missing bar. */

const TF_NAMES = ['15m', '30m', '1h', '2h', '4h'];
let BARS = null, latest = 0, pending = null;

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
    out.push({ name, sec, n, ts, O, H, L, C, run, atr });
  }
  return out;
}

// kinds of price a held relation can name: 0 open, 1 high, 2 low, 3 close, 4 body bottom, 5 body top
function priceOf(kind, o, h, l, c) {
  switch (kind) {
    case 0: return o; case 1: return h; case 2: return l; case 3: return c;
    case 4: return o < c ? o : c; default: return o < c ? c : o;
  }
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

function compile(q) {
  const n = q.bars.length, E = new Float64Array(4 * n), D = new Int8Array(n), QN = new Float64Array(4 * n);
  q.bars.forEach(([o, h, l, c], i) => {
    E[4 * i] = l; E[4 * i + 1] = Math.min(o, c); E[4 * i + 2] = Math.max(o, c); E[4 * i + 3] = h;
    D[i] = c > o ? 1 : c < o ? -1 : 0;
  });
  let lo = Infinity, hi = -Infinity; for (const v of E) { if (v < lo) lo = v; if (v > hi) hi = v; }
  for (let i = 0; i < 4 * n; i++) QN[i] = (E[i] - lo) / (hi - lo || 1);
  // each bar's body and range as a share of the drawing's height, plus the size floor, logged for comparing as ratios
  const QB = new Float64Array(n), QR = new Float64Array(n);
  for (let i = 0; i < n; i++) { QB[i] = Math.log(QN[4 * i + 2] - QN[4 * i + 1] + SIZE_FLOOR); QR[i] = Math.log(QN[4 * i + 3] - QN[4 * i] + SIZE_FLOOR); }
  const P = (4 * n) * (4 * n - 1) / 2, A = new Int16Array(P), B = new Int16Array(P), R = new Int8Array(P);
  let p = 0;
  for (let a = 0; a < 4 * n; a++) for (let b = a + 1; b < 4 * n; b++) { A[p] = a; B[p] = b; R[p] = E[a] < E[b] ? -1 : E[a] > E[b] ? 1 : 0; p++; }
  // each held relation is checked as soon as the later of its two bars is placed
  const byBar = Array.from({ length: n }, () => []);
  q.holds.forEach(h => byBar[h.color ? h.bar : Math.max(h.a[0], h.b[0])].push(h));
  // the comparisons each bar settles (pairs whose later endpoint is on it), so flips can be counted while bars are placed
  const levels = Array.from({ length: n }, (_, g) => {
    const ix = []; for (let k = 0; k < P; k++) if (B[k] >> 2 === g) ix.push(k);
    return { A: Int16Array.from(ix, k => A[k]), B: Int16Array.from(ix, k => B[k]), R: Int8Array.from(ix, k => R[k]) };
  });
  return { n, oriented: q.oriented, D, QN, QB, QR, P, A, B, R, byBar, levels, holds: q.holds };
}

function holdOk(h, MO, MH, ML, MC) {
  if (h.color) { const x = MC[h.bar] - MO[h.bar]; return (x > 0 ? 1 : x < 0 ? -1 : 0) === h.dir; }
  const a = h.a[0], b = h.b[0];
  const va = priceOf(h.a[1], MO[a], MH[a], ML[a], MC[a]), vb = priceOf(h.b[1], MO[b], MH[b], ML[b], MC[b]);
  return (va < vb ? -1 : va > vb ? 1 : 0) === h.rel;
}

// comparisons that differ, in half-flips; returns -1 as soon as the count passes the bound
function flips(cq, MO, MH, ML, MC, W, bound) {
  const n = cq.n;
  let d = 0;
  for (let i = 0; i < n; i++) {
    const o = MO[i], c = MC[i];
    W[4 * i] = ML[i]; W[4 * i + 1] = o < c ? o : c; W[4 * i + 2] = o < c ? c : o; W[4 * i + 3] = MH[i];
    if (cq.oriented) { const s = c > o ? 1 : c < o ? -1 : 0, df = s - cq.D[i]; d += df < 0 ? -df : df; }
  }
  if (d > bound) return -1;
  const A = cq.A, B = cq.B, R = cq.R, P = cq.P;
  for (let p = 0; p < P; p++) {
    const x = W[A[p]], y = W[B[p]], df = (x < y ? -1 : x > y ? 1 : 0) - R[p];
    if (df !== 0) { d += df < 0 ? -df : df; if (d > bound) return -1; }
  }
  return d;
}

// one comparison flipped costs this much height in the ranking, spread over all comparisons of the composition
const FLIP_WEIGHT = 0.3;
// sizes compare as log ratios of (share of height + this floor): the floor is added, not a minimum, so a doji's size stays
// finite and thin bodies differ less than their raw ratio says, though not alike (a doji against a 2% body differs by
// ln 2, as two bodies twice apart do)
const SIZE_FLOOR = 0.02, SIZE_WEIGHT = 0.05;
// mean distance of the bar ends from the drawing's, both scaled to their own low..high (W already filled)
function shapeOf(cq, W) {
  const m = 4 * cq.n; let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < m; i++) { const v = W[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1, QN = cq.QN; let s = 0;
  for (let i = 0; i < m; i++) { const x = (W[i] - lo) / span - QN[i]; s += x < 0 ? -x : x; }
  return s / m;
}
// shape plus sizes: the mean distance of the bar ends, then each bar's body and range against the drawing's as ratios
function lookOf(cq, W) {
  const n = cq.n, m = 4 * n; let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < m; i++) { const v = W[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1, QN = cq.QN; let shape = 0, size = 0;
  for (let i = 0; i < m; i++) { const x = (W[i] - lo) / span - QN[i]; shape += x < 0 ? -x : x; }
  for (let i = 0; i < n; i++) {
    const b = Math.log((W[4 * i + 2] - W[4 * i + 1]) / span + SIZE_FLOOR) - cq.QB[i], r = Math.log((W[4 * i + 3] - W[4 * i]) / span + SIZE_FLOOR) - cq.QR[i];
    size += (b < 0 ? -b : b) + (r < 0 ? -r : r);
  }
  return shape / m + SIZE_WEIGHT * size / (2 * n);
}
// flipped comparisons between bar ends, in half-flips (W already filled); -1 once past the bound
function pairFlips(cq, W, bound) {
  const A = cq.A, B = cq.B, R = cq.R, P = cq.P; let d = 0;
  for (let p = 0; p < P; p++) { const x = W[A[p]], y = W[B[p]], df = (x < y ? -1 : x > y ? 1 : 0) - R[p]; if (df !== 0) { d += df < 0 ? -df : df; if (d > bound) return -1; } }
  return d;
}
// how close a placed window looks: colours, then shape and sizes, then a small charge per flip; -1 once past the bound
function closeness(cq, MO, MH, ML, MC, W, bound) {
  const n = cq.n; let c = 0;
  for (let i = 0; i < n; i++) {
    const o = MO[i], cl = MC[i];
    W[4 * i] = ML[i]; W[4 * i + 1] = o < cl ? o : cl; W[4 * i + 2] = o < cl ? cl : o; W[4 * i + 3] = MH[i];
    if (cq.oriented) { const sg = cl > o ? 1 : cl < o ? -1 : 0, df = sg - cq.D[i]; c += (df < 0 ? -df : df) / 2; }
  }
  if (c > bound) return -1;
  const sc = c + lookOf(cq, W);
  if (sc > bound) return -1;
  const d = pairFlips(cq, W, bound === Infinity ? Infinity : (bound - sc) * 2 * cq.P / FLIP_WEIGHT);
  return d < 0 ? -1 : sc + FLIP_WEIGHT * (d / 2) / cq.P;
}

// the M best candidates seen so far, worst on top
class Best {
  constructor(m) { this.m = m; this.d = []; this.v = []; }
  bound() { return this.d.length < this.m ? Infinity : this.d[0]; }
  push(d, v) {
    const D = this.d, V = this.v;
    if (D.length < this.m) {
      let i = D.length; D.push(d); V.push(v);
      while (i > 0) { const up = (i - 1) >> 1; if (D[up] >= D[i]) break; [D[up], D[i]] = [D[i], D[up]]; [V[up], V[i]] = [V[i], V[up]]; i = up; }
    } else if (d < D[0]) {
      D[0] = d; V[0] = v;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let top = i;
        if (l < D.length && D[l] > D[top]) top = l;
        if (r < D.length && D[r] > D[top]) top = r;
        if (top === i) break;
        [D[top], D[i]] = [D[i], D[top]]; [V[top], V[i]] = [V[i], V[top]]; i = top;
      }
    }
  }
  sorted() { return this.d.map((d, i) => ({ d, ...this.v[i] })).sort((a, b) => a.d - b.d || a.extra - b.extra || b.end - a.end); }
}

let tickChannel = null, tickWaiters = [];
function tick() {
  if (!tickChannel) { tickChannel = new MessageChannel(); tickChannel.port1.onmessage = () => { const w = tickWaiters.shift(); if (w) w(); }; }
  return new Promise(r => { tickWaiters.push(r); tickChannel.port2.postMessage(0); });
}

async function search(q, id, report) {
  const t0 = Date.now(), cq = compile(q), n = cq.n, held = q.holds.length > 0, stretch = held ? q.stretch : 0;
  const MO = new Float64Array(n), MH = new Float64Array(n), ML = new Float64Array(n), MC = new Float64Array(n), W = new Float64Array(4 * n);
  const picks = new Int32Array(n), exact = TF_NAMES.map(() => 0), counts = TF_NAMES.map(() => 0);
  const exactF = TF_NAMES.map(() => 0), countsF = TF_NAMES.map(() => 0);
  const f = q.next && q.next.dir ? q.next : null, oo = {}, o0 = {};
  const base = { n: 0, up: 0, down: 0, flat: 0, pass: 0 }, split = { n: 0, up: 0, down: 0, flat: 0, none: 0 };
  const best = new Best(Math.max(400, q.x * 40));
  const total = BARS.reduce((a, T) => a + T.n, 0);
  let done = 0, sinceTick = 0;

  // held relations, with stretch: drawn bar g takes bar pos + skip, and the skipped bars are ignored.
  let T = null, s = 0, bestHere = null, on = false, any = false;
  const fits = (g, pos, skip) => {
    const last = pos + skip;
    if (last >= T.n || T.run[last] < last - s + 1) return -1;
    MO[g] = T.O[last]; MH[g] = T.H[last]; ML[g] = T.L[last]; MC[g] = T.C[last]; picks[g] = last - s;
    for (const h of cq.byBar[g]) if (!holdOk(h, MO, MH, ML, MC)) return 0;
    return 1;
  };
  // A window with stretch runs from start s to a chosen last bar e: the first drawn bar sits on s, the last on e,
  // and spare is exactly how many bars between them are skipped. `exists` settles whether any placement holds;
  // `closest` then finds the closest-looking placement. Colours and flips are counted bar by bar while placing and
  // only add to the score, so a placement already past the best it could still beat is dropped there; shape and
  // sizes are added once all bars are placed.
  const exists = (g, pos, spare) => {
    for (let skip = g === n - 1 ? spare : 0; skip <= (g === 0 ? 0 : spare); skip++) {
      const ok = fits(g, pos, skip);
      if (ok < 0) return;
      if (!ok) continue;
      if (g === n - 1) { any = true; return; }
      exists(g + 1, pos + skip + 1, spare - skip);
      if (any) return;
    }
  };
  const closest = (g, pos, spare, c0, d0) => {
    for (let skip = g === n - 1 ? spare : 0; skip <= (g === 0 ? 0 : spare); skip++) {
      const ok = fits(g, pos, skip);
      if (ok < 0) return;
      if (!ok) continue;
      const last = pos + skip, o = MO[g], cl = MC[g];
      W[4 * g] = ML[g]; W[4 * g + 1] = o < cl ? o : cl; W[4 * g + 2] = o < cl ? cl : o; W[4 * g + 3] = MH[g];
      let c = c0, d = d0;
      if (cq.oriented) { const sg = cl > o ? 1 : cl < o ? -1 : 0, df = sg - cq.D[g]; c += (df < 0 ? -df : df) / 2; }
      const lv = cq.levels[g];
      for (let k = 0; k < lv.A.length; k++) { const x = W[lv.A[k]], y = W[lv.B[k]], df = (x < y ? -1 : x > y ? 1 : 0) - lv.R[k]; if (df) d += df < 0 ? -df : df; }
      const floor = c + FLIP_WEIGHT * (d / 2) / cq.P, limit = Math.min(best.bound(), bestHere ? bestHere.d : Infinity);
      if (floor > limit) continue;
      if (g === n - 1) {
        const score = floor + lookOf(cq, W);
        if (score < limit) bestHere = { d: score, picks: Array.from(picks), extra: last - s + 1 - n, span: last - s + 1 };
      } else closest(g + 1, last + 1, spare - skip, c, d);
    }
  };

  for (let k = 0; k < BARS.length; k++) {
    T = BARS[k]; on = !!q.tfs[k];
    for (s = 0; s + n <= T.n; s++) {
      if (++sinceTick >= 8192) {
        sinceTick = 0; await tick();
        if (id !== latest) return null;
        report(done / total);
      }
      done++;
      if (T.run[s + n - 1] < n) continue;
      for (let i = 0; i < n; i++) { MO[i] = T.O[s + i]; MH[i] = T.H[s + i]; ML[i] = T.L[s + i]; MC[i] = T.C[s + i]; }
      // the whole history's own rate, for comparison: every window of this length on the timeframes shown
      outcomeInto(T, s + n - 1, o0);
      const pass0 = passes(o0, f);
      if (on && !o0.why) { base.n++; if (o0.dir > 0) base.up++; else if (o0.dir < 0) base.down++; else base.flat++; if (f && pass0) base.pass++; }
      // exact twins of the whole pattern are the windows with no flips at all
      if (flips(cq, MO, MH, ML, MC, W, 0) === 0) { exact[k]++; if (pass0) exactF[k]++; }
      if (!held) {
        // nothing held: rank every window that passes the next-bar filter by how close it looks
        if (on && pass0) { const sc = closeness(cq, MO, MH, ML, MC, W, best.bound()); if (sc >= 0) best.push(sc, { k, s, picks: null, extra: 0, span: n, end: T.ts[s + n - 1] }); }
        continue;
      }
      // each run from this start to a possible last bar is its own window: it holds when some placement between its
      // ends does, its next bar is the one after that run, and the counts, rates and instance all describe it
      for (let extra = 0; extra <= stretch; extra++) {
        const e = s + n - 1 + extra;
        if (e >= T.n || T.run[e] < e - s + 1) break;
        bestHere = null; any = false;
        exists(0, s, extra);
        if (!any) continue;
        counts[k]++;
        outcomeInto(T, e, oo);
        if (on) { split.n++; if (oo.why) split.none++; else if (oo.dir > 0) split.up++; else if (oo.dir < 0) split.down++; else split.flat++; }
        if (!passes(oo, f)) continue;
        countsF[k]++;
        if (on) {
          closest(0, s, extra, 0, 0);
          if (bestHere) best.push(bestHere.d, { k, s, picks: bestHere.picks, extra, span: n + extra, end: T.ts[e] });
        }
      }
    }
  }

  let mode = held ? 'held' : 'nearest';
  let ranked = best.sorted();
  if (held && countsF.every(c => c === 0)) {
    // nothing holds everything (and passes the next-bar filter): show the nearest windows that pass, each with the relations it breaks
    mode = 'fallback';
    const near = new Best(Math.max(400, q.x * 40));
    for (let k = 0; k < BARS.length; k++) {
      if (!q.tfs[k]) continue;
      T = BARS[k];
      for (s = 0; s + n <= T.n; s++) {
        if (++sinceTick >= 8192) { sinceTick = 0; await tick(); if (id !== latest) return null; }
        if (T.run[s + n - 1] < n) continue;
        if (f && !passes(outcomeInto(T, s + n - 1, o0), f)) continue;
        for (let i = 0; i < n; i++) { MO[i] = T.O[s + i]; MH[i] = T.H[s + i]; ML[i] = T.L[s + i]; MC[i] = T.C[s + i]; }
        const sc = closeness(cq, MO, MH, ML, MC, W, near.bound());
        if (sc >= 0) near.push(sc, { k, s, picks: null, extra: 0, span: n, end: T.ts[s + n - 1] });
      }
    }
    ranked = near.sorted();
  }

  // distinct moments: skip anything overlapping an earlier pick in time, on any timeframe
  const chosen = [], spans = [];
  for (const r of ranked) {
    const R = BARS[r.k], a = R.ts[r.s], b = R.ts[r.s + r.span - 1] + R.sec;
    if (spans.some(([x, y]) => a < y && b > x)) continue;
    spans.push([a, b]); chosen.push(r);
    if (chosen.length >= q.x) break;
  }
  const results = chosen.map(r => {
    const R = BARS[r.k], raw = [], drawn = [], ps = r.picks || Array.from({ length: n }, (_, i) => i);
    for (let i = 0; i < r.span; i++) { const j = r.s + i; raw.push([R.O[j] / 100, R.H[j] / 100, R.L[j] / 100, R.C[j] / 100]); }
    for (let g = 0; g < n; g++) {
      const j = r.s + ps[g];
      MO[g] = R.O[j]; MH[g] = R.H[j]; ML[g] = R.L[j]; MC[g] = R.C[j];
      drawn.push(raw[ps[g]]);
    }
    const broken = mode === 'fallback' ? q.holds.map((h, i) => (holdOk(h, MO, MH, ML, MC) ? -1 : i)).filter(i => i >= 0) : [];
    const flipped = flips(cq, MO, MH, ML, MC, W, Infinity) / 2, off = shapeOf(cq, W);
    const e = r.s + r.span - 1, o = outcomeInto(R, e, {});
    const next = o.why ? null : { dir: o.dir, bps: o.bps, atrx: o.atrx, bar: [R.O[e + 1] / 100, R.H[e + 1] / 100, R.L[e + 1] / 100, R.C[e + 1] / 100] };
    return { tf: TF_NAMES[r.k], start: R.ts[r.s], end: R.ts[e] + R.sec, flips: flipped, off, score: r.d, extra: r.extra, picks: ps, raw, drawn, broken, next, nextWhy: o.why };
  });
  return { mode, exact, exactF, counts, countsF, split, base, filter: f, results, holds: q.holds.length, stretch, ms: Date.now() - t0 };
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  const run = async m => {
    const r = await search(m.q, m.id, f => self.postMessage({ type: 'progress', id: m.id, f }));
    if (r) self.postMessage({ type: 'result', id: m.id, ...r });
  };
  self.onmessage = async e => {
    const m = e.data;
    if (m.type === 'bars') {
      try {
        BARS = decode(m.buffer);
        self.postMessage({ type: 'ready', bars: BARS.reduce((a, T) => a + T.n, 0), from: BARS[0].ts[0], to: BARS[0].ts[BARS[0].n - 1] + BARS[0].sec });
        if (pending) { const p = pending; pending = null; run(p); }
      } catch (err) { self.postMessage({ type: 'error', message: String(err.message || err) }); }
      return;
    }
    if (m.type === 'query') {
      latest = m.id;
      if (!BARS) { pending = m; return; }
      run(m);
    }
  };
}
