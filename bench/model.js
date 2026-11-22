// The drawing: a chained run of bars with free prices, and what the matcher is asked about it.
// BTCUSDT trades around the clock, so the drawing puts every later open at the previous close.

/* ---- the chain ---- */
// A drawn bar is [low, body bottom, body top, high] with a direction; its open and close are the body's ends in that
// direction. The free prices of a drawing are the first bar's open and every bar's close, low and high; every later
// open is the previous close.
export const closeOf = (v, d) => (d === 'u' ? v[2] : v[1]);
export const openOf = (v, d) => (d === 'u' ? v[1] : v[2]);
export function chainParams(bars) {
  return { o0: openOf(bars[0].v, bars[0].d), c: bars.map(b => closeOf(b.v, b.d)), l: bars.map(b => b.v[0]), h: bars.map(b => b.v[3]), d: bars.map(b => b.d) };
}
// the bars those prices make: each body runs from its open to its close, its colour is which way it went (a bar that
// closes where it opened is a doji and keeps the direction it had), and its shadows reach at least its body
export function chainBars(P) {
  return P.c.map((c, i) => {
    const o = i ? P.c[i - 1] : P.o0, lo = Math.min(o, c), hi = Math.max(o, c);
    return { v: [Math.min(P.l[i], lo), lo, hi, Math.max(P.h[i], hi)], d: c > o ? 'u' : c < o ? 'd' : P.d[i] };
  });
}
export const copyParams = P => ({ o0: P.o0, c: P.c.slice(), l: P.l.slice(), h: P.h.slice(), d: P.d.slice() });
// moving a bar: the first moves whole; a later one swings from where it opened, its close and shadows moving together
// while its open stays on the previous close
export function moveParams(P, i, dv) {
  const Q = copyParams(P);
  if (i === 0) Q.o0 += dv;
  Q.c[i] += dv; Q.l[i] += dv; Q.h[i] += dv;
  return Q;
}
// the first bar's colour is chosen by trading its open and close: its body stays, and the next bar opens at its other end
export function flipParams(P) { const Q = copyParams(P); Q.o0 = P.c[0]; Q.c[0] = P.o0; Q.d[0] = P.d[0] === 'u' ? 'd' : 'u'; return Q; }
/* ---- end of the chain ---- */

export const TF = ['15m', '30m', '1h', '2h', '4h'];
export const TF_LONG = ['15-minute bars', '30-minute bars', '1-hour bars', '2-hour bars', '4-hour bars'];
export const MIN_BARS = 2; export const MAX_BARS = 20;
// A drawn bar: its four prices and its direction and, for each dimension switched on, its mark `m[name]`. With
// every dimension off a bar has no marks at all, and is the bar it always was.
const bar = (v, d, m) => (m ? { v: v.slice(), d, m: { ...m } } : { v: v.slice(), d });
/** Composer's opening drawing: a rising bar, then a falling bar that covers it. */
export const START = () => [bar([30, 42, 56, 68], 'u'), bar([18, 36, 62, 80], 'd')];
// chaining moves prices only: each bar keeps the marks it had
const rechain = (bars) => chainBars(chainParams(bars)).map((b, i) => bar(b.v, b.d, bars[i].m));

