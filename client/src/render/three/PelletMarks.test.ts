import { expect, it, vi } from 'vitest';
import { BoxGeometry, CircleGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Scene, Sphere, Vector3 } from 'three';
import { PelletMarks } from './PelletMarks';
import { WorldBudget } from '../../map/WorldBudget';

it('preserves local hit matrices on moving affine owners with conservative bounds and shared resources', () => {
  const scene = new Scene(), parent = new Group(), owner = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  parent.scale.set(2, .4, 3); parent.rotation.z = .7; owner.rotation.y = .8; parent.add(owner); scene.add(parent); scene.updateMatrixWorld(true);
  const geometry = new CircleGeometry(.037, 8), material = new MeshBasicMaterial();
  const geometryDisposed = vi.spyOn(geometry, 'dispose'), materialDisposed = vi.spyOn(material, 'dispose');
  const budget = new WorldBudget(), marks = new PelletMarks(scene, geometry, material, budget);
  const world = new Matrix4().makeTranslation(1, 2, 3);
  const local = owner.matrixWorld.clone().invert().multiply(world);
  marks.add(owner, local);
  const batch = owner.children[0] as InstancedMesh, matrix = new Matrix4(); batch.getMatrixAt(0, matrix);
  matrix.elements.forEach((value, index) => expect(value).toBeCloseTo(local.elements[index]!, 5));
  const hit = new Vector3().applyMatrix4(matrix).applyMatrix4(batch.matrixWorld);
  expect(hit.distanceTo(new Vector3(1, 2, 3))).toBeLessThan(1e-5);
  parent.position.x = 7; owner.rotation.x += .4; scene.updateMatrixWorld(true);
  const bounds = new Sphere().copy(batch.boundingSphere!).applyMatrix4(batch.matrixWorld);
  for (let i = 0; i < geometry.attributes.position!.count; i++) {
    const point = new Vector3().fromBufferAttribute(geometry.attributes.position!, i).applyMatrix4(matrix).applyMatrix4(batch.matrixWorld);
    expect(bounds.containsPoint(point)).toBe(true);
  }
  marks.dispose(); marks.dispose();
  expect(budget.stats.memory).toBe(0); expect(geometryDisposed).not.toHaveBeenCalled(); expect(materialDisposed).not.toHaveBeenCalled();
  geometry.dispose(); material.dispose(); owner.geometry.dispose(); (owner.material as MeshBasicMaterial).dispose();
});

it('caps overflow and matrix capacity across owners, shrinks after expiry and removes unloaded hierarchies', () => {
  const scene = new Scene(), chunk = new Group(), other = new Group(); scene.add(chunk, other);
  const owners = Array.from({ length: 96 }, () => new Group()); chunk.add(...owners);
  const geometry = new CircleGeometry(.037), material = new MeshBasicMaterial(), budget = new WorldBudget();
  const marks = new PelletMarks(scene, geometry, material, budget), matrix = new Matrix4();
  for (let i = 0; i < 96; i++) marks.add(owners[i % 2]!, matrix);
  marks.step(29);
  for (let i = 0; i < 94; i++) marks.add(owners[i + 2]!, matrix);
  expect(marks.count).toBe(96); expect(marks.stats.capacity).toBeLessThan(192);
  marks.step(1.1); expect(marks.count).toBe(94); expect(marks.stats.capacity).toBeLessThan(192);
  marks.add(other, matrix); chunk.removeFromParent(); marks.step(.1);
  expect(marks.count).toBe(1); expect(marks.stats.owners).toBe(1); expect(chunk.children.every(owner => owner.children.length === 0)).toBe(true);
  marks.step(30); expect(marks.count).toBe(0); expect(other.children).toHaveLength(0);
  expect(budget.stats.memory).toBe(PelletMarks.reserveBytes);
  marks.dispose(); expect(budget.stats.resources).toBe(0); geometry.dispose(); material.dispose();
});
