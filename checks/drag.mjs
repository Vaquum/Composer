// The feel of a drag: the part you hold is a continuous, monotonic function of the pointer, with no jump anywhere.
// Reads the page's own functions (between the "feel of a drag" markers) and walks the pointer across them in 0.01 px
// steps: a press barely moves the part and then catches up one to one, the canvas edges give without a wall, and near
// a level the part eases on, rests exactly on it and eases off, for sparse levels, crowded ones and everything between.
// Usage: node checks/drag.mjs [INDEX_HTML]
import fs from 'node:fs';
const file = process.argv[2] && process.argv[2].endsWith('.html') ? process.argv[2] : 'index.html';
const html = fs.readFileSync(file, 'utf8');
const from = html.indexOf('/* ---- the feel of a drag'), to = html.indexOf('/* ---- end of the feel ---- */');
if (from < 0 || to < from) { console.log('the feel of a drag is not marked in the page'); process.exit(1); }
const { SLOP, GIVE, DETENT_REACH, DETENT_REST, eased, give, detent, markSet } = new Function(`${html.slice(from, to)}; return { SLOP, GIVE, DETENT_REACH, DETENT_REST, eased, give, detent, markSet };`)();

const fails = [];
const STEP = 0.01, MAX_SLOPE = 2.5;
// walk f across [a, b]: no step may move further than MAX_SLOPE times the pointer, and nothing may move backwards
function walk(name, f, a, b) {
  let prev = f(a), worst = 0;
  for (let u = a + STEP; u <= b; u += STEP) {
    const y = f(u), d = y - prev;
    if (d < -1e-9) { fails.push(`${name}: moves backwards at ${u.toFixed(2)} px`); return; }
    worst = Math.max(worst, d / STEP); prev = y;
  }
  if (worst > MAX_SLOPE) fails.push(`${name}: jumps (pace ${worst.toFixed(2)} times the pointer's)`);
  return worst;
}

// a press: a hair barely moves the part; beyond about two slops it is exactly under the pointer
walk('eased', eased, -60, 60);
if (eased(0) !== 0) fails.push('eased: a press with no movement moves the part');
if (Math.abs(eased(1)) > 0.15) fails.push(`eased: a 1 px tremor moves the part ${eased(1).toFixed(2)} px`);
for (const dy of [2.5 * SLOP, 4 * SLOP, 30, -30]) if (Math.abs(eased(dy) - dy) > 0.01 * Math.abs(dy)) fails.push(`eased: still behind the pointer at ${dy} px`);

// the canvas edge: one to one inside, a smooth give past it, never a wall and never past GIVE
walk('give', u => give(u, 0, 500), -400, 900);
for (const u of [0, 250, 500]) if (give(u, 0, 500) !== u) fails.push(`give: moves the part inside the canvas at ${u}`);
if (!(give(-1e4, 0, 500) >= -GIVE) || !(give(1e4, 0, 500) <= 500 + GIVE)) fails.push('give: runs past its give');

// levels: sparse, crowded, clustered, repeated
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const cases = [[], [100], [100, 400], [100, 103], [100, 101, 102, 140], [0, 9, 18, 27, 36, 45]];
for (let n = 0; n < 40; n++) cases.push(Array.from({ length: 1 + Math.floor(rand() * 24) }, () => Math.round(rand() * 600 * 4) / 4));
let rests = 0;
for (const raw of cases) {
  const marks = markSet(raw.map(y => ({ y }))).map(m => m.y);
  for (let k = 1; k < marks.length; k++) if (!(marks[k] > marks[k - 1])) fails.push('markSet: levels are not ascending and distinct');
  const name = `detent over [${marks.join(', ')}]`;
  walk(name, u => detent(u, marks).y, -50, 650);
  for (let u = -50; u <= 650; u += 0.25) {
    const r = detent(u, marks);
    if (r.at && r.y !== marks[r.j]) fails.push(`${name}: rests near ${marks[r.j]} without being exactly on it`);
    if (r.j < 0 && r.y !== u) fails.push(`${name}: moves the part away from the pointer at ${u} with no level near`);
    if (!(r.near >= 0 && r.near <= 1)) fails.push(`${name}: nearness ${r.near} outside 0 to 1`);
    if (Math.abs(r.y - u) > DETENT_REACH) fails.push(`${name}: the part strays ${Math.abs(r.y - u).toFixed(2)} px from the pointer`);
  }
  // every level with room around it holds the part exactly over a stretch of pointer travel
  marks.forEach((m, k) => {
    const room = Math.min(DETENT_REACH, k > 0 ? (m - marks[k - 1]) / 2 : DETENT_REACH, k < marks.length - 1 ? (marks[k + 1] - m) / 2 : DETENT_REACH);
    if (room < 3) return;
    const held = [-1, 0, 1].every(t => { const r = detent(m + t * Math.min(DETENT_REST, room * 0.35) * 0.9, marks); return r.at && r.y === m; });
    if (!held) fails.push(`${name}: does not rest on ${m}`); else rests++;
  });
}

console.log(`a press eases into a drag (a 1 px tremor moves ${eased(1).toFixed(3)} px; one to one from ${(2.5 * SLOP).toFixed(1)} px), the canvas edge gives up to ${GIVE} px, and ${cases.length} sets of levels were walked in ${STEP} px steps with ${rests} rests found: ${fails.length ? fails.length + ' failures' : 'no jump, no step back'}`);
for (const f of fails.slice(0, 20)) console.log('  ' + f);
process.exit(fails.length ? 1 : 0);
