import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const [origin,destination]=process.argv.slice(2);if(!origin||!destination)throw Error('URL and directory required');
const output=resolve(destination);await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:2}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${origin}/e2e/measurement-harness.html?quality=high`);await page.waitForFunction(()=>!!window.measurementHarness);await page.evaluate(()=>window.measurementHarness.open(false));
 const results=[];
 for(const[name,at]of [['market',0],['courtyard',18],['stairs',24],['pasture',40],['first',52]]) {
  await page.evaluate(at=>{window.measurementHarness.freezeTime(null);window.measurementHarness.cascadeVariant('baseline');window.measurementHarness.at(at);},at);
  await page.waitForFunction(()=>{const s=window.measurementHarness.stats();return !s.render.pending&&!s.chunks.loading&&!s.render.appearing;});
  await page.evaluate(()=>window.measurementHarness.freezeTime(150));await page.waitForTimeout(300);
  const baseline=await page.screenshot({path:resolve(output,`${name}-baseline.png`)});
  for(const variant of ['two']) {
   await page.evaluate(v=>window.measurementHarness.cascadeVariant(v),variant);await page.waitForTimeout(700);
   const screenshot=await page.screenshot({path:resolve(output,`${name}-${variant}.png`)});
   const error=await page.evaluate(async([a,b])=>{
    const load=src=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=src;});const images=await Promise.all([load(a),load(b)]);
    const canvas=document.createElement('canvas');canvas.width=images[0].width;canvas.height=images[0].height;const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(images[0],0,0);const x=ctx.getImageData(0,0,canvas.width,canvas.height).data;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(images[1],0,0);const y=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let sum=0,over8=0,max=0;for(let i=0;i<x.length;i+=4){let local=0;for(let c=0;c<3;c++){const d=Math.abs(x[i+c]-y[i+c]);sum+=d;local=Math.max(local,d);}if(local>8)over8++;max=Math.max(max,local);}
    return{pixels:x.length/4,meanRgbError:sum/(x.length/4*3),fractionOver8:over8/(x.length/4),maxChannelError:max};
   },[... [baseline,screenshot].map(buffer=>'data:image/png;base64,'+buffer.toString('base64'))]);
   const stats=await page.evaluate(()=>window.measurementHarness.stats());results.push({name,at,variant,...error,stats,note:"Pixel delta is descriptive, not an acceptance threshold for changed shadows"});console.log(JSON.stringify({name,variant,...error}));
   if(errors.length||stats.render.errors.length||stats.chunks.errors.length)throw Error('Cascade quality failed');
  }
 }
 const closed=await page.evaluate(()=>window.measurementHarness.close());if(closed.releasedBudget.memory||closed.resources.shadowTargets)throw Error('Material experiment leaked');
 await writeFile(resolve(output,'cascade-quality.json'),JSON.stringify({scope:'One frozen scene for each A/B; framebuffer pixels, no GPU performance claim',results,closed,errors},null,2));
}finally{await browser.close();}
