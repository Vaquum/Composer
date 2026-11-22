// The bench at the root URL, in a real browser on the real bars.
// It must ask the matcher the expected questions, show its answers, and restore shared drawings.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {chromium} from 'playwright';

const [,barsFile,activityFile,python]=process.argv.slice(2);
assert.ok(python,'run through checks/with_bars.py to use its Python runtime');
const began=Date.now();
const origin=spawn(python,['checks/loading_origin.py',barsFile,activityFile],{stdio:['ignore','pipe','pipe']});
let stderr='',startupTimer,browser;
origin.stderr.on('data',bytes=>{stderr+=bytes;});
const exited=new Promise(resolve=>{origin.once('exit',resolve);origin.once('error',resolve);});
const lines=createInterface({input:origin.stdout});
const ready=new Promise((resolve,reject)=>{
  startupTimer=setTimeout(()=>reject(new Error(`bench origin did not start: ${stderr}`)),20000);
  origin.once('error',reject);
  origin.once('exit',code=>reject(new Error(`bench origin exited (${code}): ${stderr}`)));
  lines.on('line',line=>{try{const event=JSON.parse(line);if(event.type==='ready'){clearTimeout(startupTimer);resolve(event.port);}}catch(error){reject(error);}});
});

const START='s=30,42,56,68,u;18,36,56,80,d&o=1&tf=11111&x=12&n=0';
const int=text=>Number(String(text).replace(/[^\d]/g,''));
const sum=a=>a.reduce((x,y)=>x+y,0);
const share=(k,n)=>n>=30?`${(k/n*100).toFixed(1)}%`:'—';

// Every page records what it posts to its matcher and what the matcher answers, so the check reads the questions
// and answers themselves and not only what was drawn from them.
const record=()=>{
  const seen=window.__seen={posted:[],results:[]},Native=Worker;
  window.Worker=class extends Native{constructor(...a){super(...a);const post=this.postMessage.bind(this);
    this.postMessage=(m,t)=>{if(m&&m.type==='query')seen.posted.push({id:m.id,q:JSON.stringify(m.q)});return t?post(m,t):post(m);};
    this.addEventListener('message',e=>{if(e.data&&e.data.type==='result')seen.results.push(e.data);});}};
};
const blocked=()=>{window.Worker=class{constructor(){throw new Error('workers are blocked');}};};
const allFaults=[];
async function open({storage=null,worker=record}={}){
  // reduced motion: heights and marks are set outright, so what is measured is where things end up
  const context=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:'reduce'});
  await context.route(/fonts\.(googleapis|gstatic)\.com/,route=>route.fulfill({status:200,contentType:'text/css',body:''}));
  if(storage)await context.addInitScript(value=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem('composer.bench',JSON.stringify(value));sessionStorage.setItem('seeded','1');}},storage);
  await context.addInitScript(worker);
  const page=await context.newPage(),faults=[];
  page.on('pageerror',error=>faults.push(`uncaught: ${error.message}`));
  page.on('console',message=>{if(message.type()==='error'&&!/\/favicon\.ico$/.test(message.location().url))faults.push(`console: ${message.text()}`);});
  allFaults.push(faults);
  return {page,faults,context};
}
const calm=(faults,when)=>assert.deepEqual(faults,[],`${when}: the page raised an error`);

