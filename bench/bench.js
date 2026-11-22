// Composer bench. One canvas locked on the drawn shape and what it became; rows are cohorts of that shape.
// Panels around it toggle: the named patterns, the inspector, and a drawer for windows, the g1 string and Limen.
import { h, mount, $, label, note, quiet, menu, popover, closeMenu, menuOpen } from './dom.js';
import { createModel, ohlc, extent, g1, namesOf, fromRows, chainBars, copyParams, moveParams, partPrice, PARTS, KIND_NAME, TF, TF_LONG, MIN_BARS, MAX_BARS, MAX_STRETCH, AFTER, NO_GIVEN } from './model.js';
import { createEngine } from './engine.js';
import { drawLane, drawAxis, drawColumnTrack, drawGlyph, drawExample, conditioned, sharesOf, domainOf, differsFrom } from './lanes.js';

// The other two aspects of the tool. On a vaquum.fi host they are the deployed sites behind the same Portal login.
const DEPLOYED = location.hostname.endsWith('.vaquum.fi');
const CUBE = DEPLOYED ? 'https://cube.vaquum.fi/' : 'http://localhost:8791/';
const QUERY = DEPLOYED ? 'https://query.vaquum.fi/' : 'http://localhost:8790/';

const saved = (() => { try { return JSON.parse(localStorage.getItem('composer.bench') || '{}'); } catch { return {}; } })();
const ui = { left: saved.left ?? false, right: saved.right ?? window.innerWidth >= 1100, drawer: saved.drawer ?? null };
const state = { rows: saved.rows ?? 'timeframes', track: saved.track ?? 'range', lane: 'draw', col: null, page: 0,
  sort: { key: 'rank', dir: 1 }, winPage: 0, catalog: '', frame: saved.frame ?? 2, message: '',
  hold: false, pend: null, hot: null,     // hold mode: picking points on the drawing; the first point picked; the point under the pointer or the keys
  seek: null };                           // a window picked in the drawer: the canvas turns to the page that holds it
const persist = () => { try { localStorage.setItem('composer.bench', JSON.stringify({ ...ui, rows: state.rows, track: state.track, frame: state.frame })); } catch { /* storage is optional */ } };
const model = createModel(); const M = model.state;

const int = (n) => Math.round(n).toLocaleString('en-US');
const pct = (v, d = 1) => (v * 100).toFixed(d) + '%';
const cap = (t) => t[0].toUpperCase() + t.slice(1);
const pad = (n) => String(n).padStart(2, '0');
const NWORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
const when = (t) => `${day.format(new Date(t * 1000))} ${clock.format(new Date(t * 1000))}`;
const READ = { vol: 'Volume', trades: 'Trades', size: 'Trade size', maker: 'Maker share', range: 'Range', body: 'Body', day: 'Close in prior-day range' };
const READ_NOTE = { vol: 'against the median of the 11 bars before', trades: 'against the median of the 11 bars before', size: 'USDT per trade, against the 11 bars before',
  maker: 'share of the bar’s volume recorded as maker', range: 'high to low, in ATR', body: 'open to close, in ATR', day: 'where the last bar closed in the prior UTC day’s range' };
const readText = (w, x) => (w.log ? `${Math.exp(x).toFixed(2)}×` : w.key === 'maker' ? pct(x) : w.key === 'day' ? pct(x, 0) : `${x.toFixed(2)} ATR`);

// ---------------------------------------------------------------- answers

const answers = new Map();
const remember = (key, r) => { if (answers.size > 60) answers.delete(answers.keys().next().value); answers.set(key, r); };
const keyOf = (q) => JSON.stringify([engine.state.readings === 'ready', q]);
let hero = null; let heroKey = ''; let wantKey = ''; let gen = 0; let progress = 0; let pendingRender = 0;
const fresh = () => !!hero && heroKey === wantKey;
let wasReady = false;
const engine = createEngine({ onState: (st) => {
  // the matcher counts the catalogue: a Patterns panel opened before the history was ready starts counting now
  if (st.ready && !wasReady) { wasReady = true; if (ui.left) countCatalogue(); }
  // the readings arrive after the bars: every answer so far lacks them, so the drawing is asked again
  if (st.readings === 'ready' && !wantKey.startsWith('[true')) { ask(); return; }
  renderBars(); statusLine();
} });

/** Ask the matcher about the drawing as it stands, then about each row's cohort. */
function ask() {
  const q = model.query(); const key = keyOf(q); wantKey = key;
  // every change is a new generation: an answer still on its way to an earlier drawing is dropped when it lands
  const mine = ++gen; engine.clear(); progress = 0;
  if (answers.has(key)) { hero = answers.get(key); heroKey = key; askLanes(); render(); return; }
  render();
  engine.query(q, { first: true, onProgress: (f) => { progress = f; statusLine(); } }).then((r) => {
    if (!r || mine !== gen) return;
    remember(key, r); hero = r; heroKey = key; askLanes(); render();
  });
}
function askLanes() {
  engine.clear('lanes'); const mine = gen;
  for (const spec of laneSpecs()) {
    if (!spec.q) continue;
    const key = keyOf(spec.q); if (answers.has(key)) continue;
    engine.query(spec.q, { group: 'lanes' }).then((r) => { if (!r) return; remember(key, r); if (mine === gen) later(); });
  }
}
const later = () => { if (!pendingRender) pendingRender = setTimeout(() => { pendingRender = 0; render(); }, 16); };

// ---------------------------------------------------------------- lanes

const partName = (bar, part) => {
  if (part === 0) return 'low'; if (part === 3) return 'high';
  if (!M.oriented) return part === 1 ? 'body bottom' : 'body top';
  const b = M.bars[bar]; if (!b || b.v[1] === b.v[2]) return 'open and close';
  return (part === 2) === (b.d === 'u') ? 'close' : 'open';
};
const relWord = (r) => (r > 0 ? 'above' : r < 0 ? 'below' : 'level with');
const variantText = (v) => `Bar ${(v.a >> 2) + 1} ${partName(v.a >> 2, v.a & 3)} ${relWord(v.rel)} bar ${(v.b >> 2) + 1} ${partName(v.b >> 2, v.b & 3)}`;

// ---- what is held, in words
const kindLevel = (row, kind) => { const [o, hi, lo, c] = row; return [o, hi, lo, c, Math.min(o, c), Math.max(o, c)][kind]; };
const holdText = (x) => (x.h.color ? `Bar ${x.h.bar + 1} ${x.h.dir > 0 ? 'closes up' : x.h.dir < 0 ? 'closes down' : 'closes where it opened'}`
  : `Bar ${x.h.a[0] + 1} ${KIND_NAME[x.h.a[1]]} ${relWord(x.h.rel)} bar ${x.h.b[0] + 1} ${KIND_NAME[x.h.b[1]]}`);
const sumOn = (a) => a.reduce((x, n, k) => x + (M.tfOn[k] ? n : 0), 0);
/**
 * What an answer counts. With nothing held it is the exact twins of the whole shape. With something held it is the
 * windows that keep every held relation; when none does (or none that does passes the next-bar filter) the matcher
 * falls back to the nearest windows, and those are never counted as holding.
 */
function tally(r, k = -1) {
  if (!r) return { mode: 'none', n: 0, raw: 0 };
  const of = (a) => (k >= 0 ? a[k] : sumOn(a));
  if (r.mode === 'nearest') return { mode: 'nearest', n: of(r.exactF), raw: of(r.exact) };
  return { mode: r.mode, n: r.mode === 'held' ? of(r.countsF) : 0, raw: of(r.counts) };
}
/** The held relations as lines of a ledger: each pin its own line, in order, then the skeleton as one. */
function ledger() {
  const held = model.held(); const groups = held.filter((x) => x.from === 'pin').map((x) => ({ id: 'pin' + x.pin, kind: x.h.color ? 'colour' : 'relation', items: [x], text: holdText(x), pin: x.pin }));
  const skel = held.filter((x) => x.from === 'skeleton');
  if (skel.length) groups.push({ id: 'skel', kind: 'skeleton', items: skel, text: `The skeleton: ${skel.length} ${skel.length === 1 ? 'relation' : 'relations'} between its swings` });
  return { held, groups };
}
function toggleHold(on) { state.hold = on ?? !state.hold; state.pend = null; state.hot = null; if (state.hold) state.lane = 'draw'; render(); }

/** The rows under the drawing, each with the question that fills it. */
function laneSpecs() {
  if (state.rows === 'timeframes') return TF.map((name, k) => (M.tfOn[k] ? { id: 'tf' + k, kind: 'tf', k, title: name, rows: ohlc(M.bars), q: model.query({ tfs: TF.map((_, j) => j === k) }) } : null)).filter(Boolean);
  if (state.rows === 'holds') {
    // each line keeps its own hold and every hold above it
    const { groups } = ledger(); const rows = ohlc(M.bars); let acc = [];
    if (!groups.length) return [{ id: 'offer', kind: 'offer', title: 'Nothing is held', rows }];
    return groups.map((gp, k) => { acc = acc.concat(gp.items.map((x) => x.h)); return { id: 'hold.' + gp.id, kind: 'hold', k, gp, title: gp.text, rows, q: model.query({ holds: acc.slice() }) }; });
  }
  if (state.rows === 'paths') {
    // one line per complete six-bar closing path of the drawing's cohort, as the picks leave it, most common first.
    // The paths are read from the drawing's answer, so they stay in place, dimmed with it, while a new one is on its way.
    if (!hero) return [];
    const cd = conditioned(hero.panes.cont, M.given); const rows = ohlc(M.bars);
    if (!cd || !cd.n) return [{ id: 'nopath', kind: 'nopath', title: 'No closing paths', rows }];
    return cd.sequences.map(([key, n], i) => ({ id: 'path' + key, kind: 'path', i, key, n, of: cd.n, base: cd.base, most: cd.sequences[0][1], title: pathText(key), rows }));
  }
  if (!hero || !fresh()) return [];
  if (state.rows === 'variants') return hero.panes.near.filter((v) => v.bars.length === M.bars.length).map((v, i) => ({ id: `var${v.a}.${v.b}.${v.rel}`, kind: 'variant', i, v, title: variantText(v), rows: v.bars, q: model.query({ rows: v.bars }) }));
  return hero.results.map((w, i) => ({ id: `win${w.tf}.${w.start}`, kind: 'window', i, w, title: `${w.tf} · ${when(w.end)}`, rows: w.drawn, next: w.next?.bar || null }));
}
// A drawn level of an open-high-low-close row: 0 low, 1 body bottom, 2 body top, 3 high, as the matcher numbers them.
const levelOf = (row, part) => (part === 0 ? row[2] : part === 3 ? row[1] : part === 1 ? Math.min(row[0], row[3]) : Math.max(row[0], row[3]));
/** The one comparison a variant changes: its two levels in the lane's own scale, and where the drawing has the first. */
function markOf(lane) {
  if (lane.kind === 'hold' && lane.gp.kind === 'relation') {
    const x = lane.gp.items[0].h; const ex = scaled(lane.rows);
    return { a: { bar: x.a[0], v: kindLevel(ex[x.a[0]], x.a[1]) }, b: { bar: x.b[0], v: kindLevel(ex[x.b[0]], x.b[1]) }, rel: x.rel, ghost: null };
  }
  if (lane.kind !== 'variant') return null;
  const v = lane.v; const ex = scaled(lane.rows); const own = scaled(ohlc(M.bars)); const A = v.a >> 2; const B = v.b >> 2;
  if (!ex[A] || !ex[B] || !own[A] || !own[B]) return null;
  const b = levelOf(ex[B], v.b & 3); const was = levelOf(own[A], v.a & 3) - levelOf(own[B], v.b & 3);
  return { a: { bar: A, v: levelOf(ex[A], v.a & 3) }, b: { bar: B, v: b }, rel: v.rel, ghost: Math.max(-0.24, Math.min(1.24, b + was)) };
}
const scaled = (rows, ext) => { const [lo, hi] = ext || extent(rows); const d = hi - lo || 1; return rows.map((r) => r.map((v) => (v - lo) / d)); };

function buildLanes() {
  const rows = ohlc(M.bars);
  const lanes = [{ id: 'draw', kind: 'draw', title: 'The drawing', rows, res: hero, wait: !fresh() }];
  for (const spec of laneSpecs()) lanes.push({ ...spec, res: spec.q ? answers.get(keyOf(spec.q)) || null : null, wait: spec.q ? !answers.has(keyOf(spec.q)) : false });
  // a ledger line keeps some of the line above it; the first is measured against every window that could match
  let prev = null;
  for (const l of lanes) if (l.kind === 'hold') {
    if (l.k === 0 && l.res) prev = l.res.filter ? l.res.base.pass : l.res.base.n;
    l.prev = prev; l.n = l.res ? tally(l.res).n : null; prev = l.n;
  }
  return lanes;
}
// a ledger line that no window keeps has no cohort: the matcher's nearest windows are not shown as if they held
const contOf = (lane) => (lane.kind === 'hold' && lane.res?.mode !== 'held' ? null : lane.res?.panes?.cont || null);

// ---- what is given: closing states picked for the later bars. A pick narrows every cohort to the complete windows
// that closed there; the matcher is not asked again, since each answer already counts every six-bar closing path.
const STATE = ['above', 'inside', 'below']; const STATE_LONG = ['above the shape’s high', 'inside the shape', 'below the shape’s low'];
const givenAny = () => M.given !== NO_GIVEN;
const givenList = (text = M.given) => [...text].map((ch, k) => (ch === '-' ? null : { j: k + 1, z: 'UID'.indexOf(ch) })).filter(Boolean);
const givenWords = (text = M.given) => givenList(text).map((x) => `+${x.j} ${STATE[x.z]}`).join(' · ');
const condOf = (lane) => conditioned(contOf(lane), M.given);
/** A share of n windows with its Wilson 95% interval, as the matcher writes one: null under 30 windows. */
const rateOf = (k, n) => (n >= 30 ? [k / n, ...wilson(k, n), n] : null);
/** Pick a closing state for later bar +j, or free the bar when it is the one already picked. */
function give(j, z) { model.give(j, z < 0 ? '-' : 'UID'[z]); state.message = ''; render(); }
/** A six-bar closing path in words: its runs, in order. */
function pathText(key) {
  const runs = []; for (const ch of key) { const z = 'UID'.indexOf(ch); if (runs.length && runs[runs.length - 1][0] === z) runs[runs.length - 1][1]++; else runs.push([z, 1]); }
  return runs.length === 1 ? `${cap(STATE[runs[0][0]])} throughout` : runs.map(([z, k], i) => `${i ? STATE[z] : cap(STATE[z])} ${k}`).join(' → ');
}

