import { expect, it } from 'vitest';
import { BackSide, BoxGeometry, DoubleSide, FrontSide, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import type { Intersection } from 'three';
import { CameraRaycast } from './CameraRaycast';

it('matches exact mesh intersections for transformed indexed and nonindexed walls, roofs and material sides', () => {
  const cast = new CameraRaycast();
  for (const indexed of [true, false]) for (const side of [FrontSide, BackSide, DoubleSide]) {
    const original = new BoxGeometry(4, 3, 2, 12, 12, 12);
    const geometry = indexed ? original : original.toNonIndexed();
    const materials = Array.from({ length: 6 }, () => new MeshBasicMaterial({ side }));
    const mesh = new Mesh(geometry, materials);
    const group = new Group(); group.add(mesh);
    mesh.position.set(3, 2, -1); mesh.rotation.set(.2, .6, .1); mesh.scale.set(1.4, .8, 1.1);
    group.updateMatrixWorld(true);
    for (const restricted of [false, true]) {
      if (restricted) geometry.setDrawRange(300, 2001);
      for (let i = 0; i < 24; i++) {
        const origin = new Vector3(3 + Math.sin(i) * 7, 2 + Math.cos(i * .7) * 6, -1 + Math.cos(i) * 7);
        const ray = new Raycaster(origin, mesh.position.clone().sub(origin).normalize(), .05, i % 2 ? 30 : 5);
        const expected = ray.intersectObject(group).map(hit => hit.distance).sort((a, b) => a - b);
        const actual: Intersection[] = []; cast.prepare(group); cast.intersect(group, ray, actual);
        expect(actual.every(hit => hit.object === mesh)).toBe(true);
        const distances = actual.map(hit => hit.distance).sort((a, b) => a - b);
        expect(distances.length).toBe(expected.length);
        distances.forEach((distance, index) => expect(distance).toBeCloseTo(expected[index]!, 6));
      }
    }
    geometry.dispose(); if (!indexed) original.dispose(); materials.forEach(material => material.dispose());
  }
});

it('updates bounds after vertex edits and respects transformed parents and ray layers', () => {
  const cast = new CameraRaycast();
  const geometry = new BoxGeometry(2, 2, 2, 12, 12, 12);
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  const parent = new Group(); parent.add(mesh);
  const ray = new Raycaster(new Vector3(0, 0, 10), new Vector3(0, 0, -1));
  for (const offset of [0, 4]) {
    geometry.translate(0, 0, offset); parent.position.z = offset / 2; parent.updateMatrixWorld(true);
    const hits: Intersection[] = []; cast.prepare(parent); cast.intersect(parent, ray, hits);
    expect(Math.min(...hits.map(hit => hit.distance))).toBeCloseTo(ray.intersectObject(parent)[0]!.distance);
  }
  mesh.layers.set(1);
  const hidden: Intersection[] = []; cast.intersect(parent, ray, hidden); expect(hidden).toEqual([]);
  geometry.dispose(); mesh.material.dispose();
});
