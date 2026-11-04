import { expect, it } from 'vitest';
import { DoubleSide, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from 'three';
import { CameraObstruction } from './CameraObstruction';
import { CameraRaycast } from './CameraRaycast';
import { ShotgunVisuals } from './ShotgunVisuals';
import type { EntityVisuals } from './EntityVisuals';
import { ShotgunSimulation } from '../../../../shared/shotgun/Simulation.ts';

it('shares camera ranges with pellets without stale hits after owner motion and vertex updates', () => {
  const geometry = new PlaneGeometry(20, 10, 40, 20);
  const fixtures = [false, true].map(shared => {
    const scene = new Scene(), camera = new PerspectiveCamera(), hand = new Group(), chunk = new Group();
    scene.add(hand, chunk); chunk.name = 'chunk:wall'; chunk.scale.set(1.2, .9, 1.1);
    const wall = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide })); wall.position.z = -5; chunk.add(wall);
    const raycast = new CameraRaycast(), obstruction = new CameraObstruction(raycast);
    const visual = new ShotgunVisuals(scene, camera, { handAnchor: () => hand } as unknown as EntityVisuals, undefined, false, shared ? raycast : undefined);
    return { scene, chunk, wall, obstruction, visual };
  });
  const simulation = new ShotgunSimulation('shared', 'market', []); simulation.addPlayer('p');
  const sync = () => { for (const f of fixtures) f.visual.setState(simulation.snapshot(), 'p'); };
  sync();
  for (let shot = 0; shot < 2; shot++) {
    if (shot) {
      const position = geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) position.setZ(i, .08 * Math.sin(position.getX(i)));
      position.needsUpdate = true;
      for (const f of fixtures) { f.chunk.position.x = .4; f.chunk.rotation.y = .15; }
      for (let i = 0; i < 10; i++) simulation.step(.1);
    }
    for (const f of fixtures) {
      f.scene.updateMatrixWorld(true);
      f.obstruction.resolve(new Vector3(0, 1.45, 0), new Vector3(0, 0, -1), 10, .1, .1, [f.chunk], .016);
    }
    simulation.act('p', { x: 0, y: 0, z: 0 }, 'fire', 0, 0); sync();
    for (const f of fixtures) { f.scene.updateMatrixWorld(true); f.visual.flushShots(); }
    const marks = fixtures.map(f => f.wall.children.filter(n => n.name === 'pellet-mark'));
    expect(marks[0]).toHaveLength((shot + 1) * 8); expect(marks[1]).toHaveLength(marks[0]!.length);
    marks[0]!.forEach((mark, index) => mark.matrix.elements.forEach((value, element) => expect(marks[1]![index]!.matrix.elements[element]!).toBeCloseTo(value, 6)));
  }
  for (const f of fixtures) { f.visual.dispose(); (f.wall.material as MeshBasicMaterial).dispose(); }
  geometry.dispose();
});
