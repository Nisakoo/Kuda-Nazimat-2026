import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const [origin, destination] = process.argv.slice(2); if (!origin || !destination) throw new Error('URL and output required');
const output = resolve(destination); await mkdir(output, {recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
 for(const quality of ['low','balanced','high']) for(const variant of process.env.DETAIL_QUALITY_CACHED==='1'?['cached-branches']:quality==='high'?['baseline','wind','branches']:['baseline','branches']) {
  const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:2}), page=await context.newPage(), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${origin}/e2e/measurement-harness.html?quality=${quality}&detail=${variant}`);await page.waitForFunction(()=>!!window.measurementHarness);
  await page.evaluate(()=>window.measurementHarness.open(false));const records=[];
  for(const [name,at]of [['market',0],['courtyard',18],['stairs',24],['pasture',40],['first',52]]){
   await page.evaluate(at=>window.measurementHarness.at(at),at);
   await page.waitForFunction(()=>{const s=window.measurementHarness.stats();return !s.render.pending&&!s.chunks.loading&&!s.render.appearing;});await page.waitForTimeout(200);
   const inventory=await page.evaluate(()=>window.measurementHarness.inventory()), audit=await page.evaluate(()=>window.measurementHarness.detailAudit());
   records.push({name,at,inventory,audit});await page.screenshot({path:resolve(output,`${quality}-${variant}-${name}.png`)});
   if(inventory.overflow||inventory.render.errors.length||inventory.chunks.errors.length||inventory.render.chunks.length>25)throw Error('Invalid visual fixture');
  }
  if(quality==='high') {
   await page.evaluate(()=>{
    const stream=document.querySelector('canvas').captureStream(30),recorder=new MediaRecorder(stream,{mimeType:'video/webm',videoBitsPerSecond:2000000}),chunks=[];
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};window.detailRecording={stream,recorder,chunks};recorder.start();
    window.measurementHarness.start(false);window.measurementHarness.seekRoute(43);
   });
   await page.waitForTimeout(12000);
   const data=await page.evaluate(async()=>{window.measurementHarness.stop();const{stream,recorder,chunks}=window.detailRecording;
    const result=new Promise(resolve=>recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}));});recorder.stop();return result;});
   await writeFile(resolve(output,`${quality}-${variant}-motion.webm`),Buffer.from(data,'base64'));
  }
  const fallback=await page.evaluate(()=>window.measurementHarness.detailBudgetFallback());if(fallback.resources||fallback.memory)throw Error('Budget fallback retained resources');
  const closed=await page.evaluate(()=>window.measurementHarness.close());if(closed.releasedBudget.memory||closed.resources.shadowTargets||errors.length)throw Error('Detail lifecycle failed');
  await writeFile(resolve(output,`${quality}-${variant}.json`),JSON.stringify({quality,variant,records,fallback,closed,errors}));
  console.log(`${quality}/${variant}: five poses, inventory, exhausted budget and release PASS`);await context.close();
 }
} finally {await browser.close();}