// Hold mode's picked point and the point under the pointer live on the drawing. When their bar is removed, or the
// hold a knot stood for is released, they go too: nothing may be read from a bar that is no longer there.
function tidyPicks() {
  const n = M.bars.length; const gone = (q) => !!q && ((q.bar !== undefined && q.bar >= n) || (q.kind === 'knot' && !M.pins[q.pin]));
  if (gone(state.pend)) state.pend = null;
  if (gone(state.hot)) state.hot = null;
}

let ctx = null;
function render() {
  tidyPicks();
  document.body.classList.toggle('holding', state.hold);
  $('#left').hidden = !ui.left; $('#right').hidden = !ui.right; $('#drawer').hidden = !ui.drawer;
  const lanes = buildLanes();
  ctx = { lanes, all: lanes, sel: null };
  renderBars(); renderCanvas(); renderLeft(); renderRight(); renderDrawer(); statusLine();
  try { history.replaceState(null, '', '#' + encode()); } catch { /* the address is optional */ }
}

// ---------------------------------------------------------------- address

// The model writes and reads the address: prices go out at full precision, so a link reopens the same shape.
const encode = () => model.address();
/** Leave what was picked or pointed at behind, and show the drawing as it now stands. */
function showDrawing() { state.lane = 'draw'; state.col = null; state.page = 0; state.seek = null; state.pend = null; state.hot = null; state.message = ''; }

// ---------------------------------------------------------------- bars

const NEXT = [['0', 'Any', 'Every window counts'], ['1,any', 'Closed higher', null], ['-1,any', 'Closed lower', null],
  ['1,bps,10', 'Up 10 bps or more', null], ['-1,bps,10', 'Down 10 bps or more', null], ['1,bps,25', 'Up 25 bps or more', null], ['-1,bps,25', 'Down 25 bps or more', null],
  ['1,atr,0.5', 'Up half an ATR or more', null], ['-1,atr,0.5', 'Down half an ATR or more', null], ['1,atr,1', 'Up one ATR or more', null], ['-1,atr,1', 'Down one ATR or more', null]];
const nextValue = () => (M.next.dir ? [M.next.dir, M.next.measure, ...(M.next.measure === 'any' ? [] : [M.next.measure === 'bps' ? M.next.bps : M.next.atr])].join(',') : '0');
const TRACKS = [['range', 'Range'], ['body', 'Body'], ['vol', 'Volume'], ['trades', 'Trades'], ['size', 'Trade size'], ['maker', 'Maker share']];
const ROWS = { timeframes: 'Timeframes', variants: 'One comparison away', windows: 'Matched windows', holds: 'Holds', paths: 'Closing paths' };

function edit(fn) { fn(); ask(); }
function renderBars() {
  const st = engine.state; const r = hero; const n = M.bars.length;
  $('#to-cube').href = CUBE; $('#to-cube').title = 'Open the Cube explorer'; $('#to-query').href = QUERY; $('#to-query').title = 'Open the query bench';
  $('#chip').textContent = st.ready ? `BTCUSDT · Binance · 15m to 4h · ${day.format(new Date(st.from * 1000))} to ${day.format(new Date(st.to * 1000))} · ${int(st.bars)} bars` : 'BTCUSDT · Binance · 15m to 4h';
  const rd = $('#readout'); rd.classList.toggle('stale', !fresh());
  if (!r) mount(rd, note(st.failed ? st.failed : st.ready ? 'Searching the history' : 'Loading the BTCUSDT history'));
  else {
    const p = r.panes; const c = tally(r); const k = r.holds; const rate = (v, text) => (v ? h('span', { class: 'sub' }, h('b', { class: 'fig' }, pct(v[0])), ' ' + text) : null);
    const every = k === 1 ? 'the hold' : `all ${k} holds`;
    // the count says what it counts: twins of the whole shape, windows that keep what is held, or nothing at all
    const lead = c.mode === 'nearest' ? [h('b', null, int(c.n)), note(c.n === 1 ? 'exact twin' : 'exact twins')]
      : c.mode === 'held' ? [h('b', null, int(c.n)), note(`${c.n === 1 ? 'window keeps' : 'windows keep'} ${every}`)]
        : [h('b', { class: 'none' }, '0'), note(c.raw ? `windows keep ${every} and pass the next-bar filter` : `windows keep ${every}`)];
    // with a later bar picked, the readout says how many windows closed there; the whole cohort's rates would misstate them
    const cd = conditioned(p.cont, M.given); const share = cd?.picks ? rateOf(cd.n, cd.base) : null;
    mount(rd, lead, p.kind === 'closest' ? note(c.mode === 'fallback' ? `· reading the ${int(p.n)} nearest windows instead` : `· reading the ${int(p.n)} closest windows`) : null,
      p.next || p.cont ? h('span', { class: 'sep' }) : null,
      cd?.picks ? [h('span', { class: 'sub', title: `${int(cd.n)} of ${int(cd.base)} complete windows closed where the picks say` }, `given ${givenList().length > 2 ? `${givenList().length} later bars` : givenWords()} `, h('b', { class: 'fig' }, int(cd.n)), ` of ${int(cd.base)}`), share ? h('span', { class: 'sub' }, h('b', { class: 'fig' }, pct(share[0]))) : null]
        : [rate(p.next, 'next bar up'), rate(p.cont?.aboveHigh, 'broke the high'), rate(p.cont?.belowLow, 'broke the low')]);
  }
  for (const b of document.querySelectorAll('.toggles button')) { const k = b.dataset.panel; b.setAttribute('aria-pressed', String(k === 'left' ? ui.left : k === 'right' ? ui.right : ui.drawer === k)); }
  const enc = (name, value, open, cls = '') => { const b = h('button', { class: 'enc ' + cls, type: 'button', 'data-menu': '1', 'data-enc': name, onclick: () => open(b) }, label(name), h('span', { class: 'val' }, value), h('i', null, '▼')); return b; };
  const on = M.tfOn.filter(Boolean).length;
  mount($('#encbar'),
    h('span', { class: 'enc step' }, label('Bars'),
      h('button', { type: 'button', title: 'Remove the last bar · −', 'aria-label': 'Remove the last bar', disabled: n <= MIN_BARS, onclick: () => model.remove() && ask() }, '−'),
      h('span', { class: 'val fig' }, String(n)),
      h('button', { type: 'button', title: 'Add a bar · +', 'aria-label': 'Add a bar', disabled: n >= MAX_BARS, onclick: () => model.add() && ask() }, '+')),
    enc('Colours', M.oriented ? 'Up and down' : 'Shape only', (b) => menu(b, { title: 'Colours', hint: 'Whether a window must rise and fall where the drawing does.', value: M.oriented,
      options: [{ value: true, label: 'Up and down', detail: 'Each bar’s direction is part of the shape' }, { value: false, label: 'Shape only', detail: 'Only the order of the prices counts' }], onChange: (v) => edit(() => { M.oriented = v; }) })),
    enc('Next bar', NEXT.find((x) => x[0] === nextValue())?.[1] || 'Custom', (b) => menu(b, { title: 'Next bar', hint: 'Keep only the windows whose next bar did this.', value: nextValue(),
      options: NEXT.map(([value, text, detail]) => ({ value, label: text, detail })), onChange: (v) => edit(() => { const a = v.split(','); M.next.dir = +a[0] || 0; M.next.measure = a[1] || 'any'; if (a[1] === 'bps') M.next.bps = +a[2]; if (a[1] === 'atr') M.next.atr = +a[2]; }) })),
    enc('Timeframes', on === 5 ? 'All five' : TF.filter((_, k) => M.tfOn[k]).join(', '), (b) => menu(b, { title: 'Timeframes', hint: 'Bars searched. The figure is the exact twins on each.', multi: true, value: TF.map((_, k) => k).filter((k) => M.tfOn[k]),
      options: TF.map((t, k) => ({ value: k, label: TF_LONG[k], figure: r ? int(tally(r, k).n) : '' })),
      // the bar is redrawn by the change, so the menu reopens on its new button
      onChange: (k) => { if (M.tfOn[k] && on === 1) return; M.tfOn[k] = !M.tfOn[k]; ask(); document.querySelector('[data-enc="Timeframes"]')?.click(); } })),
    enc('Holds', holdsValue(), (b) => holdsPopover(b)),
    h('button', { class: 'enc tog', type: 'button', 'aria-pressed': String(state.hold), title: 'Pick points on the drawing to hold · H', onclick: () => toggleHold() }, label('Hold mode'), h('span', { class: 'val' }, state.hold ? 'On' : 'Off')),
    enc('Given', givenValue(), (b) => givenPopover(b), givenAny() ? 'on' : ''),
    h('span', { class: 'gap' }),
    enc('Rows', ROWS[state.rows], (b) => menu(b, { title: 'Rows', hint: 'What each row under the drawing holds.', value: state.rows,
      options: [{ value: 'timeframes', label: 'Timeframes', detail: 'The same shape on each timeframe searched' },
        { value: 'variants', label: 'One comparison away', detail: 'Shapes that differ from the drawing in a single comparison' },
        { value: 'windows', label: 'Matched windows', detail: 'The closest recorded windows, one per row' },
        { value: 'holds', label: 'Holds', detail: 'One line per held relation, each keeping the ones above it' },
        { value: 'paths', label: 'Closing paths', detail: 'The six-bar closing paths of the cohort, most common first' }],
      onChange: (v) => { state.rows = v; state.lane = 'draw'; state.col = null; state.page = 0; persist(); askLanes(); render(); } }), 'right'),
    enc('Columns', TRACKS.find((t) => t[0] === state.track)[1], (b) => menu(b, { title: 'Column track', hint: 'The reading under each drawn bar, for the selected row against every window.', value: state.track,
      options: TRACKS.map(([value, text]) => ({ value, label: text, detail: cap(READ_NOTE[value]) })), onChange: (v) => { state.track = v; persist(); render(); } })),
    enc('Windows', String(M.x), (b) => menu(b, { title: 'Matched windows', hint: 'How many of the closest windows are listed.', value: M.x, options: [12, 24, 48].map((v) => ({ value: v, label: `${v} windows` })), onChange: (v) => edit(() => { M.x = v; }) })));
}

// What is held, as the terms bar says it.
function holdsValue() {
  const pins = M.pins.length; const any = pins || M.skel;
  return any ? [pins ? `${pins} pinned` : '', M.skel ? `skeleton ${M.skel}` : '', M.stretch ? `stretch ${M.stretch}` : ''].filter(Boolean).join(' · ') : 'None';
}
const reopenHolds = () => document.querySelector('[data-enc="Holds"]')?.click();
// What is given, as the terms bar says it.
function givenValue() { const list = givenList(); return !list.length ? 'Nothing' : list.length > 2 ? `${list.length} later bars` : givenWords(); }
/** The picks, in words, each with its release, and how many of the drawing's windows closed there. */
function givenPopover(anchor) {
  const list = givenList(); const cd = hero && fresh() ? conditioned(hero.panes.cont, M.given) : null;
  const change = (fn) => { if (fn() !== false) { render(); document.querySelector('[data-enc="Given"]')?.click(); } };
  const body = h('div', { class: 'holds' },
    list.map((x) => h('div', { class: 'hrow' }, h('span', { class: 'what' }, `Bar +${x.j} closed ${STATE_LONG[x.z]}`), h('button', { class: 'quiet', type: 'button', onclick: () => change(() => model.give(x.j, '-')) }, 'Release'))),
    !list.length ? h('div', { class: 'hrow none' }, h('span', { class: 'what' }, 'No later bar is picked')) : null,
    cd?.picks ? h('div', { class: 'hrow' }, h('span', { class: 'what' }, `${int(cd.n)} of ${int(cd.base)} complete windows closed there`), h('span', { class: 'fig' }, cd.base >= 30 ? pct(cd.n / cd.base) : '')) : null);
  const pop = popover(anchor, { title: 'Given', hint: 'Closing states picked for later bars. Every row then reads only the windows that closed there.', body,
    footer: [h('span', { class: 'note' }, 'Pick a cell of a later bar, or press 1 2 3 on a picked column'),
      list.length ? h('button', { class: 'quiet', type: 'button', onclick: () => change(() => model.giveAll(NO_GIVEN)) }, 'Release all') : null] });
  (pop.querySelector('.hrow button') || pop.querySelector('footer button'))?.focus({ preventScroll: true });
}
/** The holds, in words, each with its release; the skeleton and the stretch as steppers. */
function holdsPopover(anchor) {
  const { held, groups } = ledger(); const top = model.skelTop(); const any = held.length > 0;
  const change = (fn) => { if (fn() !== false) { ask(); reopenHolds(); } };
  const step = (text, value, down, up, canDown, canUp, tip) => h('div', { class: 'hrow', title: tip }, h('span', { class: 'what' }, text),
    h('span', { class: 'stepper' }, h('button', { type: 'button', 'aria-label': `Less: ${text}`, disabled: !canDown, onclick: down }, '−'), h('span', { class: 'fig' }, value), h('button', { type: 'button', 'aria-label': `More: ${text}`, disabled: !canUp, onclick: up }, '+')));
  const body = h('div', { class: 'holds' },
    groups.filter((g) => g.kind !== 'skeleton').map((g) => h('div', { class: 'hrow' }, h('span', { class: 'what' }, g.text), h('button', { class: 'quiet', type: 'button', onclick: () => change(() => model.unpin(g.pin)) }, 'Release'))),
    !M.pins.length ? h('div', { class: 'hrow none' }, h('span', { class: 'what' }, 'No point is pinned')) : null,
    step('Skeleton', M.skel ? `${M.skel} of ${top}` : 'Off', () => change(() => model.setSkel(M.skel - 1)), () => change(() => model.setSkel(M.skel + 1)), M.skel > 0, M.skel < top,
      M.skel ? `Holds ${held.filter((x) => x.from === 'skeleton').length} relations between the shape’s swings, its first open and its last close` : 'Hold the order of the shape’s swings: level 1 is its extremes, each further level adds smaller swings'),
    step('Stretch', any ? `${M.stretch} ${M.stretch === 1 ? 'bar' : 'bars'}` : '—', () => change(() => model.setStretch(M.stretch - 1)), () => change(() => model.setStretch(M.stretch + 1)), any && M.stretch > 0, any && M.stretch < MAX_STRETCH,
      any ? 'Recorded bars the drawn bars may skip between the first and the last' : 'Stretch only counts once something is held: with nothing held, windows are compared bar for bar'));
  const pop = popover(anchor, { title: 'Holds', hint: 'What a window must keep exactly. Everything not held is ranked by closeness.', body,
    footer: [h('button', { class: 'quiet', type: 'button', 'aria-pressed': String(state.hold), onclick: () => { closeMenu(); toggleHold(); } }, state.hold ? 'Leave hold mode · H' : 'Pick on the drawing · H'),
      any ? h('button', { class: 'quiet', type: 'button', onclick: () => change(() => model.clearHolds()) }, 'Release all') : null] });
  (pop.querySelector('.hrow button:not(:disabled)') || pop.querySelector('footer button'))?.focus({ preventScroll: true });
}

