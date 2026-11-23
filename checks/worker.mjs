// Composer's worker and model for the checks, under Node. The page gets the shared Filang engine from /engine/; here
// that path is the folder COMPOSER_ENGINE_DIR names, or ./engine as engine.py leaves it.
//
// The checks ask in the terms they were written in: the drawn bars as open-high-low-close rows and a list of held
// relations. `asPacket` turns that into the drawing packet the worker takes, and refuses a hold a packet cannot say.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const engineDir = () => resolve(ROOT, process.env.COMPOSER_ENGINE_DIR || 'engine');

let installed = false;
/** Make /engine/ resolve under Node, and let the engine read its own file. Needed before importing bench/model.js. */
export function install() {
  if (installed) return;
  installed = true;
  const engine = pathToFileURL(engineDir() + '/').href;
  register('data:text/javascript,' + encodeURIComponent(`
    export function resolve(spec, context, next) {
      if (spec.startsWith('/engine/')) return { url: new URL(spec.slice(8), ${JSON.stringify(engine)}).href, shortCircuit: true };
      return next(spec, context);
    }`), import.meta.url);
  const web = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof URL ? input.href : input);
    if (!url.startsWith('file:')) return web(input, init);
    return new Response(await readFile(new URL(url)), { headers: { 'Content-Type': url.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } });
  };
}

const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const priceOf = ([o, h, l, c], kind) => [o, h, l, c, Math.min(o, c), Math.max(o, c)][kind];
/**
 * The drawing packet for rows and held relations. A relation is `{ a: [bar, kind], b: [bar, kind], rel }` with kind
 * 0 open, 1 high, 2 low, 3 close, 4 body bottom, 5 body top, or `{ color: true, bar, dir }`. Each becomes a pin, and
 * must be one the drawing itself keeps: a pin holds whichever way its two points lie as drawn.
 */
export function asPacket(revision, { bars, holds = [], stretch = 0, x = 12, oriented = true, skeleton = 0, pins = null }) {
  const part = (bar, kind) => {
    if (kind === 1) return 'H'; if (kind === 2) return 'L';
    const up = sign(bars[bar][3] - bars[bar][0]) >= 0;
    if (kind === 0 || kind === 3) { assert.ok(oriented, 'an open or a close needs directions kept'); return (kind === 3) === up ? 'T' : 'B'; }
    assert.ok(!oriented, 'a body end is an open or a close when directions are kept');
    return kind === 5 ? 'T' : 'B';
  };
  const made = pins || holds.map((h) => {
    if (h.color) { assert.equal(h.dir, sign(bars[h.bar][3] - bars[h.bar][0]), 'a colour is held as drawn'); return { bar: h.bar, color: true }; }
    assert.equal(h.rel, sign(priceOf(bars[h.a[0]], h.a[1]) - priceOf(bars[h.b[0]], h.b[1])), 'a relation is held as drawn');
    return { a: { bar: h.a[0], part: part(...h.a) }, b: { bar: h.b[0], part: part(...h.b) } };
  });
  return { version: 1, revision, oriented, bars: bars.map(([o, h, l, c]) => ({ v: [l, Math.min(o, c), Math.max(o, c), h], d: c < o ? 'd' : 'u' })),
    pins: made, skeleton, stretch, next: { dir: 0, measure: 'any', bps: 10, atr: 1 }, limit: x };
}

/** The worker's functions with an engine of their own. `search` takes a check's question; `ask` takes the worker's. */
export async function openWorker(file = resolve(ROOT, 'matcher.js')) {
  install();
  const worker = await import(pathToFileURL(file).href);
  const { FilangEngine } = await import('/engine/index.mjs');
  const filang = await FilangEngine.create();
  worker.state.engine = filang;
  const revision = filang.drawingProtocol().plain;
  return {
    ...worker, filang, revision,
    setBars(tables) { worker.give(filang, tables); worker.state.bars = tables; },
    setRead(read) { worker.state.readings = read; },
    setLatest(id) { worker.state.latest = id; },
    observeYield(fn) { worker.state.onYield = fn; },
    packet: (q) => asPacket(revision, q),
    ask: worker.search,
    search: (q, id, report) => worker.search({ packet: asPacket(revision, q), tfs: q.tfs, next: q.next ?? null }, id, report),
  };
}
