import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BoxGeometry } from 'three';
import ts from 'typescript';
import { roundFootprint, cityOverheadVolumes } from './city-collisions.mjs';

function contains(polygon, x, z) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const source = await readFile(new URL('../../shared/city/catalogue.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { cityLocal } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
async function district(id) {
  const bytes = await readFile(new URL(`../public/assets/models/city/city-${id}.glb`, import.meta.url));
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  return { ...gltf.nodes.find(node => node.extras?.collisions)?.extras, vertices() {
    const accessor = gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION];
    const view = gltf.bufferViews[accessor.bufferView];
    assert.equal(accessor.componentType, 5126);
    const offset = 28 + bytes.readUInt32LE(12) + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    return Array.from({ length: accessor.count }, (_, i) => {
      const start = offset + i * (view.byteStride ?? 12);
      return [bytes.readFloatLE(start), bytes.readFloatLE(start + 4), bytes.readFloatLE(start + 8)];
    });
  } };
}
function blocked(data, id, x, z) {
  const p = cityLocal(id, x, z);
  return data.collisions.some(polygon => contains(polygon, p.x, p.z));
}

test('round objects keep a close perimeter and leave their old square corners empty', () => {
  const shape = roundFootprint(0, 0, 3.5);
  for (let angle = .01; angle < Math.PI * 2; angle += .15) assert.ok(contains(shape, 3.499 * Math.cos(angle), 3.499 * Math.sin(angle)));
  assert.equal(contains(shape, 3.3, 3.3), false);
  assert.equal(contains(shape, 3.7, 0), false);
});

test('a reachable overhead beam preserves ground passage and excludes low decoration', () => {
  const beam = new BoxGeometry(4, .2, .2).translate(0, 2.2, 0);
  beam.userData.citySolid = true;
  const paving = new BoxGeometry(5, .05, 3).translate(0, .025, 0);
  paving.userData.citySolid = true;
  const leaf = new BoxGeometry(1, 1, 1).translate(0, 1, 0);
  const volumes = cityOverheadVolumes([beam, paving, leaf], []);
  assert.equal(volumes.length, 1);
  assert.ok(volumes[0].bottomY > 1.8 && volumes[0].bottomY < 2.2);
  for (const geometry of [beam, paving, leaf]) geometry.dispose();
});

test('generated fountain GLB blocks the bowl, not its empty square corners', async () => {
  const data = await district('fountain');
  assert.ok(blocked(data, 'fountain', 0, -5));
  assert.equal(blocked(data, 'fountain', 3.3, -1.7), false);
});

test('generated mill GLB preserves thin canopy posts and an empty covered corner', async () => {
  const data = await district('mill');
  assert.ok(blocked(data, 'mill', -5.4, -11.4), 'the relocated 16 cm post has a collision');
  assert.equal(blocked(data, 'mill', 2.45, -5.15), false, 'empty canopy corner stays traversable');
  assert.ok(blocked(data, 'mill', 0, -7), 'the actual millstone remains solid');
});

test('generated guest GLB retains hanging cloth height without a floor-wide wall', async () => {
  const data = await district('guest'), vertices = data.vertices();
  // fitDistrict may translate the whole clothesline. Read its paired lower/upper
  // corners from the final GLB instead of assuming the original authored anchor.
  const key = ([x, , z]) => `${x.toFixed(5)},${z.toFixed(5)}`;
  const tops = new Set(vertices.filter(p => Math.abs(p[1] - 3.7) < .0001).map(key));
  const corners = [...new Map(vertices.filter(p => Math.abs(p[1] - 2.1) < .0001 && tops.has(key(p))).map(p => [key(p), p])).values()];
  assert.equal(corners.length, 20, 'five cloth panels retain their four lower corners');
  for (const [x, y, z] of corners) assert.ok(data.ceilingVolumes.some(v => x >= v.minX && x <= v.maxX && z >= v.minZ && z <= v.maxZ && y >= v.bottomY && v.bottomY > 1.8 && v.topY >= 3.7), 'every cloth corner belongs to its exported height-aware volume');
  const center = corners.reduce((sum, p) => [sum[0] + p[0] / corners.length, sum[1] + p[2] / corners.length], [0, 0]);
  assert.equal(data.collisions.some(polygon => contains(polygon, ...center)), false, 'ground beneath the actual clothesline stays open');
});
