// Decode a bars payload (or, with --activity, an activity payload) with matcher.js and print it as JSON, for tests/test_bars.py.
// Usage: node tests/decode.mjs MATCHER_JS [--activity] FILE
import fs from 'node:fs';
const args = process.argv.slice(2), activity = args.includes('--activity'), [matcher, file] = args.filter(a => a !== '--activity');
const { decode, decodeActivity } = new Function('self', 'window', fs.readFileSync(matcher, 'utf8') + '\nreturn { decode, decodeActivity };')(undefined, undefined);
const b = fs.readFileSync(file), buffer = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
const out = activity
  ? decodeActivity(buffer).map(A => ({ name: A.name, n: A.n, vol: Array.from(A.vol), quote: Array.from(A.quote), trades: Array.from(A.trades), maker: Array.from(A.maker) }))
  : decode(buffer).map(T => ({ name: T.name, sec: T.sec, ts: Array.from(T.ts), O: Array.from(T.O), H: Array.from(T.H), L: Array.from(T.L), C: Array.from(T.C), run: Array.from(T.run) }));
process.stdout.write(JSON.stringify(out));
