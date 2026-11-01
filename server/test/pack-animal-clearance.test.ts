import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { CITY_BASE_LOCATIONS, cityLocal } from '../../shared/city/catalogue.ts';
import { MARKET_WORLD_LIFE } from '../../shared/world-life/market.ts';
import { packAnimalPosition } from '../../shared/world-life/phase.ts';

type Point = readonly [number, number, number];
type Triangle = readonly [Point, Point, Point];
interface Glb {
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: { mesh?: number; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }[];
  meshes: { primitives: { attributes: { POSITION: number }; indices: number }[] }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
}

// Read shipped geometry, including all hierarchy translations: no DOM, renderer or GPU required.
function triangles(asset: string, origin: Point = [0, 0, 0]): Triangle[] {
  const bytes = readFileSync(fileURLToPath(new URL(`../../client/public/assets/models/city/${asset}.glb`, import.meta.url)));
  const jsonLength = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString()) as Glb;
  const binary = bytes.subarray(28 + jsonLength);
  function values(index: number): number[][] {
    const accessor = gltf.accessors[index]!, view = gltf.bufferViews[accessor.bufferView]!;
    const width = accessor.type === 'VEC3' ? 3 : 1;
    const size = accessor.componentType === 5123 ? 2 : 4;
    const stride = view.byteStride ?? width * size, start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    expect([5123, 5125, 5126]).toContain(accessor.componentType);
    return Array.from({ length: accessor.count }, (_, row) => Array.from({ length: width }, (_, column) => {
      const offset = start + row * stride + column * size;
      return accessor.componentType === 5126 ? binary.readFloatLE(offset) : accessor.componentType === 5125 ? binary.readUInt32LE(offset) : binary.readUInt16LE(offset);
    }));
  }
  const result: Triangle[] = [];
  function node(index: number, offset: Point): void {
    const entry = gltf.nodes[index]!;
    // These generator assets bake rotations/scales in vertices. Fail if that contract changes.
    expect(entry.rotation).toBeUndefined(); expect(entry.scale).toBeUndefined();
    if (entry.matrix) { expect(entry.matrix.slice(0, 12)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]); expect(entry.matrix[15]).toBe(1); }
    const translation = entry.matrix?.slice(12, 15) ?? entry.translation ?? [0, 0, 0];
    const world: Point = [offset[0] + translation[0]!, offset[1] + translation[1]!, offset[2] + translation[2]!];
    if (entry.mesh !== undefined) for (const primitive of gltf.meshes[entry.mesh]!.primitives) {
      const vertices = values(primitive.attributes.POSITION).map((p): Point => [p[0]! + world[0], p[1]! + world[1], p[2]! + world[2]]);
      const indices = values(primitive.indices).flat();
      for (let i = 0; i < indices.length; i += 3) result.push([vertices[indices[i]!]!, vertices[indices[i + 1]!]!, vertices[indices[i + 2]!]!]);
    }
    for (const child of entry.children ?? []) node(child, world);
  }
  for (const root of gltf.scenes[gltf.scene]!.nodes) node(root, origin);
  return result;
}
const cross = (a: Point, b: Point): Point => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
// Conservative whole-animal envelope: wider/longer than the model, including head nod, leg swing and tail.
const half: Point = [.58, 1.05, 1.2];
function overlaps(triangle: Triangle, x: number, z: number, yaw: number, boxHalf: Point = half, centerY = boxHalf[1]): boolean {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const vertices = triangle.map((p): Point => [c * (p[0] - x) - s * (p[2] - z), p[1] - centerY, s * (p[0] - x) + c * (p[2] - z)]);
  for (let axis = 0; axis < 3; axis++) if (Math.min(...vertices.map(p => p[axis]!)) > boxHalf[axis]! || Math.max(...vertices.map(p => p[axis]!)) < -boxHalf[axis]!) return false;
  const edges = [subtract(vertices[1]!, vertices[0]!), subtract(vertices[2]!, vertices[1]!), subtract(vertices[0]!, vertices[2]!)];
  const axes = [cross(edges[0]!, edges[1]!), ...edges.flatMap(edge => [cross(edge, [1, 0, 0]), cross(edge, [0, 1, 0]), cross(edge, [0, 0, 1])])];
  for (const axis of axes) {
    const projection = vertices.map(p => p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2]);
    const extent = boxHalf[0] * Math.abs(axis[0]) + boxHalf[1] * Math.abs(axis[1]) + boxHalf[2] * Math.abs(axis[2]);
    if (Math.min(...projection) > extent || Math.max(...projection) < -extent) return false;
  }
  return true;
}

