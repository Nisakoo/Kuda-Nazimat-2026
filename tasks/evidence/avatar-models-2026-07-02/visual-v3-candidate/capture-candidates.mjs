// Do not run until the main agent grants GPU GO. This serves only private candidate GLBs.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.env.TASK048_RENDER_GO !== '1') throw new Error('GPU capture is locked. Wait for explicit GPU GO.');
const here = dirname(fileURLToPath(import.meta.url)), client = resolve(here, '../../../../client');
const require = createRequire(join(client, 'package.json')), { chromium } = require('@playwright/test');
const ids = ['lukas', 'nic', 'dan', 'ksu'], imageDir = join(here, 'captures'); await mkdir(imageDir, { recursive: true });
const report = { status: 'incomplete', startedAt: new Date().toISOString(), candidates: {}, images: [], errors: [], shadowMap: 'PCFShadowMap: explicit supported equivalent of the prior removed PCFSoftShadowMap fallback', limitations: ['Private candidate GLBs only.', 'SwiftShader evidence is not hardware acceptance.', 'No tool attachment is rendered.'] };
for (const id of ids) { const b = await readFile(join(here, id + '.glb')); report.candidates[id] = { sha256: createHash('sha256').update(b).digest('hex'), bytes: b.length }; }
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#fbf1df}canvas{display:block}</style><script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head><body><script type="module">
import * as T from 'three'; import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const renderer=new T.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setSize(800,1000);renderer.setPixelRatio(1);renderer.outputColorSpace=T.SRGBColorSpace;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;renderer.setClearColor('#fff4da',0);document.body.append(renderer.domElement);
const scene=new T.Scene(),group=new T.Group(),camera=new T.OrthographicCamera(-.88,.88,1.10,-1.10,.1,30);camera.position.set(0,1.5,5);camera.lookAt(0,.86,0);camera.updateProjectionMatrix();scene.add(group);
const pedestal=new T.Mesh(new T.CylinderGeometry(.72,.76,.12,6),new T.MeshStandardMaterial({color:'#e4cba2',roughness:1,flatShading:true}));pedestal.position.y=-.065;pedestal.receiveShadow=true;scene.add(pedestal);
const ambient=new T.AmbientLight('#fff7df',2.3),sun=new T.DirectionalLight('#fff1d0',3.3),fill=new T.DirectionalLight('#d4e9e9',1.2);sun.position.set(-3,6,5);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-2;sun.shadow.camera.right=2;sun.shadow.camera.top=3;sun.shadow.camera.bottom=-1;fill.position.set(4,2,1);scene.add(ambient,sun,fill);
const settings={preview:['#fff7df',2.3,'#fff1d0',3.3,'#d4e9e9',1.2],neutral:['#ffffff',1.6,'#ffffff',2.3,'#e6eeff',.8],market:['#ffe4cc',1.8,'#ffe5bd',2.8,'#d4e9e9',.8]};let current=null,mixer=null,clips=[];
window.selectCandidate=async id=>{if(current)group.remove(current);const result=await new GLTFLoader().loadAsync('/candidate/'+encodeURIComponent(id)+'.glb');current=result.scene;clips=result.animations;const b=new T.Box3().setFromObject(current),h=b.getSize(new T.Vector3()).y;current.scale.multiplyScalar(1.85/h);current.position.y=-b.min.y*1.85/h;current.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});group.add(current);mixer=new T.AnimationMixer(current);};
window.capturePose=(yaw,light,pose,time)=>{const c=settings[light];ambient.color.set(c[0]);ambient.intensity=c[1];sun.color.set(c[2]);sun.intensity=c[3];fill.color.set(c[4]);fill.intensity=c[5];group.rotation.y=yaw;mixer.stopAllAction();const clip=clips.find(c=>c.name===pose);if(!clip)throw new Error('Missing clip '+pose);mixer.clipAction(clip).play();mixer.setTime(time);scene.updateMatrixWorld(true);renderer.render(scene,camera);};window.ready=true;
</script></body></html>`;
const threeRoot = resolve(client, 'node_modules/three');
const server = createServer(async (req, res) => { try {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
  if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  let file;
  if (/^\/candidate\/(lukas|nic|dan|ksu)\.glb$/.test(pathname)) file = join(here, pathname.split('/').at(-1));
  else if (pathname.startsWith('/three/')) { file = resolve(threeRoot, '.' + pathname.slice('/three'.length)); if (!file.startsWith(threeRoot + sep)) throw new Error('invalid path'); }
  else throw new Error('not found');
  const data = await readFile(file); res.setHeader('Content-Type', file.endsWith('.glb') ? 'model/gltf-binary' : 'text/javascript'); res.end(data);
} catch { res.writeHead(404); res.end(); } });
await new Promise(done => server.listen(0, '127.0.0.1', done)); let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 1000 }, deviceScaleFactor: 1 }); page.setDefaultTimeout(120000);
  page.on('pageerror', e => report.errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); }); page.on('requestfailed', r => report.errors.push('request failed: ' + r.url())); page.on('response', r => { if (r.status() >= 400) report.errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.ready);
  for (const id of ids) {
    await page.evaluate(id => window.selectCandidate(id), id);
    for (const lighting of ['preview', 'neutral', 'market']) for (const [view, yaw] of [['front', 0], ['side', Math.PI / 2], ['back', Math.PI]]) {
      await page.evaluate(([yaw, lighting]) => window.capturePose(yaw, lighting, 'idle', 0), [yaw, lighting]);
      const filename = `${id}-${lighting}-${view}-idle.png`; await page.screenshot({ path: join(imageDir, filename), timeout: 120000 });
      report.images.push({ id, lighting, view, pose: 'idle', file: 'captures/' + filename });
    }
    for (const [view, yaw] of [['front', 0], ['side', Math.PI / 2]]) {
      await page.evaluate(yaw => window.capturePose(yaw, 'preview', 'walk', .225), yaw);
      const filename = `${id}-preview-${view}-walk.png`; await page.screenshot({ path: join(imageDir, filename), timeout: 120000 });
      report.images.push({ id, lighting: 'preview', view, pose: 'walk', seconds: .225, file: 'captures/' + filename });
    }
  }
  if (report.errors.length) throw new Error('Browser errors recorded'); report.status = 'complete';
} catch (e) { report.failure = String(e); process.exitCode = 1; }
finally { await browser?.close(); await new Promise(done => server.close(done)); report.finishedAt = new Date().toISOString(); await writeFile(join(here, 'capture-results.json'), JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ status: report.status, images: report.images.length, errors: report.errors.length, failure: report.failure }));
