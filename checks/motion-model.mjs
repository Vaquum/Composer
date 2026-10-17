import fs from 'node:fs';
import assert from 'node:assert/strict';
const flow = new Function(fs.readFileSync('motion.js','utf8')+'\nreturn TactileFlow;')();
assert.deepEqual([flow.model.stiffness,flow.model.damping,flow.model.mass],[180,20,1]);
let x=0,v=0;
for(let i=0;i<8;i++){const n=flow.integrate(x,v,100,.016);x=n.position;v=n.velocity;}
assert.ok(x>0&&x<100&&v>0);
const reverse=flow.integrate(x,v,0,.001);
assert.ok(reverse.position>x&&reverse.velocity>0,'reversing a request preserves forward momentum');
for(let i=0;i<200;i++){const n=flow.integrate(x,v,0,.008);x=n.position;v=n.velocity;}
assert.ok(Math.abs(x)<.001&&Math.abs(v)<.01,'the reversed spring settles at its latest destination');
const values=[17,-9],velocities=[2,-3];
assert.equal(flow.advance(values,velocities,[20,30],.016,.0008,true),false);
assert.deepEqual(values,[20,30]);assert.deepEqual(velocities,[0,0],'reduced motion settles exactly');
assert.equal(flow.advance(values,velocities,[20,30],.016),false,'resting coordinates stay exact');
assert.throws(()=>flow.advance([1],[0],[1],NaN),/finite|non-negative/);
assert.throws(()=>flow.advance([Infinity],[0],[Infinity],.016),/finite|non-negative/);
for(const input of [[NaN,0,1,.01],[0,Infinity,1,.01],[0,0,1,-1]])assert.throws(()=>flow.integrate(...input),/finite|non-negative/);
const frame=[0,100],speed=[0,0];
for(let i=0;i<200;i++){flow.bounds(frame,speed,[49.78,50.22],.016);assert.ok(frame[1]>frame[0],'a collapsing composition cannot invert its frame');}
assert.deepEqual(frame,[49.78,50.22]);
assert.throws(()=>flow.bounds([10,0],[0,0],[0,1],.016),/ordered/);
assert.throws(()=>flow.bounds([0,Infinity],[0,0],[0,Infinity],.016),/finite|non-negative/);
console.log('Tactile model: reversal retains momentum, latest targets settle, reduced motion is exact, invalid input fails.');
