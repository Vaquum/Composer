// Decode a bars payload with matcher.js and print it as JSON, for tests/test_bars.py.
// Usage: node tests/decode.mjs MATCHER_JS BARS_FILE
import fs from 'node:fs';
const [matcher, file] = process.argv.slice(2);
const { decode } = new Function('self', 'window', fs.readFileSync(matcher, 'utf8') + '\nreturn { decode };')(undefined, undefined);
const b = fs.readFileSync(file);
const frames = decode(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
process.stdout.write(JSON.stringify(frames.map(T => ({ name: T.name, sec: T.sec, ts: Array.from(T.ts), O: Array.from(T.O), H: Array.from(T.H), L: Array.from(T.L), C: Array.from(T.C), run: Array.from(T.run) }))));
