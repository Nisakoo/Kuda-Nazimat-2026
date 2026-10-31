import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
const publicRoot = new URL('../public/', import.meta.url);
const root = new URL('maps/demo/', publicRoot);
await mkdir(new URL('chunks/', root), { recursive: true });
async function writeChanged(url, value) {
  const bytes = typeof value === 'string' ? Buffer.from(value) : value;
  const old = await readFile(url).catch(() => null);
  if (!old || !old.equals(bytes)) await writeFile(url, bytes);
}
const assets = {};
const collisionProfiles = {};
for (const name of ['courtyard', 'history', 'science', 'tablet']) {
  const path = `assets/models/demo/${name}.glb`;
  const bytes = await readFile(new URL(path, publicRoot));
  assets[path] = { bytes: bytes.length, memory: name === 'courtyard' ? 12 * 1024 * 1024 : 3 * 1024 * 1024 };
  // Derive walk obstacles from the same GLB geometry that the renderer displays.
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const rectangles = [];
  function visit(index, parent) {
    const node = gltf.nodes[index];
    const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
      new Vector3().fromArray(node.translation ?? [0, 0, 0]),
      new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
      new Vector3().fromArray(node.scale ?? [1, 1, 1]),
    );
    const world = new Matrix4().multiplyMatrices(parent, local);
    for (const primitive of gltf.meshes?.[node.mesh]?.primitives ?? []) {
      const accessor = gltf.accessors[primitive.attributes.POSITION];
      const box = new Box3(new Vector3().fromArray(accessor.min), new Vector3().fromArray(accessor.max)).applyMatrix4(world);
      if (box.max.y > 0.15 && box.min.y < 1.7) rectangles.push([box.min.x, box.min.z, box.max.x, box.max.z]);
    }
    for (const child of node.children ?? []) visit(child, world);
  }
  for (const node of gltf.scenes[gltf.scene ?? 0].nodes) visit(node, new Matrix4());
  collisionProfiles[name] = rectangles;
}
const chunks = [];
const hashes = new Set();
const resolution = 128;
let resourcesBytes = Object.values(assets).reduce((sum, value) => sum + value.bytes, 0);
for (let z = -16; z < 16; z++) for (let x = -16; x < 16; x++) {
  const id = `${x}_${z}`;
  const central = x === 0 && z === 0;
  const region = central ? 'Площадь открытий' : z > 0 ? 'Сады науки' : 'Квартал писцов';
  const url = `maps/demo/chunks/${id}.json`;
  const objects = [{ id: `${id}-landscape`, assetId: central ? 'courtyard' : z > 0 ? 'district-science' : 'district-history', transform: { position: { x: x * 32, y: 0, z: z * 32 }, rotationY: 0 } }];
  const data = Buffer.alloc(resolution * resolution);
  const rectangles = [...collisionProfiles[central ? 'courtyard' : z > 0 ? 'science' : 'history']];
  // Unique, meaningful collision details in each district's small garden.
  const seed = (x + 16) * 32 + z + 16;
  const gardenX = 2 + (seed % 32) * 0.25;
  const gardenZ = -4 + Math.floor(seed / 32) * 0.25;
  if (!central) {
    rectangles.push(...collisionProfiles.tablet.map(([minX, minZ, maxX, maxZ]) => [minX + gardenX, minZ + gardenZ, maxX + gardenX, maxZ + gardenZ]));
    objects.push({ id: `${id}-tablet`, assetId: 'demo-tablet', transform: { position: { x: x * 32 + gardenX, y: 0, z: z * 32 + gardenZ }, rotationY: 0 } });
  }
  const json = JSON.stringify({ id, objects });
  for (const [minX, minZ, maxX, maxZ] of rectangles) {
    const fromX = Math.max(0, Math.ceil((minX + 16) * resolution / 32 - 0.5));
    const toX = Math.min(resolution - 1, Math.floor((maxX + 16) * resolution / 32 - 0.5));
    const fromZ = Math.max(0, Math.ceil((minZ + 16) * resolution / 32 - 0.5));
    const toZ = Math.min(resolution - 1, Math.floor((maxZ + 16) * resolution / 32 - 0.5));
    if (fromX <= toX) for (let row = fromZ; row <= toZ; row++) data.fill(1, row * resolution + fromX, row * resolution + toX + 1);
  }
  // Region limits are encoded at the real finite world's perimeter.
  if (x === -16) for (let row = 0; row < resolution; row++) data[row * resolution] = 1;
  if (x === 15) for (let row = 0; row < resolution; row++) data[row * resolution + resolution - 1] = 1;
  if (z === -16) data.fill(1, 0, resolution);
  if (z === 15) data.fill(1, data.length - resolution);
  const hash = createHash('sha256').update(data).digest('hex');
  // Equal byte resources share the same URL and are counted once in the denominator.
  const collisionFile = `maps/demo/chunks/collision-${hash}.bin`;
  if (!hashes.has(hash)) { await writeChanged(new URL(collisionFile, publicRoot), data); resourcesBytes += data.length; hashes.add(hash); }
  await writeChanged(new URL(url, publicRoot), json);
  resourcesBytes += Buffer.byteLength(json);
  chunks.push({ id, x, z, region, url, bytes: Buffer.byteLength(json), collisionUrl: collisionFile, collisionBytes: data.length, assets: [...new Set(objects.map((object) => object.assetId))] });
}
const manifest = { mapId: 'demo', version: 1, worldBytes: resourcesBytes, chunkSize: 32, collisionResolution: resolution, spawn: { x: 0, y: 0, z: 6 }, origin: { x: -16, z: -16 }, chunks, models: { 'demo-tablet': 'demo/tablet.glb', courtyard: 'demo/courtyard.glb', 'district-history': 'demo/history.glb', 'district-science': 'demo/science.glb' }, assets };
let text = '';
for (let pass = 0; pass < 10; pass++) {
  text = JSON.stringify(manifest);
  const total = resourcesBytes + Buffer.byteLength(text);
  if (manifest.worldBytes === total) break;
  manifest.worldBytes = total;
}
text = JSON.stringify(manifest);
await writeChanged(new URL('manifest.json', root), text);
const bootstrap = { manifestUrl: 'maps/demo/manifest.json', worldBytes: manifest.worldBytes, manifestBytes: Buffer.byteLength(text), assets };
const science = { ...manifest, mapId: 'science', spawn: { x: 0, y: 0, z: 38 } };
let scienceText = '';
for (let pass = 0; pass < 10; pass++) { scienceText = JSON.stringify(science); const total = resourcesBytes + Buffer.byteLength(scienceText); if (science.worldBytes === total) break; science.worldBytes = total; }
scienceText = JSON.stringify(science);
await writeChanged(new URL('science.json', root), scienceText);
const scienceBootstrap = { ...bootstrap, manifestUrl: 'maps/demo/science.json', worldBytes: science.worldBytes, manifestBytes: Buffer.byteLength(scienceText) };
await writeChanged(new URL('../src/shared/demoWorld.generated.ts', import.meta.url), `// Generated by scripts/generate-demo-world.mjs; public metadata only.\nexport const DEMO_WORLD = ${JSON.stringify(bootstrap)} as const;\nexport const SCIENCE_WORLD = ${JSON.stringify(scienceBootstrap)} as const;\n`);
console.log(`Prepared ${chunks.length} chunks; ${hashes.size} unique collision resources; world ${manifest.worldBytes} bytes, cache cap ${Math.floor(manifest.worldBytes / 10)} bytes.`);
