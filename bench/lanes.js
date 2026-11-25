// The bench canvas. Columns are the drawn bars, then the six bars after them. Every lane is one cohort of windows
// drawn in the shape's own scale: its low is 0 and its high is 1. The drawn bars sit in a lens band fitted to the
// lane's height; the two rails (the shape's high and low) funnel from the band into the aftermath's scale, so a
// close above the high or below the low reads at once. Marks persist between redraws and move on a spring.
// Under the drawing's candles, on the same columns, runs one track for each dimension switched on: a mark per bar,
// whose height is its rank among the others and nothing more.
import { s } from './dom.js';
import { sceneFor } from './motion.js';

export const AFTER = 6;
export const BAND = [-0.28, 1.28];
const f1 = (v) => Math.round(v * 10) / 10;
const pc = (v) => (v * 100).toFixed(v >= 0.0995 ? 0 : 1) + '%';

/**
 * Column geometry. The drawn bars share a band between 3.4 and 9 aftermath columns wide, so a short shape stays the
 * largest thing on the canvas and a long one never crowds out the six bars after it.
 */
export function geom(W, n) {
  const padL = 14; const padR = 14; const gap = 30;
  const units = Math.max(3.4, Math.min(9, n * 0.9));
  const unit = Math.max(4, (W - padL - padR - gap) / (units + AFTER)); const bw = (unit * units) / n;
  const band = [padL, padL + n * bw]; const ax0 = band[1] + gap;
  return { n, unit, bw, band, gap, ax0, W,
    xb: (i) => padL + (i + 0.5) * bw, xa: (j) => ax0 + (j - 0.5) * unit,
    /** The cell of a later bar: its left edge and width. Lanes and the column track share it. */
    cell: (j) => [ax0 + (j - 1) * unit + 1, Math.max(1, unit - 2)],
    at(px) { return px < band[1] + gap / 2 ? { bar: Math.max(0, Math.min(n - 1, Math.floor((px - padL) / bw))) } : { after: Math.max(1, Math.min(AFTER, Math.floor((px - ax0) / unit) + 1)) }; } };
}

const setRect = (el, v) => { el.setAttribute('x', f1(v[0])); el.setAttribute('y', f1(v[1])); el.setAttribute('width', f1(Math.max(0, v[2]))); el.setAttribute('height', f1(Math.max(0, v[3]))); };
const setLine = (el, v) => { el.setAttribute('x1', f1(v[0])); el.setAttribute('y1', f1(v[1])); el.setAttribute('x2', f1(v[2])); el.setAttribute('y2', f1(v[3])); };
const setPoints = (el, v) => { let t = ''; for (let i = 0; i < v.length; i += 2) t += `${f1(v[i])},${f1(v[i + 1])} `; el.setAttribute('points', t); };
// A candle's geometry: centre x, wick top, wick bottom, body top, body bottom, body width.
const setCandle = (el, v) => {
  const wick = el.firstChild; const body = el.lastChild;
  wick.setAttribute('x1', f1(v[0])); wick.setAttribute('x2', f1(v[0])); wick.setAttribute('y1', f1(v[1])); wick.setAttribute('y2', f1(v[2]));
  body.setAttribute('x', f1(v[0] - v[5] / 2)); body.setAttribute('y', f1(v[3])); body.setAttribute('width', f1(Math.max(1, v[5]))); body.setAttribute('height', f1(Math.max(1, v[4] - v[3])));
};

/* ---- dimension tracks ---- */
const TRACK_PAD = 8;
/**
 * The height of one dimension's track under n bars. It depends on the bars alone, not on where the marks are, so
 * the canvas keeps its shape while marks are moved: room for every bar on a level of its own, and the zero line.
 */
export const trackHeight = (n, zero) => 2 * TRACK_PAD + Math.max(24, Math.min(54, (2 * (n + (zero ? 1 : 0)) + 1) * 3));
/**
 * The levels a track shows: from half a level under the lowest mark to half a level over the highest, the zero line
 * counted with the marks where there is one. The half levels are where a dragged mark goes to stand between two
 * levels, or beyond them all.
 */
export function trackScale(marks, zero) {
  const at = zero ? [...marks, 0] : marks;
  return [Math.min(...at) - 0.5, Math.max(...at) + 0.5];
}
/* ---- end of dimension tracks ---- */

