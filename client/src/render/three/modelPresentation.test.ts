import { expect, it } from 'vitest';
import { AnimationClip, AnimationMixer, BoxGeometry, Group, Mesh, MeshBasicMaterial, NumberKeyframeTrack, Vector3 } from 'three';
import { configureShadows, freezeStaticTransforms } from './modelPresentation';

it('freezes local scenery matrices while animation targets, wind and moved parents remain correct', () => {
  const scene = new Group(); scene.matrixAutoUpdate = false;
  const root = new Group(); scene.add(root);
  const wall = new Group(); wall.position.x = 5;
  const actor = new Group(); actor.name = 'actor';
  const limb = new Group(); limb.position.y = 2; actor.add(limb);
  const wind = new Group(); wind.name = 'wind-leaf-1'; root.add(wall, actor, wind);
  const clip = new AnimationClip('idle', 1, [new NumberKeyframeTrack('actor.position[x]', [0, 1], [0, 2])]);
  freezeStaticTransforms(root, [clip]);
  expect(wall.matrixAutoUpdate).toBe(false); expect(actor.matrixAutoUpdate).toBe(true); expect(wind.matrixAutoUpdate).toBe(true);
  const mixer = new AnimationMixer(root); mixer.clipAction(clip).play();
  scene.updateMatrixWorld(); const originalWall = wall.matrixWorld.clone();
  mixer.update(.5); wind.rotation.z = .1; scene.updateMatrixWorld();
  expect(wall.matrixWorld.equals(originalWall)).toBe(true);
  expect(new Vector3().setFromMatrixPosition(limb.matrixWorld).toArray()).toEqual([1, 2, 0]);
  root.position.y = 3; root.updateMatrix(); scene.updateMatrixWorld();
  expect(new Vector3().setFromMatrixPosition(limb.matrixWorld).toArray()).toEqual([1, 5, 0]);
});

it('keeps architectural and character shadows in balanced, all in high and none in low', () => {
  const root = new Group(), geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  const wall = new Mesh(geometry, material); wall.scale.set(3, 3, .3);
  const small = new Mesh(geometry, material); small.scale.setScalar(.1);
  const leaf = new Mesh(geometry, material); leaf.name = 'wind-leaf-0';
  const actor = new Group(); actor.name = 'shepherd-torso'; const hand = new Mesh(geometry, material); hand.scale.setScalar(.1); actor.add(hand);
  root.add(wall, small, leaf, actor);
  configureShadows(root, 'balanced', 'market');
  expect([wall.castShadow, small.castShadow, leaf.castShadow, hand.castShadow]).toEqual([true, false, false, true]);
  configureShadows(root, 'high', 'market'); expect([wall, small, leaf, hand].every(mesh => mesh.castShadow)).toBe(true);
  configureShadows(root, 'low', 'market'); expect([wall, small, leaf, hand].every(mesh => !mesh.castShadow && !mesh.receiveShadow)).toBe(true);
  geometry.dispose(); material.dispose();
});
