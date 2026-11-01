import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(`${process.cwd()}/client/package.json`);
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', msg => console.log('CONSOLE', msg.type(), msg.text()));
page.on('pageerror', err => console.log('PAGEERROR', err.stack));
await page.route('**/config.json', route => route.fulfill({ json: { debug: true } }));
await page.clock.install(); await page.goto('http://127.0.0.1:4299/');
console.log('WAIT ENABLED');
await page.getByRole('button', { name: 'Начать прогулку' }).waitFor({ state: 'visible', timeout: 45000 });
await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(x => x.textContent?.includes('Начать прогулку'))?.disabled, null, { timeout: 60000 });
console.log('ENABLED');
const rect = await page.getByRole('button', { name: 'Начать прогулку' }).boundingBox(); console.log('RECT', rect);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
console.log('START CLICK');
const click = page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2).then(() => console.log('CLICK COMPLETE'), e => console.log('CLICK ERROR', e.message));
setTimeout(async () => {
  console.log('STOP PROFILE');
  try { const data = await cdp.send('Profiler.stop'); writeFileSync('tasks/evidence/ui-redesign-2026-07-02/hang.cpuprofile', JSON.stringify(data.profile)); console.log('PROFILE SAVED'); }
  catch (e) { console.log('PROFILE ERROR', e.message); }
  await browser.close().catch(()=>{}); process.exit(0);
}, 15000);
await click;
console.log('EVALUATE');
void page.evaluate(() => document.pointerLockElement !== null).then(x => console.log('LOCK',x),e=>console.log('EVAL ERROR',e.message));
