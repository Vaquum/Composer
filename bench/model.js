// The drawing: a chained run of bars with free prices, and what the engine is asked about it.
// BTCUSDT trades around the clock, so the drawing puts every later open at the previous close.
// What a drawing is and holds (its g1 code, the rules held on it, its skeleton, its names) is read by the engine.
import { filang, Candles, DRAWING_REVISION } from './filang.js';

export { DRAWING_REVISION };

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
const bar = (v, d) => ({ v: v.slice(), d });
/** Composer's opening drawing: a rising bar, then a falling bar that covers it. */
export const START = () => [bar([30, 42, 56, 68], 'u'), bar([18, 36, 62, 80], 'd')];
const rechain = (bars) => chainBars(chainParams(bars)).map((b) => bar(b.v, b.d));

/** Open, high, low, close of each bar, as the matcher takes them. A doji reads as open = close. */
export function ohlc(bars) {
  return bars.map((b) => { const [l, lo, hi, h] = b.v; return lo === hi ? [lo, h, l, hi] : b.d === 'u' ? [lo, h, l, hi] : [hi, h, l, lo]; });
}
/* ---- what a match holds ---- */
// A pin names two drawn endpoints by part: L low, B body bottom, T body top, H high. The engine turns the pins and the
// skeleton into held rules, each between two prices by kind: 0 open, 1 high, 2 low, 3 close, 4 body bottom, 5 body top.
export const PARTS = ['L', 'B', 'T', 'H'];
export const KIND_NAME = ['open', 'high', 'low', 'close', 'body bottom', 'body top'];
const KINDS = ['open', 'high', 'low', 'close', 'body_low', 'body_high'];
const KIND_LETTER = ['O', 'H', 'L', 'C', 'B', 'T'];
/** A drawn level by part, from an open-high-low-close row. */
export const partPrice = (row, part) => (part === 'L' ? row[2] : part === 'H' ? row[1] : part === 'B' ? Math.min(row[0], row[3]) : Math.max(row[0], row[3]));
// What the engine reads off a packet, kept by its text: the g1 code, the held rules in the order a fallback result's
// `broken` indexes them, the skeleton's levels and swings, and the names that fit.
const seen = new Map();
function read(packet) {
  const text = JSON.stringify(packet); let d = seen.get(text);
  if (!d) { d = filang.decodeDrawing(text); if (seen.size >= 256) seen.delete(seen.keys().next().value); seen.set(text, d); }
  return d;
}
/** The held rules as the bench shows them: `h` is the rule the engine holds, with where it came from. */
function rulesOf(d) {
  return d.held_rules.map((r) => {
    const pin = r.source === 'pin' ? r.pin : -1;
    if (r.colour !== undefined) return { h: { color: true, bar: r.bar, dir: r.colour }, label: `bar ${r.bar + 1} ${r.colour > 0 ? 'up' : r.colour < 0 ? 'down' : 'open = close'}`, from: r.source, pin };
    const ka = KINDS.indexOf(r.a.price); const kb = KINDS.indexOf(r.b.price);
    return { h: { a: [r.a.bar, ka], b: [r.b.bar, kb], rel: r.relation }, label: `${KIND_LETTER[ka]}${r.a.bar + 1} ${r.relation > 0 ? '>' : r.relation < 0 ? '<' : '='} ${KIND_LETTER[kb]}${r.b.bar + 1}`, from: r.source, pin };
  });
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

// The drawing packet is the engine's own format: bars as drawn, pins, skeleton, stretch, the next-bar term and the
// number of closest windows. The engine reads and refuses packets; a link may carry at most this much text.
export const PACKET_MAX = 96000;
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
  };
  // What is asked of the drawing besides the drawing itself. Changing a term is not an undo step, so an ordinary
  // snapshot leaves the terms alone; following a link replaces them, so that snapshot takes them too (`all`).
  const terms = () => ({ oriented: m.oriented, tfOn: m.tfOn.slice(), x: m.x, next: { ...m.next } });
  const snap = (all = false) => ({ bars: m.bars.map((b) => bar(b.v, b.d)), pins: JSON.parse(JSON.stringify(m.pins)), skel: m.skel, stretch: m.stretch, given: m.given, ...(all === true ? { terms: terms() } : {}) });
  const push = (was) => { m.past.push(was || snap()); if (m.past.length > 400) m.past.shift(); m.future = []; };
  const restore = (st) => { m.bars = st.bars.map((b) => bar(b.v, b.d)); m.pins = JSON.parse(JSON.stringify(st.pins)); m.skel = st.skel; m.stretch = st.stretch; m.given = st.given || NO_GIVEN; m.sel = Math.min(m.sel, m.bars.length - 1);
    if (st.terms) { m.oriented = st.terms.oriented; m.tfOn = st.terms.tfOn.slice(); m.x = st.terms.x; m.next = { ...st.terms.next }; }
  };
  // a pin lives on its bars: when a bar goes, so do the pins that named it, and the skeleton cannot be finer than the shape has swings
  const tidy = () => {
    const n = m.bars.length; m.pins = m.pins.filter((p) => (p.color ? p.bar < n : p.a.bar < n && p.b.bar < n));
    m.skel = Math.min(m.skel, top());
  };
  // The drawing as the engine's packet: what is drawn and what is held on it, nothing rounded. `over` asks about other
  // rows, fewer pins, or another skeleton level.
  const packet = (over = {}) => ({ version: 1, revision: DRAWING_REVISION, oriented: m.oriented,
    bars: over.rows ? over.rows.map(([o, h, l, c]) => ({ v: [l, Math.min(o, c), Math.max(o, c), h], d: c < o ? 'd' : 'u' })) : m.bars.map((b) => ({ v: Array.from(b.v), d: b.d })),
    pins: (over.pins === undefined ? m.pins : m.pins.slice(0, over.pins)).map((q) => (q.color ? { bar: q.bar, color: true } : { a: { bar: q.a.bar, part: q.a.part }, b: { bar: q.b.bar, part: q.b.part } })),
    skeleton: over.pins === undefined ? over.skeleton ?? m.skel : 0, stretch: m.stretch, next: { dir: m.next.dir, measure: m.next.measure, bps: m.next.bps, atr: m.next.atr }, limit: m.x });
  // how many skeleton levels the shape has: read off the bars alone, whatever is pinned
  const top = () => read(packet({ pins: 0 })).skeleton_levels;
  const same = (a, b) => (p) => !p.color && ((p.a.bar === a.bar && p.a.part === a.part && p.b.bar === b.bar && p.b.part === b.part) || (p.a.bar === b.bar && p.a.part === b.part && p.b.bar === a.bar && p.b.part === a.part));
  const api = {
    state: m,
    params: () => chainParams(m.bars),
    /** Replace the bars from chain parameters. `was` is the snapshot to undo to, taken before a drag began. */
    setParams(P, { record = false, was = null } = {}) { if (record) push(was); m.bars = chainBars(P).map((b) => bar(b.v, b.d)); },
    snapshot: snap,
    record: push,
    setBars(bars, record = true) { if (record) push(); m.bars = rechain(bars); m.sel = Math.min(m.sel, m.bars.length - 1); tidy(); },
    add() {
      if (m.bars.length >= MAX_BARS) return false;
      push(); const last = m.bars[m.bars.length - 1]; const c = closeOf(last.v, last.d); const size = Math.max(4, (last.v[2] - last.v[1]) * 0.7); const up = last.d !== 'u';
      const nc = up ? c + size : c - size;
      m.bars = rechain([...m.bars, bar([Math.min(c, nc) - size * 0.4, Math.min(c, nc), Math.max(c, nc), Math.max(c, nc) + size * 0.4], up ? 'u' : 'd')]); m.sel = m.bars.length - 1; return true;
    },
    remove() { if (m.bars.length <= MIN_BARS) return false; push(); m.bars = rechain(m.bars.slice(0, -1)); m.sel = Math.min(m.sel, m.bars.length - 1); tidy(); return true; },
    flip() { push(); m.bars = chainBars(flipParams(chainParams(m.bars))).map((b) => bar(b.v, b.d)); },
    nudge(i, dv) { push(); m.bars = chainBars(moveParams(chainParams(m.bars), i, dv)).map((b) => bar(b.v, b.d)); },
    // a step that carries the terms is undone and redone with them, so both directions restore the whole question
    undo() { if (!m.past.length) return false; const st = m.past.pop(); m.future.push(snap(!!st.terms)); restore(st); return true; },
    redo() { if (!m.future.length) return false; const st = m.future.pop(); m.past.push(snap(!!st.terms)); restore(st); return true; },

    /** Hold the relation between two drawn endpoints, whichever way they lie. False when it is already held. */
    pin(a, b) { if ((a.bar === b.bar && a.part === b.part) || m.pins.some(same(a, b))) return false; push(); m.pins.push({ a: { ...a }, b: { ...b } }); return true; },
    /** Hold a bar's colour, or let it go if it is held. */
    colorPin(b) { push(); const i = m.pins.findIndex((p) => p.color && p.bar === b); if (i >= 0) m.pins.splice(i, 1); else m.pins.push({ bar: b, color: true }); return true; },
    unpin(i) { if (!m.pins[i]) return false; push(); m.pins.splice(i, 1); return true; },
    clearHolds() { if (!m.pins.length && !m.skel) return false; push(); m.pins = []; m.skel = 0; return true; },
    setSkel(k) { k = Math.max(0, Math.min(top(), k)); if (k === m.skel) return false; push(); m.skel = k; return true; },
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
    skelTop: top,
    /** The swings the skeleton keeps, at its level or at another one. */
    skelMarks: (level = m.skel) => read(packet({ skeleton: level })).skeleton_marks.map((x) => ({ bar: x.bar, part: x.price === 'high' ? 'H' : 'L', k: x.strength })),
    /** Everything held on the drawing, or on other rows read with the drawing's pins and skeleton level. */
    held(rows) { return rulesOf(read(packet(rows ? { rows } : {}))); },
    /** The drawing's g1 code. */
    code: () => read(packet()).shape.code,
    /** The catalogue names that fit the drawing, each with the bars it covers. */
    names: () => read(packet()).names.map(({ id, start, end }) => ({ who: end - start === 1 ? `Bar ${end}` : `Bars ${start + 1}–${end}`, p: Candles.patterns.find((p) => p.id === id) })),
    /**
     * What the worker is asked: the drawing as a packet, the timeframes shown, and Composer's next-bar filter.
     * `over.rows` asks about other bars with the same pins and skeleton; `over.pins` keeps only that many of the pins,
     * in order, and no skeleton; `over.tfs` shows other timeframes.
     */
    query(over = {}) {
      const nx = m.next; const next = nx.dir ? { dir: nx.dir, measure: nx.measure, value: nx.measure === 'bps' ? nx.bps : nx.measure === 'atr' ? nx.atr : 0 } : null;
      return { packet: packet(over), tfs: (over.tfs || m.tfOn).map(Number), next };
    },

    /** The drawing as the packet the query bench reads: what is drawn and what is held on it, nothing rounded. */
    toPacket: () => packet(),
    /** Whether a pin holds something the engine reads as a rule on fixed candles: a colour pin does only with directions kept. */
    pinned: () => m.pins.some((q) => !q.color || m.oriented),
    /**
     * Take the drawing a packet carries: the bars, whether directions are kept, the pins, the skeleton, the stretch,
     * the next-bar term and the number of closest windows. The timeframes stay as they are; picks go, since they were
     * read off another shape. Null when it was taken; otherwise the reason, with nothing changed. History is left alone.
     */
    readPacket(text) {
      if (typeof text !== 'string' || !text.length || text.length > PACKET_MAX) return 'it has an invalid size';
      let p; try { p = filang.decodeDrawing(text).packet; } catch (e) { return String(e.message || e).replace(/\.$/, ''); }
      if (p.dimensions?.length) return 'it carries dimensions, which this bench does not draw yet';
      if (p.bars.length < MIN_BARS) return `this bench draws ${MIN_BARS} bars or more`;
      m.bars = rechain(p.bars.map((b) => bar(b.v, b.d))); m.sel = m.bars.length - 1; m.oriented = p.oriented;
      // a pin is a colour pin only as the decoder judged it one (`color === true`): any other pin was checked as two
      // endpoints, and is taken as two endpoints, whatever else it carries
      m.pins = p.pins.filter((q) => q.color === true || q.a.bar !== q.b.bar || q.a.part !== q.b.part).map((q) => (q.color === true ? { bar: q.bar, color: true } : { a: { bar: q.a.bar, part: q.a.part }, b: { bar: q.b.bar, part: q.b.part } }));
      m.skel = Math.min(p.skeleton, top()); m.stretch = p.stretch;
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
        + (m.pins.length ? `&p=${m.pins.map((q) => (q.color ? 'c' + q.bar : `${q.a.bar}${q.a.part}.${q.b.bar}${q.b.part}`)).join(',')}` : '') + (m.skel ? `&k=${m.skel}` : '') + (m.stretch ? `&st=${m.stretch}` : '') + (m.given !== NO_GIVEN ? `&gv=${m.given}` : '');
    },
    /**
     * Take the drawing an address names, with everything asked of it; what the address leaves out goes back to how
     * the bench opens. False, with nothing changed, when it names no readable drawing. History is left alone.
     */
    readAddress(text) {
      let bars; let p;
      try {
        p = new URLSearchParams(String(text).replace(/^#/, '')); const sh = p.get('s'); if (!sh) return false;
        bars = sh.split(';').map((t) => { const a = t.split(','); const v = a.slice(0, 4).map(Number); if (a.length !== 5 || v.some((x) => !Number.isFinite(x)) || !['u', 'd'].includes(a[4])) throw new Error('bar'); return bar(v, a[4]); });
      } catch { return false; }
      if (bars.length < MIN_BARS || bars.length > MAX_BARS) return false;
      m.bars = rechain(bars); m.sel = m.bars.length - 1;
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
      m.pins = pins; m.skel = Math.max(0, Math.min(top(), Math.trunc(+p.get('k')) || 0)); m.stretch = Math.max(0, Math.min(MAX_STRETCH, Math.trunc(+p.get('st')) || 0));
      // the closing states picked for the later bars, one character per bar
      m.given = /^[UID-]{6}$/.test(p.get('gv') || '') ? p.get('gv') : NO_GIVEN;
      return true;
    },
  };
  return api;
}
