import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const [url, quality, output, dpr = '2'] = process.argv.slice(2);
if (!url || !quality || !output || !['low', 'balanced', 'high'].includes(quality)) throw new Error('Usage: node scripts/profile-render.mjs URL low|balanced|high OUTPUT.json [DPR]');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: Number(dpr) });
  await context.addInitScript(({quality}) => {
    localStorage.setItem('world.graphics-quality', quality);
    window.perfProbe = { times: [], draws: [], count: 0 };
    const proto = WebGL2RenderingContext.prototype;
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const original = proto[name];
      proto[name] = function(...args) {
        if (this.canvas.getAttribute('aria-label') === 'Трёхмерная сцена') window.perfProbe.count++;
        return original.apply(this, args);
      };
    }
    const original = proto.fenceSync;
    proto.fenceSync = function(...args) {
      if (this.canvas.getAttribute('aria-label') === 'Трёхмерная сцена') {
        window.perfProbe.times.push(performance.now());
        window.perfProbe.draws.push(window.perfProbe.count); window.perfProbe.count = 0;
      }
      return original.apply(this, args);
    };
  }, {quality});
  const page = await context.newPage(); const errors=[];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/config.json', route => route.fulfill({json:{mapId:'market',debug:true}}));
  await page.goto(url);
  const close = page.getByRole('button', {name:'Закрыть',exact:true});
  if (await close.count()) await close.first().click();
  await page.getByRole('button', {name:'Начать прогулку',exact:true}).click();
  await page.waitForFunction(() => !!document.pointerLockElement, {timeout:30000});
  await page.waitForTimeout(5000);
  await page.evaluate(() => { window.perfProbe.times=[]; window.perfProbe.draws=[]; window.perfProbe.started=performance.now(); });
  await page.keyboard.down('s'); await page.waitForTimeout(5000); await page.keyboard.up('s');
  await page.keyboard.down('w'); await page.waitForTimeout(5000); await page.keyboard.up('w');
  const result = await page.evaluate(() => {
    const p=window.perfProbe, duration=performance.now()-p.started;
    const intervals=p.times.slice(1).map((t,i)=>t-p.times[i]).sort((a,b)=>a-b);
    const canvas=document.querySelector('canvas[aria-label="Трёхмерная сцена"]'); const gl=canvas.getContext('webgl2');
    const ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {seconds:duration/1000,submitted:p.times.length,fps:p.times.length*1000/duration,p95:intervals[Math.ceil(intervals.length*.95)-1],maxInterval:Math.max(...intervals),maxDraw:Math.max(...p.draws),averageDraw:p.draws.reduce((a,b)=>a+b,0)/p.draws.length,
      gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',userAgent:navigator.userAgent,dpr:devicePixelRatio,drawingBuffer:[canvas.width,canvas.height],antialias:gl.getContextAttributes().antialias,
      hud:document.querySelector('[aria-label="Производительность"]')?.textContent, resources:document.querySelector('[aria-label="Ресурсы сцены"]')?.textContent};
  });
  await page.screenshot({path:output.replace('.json','.png')});
  await writeFile(output,JSON.stringify({url,quality,...result,errors},null,2));
  console.log(JSON.stringify({quality,...result,errors}));
} finally { await browser.close(); }
