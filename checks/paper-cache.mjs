// Compare the enabled native background cache with the original attachment.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { webkit } from 'playwright';
const html=fs.readFileSync('index.html','utf8'),styles=html.match(/<style>([\s\S]*?)<\/style>/)[1];
const start=html.indexOf('const PAPER_CACHE='),end=html.indexOf('function dense(',start);
// Exercise the enabled path on Linux CI as well as the profiled Mac host.
const runtime=html.slice(start,end).replace(/^const PAPER_CACHE=.*?;\n/,'const PAPER_CACHE=true;\n');
const browser=await webkit.launch({headless:true});
try{
  for(const dpr of [1,2])for(const width of [600,1280]){
    const context=await browser.newContext({viewport:{width,height:400},deviceScaleFactor:dpr}),page=await context.newPage();
    try{
      await page.setContent(`<style>${styles}</style><main style="height:1300px;padding:24px">Paper texture · native pixels</main>`);
      await page.addScriptTag({content:runtime});
      for(const theme of ['light','dark']){
        await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
        for(const top of [0,223,700]){
          await page.evaluate(top=>document.body.scrollTop=top,top);
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          assert.equal(await page.evaluate(()=>document.body.scrollTop),top);
          const enabled=await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundImage!=='none');
          assert.equal(enabled,width>=1181&&top===0,'only desktop origin may use the native cache');
          const cached=await page.screenshot(),legacy=await page.addStyleTag({content:':root{background-image:none!important}body{background-color:var(--paper)!important;background-image:var(--tex)!important;background-attachment:scroll!important}'});
          const original=await page.screenshot();await legacy.evaluate(node=>node.remove());
          const difference=await page.evaluate(async({a,b})=>{
            const pixels=async src=>{const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=src;});const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,canvas.width,canvas.height).data;};
            const x=await pixels(a),y=await pixels(b);let max=0,total=0;for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);max=Math.max(max,d);total+=d;}return{max,mean:total/x.length};
          },{a:'data:image/png;base64,'+cached.toString('base64'),b:'data:image/png;base64,'+original.toString('base64')});
          console.log(JSON.stringify({dpr,width,theme,top,...difference}));
          assert.ok(difference.max<=2&&difference.mean<.005,'cached paper must preserve native SVG pixels');
        }
      }
    }finally{await context.close();}
  }
}finally{await browser.close();}
console.log('Paper cache: native pixels, actual scrolling, palettes, screen widths and densities passed.');
