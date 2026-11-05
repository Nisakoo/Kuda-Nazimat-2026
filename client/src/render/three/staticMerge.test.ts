import { readFileSync } from 'node:fs';
import { AnimationMixer, Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import type { Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { describe, expect, it } from 'vitest';
import { configureShadows } from './modelPresentation';
import { mergeStaticMeshes } from './staticMerge';

const load = async (name: string) => {
  const bytes = Uint8Array.from(readFileSync(new URL(`../../../public/assets/models/market/${name}.glb`, import.meta.url))).buffer;
  return new GLTFLoader().parseAsync(bytes, '');
};
const draws = (root: Object3D) => { let count = 0; root.traverseVisible(node => { if ((node as Mesh).isMesh) count++; }); return count; };
const triangles = (root: Object3D) => { let count = 0; root.traverseVisible(node => { const mesh = node as Mesh; if (mesh.isMesh) count += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position!.count) / 3; }); return count; };
const casters = (root: Object3D) => { let count = 0; root.traverseVisible(node => { const mesh = node as Mesh; if (mesh.isMesh && mesh.castShadow) count += (mesh.geometry.index?.count ?? 0) / 3; }); return count; };

describe('static mesh merging of streamed scenery', () => {
  for (const name of ['market', 'pasture', 'main-building']) {
    it(`${name}: fewer draws, identical triangles, bounds, shadow casters, animation targets and camera hits`, async () => {
      const gltf = await load(name);
      for (const quality of ['balanced', 'high'] as const) {
        const before = clone(gltf.scene), after = clone(gltf.scene);
        configureShadows(before, quality, name); configureShadows(after, quality, name);
        const removed = mergeStaticMeshes(after, gltf.animations);
        // Merged parts under animated nodes must still follow the clip.
        for (const root of [before, after]) { const mixer = new AnimationMixer(root); for (const clip of gltf.animations) mixer.clipAction(clip).play(); mixer.update(.37); }
        before.updateMatrixWorld(true); after.updateMatrixWorld(true);
        expect(removed).toBeGreaterThan(0);
        expect(draws(after)).toBe(draws(before) - removed);
        expect(triangles(after)).toBe(triangles(before));
        expect(casters(after)).toBe(casters(before));
        const a = new Box3().setFromObject(before), b = new Box3().setFromObject(after);
        expect(b.min.distanceTo(a.min)).toBeLessThan(1e-4); expect(b.max.distanceTo(a.max)).toBeLessThan(1e-4);
        for (const clip of gltf.animations) for (const track of clip.tracks) expect(after.getObjectByName(track.name.split('.')[0]!)).toBeDefined();
        expect(after.getObjectByName('babel-symbols')?.isObject3D ?? true).toBe(true);
        // Same nearest surface along a fan of camera-height rays.
        const ray = new Raycaster();
        for (let i = 0; i < 24; i++) {
          const angle = i / 24 * Math.PI * 2;
          ray.set(new Vector3(0, 1.4, 0), new Vector3(Math.sin(angle), -.05, Math.cos(angle)).normalize()); ray.far = 40;
          const x = ray.intersectObject(before, true)[0]?.distance ?? -1, y = ray.intersectObject(after, true)[0]?.distance ?? -1;
          expect(y).toBeCloseTo(x, 4);
        }
        if (name === 'market') console.info(`${name}/${quality}: ${draws(before)} → ${draws(after)} draws`);
      }
    });
  }

  it('keeps wind pivots, animated nodes, hidden, mirrored and multi-material meshes separate', () => {
    const root = new Group(), material = new MeshStandardMaterial(), geometry = new BoxGeometry(); geometry.clearGroups();
    const add = (name: string, parent: Object3D = root) => { const mesh = new Mesh(geometry, material); mesh.name = name; parent.add(mesh); return mesh; };
    add('a').position.x = 1; add('b').position.x = 3;
    const wind = new Group(); wind.name = 'wind-leaf-0'; root.add(wind); add('leaf', wind); add('leaf-2', wind);
    add('hidden').visible = false; add('hidden-2').visible = false;
    add('mirror').scale.x = -1; add('mirror-2').scale.z = -1;
    const arm = new Group(); arm.name = 'arm'; root.add(arm); add('hand', arm); add('finger', arm); add('elbow-a', arm).visible = false;
    const animated = { tracks: [{ name: 'arm.position' }] } as never;
    expect(mergeStaticMeshes(root, [animated])).toBe(2);
    // The animated arm keeps its own merged child, in arm-local space.
    expect(arm.children.some(child => child.name.startsWith('static-merge-'))).toBe(true); expect(root.getObjectByName('hand')).toBeUndefined();
    for (const name of ['leaf', 'leaf-2', 'hidden', 'hidden-2', 'mirror', 'mirror-2', 'arm', 'elbow-a']) expect(root.getObjectByName(name)).toBeDefined();
    expect(root.getObjectByName('a')).toBeUndefined();
    const merged = root.children.find(child => child.name.startsWith('static-merge-')) as Mesh;
    expect(merged.material).toBe(material);
    merged.geometry.computeBoundingBox(); expect(merged.geometry.boundingBox!.min.x).toBeCloseTo(.5); expect(merged.geometry.boundingBox!.max.x).toBeCloseTo(3.5);
  });
});
