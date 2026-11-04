import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const [origin, directory] = process.argv.slice(2), output = resolve(directory); await mkdir(output, {recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true}), results=[];
try {
 for (let i=0;i<6;i++) {
  const variant=i%2?'precompile':'baseline', context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:2});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(origin).origin?r.continue():r.abort());
  await page.goto(`${origin}/e2e/measurement-harness.html?quality=high&frame=${variant}`);await page.waitForFunction(()=>window.measurementHarness);
  const loading=await page.evaluate(()=>window.measurementHarness.open(true));
  await page.waitForTimeout(1000);
  const status=await page.evaluate(()=>window.measurementHarness.stats());
  const closed=await page.evaluate(()=>window.measurementHarness.close());
  const samples=loading.measurement.samples.filter(s=>s.submitted),cpu=samples.map(s=>Object.values(s.cpu).reduce((sum,v)=>sum+v,0)).sort((a,b)=>a-b);
  results.push({index:i,variant,loading,status,closed,errors,cpuP95:cpu[Math.floor((cpu.length-1)*.95)],cpuMax:cpu.at(-1)});
  if(errors.length||closed.releasedBudget.memory||loading.render.errors.length||loading.chunks.errors.length)throw Error('Invalid entry');
  console.log(variant,loading.loadMs,results.at(-1).cpuP95,status.experiment);await context.close();
 }
 await writeFile(resolve(output,'startup.json'),JSON.stringify(results,null,2));
}finally{await browser.close();}