function statusLine() {
  const st = engine.state; const el = $('#status'); el.className = st.failed ? 'err' : '';
  el.textContent = st.failed ? st.failed : !st.ready ? 'Loading the history' : !fresh() ? `Searching ${Math.round(progress * 100)}%` : state.hold ? (state.pend ? 'Pick the second point · Esc to cancel' : 'Hold mode · pick two points, a body or a knot · Esc to leave') : state.message || `${hero.ms} ms${st.readings === 'ready' ? '' : st.readings === 'failed' ? ' · readings unavailable' : ' · readings loading'}`;
}

// ---------------------------------------------------------------- canvas

// Wilson 95% interval from the matcher: [share, low, high, windows], or null under 30 windows.
function rateCell(v, text, centred) {
  if (!v) return h('div', { title: 'Fewer than 30 windows: no rate is shown' }, h('b', { class: 'thin' }, '—'), h('small', null, h('span', { class: 'dim' }, 'under 30')));
  const meter = centred
    ? (() => { const d = (Math.max(-0.2, Math.min(0.2, v[0] - 0.5)) / 0.2) * 50; return h('div', { class: 'meter mid' }, h('i', { class: d < 0 ? 'below' : '', style: d >= 0 ? `left:50%;width:${d}%` : `left:${50 + d}%;width:${-d}%` })); })()
    : h('div', { class: 'meter' }, h('i', { style: `width:${Math.min(100, v[0] * 100)}%` }));
  return h('div', { title: `${pct(v[0])} of ${int(v[3])} windows ${text}. 95% interval ${pct(v[1])} to ${pct(v[2])}.` }, h('b', null, pct(v[0])), h('small', null, `${pct(v[1], 0)}–${pct(v[2], 0)}`), meter);
}
// A track whose second column must stay when the canvas is tight: a share that the count beside it is not without.
const lead2 = (cells) => Object.assign(cells, { lead2: true });
function laneTrack(lane) {
  if (lane.kind === 'window') {
    const w = lane.w; const nx = w.next;
    return [h('div', null, h('b', null, pct(w.off, 1)), h('small', null, 'off the shape')),
      h('div', null, h('b', null, w.flips ? String(w.flips) : 'exact'), h('small', null, w.flips ? 'flips' : 'order')),
      h('div', null, h('b', { class: nx && nx.bps < 0 ? 'neg' : '' }, nx ? `${nx.bps > 0 ? '+' : nx.bps < 0 ? '−' : ''}${Math.abs(nx.bps).toFixed(0)}` : '—'), h('small', null, nx ? 'next, bps' : w.nextWhy === 'gap' ? 'gap' : 'no next bar')),
      h('div', null, h('b', { class: nx && nx.atrx < 0 ? 'neg' : '' }, nx && nx.atrx === nx.atrx ? `${nx.atrx > 0 ? '+' : nx.atrx < 0 ? '−' : ''}${Math.abs(nx.atrx).toFixed(2)}` : '—'), h('small', null, 'next, ATR'))];
  }
  if (lane.kind === 'path') {
    // a closing path: the windows that took all six closes, as a share of the cohort the picks leave, and of the whole cohort
    return lead2([h('div', { title: `${int(lane.n)} complete windows closed this way at all six later bars` }, h('b', null, int(lane.n)), h('small', null, lane.n === 1 ? 'window' : 'windows'), h('div', { class: 'meter' }, h('i', { style: `width:${Math.min(100, (lane.n / Math.max(1, lane.most)) * 100)}%` }))),
      rateCell(rateOf(lane.n, lane.of), givenAny() ? 'that closed where the picks say took this whole path' : 'took this whole path'),
      givenAny() ? rateCell(rateOf(lane.n, lane.base), 'of the whole cohort took this whole path') : h('div')]);
  }
  if (lane.kind === 'nopath') return [];
  const r = lane.res; const p = r?.panes;
  if (lane.kind === 'offer') return [];
  if (!r) return [h('div', null, h('b', { class: 'thin' }, lane.kind === 'variant' ? int(lane.v.n) : '—'), h('small', null, lane.wait ? 'searching' : 'windows'))];
  const cd = condOf(lane);
  if (!cd && givenAny() && lane.kind !== 'window') {
    // picks are set but this cohort has no complete six-bar windows to narrow: nothing is read, and the cohort's own
    // rates are not shown under columns that now mean something else
    const none = () => h('div', { title: 'No complete windows here, so nothing can be read under the picks' }, h('b', { class: 'thin' }, '—'), h('small', null, h('span', { class: 'dim' }, 'no complete windows')));
    return lead2([none(), none(), none(), none()]);
  }
  if (cd && (cd.picks || state.rows === 'paths')) {
    // the picks narrow this cohort to the windows that closed there: the track reads those windows, not the cohort
    const count = h('div', { title: cd.picks ? `${int(cd.n)} of ${int(cd.base)} complete windows closed where the picks say` : `${int(cd.n)} windows have all six later bars` },
      h('b', { class: cd.n < 30 ? 'thin' : '' }, int(cd.n)), h('small', null, cd.picks ? 'given' : 'complete'), h('div', { class: 'meter' }, h('i', { style: `width:${Math.min(100, (cd.n / Math.max(1, cd.base)) * 100)}%` })));
    if (state.rows === 'paths') return lead2([count, h('div', { title: 'Every one of them took one of the paths below' }, h('b', { class: 'thin' }, '100%'), h('small', null, 'all paths')), cd.picks ? rateCell(rateOf(cd.n, cd.base), 'closed where the picks say') : h('div')]);
    return lead2([count, rateCell(rateOf(cd.n, cd.base), 'closed where the picks say'),
      rateCell(rateOf(cd.grid[AFTER - 1][0], cd.n), `that closed there closed bar +${AFTER} above the shape’s high`), rateCell(rateOf(cd.grid[AFTER - 1][2], cd.n), `that closed there closed bar +${AFTER} below the shape’s low`)]);
  }
  if (lane.kind === 'hold') {
    // a ledger line: the windows that keep this hold and those above it, and how much of the line above that is
    const kept = lane.prev ? Math.min(1, lane.n / lane.prev) : null; const none = r.mode !== 'held'; const no = () => h('div', { title: 'No window keeps these relations: nothing is estimated' }, h('b', { class: 'thin' }, '—'), h('small', null, h('span', { class: 'dim' }, 'none hold')));
    return [h('div', { title: `${int(lane.n)} windows keep this and every hold above it${lane.prev ? `, of ${int(lane.prev)} on the line above` : ''}` },
      h('b', { class: none ? 'thin' : '' }, int(lane.n)), h('small', null, kept === null ? 'windows' : kept >= 0.9995 ? 'all kept' : `${pct(kept, kept < 0.1 ? 1 : 0)} kept`), h('div', { class: 'meter' }, h('i', { style: `width:${Math.min(100, (kept ?? 1) * 100)}%` }))),
    none ? no() : rateCell(p.cont?.aboveHigh, 'traded above the shape’s high within six bars'), none ? no() : rateCell(p.cont?.belowLow, 'traded below the shape’s low within six bars'), none ? no() : rateCell(p.next, 'closed higher on the next bar', true)];
  }
  const n = p.n; const base = Math.max(1, hero?.panes?.n || n);
  return [h('div', { title: p.kind === 'closest' ? (r.mode === 'fallback' ? 'No window keeps every held relation: these are the nearest windows instead' : 'Fewer than 30 exact twins: these are the closest windows instead') : p.kind === 'hold' ? 'Windows that keep every held relation' : 'Windows with exactly this shape' },
    // closest windows are neither twins nor holding: the count says so itself, since the small line under it is dropped when room is short
    h('b', { class: p.kind === 'closest' ? 'thin' : '' }, (p.kind === 'closest' ? '≈' : '') + int(n)), h('small', null, p.kind === 'closest' ? (r.mode === 'fallback' ? 'nearest' : 'closest') : p.kind === 'hold' ? (n === 1 ? 'holds' : 'hold') : n === 1 ? 'twin' : 'twins'), h('div', { class: 'meter' }, h('i', { style: `width:${Math.min(100, (n / base) * 100)}%` }))),
  rateCell(p.cont?.aboveHigh, 'traded above the shape’s high within six bars'), rateCell(p.cont?.belowLow, 'traded below the shape’s low within six bars'), rateCell(p.next, 'closed higher on the next bar', true)];
}

/** The held relations a nearest window does not keep, in words. The matcher reports them only when nothing holds. */
function brokenOf(w) { if (!w.broken?.length || !fresh()) return []; const held = model.held(); return w.broken.map((i) => (held[i] ? holdText(held[i]) : null)).filter(Boolean); }
function putOnCanvas(rows, message) {
  model.setBars(fromRows(rows)); M.sel = M.bars.length - 1; state.lane = 'draw'; state.col = null; state.message = message || ''; ask();
}
function laneHead(lane) {
  const head = (no, name, text, receipt, actions = []) => [h('span', { class: 'no' }, no || ''), h('span', { class: 'role' }, label(name), actions.length ? h('span', { class: 'acts' }, actions) : null),
    h('div', { class: 'texts' }, h('div', { class: 'text' }, text)), receipt ? h('div', { class: 'foot-line' }, h('span', { class: 'receipt' }, receipt)) : null];
  if (lane.kind === 'draw') {
    const names = namesOf(M.bars, M.oriented); const n = M.bars.length;
    return head('01', 'Shape', names.length ? names.slice(0, 2).map((x) => x.p.name).join(' · ') : `${cap(NWORD[n] || String(n))}-bar shape`, g1(M.bars, M.oriented),
      [quiet('Undo', () => model.undo() && ask(), 'Undo the last change · ⌘Z'), quiet('Flip', () => { model.flip(); ask(); }, 'Trade the first bar’s open and close · Space'),
        h('button', { class: 'quiet', type: 'button', 'aria-pressed': String(state.hold), title: 'Pick points on the drawing to hold · H', onclick: (e) => { e.stopPropagation(); toggleHold(); } }, 'Hold')]);
  }
  if (lane.kind === 'path') return head(pad(lane.i + 1), 'Path', lane.title, `${int(lane.n)} of ${int(lane.of)} windows`,
    [quiet('Given this path', () => { model.giveAll(lane.key); state.lane = 'draw'; state.col = null; render(); }, 'Pick this path’s close at every later bar')]);
  if (lane.kind === 'nopath') { const none = !hero?.panes?.cont; return head('', 'Paths', none ? 'No closing paths' : 'No window closed there', none ? 'Fewer than 30 complete windows' : 'No complete window closed where every pick says',
    givenAny() ? [quiet('Release the picks', () => { model.giveAll(NO_GIVEN); render(); }, 'Free every later bar')] : []); }
  if (lane.kind === 'offer') return head('', 'Holds', 'Nothing is held', 'Every window is ranked by how close it looks',
    [quiet('Pick on the drawing', () => toggleHold(true), 'Pick two points to hold their relation, or a body to hold its colour · H'), model.skelTop() ? quiet('Hold the skeleton', () => { if (model.setSkel(1)) ask(); }, 'Hold the order of the shape’s extremes') : null]);
  if (lane.kind === 'hold') {
    const gp = lane.gp; const same = lane.res && lane.prev !== null && lane.n === lane.prev;
    const receipt = !lane.res || lane.prev === null ? null : lane.res.mode !== 'held' ? (lane.res.mode === 'fallback' && tally(lane.res).raw ? 'Windows keep it, but none passes the next-bar filter' : 'No window keeps it with the holds above') : same ? 'Removes nothing: every window above already keeps it' : `${int(lane.prev - lane.n)} windows removed`;
    return head(pad(lane.k + 1), gp.kind === 'skeleton' ? 'Skeleton' : gp.kind === 'colour' ? 'Held colour' : 'Held', gp.text, receipt,
      gp.kind === 'skeleton' ? [M.skel < model.skelTop() ? quiet('Finer', () => { if (model.setSkel(M.skel + 1)) ask(); }, 'Add the next smaller swings') : null, M.skel > 1 ? quiet('Coarser', () => { if (model.setSkel(M.skel - 1)) ask(); }, 'Keep only the larger swings') : null, quiet('Release', () => { if (model.setSkel(0)) ask(); }, 'Stop holding the skeleton')]
        : [quiet('Release', () => { if (model.unpin(gp.pin)) ask(); }, 'Stop holding this')]);
  }
  if (lane.kind === 'tf') { const c = lane.res ? tally(lane.res, lane.k) : null; const all = tally(hero).n; const word = c?.mode === 'nearest' ? 'twins' : 'holding'; return head(lane.title, 'Timeframe', TF_LONG[lane.k], !c ? null : c.mode === 'fallback' ? 'None holds here: the nearest windows instead' : `${int(c.n)} of ${int(all || c.n)} ${word}`,
    [quiet('Only this', () => edit(() => { M.tfOn = TF.map((_, j) => j === lane.k); }), 'Search this timeframe alone'), M.tfOn.filter(Boolean).length > 1 ? quiet('Leave out', () => edit(() => { M.tfOn[lane.k] = false; }), 'Stop searching this timeframe') : null]); }
  if (lane.kind === 'variant') {
    const v = lane.v; const shortWord = (r) => (r > 0 ? 'above' : r < 0 ? 'below' : 'level');
    return head(pad(lane.i + 1), 'One away', [`Bar ${(v.a >> 2) + 1} ${partName(v.a >> 2, v.a & 3)} `, h('span', { class: 'was' }, shortWord(v.was)), h('span', { class: 'to' }, ' → '), h('span', { class: 'now' }, relWord(v.rel)), ` bar ${(v.b >> 2) + 1} ${partName(v.b >> 2, v.b & 3)}`],
      `${int(v.n)} windows have it ${relWord(v.rel)}`, [quiet('Put on canvas', () => putOnCanvas(lane.v.bars), 'Replace the drawing with this shape')]);
  }
  const breaks = brokenOf(lane.w);
  return head(lane.w.tf, breaks.length ? 'Window · breaks a hold' : 'Window', when(lane.w.end), breaks.length ? `Breaks: ${breaks.join(' · ')}` : `${pct(lane.w.off, 1)} off · ${lane.w.flips ? lane.w.flips + ' flips' : 'exact order'}`, [quiet('Put on canvas', () => putOnCanvas(lane.w.drawn), 'Replace the drawing with these bars')]);
}

