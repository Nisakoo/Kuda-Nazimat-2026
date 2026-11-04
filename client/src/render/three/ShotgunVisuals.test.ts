import { expect, it, vi } from 'vitest';
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { ShotgunVisuals } from './ShotgunVisuals';
import type { EntityVisuals } from './EntityVisuals';
import { ShotgunSimulation } from '../../../../shared/shotgun/Simulation.ts';
import { WorldBudget } from '../../map/WorldBudget';
it('presents first person, reload and bounded surface-attached marks, deduplicates snapshots and releases resources',()=>{
  const scene=new Scene(),camera=new PerspectiveCamera(),hand=new Group();scene.add(hand);
  const characters={handAnchor:()=>hand} as unknown as EntityVisuals;
  const visual=new ShotgunVisuals(scene,camera,characters);
  const wall=new Mesh(new BoxGeometry(20,10,.2),new MeshBasicMaterial());wall.position.set(0,0,-5);wall.scale.set(3,2,2);
  const chunk=new Group();chunk.name='chunk:test';chunk.add(wall);scene.add(chunk);
  const simulation=new ShotgunSimulation('s','m',[]);simulation.addPlayer('p');
  const state=()=>visual.setState(simulation.snapshot(),'p');state();visual.animate(.016,true);
  const gun=scene.getObjectByName('first-person-shotgun')!;expect(gun.visible).toBe(true);
  simulation.act('p',{x:0,y:0,z:0},'fire',0,0);state();scene.updateMatrixWorld();visual.flushShots();
  const marks=()=>wall.children.filter(child=>child.name==='pellet-mark');expect(marks()).toHaveLength(8);
  expect(marks().every(mark=>mark.position.z>.1)).toBe(true);
  expect(marks()[0]!.getWorldScale(new Vector3()).toArray()).toEqual([1,1,1]);
  state();visual.flushShots();expect(marks()).toHaveLength(8);
  simulation.act('p',{x:0,y:0,z:0},'reload',0,0);for(let i=0;i<10;i++)simulation.step(.1);state();visual.animate(.016,true);
  expect(gun.rotation.z).toBeLessThan(0);expect(gun.getObjectByName('shell')?.visible).toBe(true);
  expect(visual.aim(new Vector3(0,1.45,0)).yaw).toBeCloseTo(0);
  for(let shot=0;shot<30;shot++) {for(let i=0;i<25;i++)simulation.step(.1);simulation.act('p',{x:0,y:0,z:0},'fire',0,0);simulation.act('p',{x:0,y:0,z:0},'reload',0,0);state();scene.updateMatrixWorld();visual.flushShots();}
  expect(marks().length).toBeLessThanOrEqual(96);
  visual.animate(31,false);expect(marks()).toHaveLength(0);expect(gun.visible).toBe(false);
  const gunMesh=gun.children.find(child=>child instanceof Mesh) as Mesh;
  const dispose=vi.spyOn(gunMesh.geometry,'dispose');visual.dispose();expect(dispose).toHaveBeenCalledOnce();expect(hand.children).toHaveLength(0);expect(scene.getObjectByName('first-person-shotgun')).toBeUndefined();
  wall.geometry.dispose();(wall.material as MeshBasicMaterial).dispose();
});

it('keeps batched hit matrices equivalent to original raycast marks and falls back when the budget is unavailable', () => {
  const fixtures = [false, true].map(batched => {
    const scene = new Scene(), camera = new PerspectiveCamera(), hand = new Group(); scene.add(hand);
    const budget = new WorldBudget();
    const visual = new ShotgunVisuals(scene, camera, { handAnchor: () => hand } as unknown as EntityVisuals, budget, batched);
    const chunk = new Group(); chunk.name = 'chunk:test'; scene.add(chunk);
    const wall = new Mesh(new BoxGeometry(20, 10, .2), new MeshBasicMaterial()); wall.position.z = -5; wall.scale.set(3, 2, 2); chunk.add(wall);
    return { scene, visual, wall, chunk, budget };
  });
  const simulation = new ShotgunSimulation('s', 'm', []); simulation.addPlayer('p');
  for (const fixture of fixtures) fixture.visual.setState(simulation.snapshot(), 'p');
  simulation.act('p', { x: 0, y: 0, z: 0 }, 'fire', 0, 0);
  for (const fixture of fixtures) { fixture.visual.setState(simulation.snapshot(), 'p'); fixture.scene.updateMatrixWorld(true); fixture.visual.flushShots(); fixture.visual.setState(simulation.snapshot(), 'p'); fixture.visual.flushShots(); }
  const original = fixtures[0]!, candidate = fixtures[1]!;
  expect(original.visual.markCount).toBe(8); expect(candidate.visual.markCount).toBe(8);
  const marks = original.wall.children.filter(child => child.name === 'pellet-mark');
  const batch = candidate.wall.children.find(child => child.name === 'pellet-batch') as InstancedMesh;
  expect(batch.count).toBe(8);
  for (let i = 0; i < 8; i++) {
    const local = new Matrix4(); batch.getMatrixAt(i, local);
    local.elements.forEach((value, index) => expect(value).toBeCloseTo(marks[i]!.matrix.elements[index]!, 5));
  }
  candidate.chunk.position.x = original.chunk.position.x = 7;
  candidate.scene.updateMatrixWorld(true); original.scene.updateMatrixWorld(true);
  const matrix = new Matrix4(); batch.getMatrixAt(0, matrix);
  expect(new Vector3().applyMatrix4(matrix).applyMatrix4(batch.matrixWorld).distanceTo(marks[0]!.getWorldPosition(new Vector3()))).toBeLessThan(1e-5);
  candidate.chunk.removeFromParent(); candidate.visual.pruneDetachedMarks(); expect(candidate.visual.markCount).toBe(0);
  for (const fixture of fixtures) { fixture.visual.dispose(); expect(fixture.budget.stats.resources).toBe(0); fixture.wall.geometry.dispose(); (fixture.wall.material as MeshBasicMaterial).dispose(); }

  const scene = new Scene(), camera = new PerspectiveCamera(), hand = new Group(), budget = new WorldBudget(1);
  const fallback = new ShotgunVisuals(scene, camera, { handAnchor: () => hand } as unknown as EntityVisuals, budget, true);
  expect(budget.stats.memory).toBe(0); fallback.dispose();
});
