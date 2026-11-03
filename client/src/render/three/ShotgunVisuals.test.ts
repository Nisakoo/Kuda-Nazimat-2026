import { expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { ShotgunVisuals } from './ShotgunVisuals';
import type { EntityVisuals } from './EntityVisuals';
import { ShotgunSimulation } from '../../../../shared/shotgun/Simulation.ts';
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