/** Open, high, low, close of each bar, as the matcher takes them. A doji reads as open = close. */
export function ohlc(bars) {
  return bars.map((b) => { const [l, lo, hi, h] = b.v; return lo === hi ? [lo, h, l, hi] : b.d === 'u' ? [lo, h, l, hi] : [hi, h, l, lo]; });
}
const dense = (arr) => { const srt = Array.from(new Set(arr)).sort((a, b) => a - b); const m = new Map(); srt.forEach((v, i) => m.set(v, i)); return arr.map((v) => m.get(v)); };
/** The g1 identity: every endpoint ranked, equal prices sharing a rank, and each bar's direction. */
export function identity(bars) {
  const vals = []; for (const b of bars) for (let k = 0; k < 4; k++) vals.push(b.v[k]);
  return { r: dense(vals), d: bars.map((b) => (b.v[1] === b.v[2] ? 'z' : b.d)), n: bars.length };
}
/* ---- dimensions ---- */
// Beside price a drawing can switch on dimensions, each with one mark per bar. Only the order of a dimension's marks
// is read: which bar is lower, which are level, which is higher. Delta and imbalance are also ranked against zero,
// the line a mark sits below, on or above: net selling, balanced, net buying. Names and order are the g1 text's, the
// labels Cube's. A mark is a level: any number, of which only the order counts. At rest marks are whole and dense,
// from 0 up, or outward from the zero line (-1 the first level under it, 1 the first above).
export const DIMENSIONS = Object.freeze([
  Object.freeze({ name: 'volume', label: 'Volume', zero: false }),
  Object.freeze({ name: 'trades', label: 'Trades', zero: false }),
  Object.freeze({ name: 'delta', label: 'Delta', zero: true }),
  Object.freeze({ name: 'size', label: 'Trade size', zero: false }),
  Object.freeze({ name: 'imbalance', label: 'Net taker imbalance', zero: true }),
]);
const DIM = new Map(DIMENSIONS.map((d) => [d.name, d]));
/** The dimensions a run of bars carries marks for, in the order their parts are written. */
export const dimsOf = (bars) => DIMENSIONS.filter((d) => bars.length > 0 && bars.every((b) => b.m && Number.isFinite(b.m[d.name]))).map((d) => d.name);
/** One dimension's marks, bar by bar. */
export const marksOf = (bars, name) => bars.map((b) => b.m[name]);
/** Marks with the same order, whole and dense: from 0 up, or outward from the zero line when the dimension has one. */
export function settled(name, marks) {
  if (!DIM.get(name).zero) return dense(marks);
  const up = Array.from(new Set(marks.filter((v) => v > 0))).sort((a, b) => a - b); const down = Array.from(new Set(marks.filter((v) => v < 0))).sort((a, b) => b - a);
  return marks.map((v) => (v > 0 ? up.indexOf(v) + 1 : v < 0 ? -(down.indexOf(v) + 1) : 0));
}
/** A dimension's part of the g1 code: one dense rank per bar, and the rank of zero after a slash when it has one. */
export function dimPart(name, marks) {
  if (!DIM.get(name).zero) return `${name}:${dense(marks).join(',')}`;
  const r = dense([...marks, 0]);
  return `${name}:${r.slice(0, -1).join(',')}/${r[marks.length]}`;
}
/** The parts of every dimension the bars carry, in order. */
export const dimParts = (bars) => dimsOf(bars).map((name) => dimPart(name, marksOf(bars, name)));
/**
 * Dimension parts read back as marks, strictly as the g1 text is: known names in the fixed order, each at most
 * once; one rank for each of the n bars; the rank of zero after a slash exactly when the dimension has one; ranks
 * whole, written plainly and dense from zero. Returns { name: marks }, or throws an Error that says what is wrong.
 */
export function readDimParts(parts, n) {
  const out = {}; let last = -1;
  for (const part of parts) {
    const m = typeof part === 'string' ? /^([a-z]+):([0-9,]*)(?:\/([0-9]*))?$/.exec(part) : null; const at = m ? DIMENSIONS.findIndex((d) => d.name === m[1]) : -1;
    if (at < 0) throw new Error('a dimension part is volume, trades, delta, size or imbalance, a colon and one rank for each bar');
    if (at <= last) throw new Error('dimension parts follow the order volume, trades, delta, size, imbalance, each at most once');
    last = at;
    const { name, zero } = DIMENSIONS[at];
    if ((m[3] !== undefined) !== zero) throw new Error(zero ? `the ${name} part ends with a slash and the rank of zero` : `the ${name} part has no zero to rank, so it takes no slash`);
    const fields = m[2].split(','); const all = zero ? [...fields, m[3]] : fields;
    if (fields.length !== n) throw new Error(`the ${name} part needs one rank for each bar`);
    if (all.some((f) => !/^(0|[1-9][0-9]*)$/.test(f))) throw new Error('dimension ranks are whole numbers written plainly');
    const ranks = all.map(Number); const used = new Set(ranks);
    for (let r = 0; r < used.size; r++) if (!used.has(r)) throw new Error(`the ${name} ranks must be dense from zero`);
    out[name] = zero ? ranks.slice(0, n).map((r) => r - ranks[n]) : ranks;
  }
  return out;
}
/**
 * Where a mark goes when it is moved one step up or down among the others: a mark alone on its level joins the next
 * level that way, and a mark that shares its level (with another mark, or with the zero line) leaves it for a level
 * of its own just beyond. Every order of the marks is reached by such steps. Null when there is nowhere to go.
 */
export function stepped(name, marks, i, dir) {
  const here = marks[i]; const others = marks.filter((_, k) => k !== i); if (DIM.get(name).zero) others.push(0);
  if (others.includes(here)) return here + dir / 2;
  const beyond = others.filter((v) => (dir > 0 ? v > here : v < here));
  return beyond.length ? (dir > 0 ? Math.min(...beyond) : Math.max(...beyond)) : null;
}
/* ---- end of dimensions ---- */

