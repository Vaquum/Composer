// The complaints that started this, measured on the real BTCUSDT bars with Composer's default of 12 shown windows:
// a green bar then a red bar must find green then red, also when the exact pattern is rare, and a small green then a
// 10x larger red must find small greens before much larger reds, never a green more than half the red.
// Each drawing is checked with nothing held, and with its first colour held and stretch 2.
// Sizes are compared as the ratio of the two bodies, each as a share of the pair's height plus 2% of it, so very thin
// bodies, which read as lines, do not count as far apart. They are required wherever the drawing can occur: two adjacent bars cannot open the
// second bar away from the first one's close, so a drawing with such a gap is held to its sizes only with stretch,
// where skipped bars make the gap possible; without stretch its sizes are printed for information.
import fs from 'node:fs';
// Usage: node checks/similarity-look.mjs MATCHER_JS BARS_FILE (BARS_FILE as bars.py writes it)
const [matcherFile, barsFile] = process.argv.slice(2);
const M = new Function('self', 'window', fs.readFileSync(matcherFile, 'utf8') + '\nreturn { decode, search, setBars: t => { BARS = t; }, setLatest: v => { latest = v; } };')(undefined, undefined);
const buf = fs.readFileSync(barsFile);
M.setBars(M.decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)));
const dir = b => (b[3] > b[0] ? 'u' : b[3] < b[0] ? 'd' : 'z');
const body = b => Math.abs(b[3] - b[0]);
// first body over second body, each as a share of the pair's height plus 2%; a doji drawing is checked for colours only
const ratio = bars => { const lo = Math.min(bars[0][2], bars[1][2]), h = Math.max(bars[0][1], bars[1][1]) - lo || 1; return (body(bars[0]) / h + 0.02) / (body(bars[1]) / h + 0.02); };
const raw = bars => body(bars[0]) / Math.max(1e-9, body(bars[1]));
const DRAWINGS = [
  ['green, then a larger red', [[42, 68, 30, 56], [62, 80, 18, 36]], true],
  ['small green, then a 10x larger red', [[50, 51.2, 49.7, 51], [51, 51.5, 39, 40]], true],
  ['red hammer, then a green', [[50, 50.3, 44, 49], [49, 53, 48.6, 52.6]], true],
  ['big green, then a small red inside it', [[40, 52, 39, 51], [48, 48.8, 46.5, 47]], true],
  ['green, then a red opening at its open, equal highs (rare)', [[45, 55, 44, 54], [45, 55, 40, 41]], true],
  ['green marubozu, then a red opening at its close (rare)', [[40, 50, 40, 50], [50, 50.5, 44, 45]], true],
  ['green, then a doji at its high (rare)', [[40, 50, 39, 49], [50, 51, 49.5, 50]], false],
];
let id = 0, bad = 0;
for (const [title, bars, sizes] of DRAWINGS) {
  const want = bars.map(dir).join(''), r0 = ratio(bars), gap = bars[1][0] !== bars[0][3];
  for (const [how, holds, stretch] of [['nothing held', [], 0], ['first colour held, stretch 2', [{ color: true, bar: 0, dir: bars[0][3] > bars[0][0] ? 1 : -1 }], 2]]) {
    M.setLatest(++id);
    const t = Date.now(), r = await M.search({ bars, holds, stretch, x: 12, tfs: [1, 1, 1, 1, 1], oriented: true, next: null }, id, () => {}), ms = Date.now() - t;
    const kept = r.results.filter(x => x.drawn.map(dir).join('') === want).length, rs = r.results.map(x => ratio(x.drawn));
    const far = rs.filter(x => Math.abs(Math.log(x / r0)) > Math.log(2)).length, sized = sizes && (!gap || stretch > 0);
    const overHalf = title.startsWith('small green') ? r.results.filter(x => raw(x.drawn) > 0.5).length : 0;
    // colours always kept; sizes: at most one of the 12 more than twice off the drawing's body ratio
    const ok = r.results.length === 12 && kept === 12 && (!sized || far <= 1) && overHalf === 0;
    if (!ok) bad++;
    console.log(`${title}, ${how}: colours ${want} kept ${kept}/${r.results.length}${sizes ? ` · body ratio drawn ${r0.toFixed(2)}, shown median ${[...rs].sort((a, b) => a - b)[rs.length >> 1].toFixed(2)}, more than 2x off ${far}/${rs.length}${sized ? '' : ' (gap between the drawn bars: not required without stretch)'}` : ''}${title.startsWith('small green') ? ` · green more than half the red ${overHalf}` : ''} · flips ${r.results.map(x => x.flips).join(',')} · ${ms} ms`);
  }
}
console.log(bad ? `${bad} case(s) look wrong` : 'every drawing finds its own colours and, where it has them, its proportions');
process.exit(bad ? 1 : 0);
