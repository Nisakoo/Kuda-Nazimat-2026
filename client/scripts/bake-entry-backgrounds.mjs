import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

// Optional authoring command. Normal dev/build/test never runs a GPU image bake.
// node client/scripts/bake-entry-backgrounds.mjs [output-directory]
const width = 1622, height = 970;
const out = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../public/assets/ui/', import.meta.url));
const source = fileURLToPath(new URL('./entry-background-scene.mjs', import.meta.url));
const moduleRoot = fileURLToPath(new URL('../node_modules/three/build/', import.meta.url));
const files = new Map([
  ['/entry-background-scene.mjs', source],
  ['/three.module.js', join(moduleRoot, 'three.module.js')],
  ['/three.core.js', join(moduleRoot, 'three.core.js')],
]);
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><script type="importmap">{"imports":{"three":"/three.module.js"}}</script><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block}#error{position:absolute;inset:0;background:#fff;color:#800;padding:24px;white-space:pre-wrap}</style></head><body><script type="module">
window.onerror=(message)=>{document.body.innerHTML='<pre id="error"></pre>';document.querySelector('#error').textContent=String(message);window.bakeError=String(message);};
try {
 const {entryBackground}=await import('/entry-background-scene.mjs');
 const scene=new URL(location.href).searchParams.get('scene');
 const start=performance.now(),value=entryBackground(scene,${width},${height});document.body.append(value.renderer.domElement);
 window.disposeBackground=value.dispose;
 window.bakeReceipt={scene,width:${width},height:${height},dpr:value.renderer.getPixelRatio(),calls:value.renderer.info.render.calls,triangles:value.renderer.info.render.triangles,renderSubmitMs:performance.now()-start,camera:{position:value.camera.position.toArray(),fov:value.camera.fov},resources:{geometries:value.renderer.info.memory.geometries,textures:value.renderer.info.memory.textures}};
 requestAnimationFrame(()=>requestAnimationFrame(()=>{window.bakeReady=true;}));
} catch(error) {window.bakeError=String(error);document.body.innerHTML='<pre id="error"></pre>';document.querySelector('#error').textContent=String(error);}
</script></body></html>`;
const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (pathname === '/') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); return; }
  const path = files.get(pathname);
  if (!path) { response.writeHead(404); response.end('Not found'); return; }
  readFile(path).then(bytes => { response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); response.end(bytes); }).catch(() => { response.writeHead(500); response.end('Local authoring source is unavailable'); });
});
let browser;
const temporary = await mkdtemp(join(tmpdir(), 'babylon-entry-bake-'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No local authoring address');
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium', args: ['--enable-unsafe-swiftshader'] });
  const receipts = [];
  for (const [scene, filename] of [['gates', 'city-gates.png'], ['street', 'babylon-market-day.png']]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage(), errors = [], failedRequests = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('requestfailed', request => failedRequests.push(request.url()));
      await page.goto(`http://127.0.0.1:${address.port}/?scene=${scene}`, { waitUntil: 'load' });
      // This is an offline authoring limit, not a changed game/test deadline.
      await page.waitForFunction(() => window.bakeReady === true || typeof window.bakeError === 'string', undefined, { timeout: 120000 });
      const result = await page.evaluate(() => ({ ready: window.bakeReady, error: window.bakeError, receipt: window.bakeReceipt, canvasCount: document.querySelectorAll('canvas').length, externalResources: performance.getEntriesByType('resource').map(item => item.name).filter(name => !name.startsWith(location.origin + '/') && !name.startsWith('data:')) }));
      if (!result.ready || result.error || result.canvasCount !== 1 || result.externalResources.length || errors.length || failedRequests.length) throw new Error(JSON.stringify({ result, errors, failedRequests }));
      const path = join(temporary, filename);
      await page.screenshot({ path, timeout: 120000 });
      const bytes = await readFile(path);
      if (bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height) throw new Error('Unexpected baked image dimensions');
      receipts.push({ ...result.receipt, filename, bytes: bytes.length, sha256: sha(bytes), errors, failedRequests, externalResources: result.externalResources });
      await page.evaluate(() => window.disposeBackground());
    } finally { await context.close(); }
  }
  // Publish both only after both complete; the old SVGs stay as authored history.
  await mkdir(out, { recursive: true });
  for (const receipt of receipts) await writeFile(join(out, receipt.filename), await readFile(join(temporary, receipt.filename)));
  const receipt = { at: new Date().toISOString(), sourceSha256: sha(await readFile(source)), width, height, note: 'Original static Three.js scenery. Not game FPS, LAN, or hardware acceptance. No remote resources or drawn UI.', scenes: receipts };
  await writeFile(join(out, 'entry-backgrounds.receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await browser?.close();
  await new Promise(accept => server.close(accept));
  await rm(temporary, { recursive: true, force: true });
}