// A row's node is kept by its place, not by what it shows: when the rows change, each drawing stays and its marks
// move to the new cohort, so the canvas re-sorts instead of being redrawn.
const nodes = new Map();
function nodeFor(id) {
  if (nodes.has(id)) return nodes.get(id);
  const n = { head: h('div', { class: 'lane-head' }), svgHost: h('div', { class: 'lane-svg' }), track: h('div', { class: 'lane-track cols' }), lane: null, geo: null, hCur: null, hVel: 0, hTarget: null };
  n.el = h('div', { class: 'lane row3', tabindex: '0' }, n.head, n.svgHost, n.track);
  n.born = !document.hidden;
  n.el.addEventListener('click', (e) => {
    if (e.target.closest('button, input, a') || n.dragged) { n.dragged = false; return; }
    const onCanvas = !!e.target.closest('.lane-svg'); const cell = onCanvas ? cellOf(n, e) : null;
    // a state cell of a later bar is a pick: every row then reads the windows that closed there
    if (cell) { state.lane = n.lane.id; state.col = { after: cell.after }; give(cell.after, cell.z); return; }
    selectLane(n.lane, onCanvas ? columnAt(n, e) : undefined);
  });
  n.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === n.el) selectLane(n.lane); });
  n.svgHost.addEventListener('mousemove', (e) => hover(n, e));
  n.svgHost.addEventListener('pointerdown', (e) => { if (n.lane.kind !== 'draw') return; if (state.hold) holdDown(n, e); else heroDown(n, e); });
  nodes.set(id, n);
  return n;
}
const columnAt = (n, e) => (n.geo ? n.geo.g.at(e.clientX - n.svgHost.getBoundingClientRect().left) : null);
/** The state cell under the pointer, on the drawing's row or the selected one: compact rows are selected first. */
function cellOf(n, e) {
  const lane = n.lane; if (!n.geo?.cellAt || state.hold || !contOf(lane) || !(lane.kind === 'draw' || lane.id === state.lane)) return null;
  const box = n.svgHost.getBoundingClientRect(); return n.geo.cellAt(e.clientX - box.left, e.clientY - box.top);
}
const sameCol = (a, b) => !!a && !!b && a.bar === b.bar && a.after === b.after;

// Lane heights move on the same spring as the marks. Reduced motion and hidden pages get the heights at once.
const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
const springs = { raf: 0, last: 0, seen: 0, watch: 0 };
// Browsers stop animation frames for pages that are not on screen. A lane left half way would misstate the layout,
// so the heights are set outright whenever frames have stalled.
function watchHeights() {
  springs.watch = 0;
  if (!springs.raf) return;
  if (performance.now() - springs.seen > 160) { cancelAnimationFrame(springs.raf); springs.raf = 0; springs.last = 0; settleHeights(); } else springs.watch = setTimeout(watchHeights, 220);
}
function stepHeights(now) {
  const dt = Math.min(0.034, springs.last ? (now - springs.last) / 1000 : 0.016); springs.last = now; springs.seen = performance.now(); let moving = false;
  for (const n of nodes.values()) {
    if (n.hTarget === null) continue;
    const d = n.hCur - n.hTarget;
    if (Math.abs(d) < 0.4 && Math.abs(n.hVel) < 3) { if (d) { n.hCur = n.hTarget; n.el.style.height = n.hTarget + 'px'; } n.hVel = 0; continue; }
    n.hVel += (-180 * d - 24 * n.hVel) * dt; n.hCur += n.hVel * dt; n.el.style.height = n.hCur.toFixed(1) + 'px'; moving = true;
  }
  if (moving && !document.hidden) springs.raf = requestAnimationFrame(stepHeights); else { springs.raf = 0; springs.last = 0; if (moving) settleHeights(); }
}
function settleHeights() { for (const n of nodes.values()) if (n.hTarget !== null) { n.hCur = n.hTarget; n.hVel = 0; n.el.style.height = n.hTarget + 'px'; } }
function setHeight(n, px) {
  n.hTarget = px;
  if (n.hCur === null || calm.matches || document.hidden) { n.hCur = px; n.hVel = 0; n.el.style.height = px + 'px'; return; }
  if (!springs.raf) { springs.seen = performance.now(); springs.raf = requestAnimationFrame(stepHeights); }
  if (!springs.watch) springs.watch = setTimeout(watchHeights, 220);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) settleHeights(); });

function selectLane(lane, col) {
  const again = state.lane === lane.id;
  state.lane = lane.id;
  if (col !== undefined) { state.col = again && sameCol(state.col, col) ? null : col; if (lane.kind === 'draw' && col?.bar !== undefined) M.sel = col.bar; }
  render();
}

function drawOne(lane, n, domain, height, direct = false, ext = null) {
  const cont = contOf(lane); const sel = lane.id === state.lane; const cd = conditioned(cont, M.given); const states = sharesOf(cd);
  // a cohort is compared with the drawing's pooled answer, once both stand for the drawing as it is now
  const pooled = lane.kind !== 'draw' && fresh() && !lane.wait ? sharesOf(condOf(ctx.lanes[0])) : null;
  const ex = scaled(lane.rows, ext); const draws = lane.kind === 'draw'; const line = ctx?.sel?.kind === 'hold' ? ctx.sel.gp : null; let marks = {};
  if (draws) {
    // every pin on the drawing, quiet; the one whose ledger line is selected, or that the pointer is on, stands out
    const held = model.held(lane.rows); const on = (x) => (!!line && line.items.some((y) => y.pin === x.pin && y.from === 'pin')) || (state.hot?.kind === 'knot' && state.hot.pin === x.pin);
    marks = { holds: held.filter((x) => x.from === 'pin' && !x.h.color).map((x) => ({ key: 'p' + x.pin, pin: x.pin, rel: x.h.rel, on: on(x), a: { bar: x.h.a[0], v: kindLevel(ex[x.h.a[0]], x.h.a[1]) }, b: { bar: x.h.b[0], v: kindLevel(ex[x.h.b[0]], x.h.b[1]) } })),
      tints: held.filter((x) => x.h.color).map((x) => ({ key: 'c' + x.pin, pin: x.pin, bar: x.h.bar, on: on(x) })),
      bones: M.skel ? bonesOf(ex) : null, bonesOn: line?.kind === 'skeleton', targets: state.hold, pend: state.pend, hot: state.hot };
  } else if (lane.kind === 'hold') marks = { frame: lane.gp.kind === 'colour' ? lane.gp.items[0].h.bar : -1, bones: lane.gp.kind === 'skeleton' ? bonesOf(ex) : null, bonesOn: true };
  else if (lane.kind === 'offer' && model.skelTop()) marks = { bones: bonesOf(ex, 1) };
  n.geo = drawLane(n.svgHost, { bars: ex, cont, states, next: lane.next ? scaled([lane.next], extent(lane.rows))[0] : null, domain, height, ...marks,
    mark: markOf(lane), pooled, diff: pooled && states ? differsFrom(states, cd.n, pooled) : null,
    given: cont ? M.given : NO_GIVEN, loose: !!cd?.picks, path: lane.kind === 'path' ? lane.key : null, overlay: lane.kind === 'draw' && ctx?.sel?.kind === 'path' ? ctx.sel.key : null, col: state.col?.after || 0,
    hero: lane.kind === 'draw', pick: lane.kind === 'draw' && (state.lane === 'draw' || !!drag) ? M.sel : -1, direct, wait: lane.wait, numbers: lane.kind === 'draw' || (sel && height >= 120),
    why: lane.kind === 'window' ? (lane.next ? '' : 'NO NEXT BAR') : lane.kind === 'offer' ? 'NOTHING IS HELD · A HOLD ADDS A LINE HERE' : lane.kind === 'hold' && lane.res && lane.res.mode !== 'held' ? (tally(lane.res).raw ? 'NONE THAT KEEPS IT PASSES THE NEXT-BAR FILTER' : 'NO WINDOW KEEPS THIS') : lane.res && !cont ? 'FEWER THAN 30 COMPLETE WINDOWS'
      : lane.kind === 'nopath' ? (hero?.panes?.cont ? 'NO WINDOW CLOSED WHERE THE PICKS SAY' : 'FEWER THAN 30 COMPLETE WINDOWS')
        : cont && !states ? `${int(cd.n)} CLOSED THERE · UNDER 30, NO ESTIMATE` : '' });
}
/** The skeleton as a line: the first open, the swings it keeps in order of time, the last close. Rows are in shape units. */
function bonesOf(ex, level = M.skel) {
  const marks = model.skelMarks(level); if (!marks.length) return null;
  const n = ex.length; const pts = [];
  if (M.oriented) pts.push([0, ex[0][0], -1]);
  // within a bar, the swing on the side it opened from comes first
  const by = marks.slice().sort((a, b) => a.bar - b.bar || ((ex[a.bar][3] >= ex[a.bar][0]) === (a.part === 'L') ? -1 : 1));
  for (const m of by) pts.push([m.bar, partPrice(ex[m.bar], m.part), 0]);
  if (M.oriented) pts.push([n - 1, ex[n - 1][3], 1]);
  return pts;
}


/** How much room the canvas has: the row head and the track give way before the columns do. */
function fitCanvas() {
  const el = $('#canvas'); const w = el.clientWidth; const fit = w >= 1120 ? 'roomy' : w >= 820 ? 'snug' : 'tight';
  if (el.dataset.fit !== fit) el.dataset.fit = fit;
}