it('the full mule circles the actual millstone without intersecting canopy posts, beams or workshop objects', () => {
  const animal = MARKET_WORLD_LIFE.packAnimals!.find(item => item.instanceId === 'city-mule')!;
  const instance = MARKET_WORLD_LIFE.instances.find(item => item.id === animal.instanceId)!;
  const mill = CITY_BASE_LOCATIONS.find(item => item.id === 'mill')!, stone = cityLocal('mill', 0, -7);
  const center = { x: mill.x + stone.x, z: mill.z + stone.z };
  const routeCenter = animal.route.reduce((sum, p) => ({ x: sum.x + p.x / animal.route.length, z: sum.z + p.z / animal.route.length }), { x: 0, z: 0 });
  expect(routeCenter.x).toBeCloseTo(center.x, 6); expect(routeCenter.z).toBeCloseTo(center.z, 6);
  expect(instance.position).toEqual(animal.route[0]);

  const model = triangles('city-mule').flat();
  expect(Math.max(...model.map(p => Math.abs(p[0])))).toBeLessThan(half[0] - .08);
  expect(Math.max(...model.map(p => p[1]))).toBeLessThan(half[1] * 2 - .1);
  expect(Math.max(...model.map(p => Math.abs(p[2])))).toBeLessThan(half[2] - .08);

  const obstacles = triangles('city-mill', [mill.x, 0, mill.z])
    // Low inset paving is a walkable surface, not a beam/solid obstacle.
    .filter(triangle => Math.max(...triangle.map(p => p[1])) > .16 && Math.min(...triangle.map(p => p[1])) < 2.1)
    .map(triangle => ({ triangle, minX: Math.min(...triangle.map(p => p[0])), maxX: Math.max(...triangle.map(p => p[0])), minZ: Math.min(...triangle.map(p => p[2])), maxZ: Math.max(...triangle.map(p => p[2])) }));
  const blocked = (x: number, z: number, yaw: number) => obstacles.some(o => o.maxX > x - 1.4 && o.minX < x + 1.4 && o.maxZ > z - 1.4 && o.minZ < z + 1.4 && overlaps(o.triangle, x, z, yaw));
  const intersections: { time: number; x: number; z: number }[] = [];
  // Actual Catmull-Rom interpolation and the renderer's +70 ms heading, including the closing segment.
  for (let time = 0; time <= animal.cycleMs; time += 50) {
    const p = packAnimalPosition(animal, time), next = packAnimalPosition(animal, time + 70);
    expect(Math.hypot(p.x - center.x, p.z - center.z)).toBeGreaterThan(4.28);
    expect(Math.hypot(p.x - center.x, p.z - center.z)).toBeLessThan(4.31);
    const yaw = Math.atan2(next.x - p.x, next.z - p.z);
    // The complete circuit lies well inside this district's chunk, not the old NPC forecourt.
    expect(p.x - 1.4).toBeGreaterThan(mill.x - 16); expect(p.x + 1.4).toBeLessThan(mill.x + 16);
    expect(p.z - 1.4).toBeGreaterThan(mill.z - 16); expect(p.z + 1.4).toBeLessThan(mill.z + 16);
    if (blocked(p.x, p.z, yaw)) intersections.push({ time, x: p.x, z: p.z });
  }
  expect(intersections, 'Animated full-body clearance over one complete loop').toEqual([]);
  // Prove this catches the former regression rather than merely checking ground support.
  const previous = { ...animal, route: Array.from({ length: 12 }, (_, index) => ({ x: -34.5 + Math.sin(index * Math.PI / 6) * 2.8, y: 0, z: 35 + Math.cos(index * Math.PI / 6) * 2.8 })) };
  let previousIntersections = 0;
  for (let time = 0; time < previous.cycleMs; time += 50) {
    const p = packAnimalPosition(previous, time), next = packAnimalPosition(previous, time + 70);
    if (blocked(p.x, p.z, Math.atan2(next.x - p.x, next.z - p.z))) previousIntersections++;
  }
  expect(previousIntersections, 'The former forecourt route collides with authored objects').toBeGreaterThan(0);
});

it('both feeding camels keep their torso and legs clear of the actual fitted guest furniture', () => {
  const guest = CITY_BASE_LOCATIONS.find(item => item.id === 'guest')!;
  const geometry = triangles('city-guest', [guest.x, 0, guest.z]);
  const camels = MARKET_WORLD_LIFE.packAnimals!.filter(item => item.kind === 'camel');
  expect(camels).toHaveLength(2);
  // Exclude ground paving below 17 cm and the feeding neck/head in front of +0.8 m.
  // Includes the loaded torso, hump, tail and legs: x±.58, z−1.2..+.8, y.17..2.3.
  const torsoHalf: Point = [.58, 1.065, 1];
  for (const animal of camels) {
    const instance = MARKET_WORLD_LIFE.instances.find(item => item.id === animal.instanceId)!;
    expect(animal.behavior).toBe('feed'); expect(instance.rotationY).toBe(0);
    expect(instance.position).toEqual(animal.route[0]);
    const { x, z } = instance.position;
    const intersections = geometry.filter(triangle => overlaps(triangle, x, z - .2, 0, torsoHalf, 1.235));
    expect(intersections, `${animal.instanceId}: furniture intersects torso/legs`).toEqual([]);
  }
  // The previous table's actual top triangle crossed camel 2's loaded torso.
  const oldTop = [[-2.5, -8], [-2.5, -6], [2.5, -8]].map(([x, z]): Point => {
    const p = cityLocal('guest', x!, z!); return [guest.x + p.x, 1.1, guest.z + p.z];
  }) as unknown as Triangle;
  const second = MARKET_WORLD_LIFE.instances.find(item => item.id === 'city-camel-2')!;
  expect(overlaps(oldTop, second.position.x, second.position.z - .2, 0, torsoHalf, 1.235), 'The guard catches the former table collision').toBe(true);
});
