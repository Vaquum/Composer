// The shared Filang engine in the page. It reads drawings here: a drawing's g1 code, what it holds, its skeleton and
// the catalogue names that fit it. The worker (matcher.js) holds its own copy with the bars and asks it what matches.
import { FilangEngine } from '/engine/index.mjs';

/** The engine's compiled module. The page compiles it once and hands it to the worker, so it is downloaded once. */
export const engineModule = await WebAssembly.compileStreaming(fetch(new URL('./filang_engine.wasm', import.meta.resolve('/engine/index.mjs'))));
/** Importing this module waits for the engine. */
export const filang = await FilangEngine.create(engineModule);

const norm = (s) => s.normalize('NFKC').trim().toLowerCase();
const patterns = filang.catalogue().patterns;
const named = new Map();
for (const p of patterns) for (const key of [p.id, ...p.labels]) if (!named.has(norm(key))) named.set(norm(key), p);
/** The engine's catalogue of named candles, and the candle an id, a name, an alias or a translation names. */
export const Candles = { patterns, resolve: (name) => (typeof name === 'string' ? named.get(norm(name)) : undefined) };
/** The revision a plain drawing packet is marked with. */
export const DRAWING_REVISION = filang.drawingProtocol().plain;
