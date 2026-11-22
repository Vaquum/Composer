// The drawing: a chained run of bars with free prices, and what the matcher is asked about it.
// The chain functions are Composer's own, unchanged (index.html, "the chain"): BTCUSDT trades around the clock,
// so every bar opens where the previous bar closed.

/* ---- the chain: pure functions, as in index.html ---- */
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
const dense = (arr) => { const srt = Array.from(new Set(arr)).sort((a, b) => a - b); const m = new Map(); srt.forEach((v, i) => m.set(v, i)); return arr.map((v) => m.get(v)); };
/** The g1 identity: every endpoint ranked, equal prices sharing a rank, and each bar's direction. */
export function identity(bars) {
  const vals = []; for (const b of bars) for (let k = 0; k < 4; k++) vals.push(b.v[k]);
  return { r: dense(vals), d: bars.map((b) => (b.v[1] === b.v[2] ? 'z' : b.d)), n: bars.length };
}
export function g1(bars, oriented) {
  const id = identity(bars);
  return `g1:${oriented ? 'o' : 'u'}:` + Array.from({ length: id.n }, (_, i) => id.r.slice(i * 4, i * 4 + 4).join(',') + (oriented ? ',' + id.d[i] : '')).join(';');
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
/* ---- what a match holds: Composer's own definitions (index.html, "what a match holds"), over recorded rows ---- */
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
export const PACKET_MAX = 96000;
/** Read a packet as the engine's decoder reads it: the packet, or an Error that says what is wrong with it. */
export function decodePacket(text) {
  const need = (ok, why) => { if (!ok) throw new Error(why); };
  const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const whole = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
  need(typeof text === 'string' && text.length > 0 && text.length <= PACKET_MAX, 'it has an invalid size');
  let p; try { p = JSON.parse(text); } catch { p = null; }
  need(obj(p) && p.version === 1 && p.revision === DRAWING_REVISION, 'it is not a drawing in the format this bench reads');
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
    m.skel = Math.min(m.skel, skelLevels(ohlc(m.bars)).length);
  };
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
     * What the matcher is asked, exactly as the page asks it: the bars, the held relations, and the stretch.
     * `over.rows` asks about other bars with the same pins; `over.holds` sends a chosen part of what is held.
     */
    query(over = {}) {
      const nx = m.next; const next = nx.dir ? { dir: nx.dir, measure: nx.measure, value: nx.measure === 'bps' ? nx.bps : nx.measure === 'atr' ? nx.atr : 0 } : null;
      const rows = over.rows || ohlc(m.bars);
      return { bars: rows, oriented: m.oriented, holds: over.holds || api.held(rows).map((x) => x.h), stretch: m.stretch, x: m.x, tfs: (over.tfs || m.tfOn).map(Number), next };
    },

    /** The drawing as the packet the query bench reads: what is drawn and what is held on it, nothing rounded. */
    toPacket() {
      return { version: 1, revision: DRAWING_REVISION, oriented: m.oriented, bars: m.bars.map((b) => ({ v: Array.from(b.v), d: b.d })),
        pins: m.pins.map((q) => (q.color ? { bar: q.bar, color: true } : { a: { bar: q.a.bar, part: q.a.part }, b: { bar: q.b.bar, part: q.b.part } })),
        skeleton: m.skel, stretch: m.stretch, next: { dir: m.next.dir, measure: m.next.measure, bps: m.next.bps, atr: m.next.atr }, limit: m.x };
    },
    /** Whether a pin holds something the engine reads as a rule on fixed candles: a colour pin does only with directions kept. */
    pinned: () => m.pins.some((q) => !q.color || m.oriented),
    /**
     * Take the drawing a packet carries: the bars, whether directions are kept, the pins, the skeleton, the stretch,
     * the next-bar term and the number of closest windows. The timeframes stay as they are; picks go, since they were
     * read off another shape. Null when it was taken; otherwise the reason, with nothing changed. History is left alone.
     */
    readPacket(text) {
      let p; try { p = decodePacket(text); } catch (e) { return String(e.message || e); }
      if (p.bars.length < MIN_BARS) return `this bench draws ${MIN_BARS} bars or more`;
      m.bars = rechain(p.bars.map((b) => bar(b.v, b.d))); m.sel = m.bars.length - 1; m.oriented = p.oriented;
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
      m.pins = pins; m.skel = Math.max(0, Math.min(skelLevels(ohlc(m.bars)).length, Math.trunc(+p.get('k')) || 0)); m.stretch = Math.max(0, Math.min(MAX_STRETCH, Math.trunc(+p.get('st')) || 0));
      // the closing states picked for the later bars, one character per bar
      m.given = /^[UID-]{6}$/.test(p.get('gv') || '') ? p.get('gv') : NO_GIVEN;
      return true;
    },
  };
  return api;
}
