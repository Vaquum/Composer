// Compare the native SVG background with the runtime bitmap at each density.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { webkit } from 'playwright';
const html=fs.readFileSync('index.html','utf8'),styles=html.match(/<style>([\s\S]*?)<\/style>/)[1];
const start=html.indexOf('const Paper='),end=html.indexOf('function rgbOf(',start);
const runtime='const PAPER_CACHE=true;'+html.slice(start,end)+'window.Paper=Paper;';
const browser=await webkit.launch({headless:true});
try{
  for(const dpr of [1,2]){
    const context=await browser.newContext({viewport:{width:600,height:400},deviceScaleFactor:dpr}),page=await context.newPage();
    try{
      await page.setContent(`<style>${styles}</style><main style="height:1300px;padding:24px">Paper texture · native pixels</main>`);
      await page.addScriptTag({content:runtime});
      for(const theme of ['light','dark']){
        await page.evaluate(async theme=>{document.documentElement.dataset.theme=theme;Paper.update();await Paper.ready;},theme);
        assert.match(await page.evaluate(()=>document.body.style.backgroundImage),/^url\("data:image\/png;base64,/,'the cache must actually be used');
        for(const top of [0,223,700]){
          await page.evaluate(top=>document.body.scrollTop=top,top);
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          assert.equal(await page.evaluate(()=>document.body.scrollTop),top);
          const cached=await page.screenshot(),legacy=await page.addStyleTag({content:'body{background-image:var(--tex)!important;background-size:auto!important}'});
          const original=await page.screenshot();await legacy.evaluate(node=>node.remove());
          const difference=await page.evaluate(async({a,b})=>{
            const pixels=async src=>{const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=src;});const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,canvas.width,canvas.height).data;};
            const x=await pixels(a),y=await pixels(b);let max=0,total=0;for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);max=Math.max(max,d);total+=d;}return{max,mean:total/x.length};
          },{a:'data:image/png;base64,'+cached.toString('base64'),b:'data:image/png;base64,'+original.toString('base64')});
          console.log(JSON.stringify({dpr,theme,top,...difference}));
          assert.ok(difference.max<=2&&difference.mean<.005,'runtime paper must preserve native SVG pixels');
        }
      }
      const race=await page.evaluate(async()=>{
        document.documentElement.dataset.theme='dark';Paper.update();document.documentElement.dataset.theme='light';Paper.update();await Paper.ready;
        return document.body.style.backgroundImage===`url("${Paper.cache.get(Paper.key)}")`&&Paper.cache.size<=4;
      });
      assert.ok(race,'a superseded palette must not replace the current paper');
    }finally{await context.close();}
  }
}finally{await browser.close();}
console.log('Paper cache: native pixels, actual scrolling, palettes, densities and supersession passed.');
