import { chromium } from '@playwright/test';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {execFileSync}from'node:child_process';
import { summarize } from './render-summary.mjs';
const[originalOrigin,finalOrigin,directory]=process.argv.slice(2),output=resolve(directory);await mkdir(output,{recursive:true});
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const environment={capturedAt:new Date().toISOString(),node:process.version,os:execFileSync('sw_vers',{encoding:'utf8'}),power:execFileSync('pmset',['-g','batt'],{encoding:'utf8'}),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),originalOrigin,finalOrigin,archiveSha256:process.env.MEASURE_BASELINE_ARCHIVE?await hash(resolve(process.env.MEASURE_BASELINE_ARCHIVE)):null,runtimeHashes:Object.fromEntries(await Promise.all(['ThreeRenderer.ts','ShotgunVisuals.ts','CameraObstruction.ts'].map(async name=>[name,await hash('src/render/three/'+name)]))),scope:'M4/Chrome, market/radius2; authored presentation, one synthetic player, native RAF, same local assets; HTTP cache disabled; driver/OS shader caches retained'};
await writeFile(resolve(output,'environment.json'),JSON.stringify(environment,null,2));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const quality of ['low','balanced','high']){
  const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:2}),page=await context.newPage(),errors=[],external=[],rows=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{const u=new URL(r.request().url());if(/^https?:$/.test(u.protocol)&&![new URL(originalOrigin).origin,new URL(finalOrigin).origin].includes(u.origin)){external.push(u.href);return r.abort();}return r.continue();});
  for(let round=0;round<6;round++){
   const variant=round%2?'final':'original',origin=round%2?finalOrigin:originalOrigin,index=Math.floor(round/2)+1;
   await page.goto(`${origin}/e2e/measurement-harness.html?quality=${quality}`);await page.waitForFunction(()=>window.measurementHarness);
   const entry=await page.evaluate(()=>window.measurementHarness.open(true));
   for(const at of [0,18,24,40,56]){await page.evaluate(t=>window.measurementHarness.at(t),at);await page.waitForTimeout(750);}
   await page.evaluate(()=>window.measurementHarness.at(0));await page.waitForTimeout(5000);
   const recordedStart=await page.evaluate(()=>{window.measurementHarness.start(true,true);return performance.now();}),checkpoints=[];
   for(let s=0;s<60;s+=10){await page.waitForTimeout(10000);checkpoints.push(await page.evaluate(()=>window.measurementHarness.stats()));console.log(quality,variant,index,s+10);}
   const raw=await page.evaluate(()=>window.measurementHarness.stop());raw.startedAt??=recordedStart;
   const graphics=await page.locator('canvas').evaluate(c=>{const gl=c.getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return{css:[c.getBoundingClientRect().width,c.getBoundingClientRect().height],buffer:[c.width,c.height],dpr:devicePixelRatio,gpu:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):null,backend:gl.getParameter(gl.VERSION),antialias:gl.getContextAttributes().antialias};});
   const result={quality,variant,index,entry,checkpoints,graphics,...raw,summary:summarize(raw),errors:[...errors],external:[...external]};
   const shotSamples=raw.measurement.samples.filter(s=>s.at-raw.startedAt>=900&&s.at-raw.startedAt<1600);result.firstShotCpuMax=Math.max(0,...shotSamples.map(s=>s.cpu.shots??0));
   result.closed=await page.evaluate(()=>window.measurementHarness.close());
   if(errors.length||external.length||raw.overflow||raw.measurement.dropped||result.closed.releasedBudget.memory||checkpoints.some(c=>c.render.errors.length||c.chunks.errors.length))throw Error('Invalid final comparison capture');
   await writeFile(resolve(output,`${variant}-${quality}-${index}.json`),JSON.stringify(result));rows.push({variant,index,firstShotCpuMax:result.firstShotCpuMax,...result.summary});
  }
  await page.goto(`${finalOrigin}/e2e/measurement-harness.html?quality=${quality}`);await page.waitForFunction(()=>window.measurementHarness);await page.evaluate(()=>window.measurementHarness.open(false));
  const cdp=await context.newCDPSession(page),heap=async()=>{await cdp.send('HeapProfiler.collectGarbage');return cdp.send('Runtime.getHeapUsage');},warmHeap=await heap(),cycles=[];
  for(let i=0;i<5;i++){const closed=await page.evaluate(()=>window.measurementHarness.close()),closedHeap=await heap(),reopened=await page.evaluate(()=>window.measurementHarness.open(false));await page.waitForTimeout(500);const openedHeap=await heap();cycles.push({closed,closedHeap,reopened,openedHeap});if(closed.releasedBudget.memory||closed.render.models||closed.render.instances||closed.render.geometries||closed.render.textures||closed.resources.queries||closed.resources.shadowTargets||openedHeap.usedSize-warmHeap.usedSize>8*1024*1024)throw Error('Final lifecycle leak');console.log(quality,'final lifecycle',i+1);}
  for(const[name,at]of[['market',0],['courtyard',18],['stairs',24],['pasture',40],['first',52]]){await page.evaluate(t=>window.measurementHarness.at(t),at);await page.waitForTimeout(700);await page.screenshot({path:resolve(output,`${quality}-${name}.png`)});}
  await page.evaluate(()=>window.measurementHarness.close());await writeFile(resolve(output,`${quality}-summary.json`),JSON.stringify({quality,rows,warmHeap,cycles,errors,external},null,2));await context.close();
 }
}finally{await browser.close();}