/** No later bar picked. A pick is one letter per later bar: U above the shape's high, I inside, D below its low. */
export const NONE = '-'.repeat(AFTER);
/**
 * The complete windows of a continuation that closed where the picks say. `given` has one character per later bar:
 * a closing state, or `-` for a bar that is left free. Returns their sequences, their count `n`, the count of the
 * whole cohort `base`, and `grid[j][z]`: how many of them closed in state z at bar +j+1. Null without a continuation.
 */
export function conditioned(cont, given = NONE) {
  if (!cont) return null;
  const picks = []; for (let j = 0; j < AFTER; j++) if ('UID'.includes(given[j])) picks.push(j);
  const sequences = picks.length ? cont.sequences.filter(([key]) => picks.every((j) => key[j] === given[j])) : cont.sequences;
  const grid = Array.from({ length: AFTER }, () => [0, 0, 0]); let n = 0;
  for (const [key, k] of sequences) { n += k; for (let j = 0; j < AFTER; j++) grid[j]['UID'.indexOf(key[j])] += k; }
  return { sequences, n, base: cont.n, grid, picks: picks.length };
}
/** Shares of those windows by closing state at each later bar. Null under 30 windows: nothing is estimated. */
export const sharesOf = (cd) => (cd && cd.n >= 30 ? cd.grid.map((row) => row.map((k) => k / cd.n)) : null);
// Wilson 95% interval for a share of n windows.
const wilson = (p, n) => { const z = 1.96; const d = 1 + (z * z) / n; const c = p + (z * z) / (2 * n); const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
/** For each later bar and state: whether the pooled share lies outside this cohort's 95% interval. Null under 30 windows. */
export function differsFrom(states, n, pooled) {
  if (!states || !pooled || !(n >= 30)) return null;
  return states.map((row, j) => row.map((p, z) => { const [lo, hi] = wilson(p, n); return pooled[j][z] < lo || pooled[j][z] > hi; }));
}
/** The common scale of the aftermath: wide enough for every cohort's middle 80% of closes, in shape heights. */
export function domainOf(conts) {
  let lo = -0.55; let hi = 1.55;
  for (const c of conts) if (c) for (const q of c.fan) { if (q[0] < lo) lo = q[0]; if (q[4] > hi) hi = q[4]; }
  lo = Math.max(-3.2, lo); hi = Math.min(4.2, hi); const pad = (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}

/**
 * One lane. `bars` are open-high-low-close rows already in shape units. `cont` is the cohort's continuation or null.
 * `next` is one recorded bar after a window, in shape units. `mark` is the one comparison a variant changes.
 * `pooled` and `diff` compare the cohort's closing states with the drawing's. Returns the geometry, for pointing.
 *
 * Every lane is drawn alike, whatever its height: the candles keep their proportions (a body is as wide as the lane
 * is tall allows), and each later bar has three cells, above the shape's high, inside it and below its low, each
 * filled from the left by the share of windows that closed there. So a share reads by length, down any column.
 */
export function drawLane(host, { bars, cont, states, next = null, domain, height, hero = false, pick = -1, direct = false, wait = false, why = '', numbers = false, mark = null, pooled = null, diff = null,
  holds = null, tints = null, frame = -1, bones = null, bonesOn = false, targets = false, pend = null, hot = null,
  given = NONE, path = null, overlay = null, col = 0, loose = false, dims = null, band = BAND }) {
  const W = Math.max(160, Math.floor(host.clientWidth)); const n = bars.length;
  // the dimension tracks take the foot of the lane; the candles and what followed them keep the rest, as they were
  const full = height; height = full - (dims || []).reduce((a, t) => a + t.height, 0);
  const sc = sceneFor(host, ['back', 'zones', 'fan', 'rails', 'candles', 'marks', 'knobs', 'text']); sc.size(W, full);
  const g = geom(W, n); const small = height < 112;
  const padT = hero ? 14 : small ? 6 : 12; const padB = hero ? 24 : small ? 6 : 12; const inner = Math.max(20, height - padT - padB);
  const to = (d) => (v) => padT + (1 - (v - d[0]) / (d[1] - d[0])) * inner;
  // `band` is the price range the drawn bars stand in, in shape units. It is BAND unless the bench holds the view steady
  // while a drawing is edited: then the same prices keep the same height however the shape's own range moves.
  const yb = to(band); const ya = to(domain); const clampA = (v) => Math.max(domain[0], Math.min(domain[1], v));
  const lastClose = bars[n - 1][3]; const text = [];
  sc.begin();
  sc.put('band', 'back', () => s('rect', { class: 'b-pattern' }), [g.band[0], 0, g.band[1] - g.band[0], full], setRect);
  // the two rails: the shape's high and low, carried through the lens into the aftermath
  for (const [key, v] of [['hi', 1], ['lo', 0]]) {
    sc.put('rail' + key, 'rails', () => s('polyline', { class: 'b-rail' }), [g.band[0], yb(v), g.band[1], yb(v), g.ax0, ya(v), W, ya(v)], setPoints);
  }
  // a body is never wider than the lane's height can carry: the shape keeps its proportions at any size
  const cw = Math.max(2.5, Math.min(46, g.bw * 0.46, inner * 0.15));
  bars.forEach(([o, hi, lo, c], i) => {
    sc.put('c' + i, 'candles', () => s('g', {}, s('line'), s('rect')), [g.xb(i), yb(hi), yb(lo), yb(Math.max(o, c)), yb(Math.min(o, c)), cw], setCandle,
      (c >= o ? 'b-up' : 'b-down') + ' b-in' + (small ? ' b-sm' : '') + (hero && i === pick ? ' b-pick' : ''));
    if (hero) {
      const knob = (k, x, y, cls) => sc.put(k + i, 'knobs', () => s('rect', { class: cls }), [x - 3, y - 3, 6, 6], setRect);
      if (!targets) {
        knob('kh', g.xb(i), yb(hi), 'b-knob'); knob('kl', g.xb(i), yb(lo), 'b-knob');
        sc.put('kc' + i, 'knobs', () => s('line', { class: 'b-tab' }), [g.xb(i) + cw / 2, yb(c), g.xb(i) + cw / 2 + 9, yb(c)], setLine);
        if (i === 0) sc.put('ko', 'knobs', () => s('line', { class: 'b-tab' }), [g.xb(0) - cw / 2 - 9, yb(o), g.xb(0) - cw / 2, yb(o)], setLine);
      }
      text.push(s('text', { class: 'b-axis' + (i === pick ? ' pick' : ''), x: g.xb(i), y: height - 7, 'text-anchor': 'middle' }, String(i + 1)));
    }
  });
  if (mark) {
    // the one comparison this shape changes: b's level carried across to a, a's level now, and where the drawing has it.
    // The bracket stands between the two bars, or in the gap after the last one, wherever there is room for the word.
    const xA = g.xb(mark.a.bar); const xB = g.xb(mark.b.bar); const yA = yb(mark.a.v); const yB = yb(mark.b.v);
    const side = mark.a.bar === n - 1 || mark.a.bar === mark.b.bar || xB > xA ? 1 : -1; const outer = mark.a.bar === mark.b.bar || (side > 0) !== (xB > xA);
    const bx = xA + side * (cw / 2 + 8); const end = bx + side * 4;
    const bEdge = mark.a.bar === mark.b.bar ? xA - (cw / 2 + 5) : xB + Math.sign(xA - xB) * (cw / 2 + 1);
    sc.put('mref', 'marks', () => s('line', { class: 'b-ref' }), [Math.min(bEdge, bx - 4), yB, Math.max(bEdge, bx + 4), yB], setLine);
    sc.put('mtb', 'marks', () => s('line', { class: 'b-now' }), [xB - cw / 2 - 4, yB, xB + cw / 2 + 4, yB], setLine);
    // the move: from where the drawing has a's level (dashed) to where this shape has it, across b's level
    const yG = mark.ghost !== null && Math.abs(yb(mark.ghost) - yA) >= 2 ? yb(mark.ghost) : yB;
    if (yG !== yB) sc.put('mwas', 'marks', () => s('line', { class: 'b-was' }), [xA - side * (cw / 2 + 4), yG, end, yG], setLine);
    sc.put('mnow', 'marks', () => s('line', { class: 'b-now' }), [xA - side * (cw / 2 + 4), yA, end, yA], setLine);
    sc.put('mgap', 'marks', () => s('line', { class: 'b-now thin' }), [bx, yG, bx, yA], setLine);
    const room = outer ? g.bw / 2 - cw / 2 - 14 + (mark.a.bar === n - 1 ? g.gap - 6 : g.bw / 2 - cw / 2 - 6) : Math.abs(xB - xA) - cw - 22;
    if (room >= 42) {
      const apart = Math.abs(yA - yB); const ty = apart >= 22 ? (yA + yB) / 2 + 3.5 : Math.min(yA, yB) - 5 < padT + 6 ? Math.max(yA, yB) + 12 : Math.min(yA, yB) - 5;
      text.push(s('text', { class: 'b-word', x: bx + side * 6, y: ty, 'text-anchor': side > 0 ? 'start' : 'end' }, mark.rel > 0 ? 'above' : mark.rel < 0 ? 'below' : 'level'));
    }
  }
  // ---- what is held on this shape. A relation is a hairline between its two endpoints with a knot at its middle;
  // a held colour is a knot on the body; the skeleton is the line through the swings it keeps in order.
  const knots = [];
  if (bones && bones.length > 1) {
    sc.put('bones' + bones.length, 'marks', () => s('polyline'), bones.flatMap(([i, v, edge]) => [g.xb(i) + (edge || 0) * cw / 2, yb(v)]), setPoints, 'b-bones' + (bonesOn ? ' on' : ''));
    bones.forEach(([i, v, edge], k) => { if (!edge) sc.put('bone' + k, 'marks', () => s('rect'), [g.xb(i) - 2, yb(v) - 2, 4, 4], setRect, 'b-bone' + (bonesOn ? ' on' : '')); });
  }
  for (const [k, hd] of (holds || []).entries()) {
    const xA = g.xb(hd.a.bar); const xB = g.xb(hd.b.bar); const yA = yb(hd.a.v); const yB = yb(hd.b.v); let kx; let ky; const cls = 'b-hold' + (hd.on ? ' on' : '');
    if (hd.a.bar === hd.b.bar) {
      // two levels of one bar: a bracket beside it
      const x0 = xA + cw / 2 + 2; const x1 = xA + cw / 2 + 8;
      sc.put('hold' + hd.key, 'marks', () => s('polyline'), [x0, yA, x1, yA, x1, yB, x0, yB], setPoints, cls + ' open');
      kx = x1; ky = (yA + yB) / 2;
    } else {
      const sd = Math.sign(xB - xA); const x0 = xA + sd * (cw / 2 + 3); const x1 = xB - sd * (cw / 2 + 3);
      sc.put('hold' + hd.key, 'marks', () => s('polyline'), [xA + sd * (cw / 2), yA, x0, yA, x1, yB, xB - sd * (cw / 2), yB], setPoints, cls + ' open');
      // knots of relations between the same two bars sit apart along their lines
      const at = 0.5 + (((k % 3) - 1) * 0.16); kx = x0 + (x1 - x0) * at; ky = yA + (yB - yA) * at;
    }
    sc.put('knot' + hd.key, 'knobs', () => s('rect'), [kx - 3, ky - 3, 6, 6], setRect, 'b-holdknot' + (hd.on ? ' on' : ''));
    knots.push({ key: hd.key, pin: hd.pin, x: kx, y: ky });
    if (hd.on && hero) text.push(s('text', { class: 'b-word', x: kx + 8, y: ky + 3.5 }, hd.rel > 0 ? 'above' : hd.rel < 0 ? 'below' : 'level'));
  }
  for (const tn of tints || []) {
    const [o, , , c] = bars[tn.bar]; const kx = g.xb(tn.bar); const ky = (yb(o) + yb(c)) / 2;
    sc.put('tint' + tn.key, 'knobs', () => s('rect'), [kx - 3.5, ky - 3.5, 7, 7], setRect, 'b-holdknot tint' + (tn.on ? ' on' : ''));
    knots.push({ key: tn.key, pin: tn.pin, x: kx, y: ky });
  }
  if (frame >= 0 && bars[frame]) {
    const [o, , , c] = bars[frame]; const top = yb(Math.max(o, c)); const bot = yb(Math.min(o, c));
    sc.put('frame', 'marks', () => s('rect', { class: 'b-frame' }), [g.xb(frame) - cw / 2 - 4, top - 4, cw + 8, Math.max(1, bot - top) + 8], setRect);
  }
  if (targets) {
    // hold mode: every endpoint of the drawing is a point to pick, and a body stands for its colour
    bars.forEach(([o, hi, lo, c], i) => {
      const lv = { H: hi, T: Math.max(o, c), B: Math.min(o, c), L: lo };
      if (hot?.kind === 'body' && hot.bar === i) sc.put('tb', 'marks', () => s('rect', { class: 'b-bodyhit' }), [g.xb(i) - cw / 2 - 3, yb(lv.T) - 3, cw + 6, Math.max(1, yb(lv.B) - yb(lv.T)) + 6], setRect);
      for (const part of ['H', 'T', 'B', 'L']) {
        if (part === 'B' && lv.B === lv.T) continue;
        const isPend = !!pend && pend.bar === i && pend.part === part; const isHot = hot?.kind === 'end' && hot.bar === i && hot.part === part;
        sc.put(`tg${i}${part}`, 'knobs', () => s('rect'), [g.xb(i) - 3.5, yb(lv[part]) - 3.5, 7, 7], setRect, 'b-target' + (isPend ? ' pend' : isHot ? ' hot' : ''));
      }
    });
    // the relation being made: from the first point to wherever the pointer is
    if (pend && hot?.kind === 'end' && !(hot.bar === pend.bar && hot.part === pend.part)) {
      const lvl = (bi, part) => { const [o, hi, lo, c] = bars[bi]; return part === 'H' ? hi : part === 'L' ? lo : part === 'T' ? Math.max(o, c) : Math.min(o, c); };
      sc.put('making', 'marks', () => s('line', { class: 'b-hold on' }), [g.xb(pend.bar), yb(lvl(pend.bar, pend.part)), g.xb(hot.bar), yb(lvl(hot.bar, hot.part))], setLine);
    }
  }
  // Three slim tracks per later bar, held to the rails: above the shape's high, between the rails, below its low.
  // Each fills from the left by the share of windows that closed there, so shares compare by length down a column.
  // A picked cell is a condition: it carries the selection, and the other two cells of its bar are ruled out.
  let tracks = null;
  if (cont || path) {
    const top = ya(domain[1]); const yh = ya(1); const yl = ya(0); const bot = ya(domain[0]);
    const T = small ? 7 : numbers ? 17 : 11; const fit = (room) => Math.max(1, Math.min(T, room));
    tracks = [[yh - 1 - fit(yh - top - 2), fit(yh - top - 2)], [(yh + yl) / 2 - fit(yl - yh - 4) / 2, fit(yl - yh - 4)], [yl + 1, fit(bot - yl - 2)]];
    const mid = (z) => tracks[z][0] + tracks[z][1] / 2;
    for (let j = 1; j <= AFTER; j++) {
      const [x0, w] = g.cell(j); const pz = 'UID'.indexOf(given[j - 1]); const on = path ? 'UID'.indexOf(path[j - 1]) : -1;
      sc.put('col' + j, 'back', () => s('rect'), [x0, top, w, bot - top], setRect, j === col ? 'b-col on' : 'b-col');
      for (let z = 0; z < 3; z++) {
        const [y0, hh] = tracks[z]; const share = path ? +(on === z) : states ? states[j - 1][z] : 0; const off = !path && !!states && !!diff && diff[j - 1][z];
        sc.put(`w${z}.${j}`, 'zones', () => s('rect'), [x0, y0, w, hh], setRect, pz >= 0 && pz !== z ? 'b-wash out' : 'b-wash');
        if (path || states) sc.put(`s${z}.${j}`, 'zones', () => s('rect'), [x0, y0, w * share, hh], setRect, path ? 'b-sharebar step' : off ? 'b-sharebar off' : 'b-sharebar');
        // the drawing's pooled share lies outside this cohort's 95% interval: the fill is stronger, and a tick says where the drawing has it
        if (off) sc.put(`p${z}.${j}`, 'zones', () => s('rect', { class: 'b-pool' }), [x0 + w * pooled[j - 1][z] - 0.5, y0 - 1, 1, hh + 2], setRect);
        if (numbers && states && !path && pz < 0 && w > 34 && hh >= 13) text.push(s('text', { class: 'b-share', x: x0 + w - 5, y: y0 + hh / 2 + 4, 'text-anchor': 'end' }, pc(share)));
      }
      if (pz >= 0) {
        const [y0, hh] = tracks[pz];
        sc.put('gv' + j, 'marks', () => s('rect', { class: 'b-given' }), [x0 + 0.5, y0 - 1.5, Math.max(1, w - 1), hh + 3], setRect);
        if (numbers && w > 34 && hh >= 13) text.push(s('text', { class: 'b-share given', x: x0 + w - 5, y: y0 + hh / 2 + 4, 'text-anchor': 'end' }, 'GIVEN'));
      }
    }
    const xs = [g.ax0, ...Array.from({ length: AFTER }, (_, k) => g.xa(k + 1))];
    if (cont && !path) {
      // the fan is the whole cohort's: the matcher keeps quantiles, not closes, so a pick cannot narrow it
      const q = (k) => [ya(clampA(lastClose)), ...cont.fan.map((r) => ya(clampA(r[k])))];
      const ring = (a, b) => [...xs.flatMap((x, k) => [x, a[k]]), ...xs.map((x, k) => [x, b[k]]).reverse().flat()];
      if (!small) sc.put('fanO', 'fan', () => s('polygon'), ring(q(4), q(0)), setPoints, loose ? 'b-fan outer loose' : 'b-fan outer');
      sc.put('fanI', 'fan', () => s('polygon'), ring(q(3), q(1)), setPoints, loose ? 'b-fan loose' : 'b-fan');
      sc.put('fanM', 'fan', () => s('polyline'), xs.flatMap((x, k) => [x, q(2)[k]]), setPoints, (small ? 'b-mid sm' : 'b-mid') + (loose ? ' loose' : ''));
    }
    // a closing path: one state per later bar, joined from the last close through the cells it passes
    const line = path || overlay;
    if (line) sc.put('path', 'marks', () => s('polyline'), [g.ax0, ya(clampA(lastClose)), ...[...line].flatMap((ch, k) => [xs[k + 1], mid('UID'.indexOf(ch))])], setPoints, path ? 'b-path' : 'b-path over');
  }
  // the last close, carried from the lens to where the continuation starts
  sc.put('link', 'rails', () => s('line', { class: 'b-link' }), [g.xb(n - 1) + cw / 2 + (hero ? 10 : 1), yb(lastClose), g.ax0, ya(clampA(lastClose))], setLine);
  if (next) {
    const [o, hi, lo, c] = next.map(clampA);
    sc.put('n1', 'candles', () => s('g', {}, s('line'), s('rect')), [g.xa(1), ya(hi), ya(lo), ya(Math.max(o, c)), ya(Math.min(o, c)), Math.max(2.5, Math.min(18, g.unit * 0.46, cw))], setCandle, (c >= o ? 'b-up' : 'b-down') + ' b-after' + (small ? ' b-sm' : ''));
  }
  // ---- one track for each dimension switched on, under the candles and on their columns. A mark is a level line
  // as wide as a body: marks at one height are level, and a higher mark is a higher rank. A dimension that is ranked
  // against zero has the zero line through its track.
  const dimGeo = []; let ty = height;
  for (const t of dims || []) {
    const [lo, hi] = t.scale || trackScale(t.marks, t.zero); const top = ty + TRACK_PAD; const room = t.height - 2 * TRACK_PAD; ty += t.height;
    const y = (level) => top + (1 - (level - lo) / (hi - lo)) * room; const mw = Math.max(7, Math.min(cw, g.bw * 0.62));
    sc.put('tr' + t.name, 'back', () => s('line', { class: 'b-track' }), [0, top - TRACK_PAD + 0.5, W, top - TRACK_PAD + 0.5], setLine);
    // the levels there are to stand on, as hairlines across the bars
    for (let level = Math.ceil(lo); level <= Math.floor(hi); level++) {
      if (t.zero && level === 0) continue;
      sc.put(`tl${t.name}.${level}`, 'back', () => s('line', { class: 'b-level' }), [g.band[0], y(level), g.band[1], y(level)], setLine);
    }
    if (t.zero) {
      sc.put('tz' + t.name, 'rails', () => s('line', { class: 'b-zero', 'data-dim': t.name }), [g.band[0], y(0), g.band[1] + 8, y(0)], setLine);
      text.push(s('text', { class: 'b-scale', x: g.band[1] + 12, y: y(0) + 3.5 }, '0'));
    }
    t.marks.forEach((level, i) => {
      sc.put(`tm${t.name}.${i}`, 'marks', () => s('line', { 'data-dim': t.name, 'data-bar': i + 1 }), [g.xb(i) - mw / 2, y(level), g.xb(i) + mw / 2, y(level)], setLine, 'b-dimmark' + (t.active ? ' on' : '') + (i === pick ? ' pick' : ''));
    });
    dimGeo.push({ name: t.name, zero: t.zero, y0: top - TRACK_PAD, height: t.height, lo, hi, y, levelAt: (py) => lo + (1 - (py - top) / room) * (hi - lo) });
  }
  sc.end();
  if (direct) sc.settle();
  // the rails are named in the gap between the lens and the aftermath, clear of the share tracks
  if (hero) text.push(s('text', { class: 'b-scale', x: W - 5, y: ya(1) - 26, 'text-anchor': 'end' }, 'SHAPE HIGH'), s('text', { class: 'b-scale', x: W - 5, y: ya(0) + 33, 'text-anchor': 'end' }, 'SHAPE LOW'));
  const say = !cont && !next && !path ? (wait ? 'SEARCHING' : why) : '';
  if (say) text.push(s('text', { class: 'b-scale', x: g.ax0 + (W - g.ax0) / 2, y: (ya(1) + ya(0)) / 2 + 4, 'text-anchor': 'middle' }, say));
  // a cohort the picks leave too few windows of: its cells stay, empty, and the reason is said under them
  if (cont && !states && !path && why && tracks && !small) text.push(s('text', { class: 'b-scale', x: g.ax0 + 2, y: Math.min(height - 5, tracks[2][0] + tracks[2][1] + 15) }, why));
  sc.layers.text.replaceChildren(...text);
  /** The state cell under a point, if it is on one: { after, z } with z 0 above, 1 inside, 2 below. */
  const cellAt = (px, py) => {
    if (!tracks || px < g.ax0) return null;
    const j = Math.floor((px - g.ax0) / g.unit) + 1; if (j < 1 || j > AFTER) return null;
    const z = tracks.findIndex(([y0, hh]) => py >= y0 - 3 && py <= y0 + hh + 3);
    return z < 0 ? null : { after: j, z };
  };
  /** The dimension track under a point, if it is on one. */
  const dimAt = (py) => dimGeo.find((t) => py >= t.y0 && py < t.y0 + t.height) || null;
  return { g, yb, ya, cw, padT, inner, height: full, n, knots, cellAt, dims: dimGeo, dimAt, band, price: (y) => band[0] + (1 - (y - padT) / inner) * (band[1] - band[0]) };
}

/** Column labels: the drawn bars by number, then the bars after them. */
export function drawAxis(host, { n, pick }) {
  const W = Math.max(160, Math.floor(host.clientWidth)); const svg = s('svg', { viewBox: `0 0 ${W} 29`, width: W, height: 29, role: 'img' }); host.replaceChildren(svg);
  const g = geom(W, n);
  svg.append(s('rect', { class: 'b-pattern', x: g.band[0], y: 0, width: g.band[1] - g.band[0], height: 29 }));
  if (g.bw >= 44) for (let i = 0; i < n; i++) svg.append(s('text', { class: 'b-axis on' + (i === pick ? ' pick' : ''), x: g.xb(i), y: 18, 'text-anchor': 'middle' }, `BAR ${i + 1}`));
  else svg.append(s('text', { class: 'b-axis on', x: (g.band[0] + g.band[1]) / 2, y: 18, 'text-anchor': 'middle' }, `SHAPE · ${n} BARS`));
  for (let j = 1; j <= AFTER; j++) svg.append(s('text', { class: 'b-axis', x: g.xa(j), y: 18, 'text-anchor': 'middle' }, `+${j}`));
}

/**
 * The column track for the selected lane, on the canvas's own columns. Under each drawn bar, one reading: the
 * cohort's value, every window's, and a meter of the standardized difference from the tick that stands for all
 * windows. Under each later bar, the three closing states as the lanes draw them, with their shares.
 */
export function drawColumnTrack(host, { n, readings, states, given = NONE, cells = false, col = 0, height = 61 }) {
  const W = Math.max(160, Math.floor(host.clientWidth)); const sc = sceneFor(host, ['back', 'bars', 'text']); sc.size(W, height);
  const g = geom(W, n); const text = []; const my = height - 13;
  sc.begin();
  sc.put('band', 'back', () => s('rect', { class: 'b-pattern' }), [g.band[0], 0, g.band[1] - g.band[0], height], setRect);
  readings.forEach((r, i) => {
    if (!r) return;
    const cx = g.xb(i); const half = Math.max(5, Math.min(46, g.bw / 2 - 7)); const d = Math.max(-1, Math.min(1, r.d / 0.6)); const len = Math.abs(d) * half;
    sc.put('t' + i, 'back', () => s('line', { class: 'b-track' }), [cx - half, my, cx + half, my], setLine);
    sc.put('r' + i, 'bars', () => s('rect'), [d >= 0 ? cx : cx - len, my - 2, len, 5], setRect, d >= 0 ? 'b-bar' : 'b-bar below');
    sc.put('a' + i, 'bars', () => s('rect', { class: 'b-all' }), [cx - 0.5, my - 5, 1, 11], setRect);
    if (g.bw >= 40) text.push(s('text', { class: 'b-num', x: cx, y: 16, 'text-anchor': 'middle' }, r.text));
    if (g.bw >= 76) text.push(s('text', { class: 'b-num dim', x: cx, y: 30, 'text-anchor': 'middle' }, `all ${r.all}`));
  });
  const rowH = (height - 9) / 3;
  if (states || cells) {
    for (let j = 1; j <= AFTER; j++) {
      const [x0, w] = g.cell(j); const pz = 'UID'.indexOf(given[j - 1]);
      if (j === col) sc.put('col', 'back', () => s('rect', { class: 'b-col on' }), [x0, 2, w, height - 4], setRect);
      for (let z = 0; z < 3; z++) {
        const y0 = 5 + z * rowH; const share = states ? states[j - 1][z] : 0;
        sc.put(`w${z}.${j}`, 'back', () => s('rect'), [x0, y0, w, rowH - 1], setRect, pz >= 0 && pz !== z ? 'b-wash out' : 'b-wash');
        if (states) sc.put(`s${z}.${j}`, 'bars', () => s('rect', { class: 'b-sharebar' }), [x0, y0, w * share, rowH - 1], setRect);
        if (pz === z) sc.put('gv' + j, 'bars', () => s('rect', { class: 'b-given' }), [x0 + 0.5, y0 - 0.5, Math.max(1, w - 1), rowH], setRect);
        if (w >= 34 && (states || pz === z)) text.push(s('text', { class: 'b-num' + (pz === z ? ' given' : ''), x: x0 + w - 4, y: y0 + rowH / 2 + 3, 'text-anchor': 'end' }, pz === z ? 'GIVEN' : pc(share)));
      }
    }
  }
  sc.end();
  sc.layers.text.replaceChildren(...text);
  /** The state cell of a later bar under a point of the track: { after, z }. */
  g.cellAt = (px, py) => { if (px < g.ax0) return null; const j = Math.floor((px - g.ax0) / g.unit) + 1; const z = Math.floor((py - 5) / rowH); return j >= 1 && j <= AFTER && z >= 0 && z <= 2 ? { after: j, z } : null; };
  return g;
}

/** A small drawing of a run of bars, for the catalogue. */
export function drawGlyph(host, rows, w = 34, height = 26) {
  const svg = s('svg', { class: 'glyph', viewBox: `0 0 ${w} ${height}`, width: w, height }); host.replaceChildren(svg);
  if (!rows?.length) return;
  let lo = Infinity; let hi = -Infinity; for (const [, h, l] of rows) { if (l < lo) lo = l; if (h > hi) hi = h; }
  const y = (v) => 2 + (1 - (v - lo) / (hi - lo || 1)) * (height - 4); const step = w / (rows.length + 1); const bw = Math.min(7, step * 0.56);
  rows.forEach(([o, h, l, c], k) => {
    const cx = step * (k + 1); const top = y(Math.max(o, c)); const bot = y(Math.min(o, c));
    svg.append(s('g', { class: (c >= o ? 'b-up' : 'b-down') + ' b-in' }, s('line', { x1: cx, x2: cx, y1: y(h), y2: y(l) }), s('rect', { x: cx - bw / 2, y: top, width: bw, height: Math.max(1, bot - top) })));
  });
}

/**
 * One recorded window that took a closing path: its six later bars in the shape's own scale, between the rails
 * that stand for the shape's high and low. `example` is { bars: open-high-low-close rows, start: the last close }.
 */
export function drawExample(host, example, w = 252, height = 92) {
  const svg = s('svg', { class: 'example', viewBox: `0 0 ${w} ${height}`, width: w, height, role: 'img' }); host.replaceChildren(svg);
  if (!example?.bars?.length) return;
  let lo = Math.min(-0.15, example.start); let hi = Math.max(1.15, example.start);
  for (const [, h, l] of example.bars) { if (l < lo) lo = l; if (h > hi) hi = h; }
  const y = (v) => 5 + (1 - (v - lo) / (hi - lo || 1)) * (height - 10); const step = (w - 26) / AFTER; const bw = Math.min(13, step * 0.46);
  for (const v of [1, 0]) svg.append(s('line', { class: 'b-rail', x1: 0, x2: w, y1: f1(y(v)), y2: f1(y(v)) }));
  svg.append(s('line', { class: 'b-link', x1: 0, x2: 26, y1: f1(y(example.start)), y2: f1(y(example.start)) }));
  example.bars.forEach(([o, h, l, c], k) => {
    const cx = 26 + step * (k + 0.5); const top = y(Math.max(o, c)); const bot = y(Math.min(o, c));
    svg.append(s('g', { class: (c >= o ? 'b-up' : 'b-down') + ' b-in b-sm' }, s('line', { x1: f1(cx), x2: f1(cx), y1: f1(y(h)), y2: f1(y(l)) }), s('rect', { x: f1(cx - bw / 2), y: f1(top), width: f1(bw), height: f1(Math.max(1, bot - top)) })));
  });
}
