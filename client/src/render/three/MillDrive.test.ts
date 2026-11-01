import { readFileSync } from 'node:fs';
import { Box3, Matrix4, Mesh, Scene, Triangle, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import { CITY_BASE_LOCATIONS, cityLocal } from '../../../../shared/city/catalogue';
import { MARKET_WORLD_LIFE } from '../../../../shared/world-life/market';
import { WorldLifeVisuals } from './WorldLifeVisuals';
import type { GltfLibrary } from './GltfLibrary';
import type { EntityVisuals } from './EntityVisuals';

async function model(name: string) {
  const bytes = Uint8Array.from(readFileSync(new URL(`../../../public/assets/models/city/${name}.glb`, import.meta.url)));
  return (await new GLTFLoader().parseAsync(bytes.buffer, '')).scene;
}
it('keeps the drive on its axle and harness through a full turn, clear of real supports and furniture', async () => {
  const mule = await model('city-mule'), mill = await model('city-mill');
  const location = CITY_BASE_LOCATIONS.find(item => item.id === 'mill')!, local = cityLocal('mill', 0, -7);
  const axle = new Vector3(location.x + local.x, 2.65, location.z + local.z);
  mill.position.set(location.x, 0, location.z); mill.updateMatrixWorld(true);
  const obstacles: { triangle: Triangle; bounds: Box3 }[] = [];
  mill.traverse(node => {
    if (!(node instanceof Mesh)) return;
    const vertices = node.geometry.getAttribute('position'), index = node.geometry.index;
    for (let i = 0; i < (index?.count ?? vertices.count); i += 3) {
      const point = (offset: number) => new Vector3().fromBufferAttribute(vertices, index ? index.getX(i + offset) : i + offset).applyMatrix4(node.matrixWorld);
      const triangle = new Triangle(point(0), point(1), point(2));
      const bounds = new Box3().setFromPoints([triangle.a, triangle.b, triangle.c]);
      if (bounds.max.y >= 1.2 && bounds.min.y <= 2.8) obstacles.push({ triangle, bounds });
    }
  });
  expect(obstacles.length).toBeGreaterThan(100);
  // Positive control: the former canopy supports stood inside the drive's sweep.
  const oldPosts: Triangle[] = [];
  for(const x of [-3,3])for(const z of [-9,-5]){
    const corners=[[-.08,-.08],[.08,-.08],[.08,.08],[-.08,.08]].map(([dx,dz])=>{
      const p=cityLocal('mill',x+dx!,z+dz!);return new Vector3(location.x+p.x,0,location.z+p.z);
    });
    for(let i=0;i<4;i++){
      const a=corners[i]!,b=corners[(i+1)%4]!,topA=a.clone().setY(3.4),topB=b.clone().setY(3.4);
      oldPosts.push(new Triangle(a,b,topB),new Triangle(a,topB,topA));
    }
  }
  let oldPostHits=0;
  const scene = new Scene();
  const library = { has: (id: string) => id === 'city-mule', instantiate: async () => ({ root: mule, animate() {}, dispose() {} }) } as unknown as GltfLibrary;
  const characters = { setHands() {}, handAnchor() {} } as unknown as EntityVisuals;
  const life = new WorldLifeVisuals(scene, library, characters);
  const state = { v: 1 as const, type: 'scene-state' as const, sceneId: 'mill', revision: 0, serverTimeMs: 1000, epochMs: 1000, definition: MARKET_WORLD_LIFE, pots: [], apples: [] };
  life.setState(state, 0); life.animate(0, .016, ['-1_1']); await Promise.resolve(); await Promise.resolve();
  const arm = mule.getObjectByName('pack-drive-arm')!, drop = mule.getObjectByName('pack-drive-drop')!, hub = mule.getObjectByName('pack-drive-hub')!;
  expect(arm).toBeDefined(); expect(drop).toBeDefined(); expect(hub).toBeDefined();
  let checked = 0;
  for (let milliseconds = 0; milliseconds <= 22000; milliseconds += 50) {
    life.animate(milliseconds / 1000, .05, ['-1_1']); scene.updateMatrixWorld(true);
    expect(hub.getWorldPosition(new Vector3()).distanceTo(axle)).toBeLessThan(1e-6);
    expect(arm.localToWorld(new Vector3()).distanceTo(axle)).toBeLessThan(1e-6);
    expect(arm.localToWorld(new Vector3(0, 0, 1)).distanceTo(drop.localToWorld(new Vector3(0, 1, 0)))).toBeLessThan(1e-6);
    expect(drop.localToWorld(new Vector3()).distanceTo(mule.localToWorld(new Vector3(.43, 1.32, .18)))).toBeLessThan(1e-6);
    for (const member of [arm, drop]) {
      const mesh = member.children[0] as Mesh;
      mesh.geometry.computeBoundingBox(); const box = mesh.geometry.boundingBox!.clone();
      // The first 35 cm of the arm are its intentional bearing on the central axle.
      if (member === arm) box.min.z = .35 / arm.scale.z;
      const worldBounds = box.clone().applyMatrix4(mesh.matrixWorld), inverse = new Matrix4().copy(mesh.matrixWorld).invert();
      for (const obstacle of obstacles) {
        if (!worldBounds.intersectsBox(obstacle.bounds)) continue;
        const triangle = obstacle.triangle.clone(); triangle.a.applyMatrix4(inverse); triangle.b.applyMatrix4(inverse); triangle.c.applyMatrix4(inverse);
        expect(box.intersectsTriangle(triangle), `${member.name} hits mill geometry at ${milliseconds} ms`).toBe(false);
      }
      if(member===arm)for(const oldPost of oldPosts){
        const triangle=oldPost.clone();triangle.a.applyMatrix4(inverse);triangle.b.applyMatrix4(inverse);triangle.c.applyMatrix4(inverse);
        if(box.intersectsTriangle(triangle))oldPostHits++;
      }
      checked++;
    }
  }
  expect(checked).toBe(882);
  expect(oldPostHits).toBeGreaterThan(0);
  // Resynchronizing the clock must preserve the same pose rather than restart the drive.
  life.animate(7.3, .016, ['-1_1']); scene.updateMatrixWorld(true);
  const before = arm.matrixWorld.clone();
  life.setState({ ...state, revision: 1, serverTimeMs: 8300 }, 100);
  life.animate(100, .016, ['-1_1']); scene.updateMatrixWorld(true);
  expect(arm.matrixWorld.elements).toEqual(before.elements);
  life.dispose();
  for (const root of [mule, mill]) root.traverse(node => { if (node instanceof Mesh) { node.geometry.dispose(); for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose(); } });
});