function renderCanvas() {
  fitCanvas();
  const { lanes } = ctx; const host = $('#lanes'); const avail = host.clientHeight;
  host.classList.toggle('stale', !fresh());
  let rest = lanes.slice(1); const MIN = 64;
  // the selected row is drawn tall, as the drawing is; the others stay compact and share what is left
  const heroFor = (expanded) => Math.round(Math.max(expanded ? 168 : 190, Math.min(340, avail * (expanded ? 0.34 : 0.42))));
  const tallH = Math.round(Math.max(128, Math.min(232, avail * 0.27)));
  const paged = rest.length > 0 && (state.rows === 'windows' || (state.rows === 'paths' && rest[0].kind === 'path'));
  if (paged) {
    // a page holds what fits when one of its rows is open
    const per = Math.max(2, 1 + Math.floor((avail - heroFor(true) - tallH) / (MIN + 8))); const pages = Math.max(1, Math.ceil(rest.length / per));
    // a window picked in the drawer may be on another page of the canvas: the page turns to the one that holds it
    if (state.seek) { const at = rest.findIndex((l) => l.id === state.seek); if (at >= 0) state.page = Math.floor(at / per); state.seek = null; }
    state.page = Math.min(state.page, pages - 1);
    const total = rest.length; const from = state.page * per; rest = rest.slice(from, from + per);
    const what = state.rows === 'paths' ? 'Paths' : 'Windows';
    mount($('#pager'), h('span', { class: 'fig' }, `${what} ${from + 1}–${from + rest.length} of ${total}`),
      h('button', { class: 'quiet', type: 'button', title: `Previous ${what.toLowerCase()}`, 'aria-label': `Previous ${what.toLowerCase()}`, disabled: state.page === 0, onclick: () => { state.page--; render(); } }, '←'),
      h('button', { class: 'quiet', type: 'button', title: `Next ${what.toLowerCase()}`, 'aria-label': `Next ${what.toLowerCase()}`, disabled: state.page >= pages - 1, onclick: () => { state.page++; render(); } }, '→'));
  } else mount($('#pager'));
  const all = [lanes[0], ...rest]; ctx.all = all;
  if (!all.some((l) => l.id === state.lane)) state.lane = 'draw';
  const sel = all.find((l) => l.id === state.lane); ctx.sel = sel;
  const open = sel.id !== 'draw'; const heroH = rest.length ? heroFor(open) : Math.max(190, avail - 1);
  const openH = !open ? 0 : rest.length === 1 ? Math.max(tallH, avail - heroH - 1) : tallH;
  const others = rest.length - (open ? 1 : 0);
  const laneH = others > 0 ? Math.min(tallH, Math.max(MIN, Math.floor((avail - heroH - openH) / others) - 1)) : 0;
  const domain = domainOf(all.map(contOf)); ctx.domain = domain;

  const slots = all.map((_, i) => (i ? 'row' + i : 'draw'));
  for (const [id, n] of nodes) if (!slots.includes(id)) { n.el.remove(); nodes.delete(id); }
  const heights = new Map();
  all.forEach((lane, i) => {
    const n = nodeFor(slots[i]); n.lane = lane; lane.node = n; n.el.dataset.lane = lane.id;
    const height = lane.id === 'draw' ? heroH : lane.id === sel.id ? openH : laneH; heights.set(lane.id, height);
    n.el.className = 'lane row3' + (n.born ? ' m-enter' : '') + (lane.id === 'draw' ? ' pinned draw' : '') + (lane.id === state.lane ? ' sel' : '') + (height < 112 ? ' compact' : '') + (height < 84 ? ' short' : '') + (lane.wait ? ' wait' : '');
    setHeight(n, height); n.born = false;
    const cells = laneTrack(lane); n.track.classList.toggle('lead2', !!cells.lead2);
    mount(n.head, laneHead(lane)); mount(n.track, cells);
  });
  if (host.querySelectorAll(':scope > .lane').length !== all.length) host.append(...slots.map((id) => nodes.get(id).el));
  for (const lane of all) drawOne(lane, lane.node, domain, heights.get(lane.id) - 1);
  host.onmouseleave = unhover; unhover();

  drawAxis($('#axis'), { n: M.bars.length, pick: state.lane === 'draw' ? M.sel : -1 });
  $('#rowlabel').textContent = { timeframes: 'The shape, on each timeframe', variants: 'Shapes one comparison away', windows: '', holds: 'What each hold keeps, in order', paths: paged ? '' : 'The closing paths, most common first' }[state.rows];
  // the track's columns are named for what the rows read: a path's share, the windows the picks leave, or the cohort
  // picks narrow every row that has complete windows, whether or not the drawing itself has any: the names follow the picks
  const narrowed = givenAny();
  const heads = state.rows === 'paths' ? ['Windows', 'Probability', narrowed ? 'Of all' : '', ''] : state.rows === 'windows' && sel.kind === 'window' ? ['Shape', 'Order', 'Next', 'Next']
    : narrowed ? ['Given', 'Of cohort', `+${AFTER} above`, `+${AFTER} below`] : ['Windows', 'Broke high', 'Broke low', 'Next up'];
  $('#trackhead').classList.toggle('lead2', state.rows === 'paths' || (narrowed && !(state.rows === 'windows' && sel.kind === 'window')));
  mount($('#trackhead'), ...heads.map((t) => h('span', null, t)));
  // the column track reads the selected row; a window, or a hold no window keeps, has no cohort, so it falls back to the drawing's
  const read = sel.res?.panes && !(sel.kind === 'hold' && sel.res.mode !== 'held') ? sel : lanes[0]; const p = read.res?.panes; const nb = M.bars.length;
  const readings = Array.from({ length: nb }, (_, i) => { const w = p?.rows.find((x) => x.bar === i && x.key === state.track); return w ? { d: w.d, text: readText(w, w.set[0]), all: readText(w, w.all[0]) } : null; });
  const rcd = conditioned(p?.cont || null, M.given);
  ctx.trackGeo = drawColumnTrack($('#coltrack'), { n: nb, readings, states: sharesOf(rcd), given: rcd ? M.given : NO_GIVEN, cells: !!rcd, col: state.col?.after || 0 });
  ctx.read = read; ctx.readCd = rcd;
  const st = engine.state.readings;
  mount($('#collabel'), label(`${READ[state.track]} · closing states${rcd?.picks ? ', given the picks' : ''}`), note(!p ? '' : st === 'ready' ? `${read.title}, against every window` : st === 'failed' ? 'Readings unavailable' : 'Readings are loading'));
  const names = namesOf(M.bars, M.oriented);
  mount($('#names'), label('Named'), names.length
    ? h('span', { class: 'list' }, names.map((x) => h('button', { type: 'button', title: x.p.rule, onclick: () => { state.catalog = x.p.name; togglePanel('left', true); } }, h('span', { class: 'who' }, x.who), x.p.name)))
    : h('span', { class: 'none' }, 'No catalogue name fits these bars'));
}

function unhover() { $('#lanes').classList.remove('hot'); $('.band').classList.remove('hot'); }
function hover(n, e) {
  const lane = n.lane; if (!n.geo || drag) return;
  if (state.hold && lane.kind === 'draw') { holdHover(n, e); return; }
  const host = $('#lanes'); const cursor = $('#cursor'); const tip = $('#tip'); const G = n.geo.g;
  const box = n.svgHost.getBoundingClientRect(); const hostBox = host.getBoundingClientRect(); const col = G.at(e.clientX - box.left);
  if (lane.kind === 'draw') { const hit = hitTest(n, e.clientX - box.left, e.clientY - box.top); n.svgHost.classList.toggle('over-level', !!hit && hit.kind !== 'move' && hit.kind !== 'select'); n.svgHost.classList.toggle('over-body', !!hit && hit.kind === 'move'); }
  const cell = e.currentTarget === n.svgHost ? cellOf(n, e) : null; n.svgHost.classList.toggle('over-cell', !!cell);
  const x = box.left - hostBox.left + (col.bar !== undefined ? G.xb(col.bar) : G.xa(col.after));
  cursor.style.left = x + 'px'; cursor.style.height = host.scrollHeight + 'px';
  // one cursor through every lane and the column track under them
  const band = $('.band'); $('#cursor2').style.left = x + hostBox.left - band.getBoundingClientRect().left + 'px'; band.classList.add('hot');
  const cont = contOf(lane); const p = lane.res?.panes; let title; let lines;
  if (col.bar !== undefined) {
    const [o, hi, lo, c] = scaled(lane.rows)[col.bar]; title = `${lane.title} · bar ${col.bar + 1}`;
    const raw = lane.rows[col.bar]; const f = (v) => (lane.kind === 'window' || lane.kind === 'variant' ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : pct(v, 0));
    const [a, b, c2, d] = lane.kind === 'window' || lane.kind === 'variant' ? raw : [o, hi, lo, c];
    // only a window and a variant's example are recorded prices; every other row is the drawing, in its own height
    lines = [`O ${f(a)}  H ${f(b)}`, `L ${f(c2)}  C ${f(d)}`, lane.kind === 'window' ? 'USDT' : lane.kind === 'variant' ? 'USDT, one recorded example' : 'of the shape’s height',
      ...(p?.rows.filter((w) => w.bar === col.bar && ['range', 'vol', 'maker'].includes(w.key)).map((w) => `${READ[w.key].toLowerCase()} ${readText(w, w.set[0])} · all ${readText(w, w.all[0])}`) || [])];
  } else {
    const j = col.after; title = `${lane.title} · +${j}`;
    if (lane.kind === 'window') lines = j === 1 && lane.w.next ? [`O ${lane.w.next.bar[0].toFixed(2)}  H ${lane.w.next.bar[1].toFixed(2)}`, `L ${lane.w.next.bar[2].toFixed(2)}  C ${lane.w.next.bar[3].toFixed(2)}`, `${lane.w.next.bps.toFixed(1)} bps from the last close`] : [j === 1 ? 'no next bar' : 'only the next bar is kept for a window'];
    else if (lane.kind === 'path') { const z = 'UID'.indexOf(lane.key[j - 1]); const w = rateOf(lane.n, lane.of); lines = [`closed ${STATE_LONG[z]}`, `${int(lane.n)} of ${int(lane.of)} windows took the whole path`, w ? `${pct(w[0])} · 95% interval ${pct(w[1])} to ${pct(w[2])}` : 'fewer than 30 windows: nothing is estimated']; }
    else if (!cont) lines = [lane.wait ? 'searching' : lane.kind === 'nopath' ? 'no closing paths' : 'fewer than 30 complete windows'];
    else {
      // every share with its count and its denominator: the windows of this row that closed where the picks say
      const cd = conditioned(cont, M.given); const q = cont.fan[j - 1]; const NAME = ['above the high', 'inside', 'below the low'];
      lines = cd.picks ? [`given ${givenWords()}`] : [];
      for (let z = 0; z < 3; z++) { const k = cd.grid[j - 1][z]; const w = rateOf(k, cd.n); lines.push(`${cell?.z === z ? '› ' : ''}${NAME[z]} ${w ? pct(w[0]) : '—'} · ${int(k)} of ${int(cd.n)}${cell?.z === z && w ? ` · 95% ${pct(w[1])} to ${pct(w[2])}` : ''}`); }
      if (cd.n < 30) lines.push('fewer than 30 windows: nothing is estimated');
      lines.push(`median close ${q[2].toFixed(2)} · middle half ${q[1].toFixed(2)} to ${q[3].toFixed(2)}${cd.picks ? ' · whole cohort' : ''}`);
      if (cell) lines.push(M.given[j - 1] === 'UID'[cell.z] ? 'given · click to free this bar' : `click: given it closed ${STATE[cell.z]}`);
    }
  }
  mount(tip, h('b', null, title), lines.map((t) => h('span', null, t)));
  tip.style.top = n.el.offsetTop + 8 + 'px';
  tip.style.left = (x + 14 + tip.offsetWidth > host.clientWidth - 8 ? x - 14 - tip.offsetWidth : x + 14) + 'px';
  host.classList.add('hot');
}

// ---------------------------------------------------------------- drawing by hand

let drag = null;
/** What the pointer is over in the drawing: a close, a high, a low, the first open, a body, or just a bar. */
function hitTest(n, px, py) {
  const G = n.geo; if (!G || px > G.g.band[1] + 3 || px < G.g.band[0] - 3) return null;
  const i = Math.max(0, Math.min(G.n - 1, Math.floor((px - G.g.band[0]) / G.g.bw))); const [o, hi, lo, c] = scaled(ohlc(M.bars), drag?.ext)[i];
  const cx = G.g.xb(i); const dx = px - cx; const cand = [];
  cand.push({ kind: 'close', d: Math.abs(py - G.yb(c)) + (dx > 0 ? 0 : 5) }, { kind: 'high', d: Math.abs(py - G.yb(hi)) + (Math.abs(dx) < G.cw / 2 + 6 ? 1 : 6) }, { kind: 'low', d: Math.abs(py - G.yb(lo)) + (Math.abs(dx) < G.cw / 2 + 6 ? 1 : 6) });
  if (i === 0) cand.push({ kind: 'open', d: Math.abs(py - G.yb(o)) + (dx < 0 ? 0 : 5) });
  cand.sort((a, b) => a.d - b.d);
  if (cand[0].d <= 11 && Math.abs(dx) <= G.g.bw / 2) return { bar: i, kind: cand[0].kind };
  if (Math.abs(dx) <= G.cw / 2 + 4 && py >= G.yb(Math.max(o, c)) && py <= G.yb(Math.min(o, c))) return { bar: i, kind: 'move' };
  return { bar: i, kind: 'select' };
}
function heroDown(n, e) {
  if (e.button !== 0 || !n.geo) return;
  const box = n.svgHost.getBoundingClientRect(); const hit = hitTest(n, e.clientX - box.left, e.clientY - box.top);
  if (!hit || hit.kind === 'select') return;
  e.preventDefault(); n.svgHost.setPointerCapture(e.pointerId);
  const ext = extent(ohlc(M.bars)); const span = ext[1] - ext[0] || 1; const priceAt = (y) => ext[0] + Math.max(-0.26, Math.min(1.26, n.geo.price(y))) * span;
  M.sel = hit.bar; state.lane = 'draw';
  drag = { n, hit, ext, P0: model.params(), was: model.snapshot(), start: priceAt(e.clientY - box.top), moved: false, priceAt, id: e.pointerId, height: n.geo.height };
  n.svgHost.classList.add('dragging'); $('#lanes').classList.remove('hot');
  const move = (ev) => {
    const y = ev.clientY - n.svgHost.getBoundingClientRect().top; let p = priceAt(y); const { P0 } = drag; const i = hit.bar; const Q = copyParams(P0);
    if (hit.kind !== 'move' && !ev.altKey) {
      // an exact tie is part of the pattern: a price dragged onto another bar's level takes that level exactly
      const own = hit.kind === 'close' ? P0.c[i] : hit.kind === 'high' ? P0.h[i] : hit.kind === 'low' ? P0.l[i] : P0.o0; let best = 6.5;
      for (const b of chainBars(P0)) for (const v of b.v) { if (Math.abs(v - own) < 1e-9) continue; const d = Math.abs(n.geo.yb((v - ext[0]) / span) - y); if (d < best) { best = d; p = v; } }
    }
    if (hit.kind === 'close') Q.c[i] = p; else if (hit.kind === 'high') Q.h[i] = p; else if (hit.kind === 'low') Q.l[i] = p; else if (hit.kind === 'open') Q.o0 = p;
    else { const dv = p - drag.start; const R = moveParams(P0, i, dv); Object.assign(Q, R); }
    model.setParams(Q); drag.moved = true; wantKey = '';
    $('#lanes').classList.add('stale'); $('#readout').classList.add('stale');
    drawOne({ ...n.lane, rows: ohlc(M.bars) }, n, ctx.domain, drag.height, true, ext);
  };
  const up = () => {
    n.svgHost.removeEventListener('pointermove', move); n.svgHost.removeEventListener('pointerup', up); n.svgHost.removeEventListener('pointercancel', up);
    n.svgHost.classList.remove('dragging');
    const d = drag; drag = null; n.dragged = d.moved; setTimeout(() => { n.dragged = false; }, 60);
    if (d.moved) { model.record(d.was); state.message = ''; state.col = null; ask(); } else render();
  };
  n.svgHost.addEventListener('pointermove', move); n.svgHost.addEventListener('pointerup', up); n.svgHost.addEventListener('pointercancel', up);
}

