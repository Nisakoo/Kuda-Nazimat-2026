import {createRequire} from 'node:module';
const require = createRequire(`${process.cwd()}/client/package.json`); const {chromium} = require('playwright');
const disabled = process.argv.includes('--no-draw'); const t=Date.now(), log=(...a)=>console.log(Date.now()-t,...a);
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']}); const page=await browser.newPage({viewport:{width:1280,height:800}});
let warnings=0; page.on('console',m=>{if(m.text().includes('GPU stall')) warnings++;}); page.on('pageerror',e=>log('PAGEERROR',e.message));
await page.route('**/config.json',r=>r.fulfill({json:{debug:true}}));
if(process.argv.includes('--fence-stats')) await page.addInitScript(() => { const p = WebGL2RenderingContext.prototype; const stats = { waits: 0, timedOut: 0, fences: 0 }; window.__fenceStats = stats; const wait = p.clientWaitSync; p.clientWaitSync = function(...args) { const value = wait.apply(this, args); stats.waits++; if (value === this.TIMEOUT_EXPIRED) stats.timedOut++; return value; }; const insert = p.fenceSync; p.fenceSync = function(...args) { stats.fences++; return insert.apply(this, args); }; });
if(process.argv.includes('--half-dpr')) await page.addInitScript(() => Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: .5 }));
if(disabled) await page.addInitScript(()=>{for(const cls of [WebGLRenderingContext,WebGL2RenderingContext])for(const method of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']) if(method in cls.prototype) cls.prototype[method]=function(){};});
await page.clock.install(); await page.goto('http://127.0.0.1:4299/'); log('goto');
const timer=setTimeout(()=>{log('HARD TIMEOUT',warnings); process.exit(2);},70000);
try { await page.getByRole('button',{name:'Начать прогулку'}).click({timeout:50000}); log('click'); const locked=await page.evaluate(()=>document.pointerLockElement!==null); log('capture',locked,'GPU warnings',warnings); if(process.argv.includes('--fence-stats')) log('fence stats',await page.evaluate(() => window.__fenceStats)); }
catch(e){log('ERROR',e.message,'GPU warnings',warnings)}
clearTimeout(timer); await browser.close();
