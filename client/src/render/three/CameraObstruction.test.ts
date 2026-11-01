import { CameraRaycast } from './CameraRaycast';
import { expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3, Raycaster } from 'three';
import { CameraObstruction } from './CameraObstruction';

it('protects near-plane corners and retracts immediately, then releases smoothly',()=>{
  const camera=new CameraObstruction();
  const wall=new Mesh(new BoxGeometry(.2,2,.2),new MeshBasicMaterial());
  wall.position.set(.3,1,2);wall.updateMatrixWorld(true);
  const target=new Vector3(0,1,0),direction=new Vector3(0,0,1);
  expect(camera.resolve(target,direction,5,.3,.2,[],1/60)).toBe(5);
  const blocked=camera.resolve(target,direction,5,.3,.2,[wall],1/60);
  expect(blocked).toBeLessThan(2);
  const released=camera.resolve(target,direction,5,.3,.2,[],1/60);
  expect(released).toBeGreaterThan(blocked);expect(released).toBeLessThan(3);
  expect(camera.resolve(new Vector3(10,1,0),direction,5,.3,.2,[],1/60)).toBe(5);
  wall.geometry.dispose();wall.material.dispose();
});

it('prunes distant chunks while preserving hidden surfaces and moving nested obstacles', () => {
  const root = new Group(), geometry = new BoxGeometry(1, 2, 1), material = new MeshBasicMaterial();
  for (let i = 0; i < 25; i++) {
    const chunk = new Group(); chunk.position.set(i * 32, 0, 3);
    const mesh = new Mesh(geometry, material); mesh.visible = false; chunk.add(mesh); root.add(chunk);
  }
  const camera = new CameraRaycast(), ray = new Raycaster(new Vector3(0, 0, 0), new Vector3(0, 0, 1), .05, 10);
  const spy = vi.spyOn(Mesh.prototype, 'raycast');
  try {
    for (const x of [0, 2, 0]) {
      root.children[0]!.position.x = x; root.updateMatrixWorld(true);
      const expected = ray.intersectObject(root, true).map(hit => hit.distance);
      spy.mockClear(); camera.prepare(root);
      const hits: import('three').Intersection[] = []; camera.intersect(root, ray, hits);
      expect(hits.map(hit => hit.distance).sort((a,b) => a-b)).toEqual(expected);
      expect(spy.mock.calls.length).toBe(x === 0 ? 1 : 0);
    }
  } finally { spy.mockRestore(); geometry.dispose(); material.dispose(); }
});
