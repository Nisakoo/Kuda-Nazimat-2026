// CPU-only geometry inspection. This cannot prove or exclude GPU shadow artifacts.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '../../../../client/package.json'));
const { Raycaster, Vector3 } = require('three');
const { GLTFLoader } = await import(require.resolve('three/addons/loaders/GLTFLoader.js'));
const paths = { baseline: resolve(here, '../../../../client/public/assets/models/avatars/lukas.glb'), candidate: join(here, 'lukas.glb') };
const report = { description: 'CPU-only torso geometry and sampled front-ray depth intersections. A static test cannot identify GPU shadow acne.', models: {} };
for (const [name, path] of Object.entries(paths)) {
  const bytes = await readFile(path), gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  const torso = gltf.scene.getObjectByName('torso-surface'), g = torso.geometry, pos = g.attributes.position, index = g.index;
  const triangles = index ? index.count / 3 : pos.count / 3, seen = new Map(), p = new Vector3(), a = new Vector3(), b = new Vector3(), c = new Vector3();
  let duplicates = 0, degenerate = 0;
  for (let i = 0; i < triangles; i++) {
    const get = j => index ? index.getX(i * 3 + j) : i * 3 + j;
    a.fromBufferAttribute(pos, get(0)); b.fromBufferAttribute(pos, get(1)); c.fromBufferAttribute(pos, get(2));
    if (b.clone().sub(a).cross(c.clone().sub(a)).length() < 1e-10) degenerate++;
    const key = [a, b, c].map(v => v.toArray().map(n => n.toFixed(7)).join(',')).sort().join('|');
    if (seen.has(key)) duplicates++; else seen.set(key, i);
  }
  const rays = new Raycaster(), direction = new Vector3(0, 0, -1); let samples = 0, hits = 0, nearPairs = 0; const examples = [];
  for (let yi = 0; yi < 23; yi++) for (let xi = 0; xi < 23; xi++) {
    const x = -.21 + (xi + .37) * .42 / 23, y = .54 + (yi + .41) * .35 / 23;
    rays.set(p.set(x, y, 2), direction); const intersections = rays.intersectObject(torso, false); samples++;
    if (!intersections.length) continue; hits++;
    for (let i = 1; i < intersections.length; i++) {
      const gap = intersections[i].distance - intersections[i - 1].distance;
      if (gap < .001) { nearPairs++; if (examples.length < 8) examples.push({ x, y, gap, faces: [intersections[i - 1].faceIndex, intersections[i].faceIndex] }); }
    }
  }
  report.models[name] = { sha256: createHash('sha256').update(bytes).digest('hex'), torsoTriangles: triangles, exactDuplicateTriangles: duplicates, degenerateTriangles: degenerate, samples, hits, nearPairsUnder1mm: nearPairs, examples, materials: { type: torso.material.type, opacity: torso.material.opacity, transparent: torso.material.transparent, texture: !!torso.material.map, roughness: torso.material.roughness, metalness: torso.material.metalness } };
}
await writeFile(join(here, 'tunic-geometry-inspection.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