/** The g1 code: the price part, then one part for each dimension the bars carry marks for. */
export function g1(bars, oriented) {
  const id = identity(bars);
  return `g1:${oriented ? 'o' : 'u'}:` + Array.from({ length: id.n }, (_, i) => id.r.slice(i * 4, i * 4 + 4).join(',') + (oriented ? ',' + id.d[i] : '')).join(';')
    + dimParts(bars).map((part) => '|' + part).join('');
}
/** The catalogue names that fit the drawing, each with the bars it covers. Needs patterns.js on the page. */
export function namesOf(bars, oriented) {
  const C = globalThis.CandlePatterns; if (!C) return [];
  const q = ohlc(bars); const [o, hh, l, c] = [0, 1, 2, 3].map((k) => q.map((x) => x[k])); const out = [];
  for (let i = 0; i < bars.length; i++) for (const p of C.patterns) {
    if (p.group || (p.oriented && !oriented) || i < p.bars - 1 || !C.compile(p.id)(o, hh, l, c, i)) continue;
    out.push({ who: p.bars === 1 ? `Bar ${i + 1}` : `Bars ${i - p.bars + 2}–${i + 1}`, p });
  }
  return out;
}
/* ---- what a match holds ---- */
// A pin names two drawn endpoints by part: L low, B body bottom, T body top, H high. The matcher reads prices by kind:
// 0 open, 1 high, 2 low, 3 close, 4 body bottom, 5 body top. With colours kept, a body end is the open or the close.
export const PARTS = ['L', 'B', 'T', 'H'];
const KIND_LETTER = ['O', 'H', 'L', 'C', 'B', 'T'];
const sgn = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const dirOfRow = (r) => sgn(r[3] - r[0]);
export function kindOf(rows, bar, part, oriented) {
  if (part === 'H') return 1; if (part === 'L') return 2;
  if (!oriented) return part === 'T' ? 5 : 4;
  const d = dirOfRow(rows[bar]); return part === 'T' ? (d >= 0 ? 3 : 0) : (d >= 0 ? 0 : 3);
}
export const priceOf = (rows, bar, kind) => { const [o, h, l, c] = rows[bar]; return [o, h, l, c, Math.min(o, c), Math.max(o, c)][kind]; };
export const KIND_NAME = ['open', 'high', 'low', 'close', 'body bottom', 'body top'];
/** A drawn level by part, from an open-high-low-close row. */
export const partPrice = (row, part) => (part === 'L' ? row[2] : part === 'H' ? row[1] : part === 'B' ? Math.min(row[0], row[3]) : Math.max(row[0], row[3]));
// a high (low) that beats every bar within k bars on both sides has strength k; the extremes of the whole shape have strength n
export function landmarks(rows) {
  const n = rows.length; const out = [];
  for (const [part, k, s] of [['H', 1, 1], ['L', 2, -1]]) for (let i = 0; i < n; i++) {
    const v = (j) => rows[j][k] * s; let st = 0;
    while (st < n) {
      const lo = i - (st + 1); const hi = i + (st + 1);
      if (lo < 0 && hi >= n) { st = n; break; }
      if ((lo >= 0 && !(v(i) > v(lo))) || (hi < n && !(v(i) > v(hi)))) break;
      st++;
    }
    if (st > 0) out.push({ bar: i, part, k: st });
  }
  return out;
}
export const skelLevels = (rows) => [...new Set(landmarks(rows).map((m) => m.k))].sort((a, b) => b - a);
export function skelMarks(rows, skel) { const lv = skelLevels(rows); if (!skel || !lv.length) return []; const min = lv[Math.min(skel, lv.length) - 1]; return landmarks(rows).filter((m) => m.k >= min); }
/**
 * Everything held, as the matcher needs it (`h`), each with where it came from. A relation is read off the rows as
 * they stand: a pin holds two endpoints, and whichever way they lie now is what a window must keep.
 */
export function heldOf(rows, { pins = [], skel = 0, oriented = true } = {}) {
  const out = []; const seen = new Set(); const n = rows.length;
  const rel = (a, ka, b, kb, from, pin) => {
    if (a === b && ka === kb) return;
    const key = a < b || (a === b && ka < kb) ? `${a}.${ka}|${b}.${kb}` : `${b}.${kb}|${a}.${ka}`;
    if (seen.has(key)) return; seen.add(key);
    const r = sgn(priceOf(rows, a, ka) - priceOf(rows, b, kb));
    out.push({ h: { a: [a, ka], b: [b, kb], rel: r }, label: `${KIND_LETTER[ka]}${a + 1} ${r > 0 ? '>' : r < 0 ? '<' : '='} ${KIND_LETTER[kb]}${b + 1}`, from, pin });
  };
  pins.forEach((p, i) => {
    if (p.color) {
      if (p.bar < n && oriented && !seen.has('c' + p.bar)) { seen.add('c' + p.bar); const d = dirOfRow(rows[p.bar]); out.push({ h: { color: true, bar: p.bar, dir: d }, label: `bar ${p.bar + 1} ${d > 0 ? 'up' : d < 0 ? 'down' : 'open = close'}`, from: 'pin', pin: i }); }
      return;
    }
    if (p.a.bar >= n || p.b.bar >= n) return;
    rel(p.a.bar, kindOf(rows, p.a.bar, p.a.part, oriented), p.b.bar, kindOf(rows, p.b.bar, p.b.part, oriented), 'pin', i);
  });
  const marks = skelMarks(rows, skel);
  if (marks.length) {
    const pts = [];
    if (oriented) pts.push([0, 0]);
    for (const m of marks) pts.push([m.bar, m.part === 'H' ? 1 : 2]);
    if (oriented) pts.push([n - 1, 3]);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) rel(pts[i][0], pts[i][1], pts[j][0], pts[j][1], 'skeleton', -1);
    for (const m of marks) for (const j of [m.bar - 1, m.bar + 1]) if (j >= 0 && j < n) { const k = m.part === 'H' ? 1 : 2; rel(m.bar, k, j, k, 'skeleton', -1); }
  }
  return out;
}
/* ---- end of what a match holds ---- */

