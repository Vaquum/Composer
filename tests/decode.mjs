// Decode a bars payload (or, with --activity, an activity payload, or, with --counters, a counters payload) with matcher.js
// and print it as JSON, for tests/test_bars.py. Counters are printed as hexadecimal floats, as Python's float.hex writes
// them, so that the test compares bits.
// Usage: node tests/decode.mjs MATCHER_JS [--activity | --counters] FILE
import fs from 'node:fs';
const args = process.argv.slice(2), activity = args.includes('--activity'), counters = args.includes('--counters'), [matcher, file] = args.filter(a => !a.startsWith('--'));
const { decode, decodeActivity, decodeCounters } = await import((await import('node:url')).pathToFileURL((await import('node:path')).resolve(matcher)).href);
const b = fs.readFileSync(file), buffer = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
// a finite nonnegative double as float.hex writes it: 0x1.<13 hex digits>p<exponent>, or 0x0.0p+0
function hex(x) {
  if (x === 0) return '0x0.0p+0';
  const bits = new DataView(new ArrayBuffer(8)); bits.setFloat64(0, x);
  const high = bits.getUint32(0), exponent = (high >>> 20) & 0x7ff, mantissa = (high & 0xfffff).toString(16).padStart(5, '0') + bits.getUint32(4).toString(16).padStart(8, '0');
  const e = exponent ? exponent - 1023 : -1022;
  return `0x${exponent ? 1 : 0}.${mantissa}p${e < 0 ? '-' : '+'}${Math.abs(e)}`;
}
const out = counters
  ? decodeCounters(buffer).map(C => ({ name: C.name, n: C.n, vol: Array.from(C.vol, hex), tbvol: Array.from(C.tbvol, hex), cnt: Array.from(C.cnt) }))
  : activity
  ? decodeActivity(buffer).map(A => ({ name: A.name, n: A.n, vol: Array.from(A.vol), quote: Array.from(A.quote), trades: Array.from(A.trades), maker: Array.from(A.maker) }))
  : decode(buffer).map(T => ({ name: T.name, sec: T.sec, ts: Array.from(T.ts), O: Array.from(T.O), H: Array.from(T.H), L: Array.from(T.L), C: Array.from(T.C), run: Array.from(T.run) }));
process.stdout.write(JSON.stringify(out));
