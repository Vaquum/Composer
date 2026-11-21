// Compare every profile with an independent geometric definition on a finite grid.
// The grid contains diagram coordinates, not observations of a financial market.
import assert from 'node:assert/strict';
import '../patterns.js';
const catalog = globalThis.CandlePatterns;
const grid = [];
for (let lo=0; lo<=4; lo++) for (let hi=lo; hi<=4; hi++)
  for (let o=lo; o<=hi; o++) for (let c=lo; c<=hi; c++) grid.push([o,hi,lo,c]);
const expected = (a,b) => {
  const [po,ph,pl,pc] = a, [o,h,l,c] = b;
  const bottom=Math.min(o,c), top=Math.max(o,c), size=top-bottom, lw=bottom-l, uw=h-top;
  const pBottom=Math.min(po,pc), pTop=Math.max(po,pc);
  const opposite=(o<c && po>pc)||(o>c && po<pc);
  const bull=po>pc && o<c && o<=pc && c>=po && (o<pc || c>po);
  const bear=po<pc && o>c && o>=pc && c<=po && (o>pc || c<po);
  const insideBody=pBottom<bottom && top<pTop;
  return {
    'marubozu':size>0 && uw===0 && lw===0, 'doji':size===0 && lw>0 && uw>0,
    'dragonfly-doji':o===c && c===h && h>l, 'gravestone-doji':o===c && c===l && h>l,
    'opening-marubozu':(o===h && c>l && c<o)||(o===l && c<h && c>o),
    'closing-marubozu':(c===h && o>l && o<c)||(c===l && o<h && o>c),
    'engulfing':bull||bear, 'bullish-engulfing':bull, 'bearish-engulfing':bear,
    'harami':insideBody && o!==c, 'harami-cross':insideBody && o===c,
    'window':l>ph||h<pl, 'rising-window':l>ph, 'falling-window':h<pl,
    'tweezer-top':h===ph, 'tweezer-bottom':l===pl, 'meeting-lines':opposite && c===pc, 'separating-lines':opposite && o===po,
    'hammer':size>0 && lw>=2*size && uw<=size/2, 'inverted-hammer':size>0 && uw>=2*size && lw<=size/2,
    'spinning-top':size>0 && lw>size && uw>size,
    'four-price-doji':o===h && h===l && l===c,
    'inside-bar':l>=pl && h<=ph && (l!==pl || h!==ph),
    'outside-bar':l<=pl && h>=ph && (l!==pl || h!==ph)
  };
};
const observed = new Set();
for (const p of catalog.patterns) {
  for (const alias of [p.id,p.name,p.ja,...p.aliases]) assert.equal(catalog.resolve(alias),p);
  assert.equal(catalog.resolve(p.name.toUpperCase()),p);
  if (p.bars===2) assert.equal(catalog.matches(p.id,[grid[0]]),false);
}
for (const a of grid) for (const b of grid) {
  const xs = expected(a,b);
  assert.equal(Object.keys(xs).length,catalog.patterns.length);
  for (const p of catalog.patterns) {
    const actual=catalog.matches(p.id,[a,b]);
    assert.equal(actual,xs[p.id],JSON.stringify([p.id,a,b]));
    if (actual) observed.add(p.id);
  }
}
assert.equal(observed.size,24);
assert.equal(catalog.resolve('  ハンマー  ').id,'hammer');
assert.equal(catalog.resolve('ｶﾗｶｻ').id,'hammer');
assert.equal(catalog.resolve('unknown'),undefined);
assert.throws(()=>catalog.compile('unknown'));
assert(catalog.matches('hammer',[[4,7,0,6]])); // both exact ratio boundaries
assert(!catalog.matches('hammer',[[3,6,0,5]])); // same ordinal endpoints, shorter lower wick
console.log(`All 24 bilingual profiles agree on ${grid.length**2} ordered coordinate pairs, including ties and direction.`);