// ---- the bench, read from outside
const settled=page=>page.waitForFunction(()=>{const d=document.querySelector('#canvas')?.dataset;return !!d&&d.history==='ready'&&d.readings==='ready'&&d.answer==='current'&&d.waiting==='0';},null,{timeout:90000});
const see=page=>page.evaluate(()=>{
  const d=document.querySelector('#canvas').dataset,q=new URLSearchParams(location.hash.slice(1)),text=el=>el?el.textContent.replace(/\s+/g,' ').trim():'';
  const shown=el=>el?el.innerText.replace(/\s+/g,' ').trim():'';
  const drawer=document.querySelector('#drawer');
  return {hash:location.hash.slice(1),s:q.get('s'),o:q.get('o'),tf:q.get('tf'),x:q.get('x'),n:q.get('n'),p:q.get('p')||'',k:q.get('k')||'',st:q.get('st')||'',gv:q.get('gv')||'',
    bars:(q.get('s')||'').split(';').length,first:(q.get('s')||'').split(';')[0],
    lane:document.querySelector('#lanes > .lane.sel')?.dataset.lane,lanes:[...document.querySelectorAll('#lanes > .lane')].map(l=>l.dataset.lane),
    bar:d.bar,col:d.col,holding:document.body.classList.contains('holding'),
    count:text(document.querySelector('#readout b')),readout:shown(document.querySelector('#readout')),status:text(document.querySelector('#status')),
    left:!document.querySelector('#left').hidden,right:!document.querySelector('#right').hidden,drawer:drawer.hidden?null:text(drawer.querySelector('header .title')),
    pager:text(document.querySelector('#pager .fig')),head:text(document.querySelector('#trackhead')),
    receipts:Object.fromEntries([...document.querySelectorAll('#lanes > .lane')].map(l=>[l.dataset.lane,text(l.querySelector('.receipt'))])),
    tracks:Object.fromEntries([...document.querySelectorAll('#lanes > .lane')].map(l=>[l.dataset.lane,text(l.querySelector('.lane-track'))])),
    heights:Object.fromEntries([...document.querySelectorAll('#lanes > .lane')].map(l=>[l.dataset.lane,l.offsetHeight])),
    drawn:text(document.querySelector('#lanes > .lane.draw .lane-svg')),posted:window.__seen.posted.length};
});
const term=(page,name)=>page.evaluate(name=>document.querySelector(`[data-enc="${name}"] .val`).textContent,name);
const rows=async(page,label)=>{await page.click('[data-enc="Rows"]');await page.click(`.pop li button:has-text("${label}")`);};
// Follow a link in the open tab, and return once the bench has taken it: its own listener was added first, so it has
// run by the time this one does.
const go=(page,hash)=>page.evaluate(hash=>new Promise(resolve=>{
  if(location.hash.slice(1)===hash){resolve();return;}
  addEventListener('hashchange',()=>setTimeout(resolve,0),{once:true});location.hash=hash;
}),hash);
// The matcher's answer to a question, as this page got it; null when the page never asked exactly that.
const answerTo=async(page,q)=>{
  const posted=await page.evaluate(()=>window.__seen.posted);
  const ids=posted.filter(p=>isDeepStrictEqual(JSON.parse(p.q),q)).map(p=>p.id);
  return page.evaluate(ids=>{
    const r=ids.map(id=>window.__seen.results.find(r=>r.id===id)).filter(Boolean).pop();
    return r?{mode:r.mode,exactF:r.exactF,countsF:r.countsF,
      contN:r.panes.cont?r.panes.cont.n:null,sequences:r.panes.cont?r.panes.cont.sequences:null,near:r.panes.near.map(v=>v.bars.length),windows:r.results.length}:null;
  },ids);
};
// The Inspect block of a later bar: the three shares it shows, as text.
const barBlock=(page,j)=>page.evaluate(j=>{
  const block=[...document.querySelectorAll('#right .block')].find(b=>b.querySelector('.sec .label')?.textContent===`Bar +${j}`);
  return block?[...block.querySelectorAll('.rate .line b')].slice(0,3).map(b=>b.textContent):null;
},j);
// An independent count of the closing paths the picks leave: written here, not taken from the bench.
const narrow=(sequences,given)=>{
  const kept=sequences.filter(([key])=>[...given].every((g,j)=>g==='-'||key[j]===g)),n=sum(kept.map(([,k])=>k));
  return {n,paths:kept.length,grid:Array.from({length:6},(_,j)=>['U','I','D'].map(z=>sum(kept.filter(([key])=>key[j]===z).map(([,k])=>k))))};
};

