import { expect, it } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three';
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
