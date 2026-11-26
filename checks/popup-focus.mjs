import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const source = await readFile(process.argv[2] || new URL('../bench/dom.js', import.meta.url), 'utf8');
const browser = await chromium.launch({headless:true});
try {
  for (const kind of ['menu','popover']) for (const redraw of [false,true]) for (const key of ['Escape', ...(kind === 'menu' ? ['Tab'] : [])]) {
    const page = await browser.newPage();
    await page.route('http://composer.test/**', route => route.fulfill(route.request().url().endsWith('/dom.js') ? {contentType:'text/javascript',body:source} : {contentType:'text/html',body:'<button data-enc="Control">Control</button><button id="after">After</button>'}));
    await page.goto('http://composer.test/');
    await page.evaluate(async kind => {
      const {menu,popover,h} = await import('/dom.js'); const anchor=document.querySelector('[data-enc]');
      if(kind==='menu') menu(anchor,{title:'Control',options:[{value:1,label:'One'}],value:1,onChange:()=>{}});
      else {popover(anchor,{title:'Control',body:h('button',{type:'button'},'Inside')}); document.querySelector('.pop button').focus();}
    },kind);
    if(redraw) await page.evaluate(()=>{const old=document.querySelector('[data-enc]');const replacement=old.cloneNode(true);old.replaceWith(replacement);});
    await page.keyboard.press(key);
    const actual=await page.evaluate(()=>({focus:document.activeElement?.id || document.activeElement?.getAttribute('data-enc'),expanded:document.querySelector('[data-enc]').getAttribute('aria-expanded'),popup:!!document.querySelector('.pop')}));
    assert.deepEqual(actual,{focus:key==='Tab'?'after':'Control',expanded:'false',popup:false},`${kind}, redraw=${redraw}, ${key}`);
    console.log(`PASS ${kind} redraw=${redraw} ${key}`); await page.close();
  }
} finally {await browser.close();}
