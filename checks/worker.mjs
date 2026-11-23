// The matcher for the checks, under Node. Every check that asks the matcher gets it from here, so the way it is
// loaded is written once.
//
// matcher.js is a worker script: it is read as text and run as a function, which hands back the parts the checks
// drive directly. `observeYield` tells a check each time the matcher gives way to other tasks.
import fs from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** What a check must do before it imports the bench's modules. Nothing, while they stand on their own. */
export function install() {}

/** The matcher's functions: decode, decodeActivity, readings, search, and setters for its bars, readings and latest question. */
export async function openWorker(file = resolve(ROOT, 'matcher.js')) {
  const source = fs.readFileSync(file, 'utf8');
  return new Function('self', 'window', source + `
    ;let yieldObserver = null; const originalTick = tick; tick = () => { yieldObserver?.(); return originalTick(); };
    return { decode, decodeActivity, readings, search,
      setBars: t => { BARS = t; }, setRead: r => { READ = r; }, setLatest: v => { latest = v; }, observeYield: f => { yieldObserver = f; } };`)(undefined, undefined);
}
