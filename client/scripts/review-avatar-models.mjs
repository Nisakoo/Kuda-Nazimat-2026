/** Offline, reproducible views of actual exported avatars; no game/server mutation. */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const client = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.argv[2] ?? `${client}/public/assets/models/avatars`);
const output = resolve(process.argv[3] ?? '/tmp/avatar-review');
await mkdir(output, { recursive: true });
const html = `<!doctype html><html><head><style>body{margin:0;background:#f4eee3}canvas{display:block}</style><script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head><body><script type="module">
import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const r=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});r.setSize(1200,840);r.setPixelRatio(1);r.outputColorSpace=T.SRGBColorSpace;r.toneMapping=T.ACESFilmicToneMapping;r.toneMappingExposure=1.1;r.shadowMap.enabled=true;r.shadowMap.type=T.PCFShadowMap;document.body.append(r.domElement);
const scenes=[];for(let i=0;i<6;i++){const s=new T.Scene();s.background=new T.Color('#f4eee3');const camera=new T.OrthographicCamera(-.55,.55,.59,-.59,.01,20);camera.position.set(0,1.05,5);camera.lookAt(0,.91,0);camera.zoom=.53;camera.updateProjectionMatrix();const ambient=new T.HemisphereLight('#fff4df','#a99880',2.2);const sun=new T.DirectionalLight('#fff4e1',3.4);sun.position.set(-3,5,5);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.normalBias=.012;sun.shadow.camera.left=-2;sun.shadow.camera.right=2;sun.shadow.camera.top=3;sun.shadow.camera.bottom=-1;s.add(ambient,sun,new T.DirectionalLight('#dae7ff',.8));const ground=new T.Mesh(new T.PlaneGeometry(20,20),new T.MeshStandardMaterial({color:'#eee3cd',roughness:1}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;ground.position.y=-.005;s.add(ground);scenes.push({s,camera,ambient,sun});}
window.show=async(id,light)=>{const gltf=await new GLTFLoader().loadAsync('/model/'+id+'.glb');const yaws=[0,Math.PI/4,Math.PI/2,Math.PI,0,Math.PI/2];for(let i=0;i<6;i++){const v=scenes[i];if(v.model)v.s.remove(v.model);v.model=gltf.scene.clone(true);v.model.rotation.y=yaws[i];v.model.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});v.s.add(v.model);const mixer=new T.AnimationMixer(v.model);mixer.clipAction(gltf.animations.find(c=>c.name===(i<4?'idle':'walk'))).play();mixer.setTime(i<4?0:.225);if(light==='market'){v.ambient.color.set('#ffe4cc');v.sun.color.set('#ffdbad');}else{v.ambient.color.set('#ffffff');v.sun.color.set('#ffffff');}r.setViewport(i%3*400,Math.floor((5-i)/3)*420,400,420);r.setScissor(i%3*400,Math.floor((5-i)/3)*420,400,420);r.setScissorTest(true);r.render(v.s,v.camera);}return true;};window.lineup=async(jumping=false)=>{const v=scenes[0];if(v.model)v.s.remove(v.model);const row=new T.Group();for(const [i,id]of ['lukas','nic','dan','ksu'].entries()){const g=await new GLTFLoader().loadAsync('/model/'+id+'.glb');g.scene.position.x=(i-1.5)*1.25;g.scene.rotation.y=-.10;g.scene.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});g.scene.userData.reviewId=id;row.add(g.scene);}if(jumping){for(const model of row.children){const g=await new GLTFLoader().loadAsync('/model/'+model.userData.reviewId+'.glb');const mixer=new T.AnimationMixer(model);mixer.clipAction(g.animations.find(c=>c.name==='jump')).play();mixer.setTime(.3);}}v.model=row;v.s.add(row);const c=new T.OrthographicCamera(-2.8,2.8,1.96,-1.96,.01,30);c.position.set(0,1.6,8);c.lookAt(0,.98,0);v.ambient.color.set('#ffffff');v.sun.color.set('#ffffff');r.setScissorTest(false);r.setViewport(0,0,1200,840);r.render(v.s,c);};window.ready=true;
</script></body></html>`;
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
    if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    let file;
    if (/^\/model\/(lukas|nic|dan|ksu)\.glb$/.test(path)) file = resolve(source, path.slice(7));
    else if (path.startsWith('/three/')) {
      const root = resolve(client, 'node_modules/three'); file = resolve(root, path.slice(7));
      if (!file.startsWith(root + sep)) throw new Error('path');
    } else throw new Error('path');
    res.setHeader('Content-Type', file.endsWith('.glb') ? 'model/gltf-binary' : 'text/javascript');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
const report = { images: [], hashes: {}, errors: [], layout: ['front idle', 'three-quarter idle', 'side idle', 'back idle', 'front walk at .225s', 'side walk at .225s'] };
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 840 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.ready);
  for (const id of ['lukas', 'nic', 'dan', 'ksu']) {
    report.hashes[id] = createHash('sha256').update(await readFile(resolve(source, id + '.glb'))).digest('hex');
    for (const light of ['neutral', 'market']) {
      await page.evaluate(([id, light]) => window.show(id, light), [id, light]);
      const file = `${id}-${light}.png`; await page.screenshot({ path: resolve(output, file) }); report.images.push(file);
    }
  }
  await page.evaluate(() => window.lineup());
  await page.screenshot({ path: resolve(output, 'lineup.png') }); report.images.push('lineup.png');
  await page.evaluate(() => window.lineup(true));
  await page.screenshot({ path: resolve(output, 'jump-lineup.png') }); report.images.push('jump-lineup.png');
  if (report.errors.length) throw new Error(report.errors.join('\n'));
} finally {
  await browser?.close(); await new Promise(done => server.close(done));
  await writeFile(resolve(output, 'review.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ images: report.images.length, errors: report.errors.length }));
