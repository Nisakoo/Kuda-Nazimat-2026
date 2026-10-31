import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { CylinderGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const root = fileURLToPath(new URL('../public/assets/models/demo/', import.meta.url));
await mkdir(root, { recursive: true });
const parts = [];
const views = [];
const accessors = [];
let length = 0;
function add(array, type, componentType) {
  const pad = (4 - length % 4) % 4;
  if (pad) { parts.push(Buffer.alloc(pad)); length += pad; }
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  const view = views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length }) - 1;
  parts.push(bytes); length += bytes.length;
  const width = type === 'VEC2' ? 2 : type === 'VEC3' ? 3 : type === 'VEC4' ? 4 : 1;
  const accessor = { bufferView: view, componentType, count: array.length / width, type };
  if (componentType === 5126) {
    accessor.min = Array.from({ length: width }, (_, index) => Math.min(...array.filter((_, offset) => offset % width === index)));
    accessor.max = Array.from({ length: width }, (_, index) => Math.max(...array.filter((_, offset) => offset % width === index)));
  }
  return accessors.push(accessor) - 1;
}
function mesh(geometry, material) {
  const attributes = { POSITION: add(geometry.attributes.position.array, 'VEC3', 5126), NORMAL: add(geometry.attributes.normal.array, 'VEC3', 5126) };
  if (geometry.attributes.uv) attributes.TEXCOORD_0 = add(geometry.attributes.uv.array, 'VEC2', 5126);
  const primitive = { attributes, material };
  if (geometry.index) primitive.indices = add(geometry.index.array, 'SCALAR', geometry.index.array instanceof Uint32Array ? 5125 : 5123);
  geometry.dispose();
  return { primitives: [primitive] };
}
const meshes = [mesh(new RoundedBoxGeometry(0.7, 0.9, 0.18, 2, 0.05), 0), mesh(new CylinderGeometry(0.36, 0.42, 0.45, 16), 1), mesh(new RoundedBoxGeometry(0.4, 0.035, 0.025, 1, 0.01), 2)];
const times = add(new Float32Array([0, 1, 2]), 'SCALAR', 5126);
const idle = add(new Float32Array([0, 1, 0, 0, 1.12, 0, 0, 1, 0]), 'VEC3', 5126);
const walk = add(new Float32Array([0, 0, 0, 1, 0, Math.sin(0.3), 0, Math.cos(0.3), 0, 0, 0, 1]), 'VEC4', 5126);
const nodes = [
  { name: 'Tablet', mesh: 0, translation: [0, 1, 0], children: [2, 3, 4] },
  { name: 'Pedestal', mesh: 1, translation: [0, 0.225, 0] },
  { name: 'Inscription1', mesh: 2, translation: [0, 0.2, 0.105] },
  { name: 'Inscription2', mesh: 2, translation: [0, 0, 0.105] },
  { name: 'Inscription3', mesh: 2, translation: [0, -0.2, 0.105] },
];
function pngChunk(type, data) {
  const name = Buffer.from(type);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0); name.copy(result, 4); data.copy(result, 8); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return result;
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(Buffer.from([0, 255, 245, 225, 255, 215, 195, 165, 255, 0, 235, 220, 190, 255, 255, 250, 235, 255]))), pngChunk('IEND', Buffer.alloc(0))]);
const pad = (4 - length % 4) % 4; if (pad) { parts.push(Buffer.alloc(pad)); length += pad; }
const imageView = views.push({ buffer: 0, byteOffset: length, byteLength: png.length }) - 1;
parts.push(png); length += png.length;
const json = {
  asset: { version: '2.0', generator: 'competition-2026 local fixture generator' },
  scene: 0, scenes: [{ nodes: [0, 1] }], nodes, meshes,
  materials: [
    { name: 'clay', pbrMetallicRoughness: { baseColorFactor: [0.65, 0.35, 0.18, 1], metallicFactor: 0, roughnessFactor: 0.85 } },
    { name: 'sandstone', pbrMetallicRoughness: { baseColorFactor: [0.85, 0.69, 0.42, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
    { name: 'lapis', pbrMetallicRoughness: { baseColorFactor: [0.18, 0.34, 0.5, 1], metallicFactor: 0, roughnessFactor: 0.8 } },
  ],
  buffers: [{ byteLength: length }], bufferViews: views, accessors,
  images: [{ bufferView: imageView, mimeType: 'image/png' }], textures: [{ source: 0 }],
  animations: [
    { name: 'idle', samplers: [{ input: times, output: idle, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] },
    { name: 'walk', samplers: [{ input: times, output: walk, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }] },
  ],
};
json.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
const binary = Buffer.concat(parts);
function pack(document) {
  const text = Buffer.from(JSON.stringify(document));
  const jsonChunk = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const binChunk = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + jsonChunk.length + binChunk.length, 8);
  header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binChunk.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonChunk, binHeader, binChunk]);
}
await writeFile(root + 'tablet.glb', pack(json));
await writeFile(root + 'tablet.bin', binary);
await writeFile(root + 'tablet.gltf', JSON.stringify({ ...json, buffers: [{ byteLength: length, uri: './tablet.bin' }] }));
const fixtureRoot = fileURLToPath(new URL('../e2e/fixtures/', import.meta.url));
await mkdir(fixtureRoot, { recursive: true });
const plain = structuredClone(json); delete plain.images; delete plain.textures; delete plain.materials[0].pbrMetallicRoughness.baseColorTexture;
await writeFile(fixtureRoot + 'tablet-plain.glb', pack(plain));
console.log('Generated original GLB/glTF demo fixtures.');