/** The drawing's low and high: the scale every lane is drawn in (low 0, high 1). */
export function extent(rows) { let lo = Infinity; let hi = -Infinity; for (const [, h, l] of rows) { if (l < lo) lo = l; if (h > hi) hi = h; } return [lo, hi]; }

/** Bars from recorded open-high-low-close rows, fitted into the range [lo, hi] and chained. */
export function fromRows(rows, lo = 18, hi = 80) {
  const [a, b] = extent(rows); const f = (p) => lo + ((p - a) / (b - a || 1)) * (hi - lo);
  return rechain(rows.map(([o, h, l, c], k) => bar([f(l), f(Math.min(o, c)), f(Math.max(o, c)), f(h)], c > o ? 'u' : c < o ? 'd' : k ? 'u' : 'u')));
}

export const MAX_STRETCH = 4;

/* ---- the drawing packet: how a shape is carried to and from the query bench ---- */
// The packet is Filang's own (its study/composer/drawing.js): bars as drawn, pins, skeleton, stretch, the next-bar
// term and the number of closest windows. It names the revision of the drawing format it was written in, and the
// engine refuses any other. This is that revision; the format is the one this model already keeps.
export const DRAWING_REVISION = '133e3017ba9143f7dc255df7218ff7bfe46d9d06';
// A drawing with a dimension switched on is written in a later revision of the format: the same packet with one more
// field, `dimensions`, the dimension parts of its g1 code in order (["volume:0,1", "delta:0,2/1"]). A reader that
// knows only the first revision refuses such a packet, where it would otherwise read the price part alone. A
// drawing with every dimension off is still written in the first revision, to the letter, and a packet in the first
// revision means every dimension off. The revision names the Composer commit the format was cut from.
export const DIMENSIONS_REVISION = 'bd6a0ba32e18548b641267418491bfb5f011a274';
export const PACKET_MAX = 96000;
/** Read a packet as the engine's decoder reads it: the packet, or an Error that says what is wrong with it. */
export function decodePacket(text) {
  const need = (ok, why) => { if (!ok) throw new Error(why); };
  const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const whole = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
  need(typeof text === 'string' && text.length > 0 && text.length <= PACKET_MAX, 'it has an invalid size');
  let p; try { p = JSON.parse(text); } catch { p = null; }
  need(obj(p) && p.version === 1 && (p.revision === DRAWING_REVISION || p.revision === DIMENSIONS_REVISION), 'it is not a drawing in the format this bench reads');
  need(typeof p.oriented === 'boolean' && Array.isArray(p.bars) && whole(p.bars.length, 1, MAX_BARS), `a drawing has 1 to ${MAX_BARS} bars`);
  need(p.coordinates === undefined || p.coordinates === 'ordinal', 'its coordinate source is not known');
  let last;
  for (const b of p.bars) {
    need(obj(b) && ['u', 'd'].includes(b.d) && Array.isArray(b.v) && b.v.length === 4 && b.v.every((x, i) => Number.isFinite(x) && Math.abs(x) <= 1e12 && (!i || x >= b.v[i - 1])), 'a bar has an invalid price or direction');
    need(last === undefined || last === openOf(b.v, b.d), 'a bar opens away from the previous close');
    last = closeOf(b.v, b.d);
  }
  const n = p.bars.length;
  need(whole(p.skeleton, 0, n) && whole(p.stretch, 0, n === 1 ? 0 : MAX_STRETCH), 'its skeleton or stretch is out of range');
  need(Array.isArray(p.pins) && p.pins.length <= n * (4 * n + 1) * 2, 'its pins are not valid');
  const point = (x) => obj(x) && whole(x.bar, 0, n - 1) && PARTS.includes(x.part);
  for (const pin of p.pins) need(obj(pin) && (pin.color === true ? whole(pin.bar, 0, n - 1) : point(pin.a) && point(pin.b)), 'a pin is not valid');
  need(obj(p.next) && [-1, 0, 1].includes(p.next.dir) && ['any', 'bps', 'atr'].includes(p.next.measure) && Number.isFinite(p.next.bps) && p.next.bps > 0 && Number.isFinite(p.next.atr) && p.next.atr > 0, 'its next-bar term is not valid');
  need([12, 24, 48].includes(p.limit), 'its number of closest windows is not valid');
  // dimensions belong to the later revision only; there they are the parts of the g1 code, read as strictly as it is
  if (p.revision === DRAWING_REVISION) need(p.dimensions === undefined, 'it names dimensions in a format that has none');
  else if (p.dimensions !== undefined) { need(Array.isArray(p.dimensions) && p.dimensions.length <= DIMENSIONS.length, 'its dimensions are not valid'); readDimParts(p.dimensions, n); }
  return p;
}
/* ---- end of the drawing packet ---- */
/** Later bars a closing state can be picked for, and the pick string with none: one character per later bar. */
export const AFTER = 6;
export const NO_GIVEN = '-'.repeat(AFTER);
export function createModel() {
  const m = {
    bars: rechain(START()), sel: 1, oriented: true, tfOn: [true, true, true, true, true], x: 12,
    next: { dir: 0, measure: 'any', bps: 10, atr: 1 }, past: [], future: [],
    pins: [],     // relations held: { a: { bar, part }, b: { bar, part } }, or { bar, color: true }
    skel: 0,      // 0 off, then 1 (the extremes) up to every swing
    stretch: 0,   // recorded bars the drawn bars may skip between the first and the last; counts only while something is held
    given: NO_GIVEN,   // closing states picked for the later bars: U above the shape's high, I inside, D below its low, - free
    dims: [],     // the dimensions switched on, in the order their parts are written; every bar carries a mark for each
  };
  // What is asked of the drawing besides the drawing itself. Changing a term is not an undo step, so an ordinary
  // snapshot leaves the terms alone; following a link replaces them, so that snapshot takes them too (`all`).
  const terms = () => ({ oriented: m.oriented, tfOn: m.tfOn.slice(), x: m.x, next: { ...m.next } });
  // the marks are part of what is drawn, so a snapshot keeps them, and the switches with them
  const snap = (all = false) => ({ bars: m.bars.map((b) => bar(b.v, b.d, b.m)), dims: m.dims.slice(), pins: JSON.parse(JSON.stringify(m.pins)), skel: m.skel, stretch: m.stretch, given: m.given, ...(all === true ? { terms: terms() } : {}) });
  const push = (was) => { m.past.push(was || snap()); if (m.past.length > 400) m.past.shift(); m.future = []; };
  const restore = (st) => { m.bars = st.bars.map((b) => bar(b.v, b.d, b.m)); m.dims = (st.dims || []).slice(); m.pins = JSON.parse(JSON.stringify(st.pins)); m.skel = st.skel; m.stretch = st.stretch; m.given = st.given || NO_GIVEN; m.sel = Math.min(m.sel, m.bars.length - 1);
    if (st.terms) { m.oriented = st.terms.oriented; m.tfOn = st.terms.tfOn.slice(); m.x = st.terms.x; m.next = { ...st.terms.next }; }
  };
  // Every bar carries one mark for each dimension switched on, and no other. A bar that has none yet takes a level
  // of its own beyond the others: above them all, or, against a zero line, on the side its colour says (a rising
  // bar net buying, a falling one net selling). Marks are then settled, so removing a bar leaves no empty level.
  const conform = () => {
    m.dims = DIMENSIONS.map((d) => d.name).filter((name) => m.dims.includes(name));
    const next = m.bars.map(() => ({}));
    for (const name of m.dims) {
      const zero = DIM.get(name).zero; const marks = [];
      for (const b of m.bars) {
        let v = b.m ? b.m[name] : undefined;
        if (!Number.isFinite(v)) v = !zero ? Math.max(-1, ...marks) + 1 : b.d === 'u' ? Math.max(0, ...marks) + 1 : Math.min(0, ...marks) - 1;
        marks.push(v);
      }
      settled(name, marks).forEach((v, i) => { next[i][name] = v; });
    }
    m.bars.forEach((b, i) => { if (m.dims.length) b.m = next[i]; else delete b.m; });
  };
  // prices redrawn from chain parameters keep the marks, bar for bar
  const redrawn = (P) => chainBars(P).map((b, i) => bar(b.v, b.d, m.bars[i]?.m));
  // a pin lives on its bars: when a bar goes, so do the pins that named it, and the skeleton cannot be finer than the shape has swings
  const tidy = () => {
    const n = m.bars.length; m.pins = m.pins.filter((p) => (p.color ? p.bar < n : p.a.bar < n && p.b.bar < n));
    m.skel = Math.min(m.skel, skelLevels(ohlc(m.bars)).length);
  };
  const same = (a, b) => (p) => !p.color && ((p.a.bar === a.bar && p.a.part === a.part && p.b.bar === b.bar && p.b.part === b.part) || (p.a.bar === b.bar && p.a.part === b.part && p.b.bar === a.bar && p.b.part === a.part));
  const api = {
    state: m,
    params: () => chainParams(m.bars),
    /** Replace the bars from chain parameters. `was` is the snapshot to undo to, taken before a drag began. */
    setParams(P, { record = false, was = null } = {}) { if (record) push(was); m.bars = redrawn(P); },
    snapshot: snap,
    record: push,
    // other bars put on the canvas: a bar keeps the marks of the bar it replaces, unless it brings its own
    setBars(bars, record = true) { if (record) push(); m.bars = rechain(bars.map((b, i) => bar(b.v, b.d, b.m || m.bars[i]?.m))); m.sel = Math.min(m.sel, m.bars.length - 1); conform(); tidy(); },
    add() {
      if (m.bars.length >= MAX_BARS) return false;
      push(); const last = m.bars[m.bars.length - 1]; const c = closeOf(last.v, last.d); const size = Math.max(4, (last.v[2] - last.v[1]) * 0.7); const up = last.d !== 'u';
      const nc = up ? c + size : c - size;
      m.bars = rechain([...m.bars, bar([Math.min(c, nc) - size * 0.4, Math.min(c, nc), Math.max(c, nc), Math.max(c, nc) + size * 0.4], up ? 'u' : 'd')]); m.sel = m.bars.length - 1; conform(); return true;
    },
    remove() { if (m.bars.length <= MIN_BARS) return false; push(); m.bars = rechain(m.bars.slice(0, -1)); m.sel = Math.min(m.sel, m.bars.length - 1); conform(); tidy(); return true; },
    flip() { push(); m.bars = redrawn(flipParams(chainParams(m.bars))); },
    nudge(i, dv) { push(); m.bars = redrawn(moveParams(chainParams(m.bars), i, dv)); },

    /** Switch a dimension on or off. On, every bar takes a mark for it; off, its marks go. False when nothing changes. */
    setDim(name, on) {
      if (!DIM.has(name) || m.dims.includes(name) === !!on) return false;
      push(); m.dims = on ? [...m.dims, name] : m.dims.filter((d) => d !== name); conform(); return true;
    },
    /** One dimension's marks, bar by bar; null when it is off. */
    marks: (name) => (m.dims.includes(name) ? marksOf(m.bars, name) : null),
    /**
     * Put a mark where it is dragged, as it is: any level, between two others or beyond them all. Nothing is
     * recorded and nothing settled, so the other marks stay where they are until the drag ends.
     */
    placeMark(name, i, level) { if (!m.dims.includes(name) || !m.bars[i] || !Number.isFinite(level)) return false; m.bars[i].m[name] = level; return true; },
    /** Settle every mark onto whole, dense levels: the order stays, the empty levels go. */
    settle() { conform(); },
    /** Move bar i's mark one step up (1) or down (-1) among the others. False when it has nowhere to go. */
    stepMark(name, i, dir) {
      if (!m.dims.includes(name) || !m.bars[i]) return false;
      const to = stepped(name, marksOf(m.bars, name), i, dir); if (to === null) return false;
      push(); m.bars[i].m[name] = to; conform(); return true;
    },
    // a step that carries the terms is undone and redone with them, so both directions restore the whole question
    undo() { if (!m.past.length) return false; const st = m.past.pop(); m.future.push(snap(!!st.terms)); restore(st); return true; },
    redo() { if (!m.future.length) return false; const st = m.future.pop(); m.past.push(snap(!!st.terms)); restore(st); return true; },

    /** Hold the relation between two drawn endpoints, whichever way they lie. False when it is already held. */
    pin(a, b) { if ((a.bar === b.bar && a.part === b.part) || m.pins.some(same(a, b))) return false; push(); m.pins.push({ a: { ...a }, b: { ...b } }); return true; },
    /** Hold a bar's colour, or let it go if it is held. */
    colorPin(b) { push(); const i = m.pins.findIndex((p) => p.color && p.bar === b); if (i >= 0) m.pins.splice(i, 1); else m.pins.push({ bar: b, color: true }); return true; },
    unpin(i) { if (!m.pins[i]) return false; push(); m.pins.splice(i, 1); return true; },
    clearHolds() { if (!m.pins.length && !m.skel) return false; push(); m.pins = []; m.skel = 0; return true; },
    setSkel(k) { const top = skelLevels(ohlc(m.bars)).length; k = Math.max(0, Math.min(top, k)); if (k === m.skel) return false; push(); m.skel = k; return true; },
    setStretch(k) { k = Math.max(0, Math.min(MAX_STRETCH, k)); if (k === m.stretch) return false; push(); m.stretch = k; return true; },
    /**
     * Pick the closing state of later bar +j (1 to 6): 'U', 'I' or 'D'. The same pick again, or '-', frees the bar;
     * another state replaces the one it had. False when nothing changes.
     */
    give(j, s) {
      if (!(j >= 1 && j <= AFTER) || !'UID-'.includes(s) || s.length !== 1) return false;
      const to = m.given[j - 1] === s ? '-' : s; if (to === m.given[j - 1]) return false;
      push(); m.given = m.given.slice(0, j - 1) + to + m.given.slice(j); return true;
    },
    /** Replace every pick at once: a whole closing path, or NO_GIVEN to free every bar. */
    giveAll(text) { if (!/^[UID-]{6}$/.test(text) || text === m.given) return false; push(); m.given = text; return true; },
    skelTop: () => skelLevels(ohlc(m.bars)).length,
    /** The swings the skeleton keeps, at its level or at another one. */
    skelMarks: (level = m.skel) => skelMarks(ohlc(m.bars), level),
    /** Everything held on the drawing, or on other rows read with the drawing's pins and skeleton level. */
    held(rows) { return heldOf(rows || ohlc(m.bars), { pins: m.pins, skel: m.skel, oriented: m.oriented }); },
    /**
     * The matcher's query includes the drawn bars, held relations, and search terms.
     * `over.rows` asks about other bars with the same pins; `over.holds` sends a chosen part of what is held.
     */
    query(over = {}) {
      const nx = m.next; const next = nx.dir ? { dir: nx.dir, measure: nx.measure, value: nx.measure === 'bps' ? nx.bps : nx.measure === 'atr' ? nx.atr : 0 } : null;
      const rows = over.rows || ohlc(m.bars);
      const ask = { bars: rows, oriented: m.oriented, holds: over.holds || api.held(rows).map((x) => x.h), stretch: m.stretch, x: m.x, tfs: (over.tfs || m.tfOn).map(Number), next };
      // the dimensions switched on, as the parts of the g1 code; with none on the question is the one it always was
      if (m.dims.length) ask.dims = dimParts(m.bars);
      return ask;
    },

    /** The drawing as the packet the query bench reads: what is drawn and what is held on it, nothing rounded. */
    toPacket() {
      const dimensions = dimParts(m.bars);
      return { version: 1, revision: dimensions.length ? DIMENSIONS_REVISION : DRAWING_REVISION, oriented: m.oriented, bars: m.bars.map((b) => ({ v: Array.from(b.v), d: b.d })),
        ...(dimensions.length ? { dimensions } : {}),
        pins: m.pins.map((q) => (q.color ? { bar: q.bar, color: true } : { a: { bar: q.a.bar, part: q.a.part }, b: { bar: q.b.bar, part: q.b.part } })),
        skeleton: m.skel, stretch: m.stretch, next: { dir: m.next.dir, measure: m.next.measure, bps: m.next.bps, atr: m.next.atr }, limit: m.x };
    },
    /** Whether a pin holds something the engine reads as a rule on fixed candles: a colour pin does only with directions kept. */
    pinned: () => m.pins.some((q) => !q.color || m.oriented),
    /**
     * Take the drawing a packet carries: the bars, the dimensions switched on with their marks, whether directions are
     * kept, the pins, the skeleton, the stretch, the next-bar term and the number of closest windows. The timeframes
     * stay as they are; picks go, since they were read off another shape. Null when it was taken; otherwise the
     * reason, with nothing changed. History is left alone.
     */
    readPacket(text) {
      let p; try { p = decodePacket(text); } catch (e) { return String(e.message || e); }
      if (p.bars.length < MIN_BARS) return `this bench draws ${MIN_BARS} bars or more`;
      const marks = readDimParts(p.dimensions || [], p.bars.length);   // none in a packet of the first revision: every dimension off
      m.dims = Object.keys(marks); m.bars = rechain(p.bars.map((b, i) => bar(b.v, b.d, m.dims.length ? Object.fromEntries(m.dims.map((name) => [name, marks[name][i]])) : undefined)));
      conform(); m.sel = m.bars.length - 1; m.oriented = p.oriented;
      // a pin is a colour pin only as the decoder judged it one (`color === true`): any other pin was checked as two
      // endpoints, and is taken as two endpoints, whatever else it carries
      m.pins = p.pins.filter((q) => q.color === true || q.a.bar !== q.b.bar || q.a.part !== q.b.part).map((q) => (q.color === true ? { bar: q.bar, color: true } : { a: { bar: q.a.bar, part: q.a.part }, b: { bar: q.b.bar, part: q.b.part } }));
      m.skel = Math.min(p.skeleton, skelLevels(ohlc(m.bars)).length); m.stretch = p.stretch;
      m.next = { dir: p.next.dir, measure: p.next.measure, bps: p.next.bps, atr: p.next.atr }; m.x = p.limit; m.given = NO_GIVEN;
      return null;
    },

    /**
     * The drawing and what is asked of it, as an address fragment. A price is written as the shortest text that
     * reads back as the same number, so a link reopens the same shape: levels that differ stay apart and a tie
     * stays a tie. Rounding here would change the g1 pattern and the relations held on it.
     */
    address() {
      const num = (v) => String(v).replace('+', '');   // "1e+21" would lose its sign to the address's own decoding
      const nx = m.next;
      return `s=${m.bars.map((b) => [...b.v.map(num), b.d].join(',')).join(';')}&o=${+m.oriented}&tf=${m.tfOn.map(Number).join('')}&x=${m.x}&n=${nx.dir ? [nx.dir, nx.measure, nx.measure === 'bps' ? nx.bps : nx.atr].join(',') : 0}`
        // the dimensions switched on, as the parts of the g1 code; an address without them means every dimension off
        + (m.dims.length ? `&dim=${dimParts(m.bars).join('|')}` : '')
        + (m.pins.length ? `&p=${m.pins.map((q) => (q.color ? 'c' + q.bar : `${q.a.bar}${q.a.part}.${q.b.bar}${q.b.part}`)).join(',')}` : '') + (m.skel ? `&k=${m.skel}` : '') + (m.stretch ? `&st=${m.stretch}` : '') + (m.given !== NO_GIVEN ? `&gv=${m.given}` : '');
    },
    /**
     * Take the drawing an address names, with everything asked of it; what the address leaves out goes back to how
     * the bench opens. False, with nothing changed, when it names no readable drawing. History is left alone.
     * Dimension parts that cannot be read make the whole address unreadable: a drawing is never taken without a
     * dimension it was written with.
     */
    readAddress(text) {
      let bars; let p; let marks;
      try {
        p = new URLSearchParams(String(text).replace(/^#/, '')); const sh = p.get('s'); if (!sh) return false;
        bars = sh.split(';').map((t) => { const a = t.split(','); const v = a.slice(0, 4).map(Number); if (a.length !== 5 || v.some((x) => !Number.isFinite(x)) || !['u', 'd'].includes(a[4])) throw new Error('bar'); return bar(v, a[4]); });
        marks = readDimParts(p.get('dim') ? p.get('dim').split('|') : [], bars.length);
      } catch { return false; }
      if (bars.length < MIN_BARS || bars.length > MAX_BARS) return false;
      m.dims = Object.keys(marks); if (m.dims.length) bars.forEach((b, i) => { b.m = Object.fromEntries(m.dims.map((name) => [name, marks[name][i]])); });
      m.bars = rechain(bars); conform(); m.sel = m.bars.length - 1;
      m.oriented = p.get('o') !== '0';
      const tf = p.get('tf') || ''; m.tfOn = /^[01]{5}$/.test(tf) && tf.includes('1') ? [...tf].map((c) => c === '1') : [true, true, true, true, true];
      m.x = [12, 24, 48].includes(+p.get('x')) ? +p.get('x') : 12;
      m.next = { dir: 0, measure: 'any', bps: 10, atr: 1 };
      const nx = (p.get('n') || '0').split(',');
      if (nx.length === 3 && [1, -1].includes(+nx[0]) && ['any', 'bps', 'atr'].includes(nx[1])) { m.next.dir = +nx[0]; m.next.measure = nx[1]; if (nx[1] === 'bps') m.next.bps = +nx[2] || 10; if (nx[1] === 'atr') m.next.atr = +nx[2] || 1; }
      // what is held: pins as "0L.1T" (two endpoints) or "c1" (a bar's colour), the skeleton level, the stretch
      const n = m.bars.length; const pins = [];
      for (const tok of (p.get('p') || '').split(',')) {
        const c = /^c(\d+)$/.exec(tok); const r = /^(\d+)([LBTH])\.(\d+)([LBTH])$/.exec(tok);
        if (c && +c[1] < n) pins.push({ bar: +c[1], color: true });
        else if (r && +r[1] < n && +r[3] < n && !(r[1] === r[3] && r[2] === r[4])) pins.push({ a: { bar: +r[1], part: r[2] }, b: { bar: +r[3], part: r[4] } });
      }
      m.pins = pins; m.skel = Math.max(0, Math.min(skelLevels(ohlc(m.bars)).length, Math.trunc(+p.get('k')) || 0)); m.stretch = Math.max(0, Math.min(MAX_STRETCH, Math.trunc(+p.get('st')) || 0));
      // the closing states picked for the later bars, one character per bar
      m.given = /^[UID-]{6}$/.test(p.get('gv') || '') ? p.get('gv') : NO_GIVEN;
      return true;
    },
  };
  return api;
}
