import { chromium } from '@playwright/test';
import {writeFile,mkdir}from'node:fs/promises';import{resolve}from'node:path';
const[origin,directory]=process.argv.slice(2),output=resolve(directory);await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:2}),page=await context.newPage();
 await page.addInitScript(()=>{window.glCpuProbe={};for(const name of ['bufferData','bufferSubData','texImage2D','texSubImage2D','compileShader','linkProgram']){const original=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(...args){const began=performance.now();try{return original.apply(this,args);}finally{const row=window.glCpuProbe[name]??={count:0,totalMs:0,maxMs:0};const ms=performance.now()-began;row.count++;row.totalMs+=ms;row.maxMs=Math.max(row.maxMs,ms);}};}});
 const cdp=await context.newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});await cdp.send('Profiler.start');
 await page.goto(`${origin}/e2e/measurement-harness.html?quality=high`);await page.waitForFunction(()=>window.measurementHarness);
 const entry=await page.evaluate(()=>window.measurementHarness.open(true));await page.evaluate(()=>window.measurementHarness.start(true));await page.waitForTimeout(9000);
 const raw=await page.evaluate(()=>window.measurementHarness.stop()),profile=await cdp.send('Profiler.stop');
 const data=await page.evaluate(()=>({glCpuProbe:window.glCpuProbe,resources:performance.getEntriesByType('resource').map(r=>({name:r.name,duration:r.duration,transferSize:r.transferSize}))}));
 const cpuByNode=new Map();profile.profile.samples.forEach((id,i)=>cpuByNode.set(id,(cpuByNode.get(id)??0)+profile.profile.timeDeltas[i]));
 const functions=profile.profile.nodes.map(n=>({...n.callFrame,selfMs:(cpuByNode.get(n.id)??0)/1000})).filter(n=>n.selfMs).sort((a,b)=>b.selfMs-a.selfMs);
 const closed=await page.evaluate(()=>window.measurementHarness.close());
 await writeFile(resolve(output,'cpu.cpuprofile'),JSON.stringify(profile.profile));await writeFile(resolve(output,'attribution.json'),JSON.stringify({scope:'Sampling profiler and CPU GL call time; not a performance A/B or GPU upload duration',entry,raw,data,functions,closed},null,2));
 console.log(functions.slice(0,20));console.log(data.glCpuProbe);
}finally{await browser.close();}