// ---------------------------------------------------------------- holding by hand

const partWord = (bar, part) => KIND_NAME[kindFor(bar, part)];
function kindFor(bar, part) { const [o, , , c] = ohlc(M.bars)[bar]; if (part === 'H') return 1; if (part === 'L') return 2; if (!M.oriented) return part === 'T' ? 5 : 4; const d = Math.sign(c - o); return part === 'T' ? (d >= 0 ? 3 : 0) : (d >= 0 ? 0 : 3); }
/** What the pointer is on in hold mode: a knot (a hold to release), an endpoint to pick, or a body (its colour). */
function holdHit(n, px, py) {
  const G = n.geo; if (!G) return null;
  for (const k of G.knots) if (Math.hypot(px - k.x, py - k.y) <= 8) return { kind: 'knot', pin: k.pin };
  const ex = scaled(ohlc(M.bars)); let best = null;
  ex.forEach((row, i) => { for (const part of PARTS) { if (part === 'B' && row[0] === row[3]) continue; const d = Math.hypot(px - G.g.xb(i), py - G.yb(partPrice(row, part))); if (d <= 12 && (!best || d < best.d)) best = { kind: 'end', bar: i, part, d }; } });
  if (best) return best;
  if (!M.oriented) return null;
  const i = Math.floor((px - G.g.band[0]) / G.g.bw); const row = ex[i]; if (!row) return null;
  if (Math.abs(px - G.g.xb(i)) <= G.cw / 2 + 4 && py >= G.yb(Math.max(row[0], row[3])) - 2 && py <= G.yb(Math.min(row[0], row[3])) + 2) return { kind: 'body', bar: i };
  return null;
}
const sameHot = (a, b) => (!a && !b) || (!!a && !!b && a.kind === b.kind && a.bar === b.bar && a.part === b.part && a.pin === b.pin);
function redrawHero() { const n = ctx.lanes[0].node; if (n?.geo) drawOne({ ...n.lane, rows: ohlc(M.bars) }, n, ctx.domain, n.geo.height); }
/** Say what the point under the pointer is, and what picking it does. */
function holdTip(n, hit, x, y) {
  const tip = $('#tip'); const host = $('#lanes');
  if (!hit) { host.classList.remove('hot'); return; }
  const held = model.held(); const end = (b, part) => `bar ${b + 1} ${partWord(b, part)}`; let title; let lines;
  if (hit.kind === 'knot') { const x0 = held.find((q) => q.pin === hit.pin); title = x0 ? holdText(x0) : 'Held'; lines = ['held · click to release']; }
  else if (hit.kind === 'body') { const on = M.pins.some((q) => q.color && q.bar === hit.bar); title = `Bar ${hit.bar + 1}’s colour`; lines = [on ? 'held · click to release' : 'click to hold which way it closes']; }
  else if (!state.pend) { title = cap(end(hit.bar, hit.part)); lines = ['click, then a second point, to hold how they lie']; }
  else if (state.pend.bar === hit.bar && state.pend.part === hit.part) { title = cap(end(hit.bar, hit.part)); lines = ['picked · click again to drop it']; }
  else { const rows = ohlc(M.bars); const r = Math.sign(partPrice(rows[state.pend.bar], state.pend.part) - partPrice(rows[hit.bar], hit.part)); title = `${cap(end(state.pend.bar, state.pend.part))} ${relWord(r)} ${end(hit.bar, hit.part)}`; lines = ['click to hold it']; }
  mount(tip, h('b', null, title), lines.map((t) => h('span', null, t)));
  tip.style.top = Math.max(4, n.el.offsetTop + y - 14) + 'px'; const left = n.svgHost.offsetLeft + x;
  tip.style.left = (left + 18 + tip.offsetWidth > host.clientWidth - 8 ? left - 18 - tip.offsetWidth : left + 18) + 'px';
  host.classList.add('hot'); $('#cursor').style.height = '0px';
}
function holdHover(n, e) {
  const box = n.svgHost.getBoundingClientRect(); const hit = holdHit(n, e.clientX - box.left, e.clientY - box.top);
  n.svgHost.classList.toggle('over-target', !!hit);
  if (!sameHot(hit, state.hot)) { state.hot = hit; redrawHero(); }
  holdTip(n, hit, e.clientX - box.left, e.clientY - box.top);
}
/** Act on a point: release a knot, hold or release a colour, or pick an endpoint (the second pick makes the hold). */
function holdAct(hit) {
  if (!hit) { if (state.pend) { state.pend = null; render(); } return; }
  if (hit.kind === 'knot') { state.hot = null; if (model.unpin(hit.pin)) ask(); return; }
  if (hit.kind === 'body') { model.colorPin(hit.bar); ask(); return; }
  if (!state.pend) { state.pend = { bar: hit.bar, part: hit.part }; render(); return; }
  if (state.pend.bar === hit.bar && state.pend.part === hit.part) { state.pend = null; render(); return; }
  const made = model.pin(state.pend, { bar: hit.bar, part: hit.part }); state.pend = null; state.message = made ? '' : 'That relation is already held';
  if (made) ask(); else render();
}
function holdDown(n, e) {
  if (e.button !== 0 || !n.geo) return;
  e.preventDefault(); const box = n.svgHost.getBoundingClientRect();
  // the row's own click would select a column: a pick is not that
  n.dragged = true; setTimeout(() => { n.dragged = false; }, 80);
  state.lane = 'draw'; holdAct(holdHit(n, e.clientX - box.left, e.clientY - box.top));
}
/** Hold mode by keys: arrows walk the endpoints, Enter picks, C holds the bar's colour, Backspace releases the last hold. */
function holdKey(e) {
  const k = e.key; const n = M.bars.length; const at = state.hot?.kind === 'end' ? state.hot : { kind: 'end', bar: M.sel, part: 'H' };
  const order = ['H', 'T', 'B', 'L']; const row = ohlc(M.bars)[at.bar]; const parts = order.filter((q) => !(q === 'B' && row[0] === row[3]));
  if (k === 'ArrowLeft' || k === 'ArrowRight') { state.hot = { kind: 'end', bar: Math.max(0, Math.min(n - 1, at.bar + (k === 'ArrowLeft' ? -1 : 1))), part: at.part === 'B' ? 'T' : at.part }; }
  else if (k === 'ArrowUp' || k === 'ArrowDown') { const i = Math.max(0, parts.indexOf(at.part)); state.hot = { kind: 'end', bar: at.bar, part: parts[Math.max(0, Math.min(parts.length - 1, i + (k === 'ArrowUp' ? -1 : 1)))] }; }
  else if (k === 'Enter' || k === ' ') { state.hot = at; holdAct(at); e.preventDefault(); return true; }
  else if (k.toLowerCase() === 'c') { if (!M.oriented) { state.message = 'Colours are not part of the shape: nothing to hold'; render(); } else holdAct({ kind: 'body', bar: at.bar }); e.preventDefault(); return true; }
  else if (k === 'Backspace' || k === 'Delete') { if (M.pins.length && model.unpin(M.pins.length - 1)) ask(); e.preventDefault(); return true; }
  else return false;
  e.preventDefault(); M.sel = state.hot.bar; render();
  return true;
}

// ---------------------------------------------------------------- left: named patterns

const counted = new Map(); let counting = 0;
const infoOf = (p) => counted.get(`${p.id}|${state.frame}`);
/** Put a catalogue pattern on the canvas from its most recent recorded example on the chosen timeframe. */
function drawNamed(p) {
  const info = infoOf(p); const sample = info?.samples?.[0]; if (!sample) return;
  if (p.bars >= MIN_BARS) { putOnCanvas(sample.bars, `${p.name}: drawn from ${TF[state.frame]} · ${when(sample.close)}`); return; }
  // a one-bar pattern is put on the picked bar: its open stays on the chain, its shape comes from the example
  const [o, hi, lo, c] = sample.bars[0]; const i = M.sel; const P = model.params(); const open = i ? P.c[i - 1] : P.o0;
  const [a, b] = extent(ohlc(M.bars)); const k = ((b - a) * 0.45) / (hi - lo || 1);
  model.record(); P.c[i] = open + (c - o) * k; P.h[i] = open + (hi - o) * k; P.l[i] = open + (lo - o) * k; model.setParams(P);
  state.message = `${p.name}: bar ${i + 1} drawn from ${TF[state.frame]} · ${when(sample.close)}`; state.lane = 'draw'; ask();
}
async function countCatalogue() {
  const C = globalThis.CandlePatterns; if (!C || !engine.state.ready) return;
  const mine = ++counting; const frame = state.frame;
  for (const p of C.patterns) {
    if (mine !== counting || !ui.left) return;
    const key = `${p.id}|${frame}`; if (counted.has(key)) continue;
    counted.set(key, await engine.named(p.id, TF[frame]));
    if (mine === counting && ui.left) renderLeft();
  }
}
function renderLeft() {
  const el = $('#left'); if (!ui.left) return;
  const C = globalThis.CandlePatterns; const q = state.catalog.trim().toLowerCase(); const top = el.scrollTop; const hadFocus = document.activeElement?.classList.contains('search');
  const current = new Set(namesOf(M.bars, M.oriented).map((x) => x.p.id));
  const items = (C?.patterns || []).filter((p) => !q || (p.name + ' ' + p.ja + ' ' + p.aliases.join(' ')).toLowerCase().includes(q));
  const most = Math.max(1, ...items.map((p) => infoOf(p)?.eligible || 0));
  const row = (p) => {
    const info = infoOf(p); const glyph = h('span'); const none = info && !info.error && !info.count;
    if (info?.samples?.[0]) drawGlyph(glyph, info.samples[0].bars);
    return h('div', { class: 'pat' + (none ? ' none' : ''), role: 'button', tabindex: '0', 'aria-current': String(current.has(p.id)), title: `${p.rule}${info?.count ? ` Click to draw its most recent ${TF[state.frame]} example.` : ''}`,
      onclick: () => drawNamed(p), onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) drawNamed(p); } },
    glyph, h('span', { class: 'name' }, p.name, h('small', null, `${p.ja} · ${p.bars} ${p.bars === 1 ? 'bar' : 'bars'}`)),
    h('span', { class: 'n' }, h('b', null, info ? (info.error ? '—' : int(info.count)) : ''), h('i', { class: 'freq' }, h('u', { style: `width:${info?.count ? Math.min(100, (Math.sqrt(info.count / most) / Math.sqrt(0.2)) * 100) : 0}%` }))));
  };
  const frameBtn = h('button', { class: 'quiet', type: 'button', 'data-menu': '1', onclick: () => menu(frameBtn, { title: 'Counted on', value: state.frame, options: TF.map((t, k) => ({ value: k, label: TF_LONG[k] })), onChange: (k) => { state.frame = k; persist(); renderLeft(); countCatalogue(); } }) }, `${TF[state.frame]} ▾`);
  const search = h('input', { class: 'search', type: 'text', placeholder: 'Search, in English or Japanese', value: state.catalog, 'aria-label': 'Search patterns', oninput: (e) => { state.catalog = e.target.value; renderLeft(); } });
  const live = items.filter((p) => !infoOf(p) || infoOf(p).error || infoOf(p).count > 0); const none = items.filter((p) => infoOf(p) && !infoOf(p).error && !infoOf(p).count);
  mount(el, search, h('div', { class: 'frame' }, 'Closes that fit each rule, on', frameBtn),
    live.length ? [h('div', { class: 'sec' }, label('Named candles'), note(engine.state.ready ? '' : 'history loading')), live.map(row)] : null,
    none.length ? [h('div', { class: 'sec' }, label(`Not on ${TF[state.frame]}`)), none.map(row)] : null,
    !items.length ? h('p', { class: 'empty', style: 'padding:16px 18px' }, 'No pattern matches that search.') : null);
  el.scrollTop = top;
  if (hadFocus) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
}

// ---------------------------------------------------------------- right: inspect

