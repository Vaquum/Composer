// Real-history timing and worker yielding; run through checks/with_bars.py.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
const root=process.cwd();
const M=new Function('self','window',fs.readFileSync(root+'/matcher.js','utf8')+`;return {decode,decodeActivity,readings,search,setBars:t=>{BARS=t},setRead:t=>{READ=t},setLatest:v=>{latest=v}};`)(undefined,undefined);
const file=process.argv[3];
const bytes=f=>{const b=fs.readFileSync(f);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length)};
let t=performance.now();const history=M.decode(bytes(file));M.setBars(history);console.log(JSON.stringify({stage:'decode',ms:performance.now()-t,bars:history.reduce((a,x)=>a+x.n,0),through:new Date(history[0].ts.at(-1)*1000).toISOString()}));
t=performance.now();const A=M.decodeActivity(bytes(process.argv[4]));console.log(JSON.stringify({stage:'decode-activity',ms:performance.now()-t}));
t=performance.now();M.setRead(history.map((T,k)=>M.readings(T,A[k])));console.log(JSON.stringify({stage:'precompute-readings',ms:performance.now()-t}));
function bars(n){let c=42;return Array.from({length:n},(_,i)=>{const o=c;c+=i%3===1?-18:14;return[o,Math.max(o,c)+12,Math.min(o,c)-12,c];});}
let id=0;
for(const [name,n,holds,stretch,tf,oriented] of [
['default',2,[],0,[1,1,1,1,1],true],['default-repeat',2,[],0,[1,1,1,1,1],true],['2-bars-only-4h',2,[],0,[0,0,0,0,1],true],['10-bars',10,[],0,[1,1,1,1,1],true],['20-bars',20,[],0,[1,1,1,1,1],true],['20-bars-shape-only',20,[],0,[1,1,1,1,1],false],['2-bars-pin',2,[{color:true,bar:0,dir:1}],0,[1,1,1,1,1],true],['5-bars-pin-stretch-0',5,[{color:true,bar:0,dir:1}],0,[1,1,1,1,1],true],['5-bars-pin-stretch-4',5,[{color:true,bar:0,dir:1}],4,[1,1,1,1,1],true],['10-bars-pin-stretch-4',10,[{color:true,bar:0,dir:1}],4,[1,1,1,1,1],true],['20-bars-pin-stretch-4',20,[{color:true,bar:0,dir:1}],4,[1,1,1,1,1],true]]){
  const q={bars:bars(n),holds,stretch,tfs:tf,oriented,x:12};M.setLatest(++id);let previous=performance.now(),maxChunk=0,chunks=0;
  t=performance.now();console.log(JSON.stringify({start:name}));
  const r=await M.search(q,id,()=>{const now=performance.now();maxChunk=Math.max(maxChunk,now-previous);previous=now;chunks++;});
  console.log(JSON.stringify({scenario:name,ms:+(performance.now()-t).toFixed(1),reported:r?.ms,maxChunkMs:+maxChunk.toFixed(1),chunks,cohort:r?.panes.n,rows:r?.panes.rows.length,mode:r?.mode}));
  assert.ok(r, 'the current query must complete');
  assert.ok(maxChunk < 100, `${name}: work failed to yield within 100 ms (${maxChunk})`);
  assert.ok(r.ms < 5000, `${name}: search exceeded 5 seconds (${r.ms})`);
}
process.exit(0);
