// Composer's counter bridge and drawing controls against the literal vectors shared with Filang.
// The engine encodes and matches; the fixture supplies the expected dimension orders independently.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openWorker } from './worker.mjs';
const worker = await openWorker();
const { createModel, dimPart, DIMENSIONS, DIMENSIONS_REVISION } = await import('../bench/model.js');
const { vectors, dimensions } = JSON.parse(readFileSync(new URL('./dimension-vectors.json', import.meta.url)));
assert.deepEqual(DIMENSIONS.map((d) => d.name), dimensions);
const value = {
  volume: (v, b, n) => v, trades: (v, b, n) => n, delta: (v, b) => 2 * b - v,
  size: (v, b, n) => n ? v / n : null, imbalance: (v, b) => v ? (2 * b - v) / v : null,
};
let id = 0, checked = 0;
for (const vector of vectors) {
  const n = vector.bars.length;
  const table = { name: '15m', sec: 900, n, ts: Float64Array.from({ length: n }, (_, i) => 1700000100 + i * 900),
    run: Int32Array.from({ length: n }, (_, i) => i + 1), atr: new Float64Array(n).fill(NaN) };
  for (const [k, name] of ['O', 'H', 'L', 'C'].entries()) table[name] = Int32Array.from(vector.bars, (b) => b[k]);
  worker.setBars([table]);
  worker.giveCounters(worker.filang, [table], [{ name: '15m', n,
    vol: vector.bars.map((b) => b[4]), tbvol: vector.bars.map((b) => b[5]), cnt: vector.bars.map((b) => b[6]) }]);
  const rows = vector.chained.slice(5).split(';').map((row) => {
    const [l, lo, hi, h, d] = row.split(',');
    return d === 'd' ? [+hi, +h, +l, +lo] : [+lo, +h, +l, +hi];
  });
  for (let mask = 0; mask < 32; mask++) {
    const selected = dimensions.filter((_, i) => mask & (1 << i));
    if (selected.some((name) => vector.parts[name] === null)) continue;
    const parts = selected.map((name) => vector.parts[name]);
    const packet = { ...worker.packet({ bars: rows }), ...(parts.length ? { revision: DIMENSIONS_REVISION, dimensions: parts } : {}) };
    worker.setLatest(++id);
    const answer = await worker.ask({ packet, tfs: [1, 0, 0, 0, 0], next: null }, id, () => {});
    assert.equal(answer.exact[0], 1, `${vector.name}: ${parts.join('|') || 'price alone'}`);
    if (n >= 2) {
      const model = createModel(); assert.equal(model.readPacket(JSON.stringify(packet)), null);
      assert.equal(model.code(), vector.chained + (parts.length ? '|' + parts.join('|') : ''));
      const back = createModel(); assert.ok(back.readAddress(model.address())); assert.equal(back.code(), model.code());
      selected.forEach((name) => assert.equal(dimPart(name, vector.bars.map((b) => value[name](...b.slice(4)))), vector.parts[name]));
    }
    checked++;
  }
}
console.log(`Composer's bridge and drawings agree with ${vectors.length} shared dimension vectors in ${checked} questions.`);
