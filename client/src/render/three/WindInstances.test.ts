import { expect, it, vi } from 'vitest';
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { CameraRaycast } from './CameraRaycast';
import { WindInstances } from './WindInstances';

it('preserves animated world transforms, camera hits, shadows and shared resource ownership', () => {
  const root = new Group(); root.position.set(10, 2, -3); root.rotation.y = .4;
  const geometry = new BoxGeometry(), material = new MeshStandardMaterial();
  const sources = [0, 1, 2].map(index => {
    const pivot = new Group(); pivot.position.set(index * 2, 0, 0); root.add(pivot);
    const mesh = new Mesh(geometry, material); mesh.name = `wind-leaf-${index}-surface`;
    mesh.castShadow = mesh.receiveShadow = true; pivot.add(mesh); return mesh;
  });
  root.updateWorldMatrix(true, true);
  const ray = new Raycaster(sources[1]!.getWorldPosition(new Vector3()).add(new Vector3(0, 0, 5)), new Vector3(0, 0, -1));
  const camera = new CameraRaycast(); const before: import('three').Intersection[] = []; camera.intersect(root, ray, before);
  const batches = new WindInstances(root);
  const mesh = root.children.find(node => node instanceof InstancedMesh) as InstancedMesh;
  expect(mesh.count).toBe(3); expect(mesh.geometry).toBe(geometry); expect(mesh.material).toBe(material);
  expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
  const after: import('three').Intersection[] = []; camera.intersect(root, ray, after);
  expect(after.map(hit => hit.distance)).toEqual(before.map(hit => hit.distance));
  for (const time of [0, .2, .7]) {
    sources.forEach((source, index) => { source.parent!.rotation.z = time + index * .1; });
    batches.update(); root.updateWorldMatrix(true, true);
    sources.forEach((source, index) => {
      const matrix = new Matrix4(); mesh.getMatrixAt(index, matrix); matrix.premultiply(mesh.matrixWorld);
      matrix.elements.forEach((value, component) => expect(value).toBeCloseTo(source.matrixWorld.elements[component]!, 5));
      expect(mesh.boundingSphere!.containsPoint(source.position.clone().applyMatrix4(new Matrix4().copy(root.matrixWorld).invert().multiply(source.matrixWorld)))).toBe(true);
    });
  }
  const dispose = vi.spyOn(mesh, 'dispose'), disposeGeometry = vi.spyOn(geometry, 'dispose'), disposeMaterial = vi.spyOn(material, 'dispose');
  batches.dispose(); batches.dispose();
  expect(dispose).toHaveBeenCalledOnce(); expect(disposeGeometry).not.toHaveBeenCalled(); expect(disposeMaterial).not.toHaveBeenCalled();
  expect(sources.every(source => source.visible)).toBe(true); expect(root.children).toHaveLength(3);
  geometry.dispose(); material.dispose();
});

it('leaves unique, hidden and transparent surfaces on their original render path', () => {
  const root = new Group(), geometry = new BoxGeometry(), material = new MeshStandardMaterial({ transparent: true });
  for (let i = 0; i < 2; i++) { const mesh = new Mesh(geometry, material); mesh.name = `wind-cloth-${i}`; root.add(mesh); }
  const hidden = new Mesh(geometry, material); hidden.name = 'wind-leaf-hidden'; hidden.visible = false; root.add(hidden);
  const batches = new WindInstances(root); expect(root.children).toHaveLength(3);
  batches.dispose(); expect(hidden.visible).toBe(false); geometry.dispose(); material.dispose();
});