function rate(v, text) {
  if (!v) return h('div', { class: 'rate' }, h('div', { class: 'line' }, h('b', { class: 'thin' }, '—'), h('span', null, text)), h('small', null, 'Fewer than 30 windows'));
  return h('div', { class: 'rate' }, h('div', { class: 'line' }, h('b', null, pct(v[0])), h('span', null, text)),
    h('div', { class: 'track' }, h('i', { style: `width:${v[0] * 100}%` }), h('u', { style: `left:${v[1] * 100}%;width:${(v[2] - v[1]) * 100}%` })),
    h('small', null, `95% interval ${pct(v[1])}–${pct(v[2])} · ${int(v[3])} windows`));
}
function renderRight() {
  const el = $('#right'); if (!ui.right) return;
  const sel = ctx.sel; const top = el.scrollTop; const p = sel.res?.panes; const col = state.col; const blocks = [];
  const title = (kind, text, sub) => h('div', { class: 'block' }, h('div', { class: 'sec' }, label(kind), col ? quiet('All columns', () => { state.col = null; render(); }, 'Show the whole row') : null), h('h3', null, text), sub ? h('p', { class: 'note' }, sub) : null);
  const KIND = { draw: 'Shape', tf: 'Timeframe', variant: 'One comparison away', hold: 'Held', offer: 'Holds' };
  // what is given: how many of a cohort's complete windows closed where the picks say, and each pick with its release
  const givenBlock = (cd) => h('div', { class: 'block' }, h('div', { class: 'sec' }, label('Given'), note(`${int(cd.n)} of ${int(cd.base)} complete windows`)),
    rate(rateOf(cd.n, cd.base), 'closed where the picks say'),
    h('div', { class: 'heldlist' }, givenList().map((x) => [h('span', { class: 'k' + (col?.after === x.j ? ' on' : '') }, `Bar +${x.j} closed ${STATE_LONG[x.z]}`), quiet('Release', () => give(x.j, -1), 'Free this bar')])));
  // the closing paths of a cohort as the picks leave it, most common first, each a share of those windows
  const pathList = (cd) => (cd.sequences.length ? [label(cd.picks ? 'Most common closing paths, given the picks' : 'Most common closing paths', 'sub-label'), h('div', { class: 'paths' }, cd.sequences.slice(0, 4).flatMap(([key, k]) => { const w = rateOf(k, cd.n); return [
    h('span', { class: 'seq', title: 'Each column is a later bar: closed above the high, inside, or below the low' }, [0, 1, 2].flatMap((row) => [...key].map((ch) => h('i', { class: 'UID'.indexOf(ch) === row ? 'on' : '' })))),
    h('span', { class: 'w', title: `${int(k)} of ${int(cd.n)} windows` }, key.replaceAll('U', '▲').replaceAll('I', '·').replaceAll('D', '▼')), h('span', { class: 'v' }, w ? pct(w[0]) : `${int(k)}`)]; })),
  state.rows === 'paths' ? null : h('p', { class: 'note more' }, quiet('Every path, as rows', () => { state.rows = 'paths'; state.lane = 'draw'; state.col = null; state.page = 0; persist(); render(); }, 'Show each closing path on its own row'))] : null);
  // what is held, for the drawing and for the line selected: each in words, with its release
  const heldBlock = () => { const { groups, held } = ledger(); if (!groups.length) return null;
    return h('div', { class: 'block' }, h('div', { class: 'sec' }, label('Held'), note(`${held.length} ${held.length === 1 ? 'relation' : 'relations'}${hero?.stretch ? ` · up to ${hero.stretch} ${hero.stretch === 1 ? 'bar' : 'bars'} skipped` : ''}`)),
      h('div', { class: 'heldlist' }, groups.map((g) => [h('span', { class: 'k' + (sel.kind === 'hold' && sel.gp.id === g.id ? ' on' : '') }, g.text), quiet('Release', () => { if (g.kind === 'skeleton' ? model.setSkel(0) : model.unpin(g.pin)) ask(); }, 'Stop holding this')]))); };
  if (sel.kind === 'offer') {
    blocks.push(title('Holds', 'Nothing is held', 'With nothing held, every window is ranked by how close it looks and the count is the exact twins of the whole shape. Hold a relation and only windows that keep it count; the rest of the shape is still ranked by closeness.'));
  } else if (sel.kind === 'window') {
    const w = sel.w; const f = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); const breaks = brokenOf(w);
    blocks.push(title('Window', `${w.tf} · ${when(w.end)}`, `${pct(w.off, 1)} off the shape · ${w.flips ? `${w.flips} comparisons flipped` : 'every comparison as drawn'}`),
      hero?.mode === 'fallback' ? h('div', { class: 'block' }, h('div', { class: 'sec' }, label('Breaks'), note(breaks.length ? `${breaks.length} of ${hero.holds} held` : 'nothing held')), breaks.length ? h('div', { class: 'heldlist' }, breaks.map((b) => h('span', { class: 'k' }, b))) : h('p', { class: 'note', style: 'margin-top:8px' }, 'Keeps every held relation, but not the next-bar filter’s cohort.')) : null,
      h('div', { class: 'block' }, h('div', { class: 'sec' }, label('Recorded bars, USDT')),
        h('div', { class: 'rows' }, w.drawn.flatMap((b, i) => [h('span', { class: 'k' }, `Bar ${i + 1}`), h('span', { class: 'v' }, `${f(b[0])} → ${f(b[3])}`), h('span', { class: 'b' }, `${f(b[2])}–${f(b[1])}`)]),
          w.next ? [h('span', { class: 'k' }, 'Next bar'), h('span', { class: 'v' }, `${f(w.next.bar[0])} → ${f(w.next.bar[3])}`), h('span', { class: 'b' }, `${w.next.bps > 0 ? '+' : ''}${w.next.bps.toFixed(1)} bps`)] : [h('span', { class: 'k' }, 'Next bar'), h('span', { class: 'v' }, '—'), h('span', { class: 'b' }, w.nextWhy === 'gap' ? 'gap in the record' : 'end of the record')])));
  } else if (sel.kind === 'path') {
    // one closing path: the share of windows that took all six closes, and one recorded window that did
    const ex = hero?.panes?.cont?.examples?.[sel.key]; const host = h('div', { class: 'example-host' }); if (ex) drawExample(host, ex);
    const cd = conditioned(hero?.panes?.cont || null, M.given);
    blocks.push(title('Closing path', sel.title, [...sel.key].map((ch, k) => `+${k + 1} ${STATE['UID'.indexOf(ch)]}`).join(' · ')),
      h('div', { class: 'block' }, h('div', { class: 'sec' }, label('Probability'), note(givenAny() ? 'among the windows the picks leave' : 'of all six closes together')),
        rate(rateOf(sel.n, sel.of), 'took this whole path'), givenAny() ? rate(rateOf(sel.n, sel.base), 'of the whole cohort took it') : null,
        h('p', { class: 'note', style: 'margin-top:10px' }, 'Counted over every complete window. The six shares of a column are not multiplied together.'),
        h('p', { class: 'note more' }, quiet('Given this path', () => { model.giveAll(sel.key); state.lane = 'draw'; state.col = null; render(); }, 'Pick this path’s close at every later bar'))),
      ex ? h('div', { class: 'block' }, h('div', { class: 'sec' }, label('One recorded window'), note('in the shape’s own scale')), host,
        h('p', { class: 'note', style: 'margin-top:6px' }, 'The six bars after one window that closed this way. An example, not the cohort.')) : null,
      cd?.picks ? givenBlock(cd) : null);
  } else if (sel.kind === 'nopath') {
    const cd = conditioned(hero?.panes?.cont || null, M.given);
    blocks.push(title('Closing paths', cd ? 'No window closed there' : 'No closing paths', cd ? 'No complete window closed where every pick says. Release a pick to see paths again.' : 'Fewer than 30 complete windows: nothing is estimated.'), cd?.picks ? givenBlock(cd) : null);
  } else if (!p) {
    blocks.push(title(KIND[sel.kind], sel.kind === 'tf' ? TF_LONG[sel.k] : sel.title, engine.state.failed || (engine.state.ready ? 'Searching the history.' : 'The history is loading.')));
  } else {
    const kind = KIND[sel.kind]; const res = sel.res; const fell = res.mode === 'fallback';
    // the figure is what the cohort is: exact twins, windows that keep what is held, or only the nearest windows
    const what = p.kind === 'closest' ? (fell ? 'nearest windows' : 'closest windows') : p.kind === 'hold' ? (p.n === 1 ? 'window keeps what is held' : 'windows keep what is held') : p.n === 1 ? 'exact twin' : 'exact twins';
    const aside = p.kind !== 'closest' ? null : fell ? (tally(res).raw ? 'none that holds passes the next-bar filter' : 'no window keeps every held relation') : 'under 30 twins';
    blocks.push(h('div', { class: 'block' }, h('div', { class: 'sec' }, label(kind), col ? quiet('All columns', () => { state.col = null; render(); }, 'Show the whole row') : null),
      h('h3', null, sel.kind === 'tf' ? TF_LONG[sel.k] : sel.kind === 'draw' ? (namesOf(M.bars, M.oriented)[0]?.p.name || `${cap(NWORD[M.bars.length] || String(M.bars.length))}-bar shape`) : sel.title),
      h('div', { class: 'big', style: 'margin-top:10px' }, h('b', null, int(p.n)), h('span', { class: 'note' }, what), aside ? h('span', { class: 'vs' }, aside) : null),
      sel.kind === 'hold' && sel.prev ? h('p', { class: 'note', style: 'margin-top:8px' }, res.mode !== 'held' ? 'No window keeps this with the holds above it. The figures below read the nearest windows, which break at least one hold.' : sel.n === sel.prev ? `Removes nothing: all ${int(sel.prev)} windows on the line above already keep it.` : `${pct(sel.n / sel.prev, sel.n / sel.prev < 0.1 ? 1 : 0)} of the ${int(sel.prev)} windows on the line above; ${int(sel.prev - sel.n)} removed.`) : null,
      res.mode === 'held' && p.kind === 'hold' && sel.kind !== 'hold' ? h('p', { class: 'note', style: 'margin-top:8px' }, `${int(sel.kind === 'tf' ? res.exactF[sel.k] : sumOn(res.exactF))} of them are exact twins of the whole shape.`) : null,
      sel.kind === 'tf' ? null : h('div', { class: 'rows' }, TF.flatMap((t, k) => (p.tfN[k] ? [h('span', { class: 'k' }, t), h('span', { class: 'v' }, int(p.tfN[k])), h('span', { class: 'b' }, p.byTf[k] ? `${pct(p.byTf[k][0])} next up` : 'under 30')] : [])))));
    if (sel.kind === 'draw' || sel.kind === 'hold') { const hb = heldBlock(); if (hb) blocks.push(hb); }
    // picks narrow what this row reads to the windows that closed there
    const c = p.cont; const cd = conditioned(c, M.given); const picks = !!cd?.picks;
    if (picks) blocks.push(givenBlock(cd));
    if (col?.after) {
      // a bar that is itself picked is read without its own pick: what the pick was chosen from, given the others
      const j = col.after; const own = M.given[j - 1] !== '-'; const cj = own ? conditioned(c, M.given.slice(0, j - 1) + '-' + M.given.slice(j)) : cd;
      blocks.push(h('div', { class: 'block' }, h('div', { class: 'sec' }, label(`Bar +${j}`), note(own ? (cj?.picks ? 'where it closed, given the other picks' : 'where it closed, before this pick') : picks ? 'where it closed, given the picks' : 'where it closed')),
        c ? (() => { const q = c.fan[j - 1];
          return [[0, 1, 2].map((z) => rate(rateOf(cj.grid[j - 1][z], cj.n), `closed ${STATE_LONG[z]}`)),
            h('div', { class: 'pickrow' }, label('Given it closed', 'sub-label'), h('span', { class: 'seg' }, [0, 1, 2].map((z) => h('button', { type: 'button', 'aria-pressed': String(M.given[j - 1] === 'UID'[z]), title: `Read only the windows that closed ${STATE_LONG[z]} at +${j} · ${z + 1}`, onclick: () => give(j, z) }, cap(STATE[z]))))),
            h('div', { class: 'rows' }, [['Median close', q[2]], ['Middle half', null], ['Middle 80%', null]].flatMap(([k, v], i) => [h('span', { class: 'k' }, k), h('span', { class: 'v' }, i === 0 ? v.toFixed(2) : i === 1 ? `${q[1].toFixed(2)} to ${q[3].toFixed(2)}` : `${q[0].toFixed(2)} to ${q[4].toFixed(2)}`), h('span', { class: 'b' }, i === 0 ? 'shape heights' : '')])),
            picks ? h('p', { class: 'note', style: 'margin-top:8px' }, 'The closes above are the whole cohort’s: the matcher keeps their quantiles, which a pick cannot narrow.') : null]; })()
          : h('p', { class: 'note', style: 'margin-top:8px' }, 'Fewer than 30 complete windows: nothing is estimated.')));
    } else {
      if (col?.bar === undefined && picks) blocks.push(h('div', { class: 'block' }, h('div', { class: 'sec' }, label('What followed, given the picks'), note(`${int(cd.n)} windows`)),
        rate(rateOf(cd.grid[AFTER - 1][0], cd.n), `closed bar +${AFTER} above the shape’s high`), rate(rateOf(cd.grid[AFTER - 1][2], cd.n), `closed bar +${AFTER} below the shape’s low`),
        pathList(cd),
        h('p', { class: 'note', style: 'margin-top:10px' }, 'The next bar, the high and low traded through, and the fan are the whole cohort’s: a pick does not narrow them.')));
      else if (col?.bar === undefined) blocks.push(h('div', { class: 'block' }, h('div', { class: 'sec' }, label('What followed'), note(c ? `${int(c.n)} complete windows` : '')),
        rate(p.next, 'closed higher on the next bar'), rate(c?.aboveHigh || null, 'traded above the shape’s high within six bars'), rate(c?.belowLow || null, 'traded below the shape’s low within six bars'), rate(c?.aboveClose || null, 'closed bar +6 above the last drawn close'),
        cd ? pathList(cd) : null));
      const st = engine.state.readings; const rows = p.rows.filter((w) => col?.bar === undefined || w.bar === col.bar).slice().sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
      blocks.push(h('div', { class: 'block' }, h('div', { class: 'sec' }, label(col?.bar !== undefined ? `Bar ${col.bar + 1}, against every window` : picks ? 'What differs, whole cohort' : 'What differs'), note(rows.length ? 'this row · all' : '')),
        rows.length ? h('div', { class: 'rows' }, rows.slice(0, col?.bar !== undefined ? 12 : 9).flatMap((w) => { const d = (Math.max(-0.6, Math.min(0.6, w.d)) / 0.6) * 50;
          return [h('span', { class: 'k', title: cap(READ_NOTE[w.key]) }, col?.bar !== undefined ? READ[w.key] : `Bar ${w.bar + 1} · ${READ[w.key]}`), h('span', { class: 'v' }, readText(w, w.set[0])), h('span', { class: 'b' }, readText(w, w.all[0])),
            h('span', { class: 'bar', title: `${w.d >= 0 ? '+' : '−'}${Math.abs(w.d).toFixed(2)} standard deviations of every window` }, h('i', { class: d < 0 ? 'below' : '', style: d >= 0 ? `left:50%;width:${d}%` : `left:${50 + d}%;width:${-d}%` }))]; }))
          : h('p', { class: 'note', style: 'margin-top:8px' }, st === 'loading' ? 'Readings are loading.' : st === 'failed' ? `Readings unavailable: ${engine.state.note}` : 'Fewer than 30 windows with readings.')));
    }
  }
  mount(el, blocks); el.scrollTop = top;
}
function wilson(k, n) {
  const z = 1.959964; const pp = k / n; const d = 1 + (z * z) / n; const c = (pp + (z * z) / (2 * n)) / d; const hw = (z * Math.sqrt((pp * (1 - pp)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - hw), Math.min(1, c + hw)];
}

// ---------------------------------------------------------------- drawer

function windowsTable(host) {
  const rows = (hero?.results || []).map((w, i) => ({ w, rank: i })); const sort = state.sort;
  if (!rows.length) { mount(host, h('p', { class: 'empty', style: 'padding:18px 0' }, fresh() ? 'No window matches.' : 'Searching the history.')); return; }
  const get = { rank: (x) => x.rank, tf: (x) => TF.indexOf(x.w.tf), t: (x) => x.w.end, off: (x) => x.w.off, flips: (x) => x.w.flips, bps: (x) => (x.w.next ? x.w.next.bps : null), atr: (x) => (x.w.next && x.w.next.atrx === x.w.next.atrx ? x.w.next.atrx : null) }[sort.key];
  const sorted = rows.slice().sort((a, b) => { const x = get(a); const y = get(b); return x === null ? 1 : y === null ? -1 : (x - y) * sort.dir; });
  const size = Math.max(3, Math.floor((host.clientHeight - 74) / 31)); const pages = Math.max(1, Math.ceil(sorted.length / size)); state.winPage = Math.min(state.winPage, pages - 1);
  const scale = (f) => { const v = sorted.map(f).filter((x) => x !== null).map(Math.abs).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) * 0.95)] || 1e-9 : 1; };
  const sb = scale((x) => (x.w.next ? x.w.next.bps : null)); const sa = scale((x) => (x.w.next && x.w.next.atrx === x.w.next.atrx ? x.w.next.atrx : null));
  const th = (key, text, cls = '') => h('th', { class: cls, 'aria-sort': sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none' },
    h('button', { type: 'button', class: 'sort', title: 'Sort by this column', onclick: () => { state.sort = { key, dir: sort.key === key ? -sort.dir : ['bps', 'atr'].includes(key) ? -1 : 1 }; state.winPage = 0; renderDrawer(); } }, text, h('i', null, sort.key === key ? (sort.dir > 0 ? '▲' : '▼') : '')));
  const mini = (v, s0) => { const d = Math.max(-1, Math.min(1, v / s0)) * 50; return h('span', { class: 'mini' }, h('i', { class: d < 0 ? 'below' : '', style: d >= 0 ? `left:50%;width:${d}%` : `left:${50 + d}%;width:${-d}%` })); };
  // the table is redrawn by the pick, so the row that was focused is gone: focus goes to the row that replaced it
  const pick = (x) => { state.rows = 'windows'; state.lane = state.seek = `win${x.w.tf}.${x.w.start}`; state.col = null; if (!ui.right) ui.right = true; persist(); render(); $('#drawer tr[aria-selected="true"]')?.focus({ preventScroll: true }); };
  const fell = hero.mode === 'fallback';
  mount(host, h('table', { class: 'ruled' },
    h('thead', null, h('tr', null, th('rank', 'Closest'), th('tf', 'Timeframe'), th('t', 'Close, UTC'), th('off', 'Off the shape', 'num'), th('flips', 'Flips', 'num'), fell ? h('th', null, 'Breaks') : null, th('bps', 'Next bar, bps', 'num'), th('atr', 'Next bar, ATR', 'num'))),
    h('tbody', null, sorted.slice(state.winPage * size, (state.winPage + 1) * size).map((x) => { const nx = x.w.next;
      return h('tr', { tabindex: '0', 'aria-selected': String(state.lane === `win${x.w.tf}.${x.w.start}`), onclick: () => pick(x), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); pick(x); } } },
        h('td', { class: 'fig muted' }, String(x.rank + 1)), h('td', { class: 'fig' }, x.w.tf), h('td', { class: 'fig' }, when(x.w.end)), h('td', { class: 'fig num' }, pct(x.w.off, 1)), h('td', { class: 'fig num' }, x.w.flips ? String(x.w.flips) : 'exact'),
        fell ? h('td', { class: 'breaks', title: brokenOf(x.w).join(' · ') }, brokenOf(x.w).join(' · ') || '—') : null,
        nx ? h('td', { class: 'num' }, mini(nx.bps, sb), h('span', { class: 'fig' + (nx.bps < 0 ? ' neg' : '') }, `${nx.bps > 0 ? '+' : nx.bps < 0 ? '−' : ''}${Math.abs(nx.bps).toFixed(1)}`)) : h('td', { class: 'fig num muted' }, x.w.nextWhy || '—'),
        nx && nx.atrx === nx.atrx ? h('td', { class: 'num' }, mini(nx.atrx, sa), h('span', { class: 'fig' + (nx.atrx < 0 ? ' neg' : '') }, `${nx.atrx > 0 ? '+' : nx.atrx < 0 ? '−' : ''}${Math.abs(nx.atrx).toFixed(2)}`)) : h('td', { class: 'fig num muted' }, '—')); }))),
  h('div', { class: 'pager' }, h('span', { class: 'fig' }, `Windows ${state.winPage * size + 1}–${Math.min(sorted.length, (state.winPage + 1) * size)} of ${sorted.length}`),
    h('button', { class: 'quiet', type: 'button', title: 'Previous page', 'aria-label': 'Previous page', disabled: state.winPage === 0, onclick: () => { state.winPage--; renderDrawer(); } }, '←'),
    h('button', { class: 'quiet', type: 'button', title: 'Next page', 'aria-label': 'Next page', disabled: state.winPage >= pages - 1, onclick: () => { state.winPage++; renderDrawer(); } }, '→')));
}
function renderDrawer() {
  const el = $('#drawer'); if (!ui.drawer) return;
  const body = h('div', { class: 'body' }); const code = g1(M.bars, M.oriented); const names = namesOf(M.bars, M.oriented);
  const head = (title, text, ...seg) => h('header', null, label(title, 'title'), note(text), h('span', { class: 'seg' }, seg), quiet('Close', () => togglePanel(ui.drawer)));
  const copy = h('button', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(code); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select the text to copy'; } setTimeout(() => { copy.textContent = 'Copy'; }, 1400); } }, 'Copy');
  const terms = () => [h('dt', null, 'bars'), h('dd', null, `${M.bars.length}, ${M.oriented ? 'directions kept' : 'shape only'}`),
    h('dt', null, 'timeframes'), h('dd', null, TF.filter((_, k) => M.tfOn[k]).join(' · ')),
    h('dt', null, 'next bar'), h('dd', null, NEXT.find((x) => x[0] === nextValue())?.[1] || 'Any'),
    h('dt', null, 'held'), h('dd', null, model.held().length ? `${model.held().map((x) => x.label).join(' · ')}${M.stretch ? ` · stretch ${M.stretch}` : ''}` : 'nothing'),
    h('dt', null, 'given'), h('dd', null, givenAny() ? `${givenWords()} (read from the answer, not asked of the matcher)` : 'nothing'),
    h('dt', null, 'named'), h('dd', null, names.length ? names.map((x) => `${x.who}: ${x.p.name}`).join(' · ') : 'no catalogue name fits')];
  if (ui.drawer === 'windows') {
    mount(el, head('Windows', hero ? `${hero.mode === 'nearest' ? 'The closest recorded windows, distinct in time' : hero.mode === 'held' ? 'Windows that keep everything held, closest in shape first' : 'No window keeps everything held: the nearest, each with what it breaks'} · click a column to sort, a row to inspect it` : ''), body);
    windowsTable(body);
  } else if (ui.drawer === 'g1') {
    mount(el, head('g1', 'Every endpoint ranked, equal prices sharing a rank, then each bar’s direction.', copy), body);
    mount(body, h('div', { class: 'g1' }, h('code', null, code), h('dl', null, terms())));
  } else {
    mount(el, head('Limen', 'Hand-off of this shape as a rule. Not connected: nothing is sent anywhere.',
      h('button', { type: 'button', disabled: true, title: 'The Limen connection is not wired in this bench' }, 'Send to Limen')), body);
    mount(body, h('div', { class: 'handoff' },
      h('div', null, label('What would be handed over'), h('dl', null, h('dt', null, 'pattern'), h('dd', null, code), terms(),
        h('dt', null, 'history'), h('dd', null, engine.state.ready ? `BTCUSDT · ${int(engine.state.bars)} bars to ${day.format(new Date(engine.state.to * 1000))}` : 'loading'))),
      h('div', null, label('Still to declare before it is a strategy'), h('ul', null,
        ['Entry: the first open after the shape’s last close.', 'Exit: stop, target and expiry, with a declared intrabar policy.', 'Costs: fees and slippage on their own ledger.', 'Holdout: one chronological holdout, sealed before the search.',
          'This bench counts what followed recorded windows. It is a study, not a backtest.'].map((t) => h('li', null, t))))));
  }
}

// ---------------------------------------------------------------- panels, keys, start

function togglePanel(p, force) {
  if (p === 'left' || p === 'right') ui[p] = force ?? !ui[p]; else ui.drawer = ui.drawer === p ? null : p;
  persist(); render();
  if (p === 'left' && ui.left) countCatalogue();
  const el = p === 'left' || p === 'right' ? $('#' + p) : $('#drawer');
  if (!el.hidden && !document.hidden) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true }); }
}
for (const b of document.querySelectorAll('.toggles button')) b.addEventListener('click', () => togglePanel(b.dataset.panel));
document.addEventListener('keydown', (e) => {
  // Where a key was pressed is the event's own target. The focus cannot say: a control that acted on the key may have
  // been redrawn by now, leaving the focus on the page. And a key a control has already taken is not a shortcut too.
  const at = e.target instanceof Element ? e.target : document.body;
  if (e.defaultPrevented || /INPUT|TEXTAREA|SELECT/.test(at.tagName) || !ctx) return;
  const mod = e.metaKey || e.ctrlKey; const k = e.key.toLowerCase();
  if (mod && (k === 'z' || k === 'y')) { e.preventDefault(); if ((k === 'y' || e.shiftKey ? model.redo() : model.undo())) { state.message = ''; ask(); } return; }
  if (mod || e.altKey) return;
  if (e.key === 'Escape') {
    // one thing at a time, nearest first: a menu, a half-made hold, hold mode, the pick on the picked later bar, the column, every pick
    if (menuOpen()) closeMenu(); else if (state.pend) { state.pend = null; render(); } else if (state.hold) toggleHold(false);
    else if (state.col?.after && M.given[state.col.after - 1] !== '-') give(state.col.after, -1);
    else if (state.col) { state.col = null; render(); }
    else if (givenAny()) { model.giveAll(NO_GIVEN); render(); }
    return;
  }
  if (k === 'h' && !at.closest('.pop')) { e.preventDefault(); closeMenu(); toggleHold(); return; }
  if (state.hold && !at.closest('.pop, table, button, a, [role="button"]') && holdKey(e)) return;
  const map = { p: 'left', i: 'right', w: 'windows', g: 'g1', l: 'limen' };
  if (map[k]) { e.preventDefault(); togglePanel(map[k]); return; }
  if (e.key === ',' || e.key === '.' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    // the columns in order: the drawn bars, then the six bars after them
    e.preventDefault(); const d = e.key === ',' || e.key === 'ArrowLeft' ? -1 : 1; const bars = M.bars.length;
    const from = state.col?.after ? bars - 1 + state.col.after : M.sel; const to = Math.max(0, Math.min(bars - 1 + AFTER, from + d));
    if (to >= bars) state.col = { after: to - bars + 1 };
    else { M.sel = to; state.lane = 'draw'; state.col = ui.right ? { bar: M.sel } : null; }
    render(); return;
  }
  if (['1', '2', '3', '0'].includes(e.key) && !at.closest('.pop')) {
    // on a picked later bar: 1 above the high, 2 inside, 3 below the low, 0 frees it
    e.preventDefault(); const j = state.col?.after;
    if (!j) { state.message = 'Pick a later bar first: . moves to +1'; render(); return; }
    // freeing a pick never needs windows to narrow; setting one does
    if (e.key === '0') { if (M.given[j - 1] !== '-') give(j, -1); return; }
    if (!condOf(ctx.lanes[0])) { state.message = 'No complete windows to narrow'; render(); return; }
    give(j, +e.key - 1);
    return;
  }
  if (e.key === '+' || e.key === '=') { e.preventDefault(); if (model.add()) ask(); return; }
  if (e.key === '-' || e.key === '_') { e.preventDefault(); if (model.remove()) ask(); return; }
  if (e.key === ' ' && !at.closest('button, a, [role="button"], tr')) { e.preventDefault(); model.flip(); ask(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (at.closest('.pop, table')) return;
    e.preventDefault();
    if (e.shiftKey) { const [lo, hi] = extent(ohlc(M.bars)); model.nudge(M.sel, (e.key === 'ArrowUp' ? 1 : -1) * (hi - lo) * 0.03); state.lane = 'draw'; ask(); return; }
    const row = ctx.all.findIndex((l) => l.id === state.lane); const next = ctx.all[row + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) { state.col = null; selectLane(next); }
  }
});

model.readAddress(location.hash);   // an unreadable address starts from the opening drawing
ask();
// A link opened in a tab that already shows the bench names the drawing to show. The bench writes its own address
// with replaceState, which raises no hashchange; a fragment that names what is already shown changes nothing.
window.addEventListener('hashchange', () => {
  if (location.hash.slice(1) === encode()) return;
  const was = model.snapshot(true);   // with the terms: a link replaces them, and undo must bring them back
  if (!model.readAddress(location.hash)) { render(); return; }   // unreadable: the bench stays as it is, and says so in the address
  model.record(was); closeMenu(); showDrawing(); ask();
});
$('#coltrack').addEventListener('mousemove', (e) => { const n = ctx?.read?.node; if (n) hover(n, e); });
$('#coltrack').addEventListener('mouseleave', unhover);
$('#coltrack').addEventListener('click', (e) => {
  const g = ctx?.trackGeo; if (!g?.cellAt || !ctx.readCd || state.hold) return;
  const box = $('#coltrack').getBoundingClientRect(); const cell = g.cellAt(e.clientX - box.left, e.clientY - box.top);
  if (cell) { state.col = { after: cell.after }; give(cell.after, cell.z); }
});
let timer; window.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(render, 120); });