try{
  const port=await ready,base=`http://127.0.0.1:${port}`;
  browser=await chromium.launch({headless:true});

  // ---- 1. the bench sends the terms of each drawing and displays the result
  const openingQuery={bars:[[42,68,30,56],[56,80,18,36]],oriented:true,holds:[],stretch:0,x:12,tfs:[1,1,1,1,1],next:null};
  const lowPin={a:[0,2],b:[1,2],rel:1};
  const skeleton=[
    {a:[0,0],b:[1,1],rel:-1}, {a:[0,0],b:[1,2],rel:1}, {a:[0,0],b:[1,3],rel:1},
    {a:[1,1],b:[1,2],rel:1}, {a:[1,1],b:[1,3],rel:1}, {a:[1,2],b:[1,3],rel:-1},
    {a:[1,1],b:[0,1],rel:1}, {a:[1,2],b:[0,2],rel:-1},
  ];
  const cases=[
    {name:'one pin',holds:[lowPin],stretch:0,hash:'&p=0L.1L'},
    {name:'a pin and a colour',holds:[lowPin,{color:true,bar:0,dir:1}],stretch:0,hash:'&p=0L.1L,c0'},
    {name:'skeleton 1 with stretch 1',holds:skeleton,stretch:1,hash:'&k=1&st=1'},
  ];
  const {page,faults}=await open();
  const press=key=>page.keyboard.press(key);
  // to later bar +j, by the keys, from wherever the column is: back to the first bar, then on
  const column=async j=>{for(let i=0;i<9;i++)await press(',');const n=(await see(page)).bars;for(let i=0;i<n-1+j;i++)await press('.');assert.equal((await see(page)).col,`+${j}`,`the keys must reach +${j}`);};
  const response=await page.goto(`${base}/`,{waitUntil:'domcontentloaded'});await settled(page);
  assert.equal(response.url(),`${base}/`,'the bench must be served directly at the root');
  let v=await see(page);
  assert.equal(v.hash,START,'the bench must open on the default drawing');
  const opening=await answerTo(page,openingQuery);
  assert.equal(opening?.mode,'nearest','the default drawing must ask for nearest matches');
  assert.equal(int(v.count),sum(opening.exactF),'the readout must show the exact twins the matcher counted');
  assert.deepEqual(v.lanes,['draw','tf0','tf1','tf2','tf3','tf4'],'timeframes: one row per timeframe under the drawing');
  for(let k=0;k<5;k++)assert.equal(int(v.receipts['tf'+k].split(' of ')[0]),opening.exactF[k],`timeframe ${k}: the row must show the matcher's own count for it`);
  await rows(page,'Closing paths');   // no row asks the matcher here, so each held case costs one question
  for(const {name,holds,stretch,hash} of cases){
    await go(page,START+hash);await settled(page);v=await see(page);
    const held=await answerTo(page,{...openingQuery,holds,stretch});
    assert.equal(held?.mode,'held',`${name}: the bench must ask the matcher to keep the holds`);
    assert.equal(int(v.count),sum(held.countsF),`${name}: the readout must show the windows that keep what is held`);
    assert.match(v.readout,/keeps? /,`${name}: the readout must say the count is windows that keep the holds`);
    await page.click('[data-enc="Timeframes"]');
    assert.deepEqual((await page.locator('.pop li .fig').allTextContents()).map(int),held.countsF,`${name}: the timeframes must show the matcher's split`);
    await press('Escape');
  }
  await go(page,START);await rows(page,'Timeframes');await settled(page);
  calm(faults,'matching');

  // ---- 2. every key does its job
  const after=async(key,what,test)=>{await press(key);const now=await see(page);assert.ok(test(now),`${key}: ${what} (${JSON.stringify({lane:now.lane,bar:now.bar,col:now.col,p:now.p,gv:now.gv,bars:now.bars,holding:now.holding,status:now.status,left:now.left,right:now.right,drawer:now.drawer})})`);return now;};
  await after('ArrowDown','moves to the first row',n=>n.lane==='tf0');
  await after('ArrowDown','moves to the second row',n=>n.lane==='tf1');
  await press('ArrowUp');await after('ArrowUp','returns to the drawing',n=>n.lane==='draw');
  await after('ArrowLeft','picks the bar before',n=>n.bar==='1'&&n.col==='bar 1');
  await after('ArrowRight','picks the bar after',n=>n.bar==='2'&&n.col==='bar 2');
  await after(',','picks the bar before',n=>n.bar==='1');
  await after('.','picks the bar after',n=>n.bar==='2');
  await after('.','walks on to the first later bar',n=>n.col==='+1');
  for(let j=2;j<=6;j++)await after('ArrowRight',`walks on to +${j}`,n=>n.col===`+${j}`);
  await after('.','stops at the last later bar',n=>n.col==='+6');
  for(let j=5;j>=1;j--)await after(',',`walks back to +${j}`,n=>n.col===`+${j}`);
  await after('1','picks above',n=>n.gv==='U-----');
  await after('2','replaces the pick with inside',n=>n.gv==='I-----');
  await after('3','replaces the pick with below',n=>n.gv==='D-----');
  await after('0','frees the bar',n=>n.gv==='');
  await after('Control+z','undoes the release',n=>n.gv==='D-----');
  await after('Control+Shift+z','redoes it',n=>n.gv==='');
  await after('Escape','leaves the column',n=>n.col==='');
  await after('ArrowLeft','returns from the later bars to the drawn ones',n=>n.bar==='1');await press('ArrowRight');
  v=await see(page);
  let was=await after('Space','flips the first bar and asks again',n=>n.first!==v.first&&/,d$/.test(n.first)&&n.posted>v.posted);
  await after('Control+z','undoes the flip',n=>n.s===v.s);
  was=await see(page);
  await after('Shift+ArrowUp','nudges the picked bar up and asks again',n=>n.s!==v.s&&n.posted>was.posted);
  await after('Control+z','undoes the nudge',n=>n.s===v.s);
  await after('Shift+ArrowDown','nudges the picked bar down',n=>n.s!==v.s);
  await after('Control+z','undoes the nudge',n=>n.s===v.s);
  await after('Equal','adds a bar',n=>n.bars===3&&n.bar==='3');
  await after('Minus','removes it',n=>n.bars===2);
  await after('Control+z','undoes the removal',n=>n.bars===3);
  await after('Control+z','undoes the addition',n=>n.s===v.s);
  await after('Shift+Equal','adds a bar, as + too',n=>n.bars===3);await after('Shift+Minus','removes it, as _ too',n=>n.bars===2);
  await press('Control+z');await after('Control+z','undoes both',n=>n.s===v.s);
  await after('h','enters hold mode',n=>n.holding);
  await after('Enter','picks the first point',n=>/second point/.test(n.status)&&n.p==='');
  await press('ArrowLeft');await after('Enter','holds the relation between the two points',n=>n.p==='1H.0H'&&n.holding);
  await after('c','holds the bar\'s colour',n=>n.p==='1H.0H,c0');
  await after('Backspace','releases the last hold',n=>n.p==='1H.0H');
  await after('Escape','leaves hold mode',n=>!n.holding);
  await after('Control+z','undoes the release',n=>n.p==='1H.0H,c0');
  await press('Control+z');await after('Control+z','undoes both holds',n=>n.p==='');
  await after('Control+Shift+z','redoes the first hold',n=>n.p==='1H.0H');
  await after('Control+z','undoes it again',n=>n.p===''&&n.s===v.s);
  await after('p','opens Patterns',n=>n.left);await after('p','closes Patterns',n=>!n.left);
  await after('i','closes Inspect',n=>!n.right);await after('i','opens Inspect',n=>n.right);
  for(const [key,title] of [['w','Windows'],['g','g1'],['l','Limen']]){await after(key,`opens ${title}`,n=>n.drawer===title);await after(key,`closes ${title}`,n=>n.drawer===null);}
  await settled(page);v=await see(page);
  assert.equal(v.hash,START,'the keys, undone, must leave the opening drawing');
  calm(faults,'the keys');

  // ---- 3. every rows mode draws its rows, and a selected row opens
  await page.click('#lanes > .lane[data-lane="tf2"] .lane-head .text');v=await see(page);
  assert.equal(v.lane,'tf2');assert.ok(v.heights.tf2>v.heights.tf0*1.4,`a selected row must open: ${JSON.stringify(v.heights)}`);
  await rows(page,'One comparison away');await settled(page);v=await see(page);
  const variants=opening.near.filter(n=>n===2).length;
  assert.ok(variants>0&&v.lanes.length===variants+1&&v.lanes.slice(1).every(l=>l.startsWith('var')),`one comparison away: ${variants} rows expected, got ${v.lanes}`);
  await rows(page,'Matched windows');v=await see(page);
  let paged=/^Windows 1–(\d+) of (\d+)$/.exec(v.pager);
  assert.ok(paged&&+paged[2]===opening.windows&&v.lanes.length===+paged[1]+1&&v.lanes.slice(1).every(l=>l.startsWith('win')),`matched windows: a page of the ${opening.windows} windows expected, got "${v.pager}" and ${v.lanes}`);
  await rows(page,'Holds');v=await see(page);
  assert.deepEqual(v.lanes,['draw','offer'],'holds with nothing held: one row that offers a hold');
  await go(page,`${START}&p=0L.1L,c0`);await settled(page);v=await see(page);
  assert.deepEqual(v.lanes,['draw','hold.pin0','hold.pin1'],'holds with two held: one ledger row each');
  await page.click('#lanes > .lane[data-lane="hold.pin1"] .lane-head .text');v=await see(page);
  assert.equal(v.lane,'hold.pin1','a ledger row must be selectable');
  assert.equal(await page.evaluate(()=>document.querySelector('#right .block h3').textContent),'Bar 1 closes up','Inspect must read the selected ledger row');
  // a ledger row is the drawing with a hold on it: its levels are in the shape's own height, never recorded prices
  {const box=await page.locator('#lanes > .lane[data-lane="hold.pin0"] .lane-svg').boundingBox();let tip='';
    for(let x=box.x+12;x<box.x+box.width*0.5&&!/· bar \d/.test(tip);x+=8){await page.mouse.move(x,box.y+box.height/2);tip=await page.evaluate(()=>document.querySelector('#tip').textContent);}
    assert.match(tip,/· bar \d/,'hovering a ledger row must read one of its bars');assert.match(tip,/of the shape’s height/);assert.doesNotMatch(tip,/USDT/,'a ledger row must not label drawing levels as USDT');
    await page.mouse.move(2,2);}
  await go(page,START);await rows(page,'Closing paths');await settled(page);v=await see(page);
  paged=/^Paths 1–(\d+) of (\d+)$/.exec(v.pager);
  assert.ok(paged&&+paged[2]===opening.sequences.length&&v.lanes.length===+paged[1]+1&&v.lanes.slice(1).every(l=>l.startsWith('path')),`closing paths: a page of the ${opening.sequences.length} paths expected, got "${v.pager}"`);
  assert.equal(v.lanes[1],'path'+opening.sequences.slice().sort((a,b)=>b[1]-a[1])[0][0],'closing paths: the most common path first');
  await page.click(`#lanes > .lane[data-lane="${v.lanes[1]}"] .lane-head .text`);was=await see(page);
  assert.equal(was.lane,v.lanes[1]);assert.ok(was.heights[v.lanes[1]]>was.heights[v.lanes[2]]*1.4,'a selected path row must open');
  await press('ArrowUp');
  calm(faults,'the rows');

  // ---- 4. picks narrow as an independent count says
  const seqs=opening.sequences;
  assert.equal(sum(seqs.map(([,k])=>k)),opening.contN,'the closing paths must account for every complete window');
  await rows(page,'Timeframes');await settled(page);
  await column(1);await press('1');v=await see(page);
  let cd=narrow(seqs,'U-----'),given=/given .*?([\d,]+) of ([\d,]+)/.exec(v.readout);
  assert.ok(given&&int(given[1])===cd.n&&int(given[2])===opening.contN,`+1 above: ${cd.n} of ${opening.contN} expected, the readout says "${v.readout}"`);
  assert.match(v.head,/^Given/,'under picks the row track must be named for what it now reads');
  await press('.');
  assert.deepEqual(await barBlock(page,2),cd.grid[1].map(k=>share(k,cd.n)),'+2, given +1 above');
  await press('2');cd=narrow(seqs,'UI----');v=await see(page);
  assert.equal(v.gv,'UI----');given=/given .*?([\d,]+) of ([\d,]+)/.exec(v.readout);assert.equal(int(given[1]),cd.n,'+1 above and +2 inside');
  // a picked bar is read without its own pick: what the pick was chosen from
  {const without=narrow(seqs,'U-----');assert.deepEqual(await barBlock(page,2),without.grid[1].map(k=>share(k,without.n)),'+2 itself, given only +1 above');}
  await press('.');
  assert.deepEqual(await barBlock(page,3),cd.grid[2].map(k=>share(k,cd.n)),'+3, given +1 above and +2 inside');
  // a pair of picks that leaves some windows, but fewer than 30: counted, never estimated
  let thin=null;
  for(let a=0;a<6&&!thin;a++)for(let b=a+1;b<6&&!thin;b++)for(const za of 'UID')for(const zb of 'UID'){
    if(thin)break;
    const text=[...'------'];text[a]=za;text[b]=zb;const n=narrow(seqs,text.join('')).n;if(n>0&&n<30)thin={given:text.join(''),n,free:[0,1,2,3,4,5].find(j=>j!==a&&j!==b)};
  }
  assert.ok(thin,'the opening cohort must have a pair of picks that leaves fewer than 30 windows');
  await go(page,`${START}&gv=${thin.given}`);await page.waitForFunction(gv=>location.hash.endsWith(gv),thin.given);v=await see(page);
  given=/given .*?([\d,]+) of ([\d,]+)/.exec(v.readout);assert.equal(int(given[1]),thin.n,'a thin cohort is still counted');
  assert.match(v.drawn,/UNDER 30, NO ESTIMATE/,'a thin cohort must say that nothing is estimated');
  await column(thin.free+1);
  assert.deepEqual(await barBlock(page,thin.free+1),['—','—','—'],'a thin cohort must show no rate for a later bar');
  // no window at all: a whole path the cohort never took
  let absent=null;const taken=new Set(seqs.map(([key])=>key));
  for(let i=0;i<729&&!absent;i++){const key=[...i.toString(3).padStart(6,'0')].map(d=>'UID'[d]).join('');if(!taken.has(key))absent=key;}
  assert.ok(absent,'some closing path must be one the cohort never took');
  await rows(page,'Closing paths');await go(page,`${START}&gv=${absent}`);await page.waitForFunction(gv=>location.hash.endsWith(gv),absent);v=await see(page);
  assert.deepEqual(v.lanes,['draw','nopath'],'no window closed there: no path rows');
  assert.doesNotMatch(v.tracks.draw,/100%/,'a cohort the picks leave empty must not be reported as fully covered by its paths');
  const rare=seqs.find(([,k])=>k>0&&k<30);
  if(rare){await go(page,`${START}&gv=${rare[0]}`);await page.waitForFunction(gv=>location.hash.endsWith(gv),rare[0]);v=await see(page);
    assert.deepEqual(v.lanes,['draw','path'+rare[0]]);assert.doesNotMatch(v.tracks.draw,/100%/,'under 30 windows nothing is reported as a share of the paths');}
  await go(page,START);await page.waitForFunction(start=>location.hash.slice(1)===start,START);await rows(page,'Timeframes');await settled(page);
  calm(faults,'the picks');

  // ---- 5. an address reopens the same question
  const trip=await page.evaluate(async()=>{
    const {createModel,g1}=await import('/bench/model.js');
    let seed=20261122;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},pick=a=>a[Math.floor(rnd()*a.length)];
    const bad=[];let held=0,near=0;
    for(let t=0;t<400;t++){
      const a=createModel(),m=a.state,n=2+Math.floor(rnd()*7);
      // levels that tie, and levels a hair apart: a link must keep both as they are
      const level=()=>pick([18,30,36,42,56,62,68,80])+pick([0,0,0,0.004,-0.004,1/3,1e-9]);
      a.setBars(Array.from({length:n},()=>({v:[level(),level(),level(),level()].sort((x,y)=>x-y),d:pick(['u','d'])})),false);
      m.oriented=rnd()<0.7;m.tfOn=[0,1,2,3,4].map(()=>rnd()<0.6);if(!m.tfOn.some(Boolean))m.tfOn[2]=true;m.x=pick([12,24,48]);
      m.next=pick([{dir:0,measure:'any',bps:10,atr:1},{dir:1,measure:'any',bps:10,atr:1},{dir:-1,measure:'bps',bps:25,atr:1},{dir:1,measure:'atr',bps:10,atr:0.5}]);
      for(let i=Math.floor(rnd()*4);i>0;i--)a.pin({bar:Math.floor(rnd()*n),part:pick(['L','B','T','H'])},{bar:Math.floor(rnd()*n),part:pick(['L','B','T','H'])});
      if(rnd()<0.3)a.colorPin(Math.floor(rnd()*n));
      a.setSkel(Math.floor(rnd()*3));a.setStretch(Math.floor(rnd()*5));
      a.giveAll(Array.from({length:6},()=>pick(['-','-','-','U','I','D'])).join(''));
      if(m.pins.length||m.skel)held++;if(m.bars.some(b=>b.v.some(v=>v!==Math.round(v))))near++;
      const text=a.address(),b=createModel();
      const same=b.readAddress('#'+text)&&JSON.stringify(m.bars)===JSON.stringify(b.state.bars)&&g1(m.bars,m.oriented)===g1(b.state.bars,b.state.oriented)
        &&JSON.stringify(a.query())===JSON.stringify(b.query())&&JSON.stringify(m.pins)===JSON.stringify(b.state.pins)&&m.skel===b.state.skel&&m.stretch===b.state.stretch
        &&m.given===b.state.given&&b.address()===text;
      if(!same)bad.push(text);
    }
    return {bad:bad.length,first:bad[0]||'',held,near};
  });
  assert.equal(trip.bad,0,`an address must reopen the same bars, g1, holds, picks and terms: ${trip.first}`);
  assert.ok(trip.held>100&&trip.near>100,'the drawings tried must include held ones and levels a hair apart');
  // a link opened in a tab that already shows the bench is applied, and is one step to undo, terms and all
  await go(page,'s=30,42,56,68,u;18,36,56,80,d&o=0&tf=10000&x=24&n=0');await settled(page);v=await see(page);
  assert.deepEqual([v.o,v.tf,v.x,await term(page,'Colours'),await term(page,'Timeframes'),await term(page,'Windows')],['0','10000','24','Shape only','15m','24'],'a link in an open tab must be applied, terms and all');
  await press('Control+z');await settled(page);v=await see(page);
  assert.equal(v.hash,START,'undo after a link must bring back the drawing and its terms');
  assert.deepEqual([await term(page,'Colours'),await term(page,'Timeframes'),await term(page,'Windows')],['Up and down','All five','12']);
  await go(page,'s=nothing-readable');await page.waitForFunction(start=>location.hash.slice(1)===start,START);
  calm(faults,'the address');

  // ---- 6. what review found stays fixed
  // a window picked in the drawer turns the canvas to the page that holds it, and Space on a row is the row's alone
  await press('w');await page.click('#drawer th button.sort');   // Closest, last first
  const last=await page.evaluate(()=>{const cells=[...document.querySelector('#drawer tbody tr').cells].map(c=>c.textContent);return {rank:+cells[0],title:`${cells[1]} · ${cells[2]}`};});
  assert.equal(last.rank,opening.windows,'the drawer must list every window, sortable by rank');
  await page.click('#drawer tbody tr');v=await see(page);
  paged=/^Windows (\d+)–(\d+) of (\d+)$/.exec(v.pager);
  assert.ok(paged&&+paged[3]===opening.windows&&+paged[1]>1,`a window on a later page must turn the canvas to it: "${v.pager}"`);
  assert.ok(v.lane?.startsWith('win'),'the picked window must be the selected row');
  assert.equal(await page.evaluate(()=>document.querySelector('#right .block h3').textContent),last.title,'Inspect must show the picked window');
  await page.locator('#drawer tbody tr').nth(1).focus();await press('Space');was=await see(page);
  assert.equal(was.s,v.s,'Space on a window row must not flip the drawing');assert.ok(was.lane.startsWith('win')&&was.lane!==v.lane,'Space on a window row must pick that row');
  await press('w');await rows(page,'Timeframes');await settled(page);
  // a point picked on a bar that is then removed is dropped with it
  await press('Equal');await settled(page);await press('h');await after('Enter','picks a point on the new bar',n=>/second point/.test(n.status));
  await after('Minus','removes the bar and the pick on it',n=>n.bars===2&&!/second point/.test(n.status));
  await press('ArrowRight');await press('ArrowLeft');await press('Enter');await press('Escape');await after('Escape','leaves hold mode',n=>!n.holding);
  await press('Control+z');await after('Control+z','restores the opening drawing',n=>n.hash===START);
  await settled(page);
  calm(faults,'the regressions');

  // Patterns open when the page loads: the catalogue is counted once the history is in
  {const {page:p,faults:f,context}=await open({storage:{left:true,right:true,drawer:null,rows:'paths',track:'range',frame:2}});
    await p.goto(`${base}/`,{waitUntil:'domcontentloaded'});
    await p.waitForFunction(()=>{const figs=[...document.querySelectorAll('#left .pat .n b')];return figs.length>=20&&figs.every(b=>b.textContent!=='');},null,{timeout:90000});
    assert.ok((await p.locator('#left .pat .n b').allTextContents()).some(t=>int(t)>0),'the catalogue must be counted on the real bars');
    calm(f,'patterns open at load');await context.close();}
  // a matcher that cannot be started says so, and the page still stands
  {const {page:p,faults:f,context}=await open({worker:blocked});
    await p.goto(`${base}/`,{waitUntil:'domcontentloaded'});
    await p.waitForFunction(()=>document.querySelector('#status').classList.contains('err'));
    assert.match(await p.locator('#status').textContent(),/cannot run the matcher/);assert.match(await p.locator('#readout').textContent(),/cannot run the matcher/);
    calm(f,'a matcher that cannot start');await context.close();}
  // a link that names a catalogue pattern opens on it; an unknown name changes nothing
  for(const [id,said] of [['bearish-engulfing',/^Bearish engulfing: drawn from 1h/],['hammer',/^Hammer: bar 2 drawn from 1h/]]){
    const {page:p,faults:f,context}=await open({storage:{left:false,right:true,drawer:null,rows:'paths',track:'range',frame:2}});
    const entry=id==='hammer'?'/bench/':'/';
    await p.goto(`${base}${entry}?pattern=${id}`,{waitUntil:'domcontentloaded'});
    await p.waitForFunction(()=>location.search==='',null,{timeout:90000});await settled(p);const n=await see(p);
    assert.equal(new URL(p.url()).pathname,'/','pattern links must open at the canonical URL');
    assert.ok(n.left,`?pattern=${id}: the Patterns panel must open`);assert.match(n.status,said,`?pattern=${id}: the pattern must be put on the canvas`);
    assert.notEqual(n.hash,START,`?pattern=${id}: the drawing must change`);
    assert.ok(await p.locator(`#left [data-pattern="${id}"]`).count(),`?pattern=${id}: the panel must list it`);
    calm(f,`?pattern=${id}`);await context.close();
  }
  {const {page:p,faults:f,context}=await open({storage:{left:false,right:true,drawer:null,rows:'paths',track:'range',frame:2}});
    await p.goto(`${base}/?pattern=no-such-candle`,{waitUntil:'domcontentloaded'});await settled(p);const n=await see(p);
    assert.ok(!n.left&&n.hash===START&&await p.evaluate(()=>location.search)==='?pattern=no-such-candle','an unknown pattern name must change nothing');
    calm(f,'an unknown pattern');await context.close();}

  // ---- 7. a shape crosses to the query bench and back as Filang's own drawing packet
  {const DRAWN='s=15,20,40,50,u;30,40,60,85,u&o=1&tf=11111&x=12&n=0&p=0H.1H,c1';
    // the packet as Filang's study/composer/drawing.js writes one for this drawing, to the letter
    const PACKET='{"version":1,"revision":"133e3017ba9143f7dc255df7218ff7bfe46d9d06","oriented":true,"bars":[{"v":[15,20,40,50],"d":"u"},{"v":[30,40,60,85],"d":"u"}],"pins":[{"a":{"bar":0,"part":"H"},"b":{"bar":1,"part":"H"}},{"bar":1,"color":true}],"skeleton":0,"stretch":0,"next":{"dir":0,"measure":"any","bps":10,"atr":1},"limit":12}';
    const link=(page,sel='#to-query')=>page.evaluate(sel=>{const a=document.querySelector(sel);if(!a)return null;const u=new URL(a.href);return {to:u.origin+u.pathname,drawing:u.searchParams.get('drawing'),g1:u.searchParams.get('g1'),held:u.searchParams.get('pin-relations'),title:a.title};},sel);
    {const {page:p,faults:f,context}=await open();
      await p.goto(`${base}/bench/#${DRAWN}`,{waitUntil:'domcontentloaded'});await settled(p);
      assert.equal(p.url(),`${base}/#${DRAWN}`,'a shared bench address must keep its drawing when redirected');
      let l=await link(p);
      assert.equal(l.drawing,PACKET,'to the query bench: the packet, to the letter');
      assert.equal(l.g1,'g1:o:0,1,3,4,u;2,3,5,6,u','to the query bench: the g1 the packet must agree with');
      assert.equal(l.held,'1','to the query bench: something pinned asks for the held relations');assert.match(l.title,/pinned/);
      // the g1 drawer offers both forms while something is pinned, and says what does not cross
      await p.keyboard.press('g');
      const [exact,pinned]=await Promise.all([link(p,'#drawer .askq a:nth-of-type(1)'),link(p,'#drawer .askq a:nth-of-type(2)')]);
      assert.deepEqual([exact.drawing,exact.held,pinned.drawing,pinned.held],[PACKET,null,PACKET,'1'],'the g1 drawer: the exact shape, and what is pinned');
      assert.match(await p.locator('#drawer .askq .note').textContent(),/Not carried: the skeleton, stretch, the next-bar term, timeframes and picks\. Query counts on its own/);
      // with nothing pinned the link asks for the exact shape; what is not carried still rides in the packet for the way back
      await go(p,START+'&k=1&st=1');await settled(p);l=await link(p);const sent=JSON.parse(l.drawing);
      assert.equal(l.held,null,'nothing pinned: the exact shape');assert.equal(l.g1,'g1:o:1,3,4,5,u;0,2,4,6,d');
      assert.deepEqual([sent.bars.length,sent.pins.length,sent.skeleton,sent.stretch],[2,0,1,1]);
      assert.equal(await p.locator('#drawer .askq a').count(),1,'nothing pinned: one form to ask');
      calm(f,'the link to the query bench');await context.close();}
    // a drawing carried in is taken whole, says where it came from, and leaves the query string
    {const {page:p,faults:f,context}=await open();
      await p.goto(`${base}/?drawing=${encodeURIComponent(PACKET)}`,{waitUntil:'domcontentloaded'});
      await p.waitForFunction(()=>location.search==='',null,{timeout:90000});await settled(p);const n=await see(p);
      assert.equal(n.hash,DRAWN,'?drawing=: the bars and the pins it carries');
      assert.match(n.status,/^Drawn from Query · 2 bars · 2 pins · counted on this history$/,'?drawing=: it says where the shape came from');
      assert.equal((await link(p)).drawing,PACKET,'?drawing=: sent back, it is the same packet');
      // carried terms: skeleton, stretch, the next-bar term and the number of closest windows come with it
      const terms=JSON.stringify({...JSON.parse(PACKET),pins:[],skeleton:1,stretch:1,next:{dir:1,measure:'bps',bps:25,atr:1},limit:24});
      await p.goto(`${base}/?drawing=${encodeURIComponent(terms)}`,{waitUntil:'domcontentloaded'});
      await p.waitForFunction(()=>location.search==='',null,{timeout:90000});await settled(p);const m=await see(p);
      assert.deepEqual([m.s,m.x,m.n,m.k,m.st,m.p],['15,20,40,50,u;30,40,60,85,u','24','1,bps,25','1','1',''],'?drawing=: the terms a packet carries');
      calm(f,'a drawing carried in');await context.close();}
    // a packet that cannot be read changes nothing and says so
    const broken={
      'another format':JSON.stringify({...JSON.parse(PACKET),revision:'0000000000000000000000000000000000000000'}),
      'an opening gap':JSON.stringify({...JSON.parse(PACKET),bars:[{v:[15,20,40,50],d:'u'},{v:[30,45,60,85],d:'u'}],pins:[]}),
      'one bar':JSON.stringify({...JSON.parse(PACKET),bars:[{v:[15,20,40,50],d:'u'}],pins:[]}),
      'a pin on no bar':JSON.stringify({...JSON.parse(PACKET),pins:[{bar:2,color:true}]}),
      'not a packet':'drawing',
    };
    for(const [what,text] of Object.entries(broken)){
      const {page:p,faults:f,context}=await open();
      await p.goto(`${base}/?drawing=${encodeURIComponent(text)}`,{waitUntil:'domcontentloaded'});
      await p.waitForFunction(()=>location.search==='',null,{timeout:90000});await settled(p);const n=await see(p);
      assert.equal(n.hash,START,`?drawing= with ${what}: the drawing must not change`);
      assert.match(n.status,/^The drawing in the link could not be read: /,`?drawing= with ${what}: it must say so`);
      calm(f,`?drawing= with ${what}`);await context.close();
    }
    // the model's packet reads back as itself, whatever is drawn and held
    const {createModel,decodePacket,g1:codeOf}=await import('../bench/model.js');
    let seed=20261122;const rnd=()=>(seed=(seed*1664525+1013904223)>>>0)/4294967296;
    for(let i=0;i<2000;i++){
      const a=createModel(),n=2+Math.floor(rnd()*7),tie=rnd()<0.4;
      const price=()=>tie?Math.round(rnd()*12)*5:rnd()*100;
      let close=price();const bars=[];
      for(let k=0;k<n;k++){const o=close,c=price(),lo=Math.min(o,c),hi=Math.max(o,c);bars.push({v:[lo-(rnd()<0.3?0:price()/4),lo,hi,hi+(rnd()<0.3?0:price()/4)],d:c>=o?'u':'d'});close=c;}
      a.setBars(bars,false);a.state.oriented=rnd()<0.85;
      for(let k=0;k<Math.floor(rnd()*4);k++){if(rnd()<0.3)a.colorPin(Math.floor(rnd()*n));else a.pin({bar:Math.floor(rnd()*n),part:'LBTH'[Math.floor(rnd()*4)]},{bar:Math.floor(rnd()*n),part:'LBTH'[Math.floor(rnd()*4)]});}
      a.setSkel(Math.floor(rnd()*3));a.setStretch(Math.floor(rnd()*5));a.state.x=[12,24,48][Math.floor(rnd()*3)];
      const packet=a.toPacket(),text=JSON.stringify(packet);
      assert.deepEqual(decodePacket(text),packet,'a packet reads back as written');
      const b=createModel();assert.equal(b.readPacket(text),null,'the model takes its own packet');
      assert.equal(codeOf(b.state.bars,b.state.oriented),codeOf(a.state.bars,a.state.oriented),'the same g1 after the trip');
      assert.equal(JSON.stringify(b.toPacket()),text,'and the same packet again');
    }
  }

  for(const f of allFaults)calm(f,'at the end');
  console.log(`Composer passed matching, keyboard controls, rows, picks, shared addresses and the Query handoff in ${((Date.now()-began)/1000).toFixed(1)} s.`);
}finally{
  clearTimeout(startupTimer);
  try{await browser?.close();}
  finally{
    if(origin.exitCode===null&&origin.signalCode===null){origin.kill();await exited;}
    lines.close();
  }
}
