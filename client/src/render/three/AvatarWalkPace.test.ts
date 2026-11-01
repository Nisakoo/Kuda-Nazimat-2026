import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { AnimationMixer, Group, Scene } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AssetManager } from '../../map/AssetManager';
import type { WorldSnapshot } from '../../core/types';
import { avatarWalkPacing, AVATAR_WALK_MAX_PACE } from './AvatarWalkPace';
import { GltfLibrary } from './GltfLibrary';
import type { ModelInstance } from './GltfLibrary';
import { EntityVisuals } from './EntityVisuals';
import { SceneAssets } from './SceneAssets';

function rig() {
  const root = new Group(), avatar = new Group(); root.add(avatar); avatar.name = 'avatar';
  avatar.userData = { avatarId: 'lukas', units: 'metres', forward: '+Z', walkCycleMetres: .48 };
  avatar.scale.set(1, 1, .944);
  return { root, avatar };
}
async function loaded(path: URL) {
  const file = await readFile(path), bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const assets = new AssetManager({ resolve: value => value, load: async () => bytes });
  const library = new GltfLibrary(assets); library.register({ model: 'local.glb' });
  const pending = library.instantiate('model', new AbortController().signal);
  for (let attempt = 0; attempt < 100 && library.stats.queued === 0; attempt++) await new Promise(resolve => setTimeout(resolve, 1));
  library.flush();
  return { model: await pending, library, assets, bytes };
}

describe('avatar-only metadata walk pacing', () => {
  it('converts observed m/s using actual clip duration and current world +Z scale', () => {
    const { root, avatar } = rig(), timing = avatarWalkPacing(root, .9)!;
    expect(timing.pace(3)).toBeCloseTo(3 * .9 / (.48 * .944), 8);
    root.rotation.y = Math.PI / 2; root.scale.z = .8;
    expect(timing.pace(3)).toBeCloseTo(3 * .9 / (.48 * .944 * .8), 8);
    avatar.scale.z = 1.25;
    expect(timing.pace(5)).toBeCloseTo(5 * .9 / (.48 * 1.25 * .8), 8);
  });

  it('bounds correction pace and safely handles stops, invalid speeds and collapsed scale', () => {
    const { root, avatar } = rig(), timing = avatarWalkPacing(root, .9)!;
    for (const speed of [0, -1, NaN, Infinity]) expect(timing.pace(speed)).toBe(0);
    expect(timing.pace(100)).toBe(AVATAR_WALK_MAX_PACE);
    avatar.scale.z = 0; expect(timing.pace(3)).toBe(0);
    avatar.scale.z = NaN; expect(timing.pace(3)).toBe(0);
  });

  it('does not opt legacy, unknown or malformed metadata into the new behavior', () => {
    expect(avatarWalkPacing(new Group(), .9)).toBeUndefined();
    for (const patch of [{ avatarId: 'other' }, { units: 'cm' }, { forward: '-Z' }, { walkCycleMetres: NaN }, { walkCycleMetres: 0 }, { walkCycleMetres: 100 }]) {
      const { root, avatar } = rig(); Object.assign(avatar.userData, patch);
      expect(avatarWalkPacing(root, .9)).toBeUndefined();
    }
    for (const duration of [undefined, NaN, 0, 100]) expect(avatarWalkPacing(rig().root, duration)).toBeUndefined();
  });

  it.each(['lukas', 'nic', 'dan', 'ksu'])('uses %s GLB scale and advances beyond the legacy 2× cap', async id => {
    const { model, library, assets, bytes } = await loaded(new URL(`../../../public/assets/models/avatars/${id}.glb`, import.meta.url));
    try {
      const pace = model.walkPace!(3), avatar = model.root.getObjectByName('avatar')!;
      expect(pace).toBeCloseTo(3 * .9 / (1.2 * avatar.scale.z), 6);
      expect(pace).toBeGreaterThan(2.3); expect(pace).toBeLessThan(2.5);
      const reference = await new GLTFLoader().parseAsync(bytes, '');
      const mixer = new AnimationMixer(reference.scene), clip = reference.animations.find(c => c.name === 'walk')!;
      mixer.clipAction(clip).setEffectiveTimeScale(pace).play(); mixer.update(1 / 60);
      model.animate('walk', 1 / 60, pace);
      expect(model.root.getObjectByName('knee-left')!.quaternion.clone().normalize().angleTo(reference.scene.getObjectByName('knee-left')!.quaternion.clone().normalize())).toBeLessThan(.000001);
      mixer.stopAllAction(); mixer.uncacheRoot(reference.scene);
    } finally { model.dispose(); library.dispose(); assets.dispose(); }
  });

  it('keeps the legacy tablet walk bounded at 2×', async () => {
    const { model, library, assets, bytes } = await loaded(new URL('../../../e2e/fixtures/tablet-plain.glb', import.meta.url));
    try {
      expect(model.walkPace).toBeUndefined();
      const reference = await new GLTFLoader().parseAsync(bytes, ''), mixer = new AnimationMixer(reference.scene);
      mixer.clipAction(reference.animations.find(c => c.name === 'walk')!).setEffectiveTimeScale(2).play(); mixer.update(.05);
      model.animate('walk', .05, 100);
      expect(model.root.getObjectByName('Tablet')!.quaternion.clone().normalize().angleTo(reference.scene.getObjectByName('Tablet')!.quaternion.clone().normalize())).toBeLessThan(.000001);
      mixer.stopAllAction(); mixer.uncacheRoot(reference.scene);
    } finally { model.dispose(); library.dispose(); assets.dispose(); }
  });

  it('passes immediate observed speed to avatar pacing without changing root movement', async () => {
    const sceneAssets = new SceneAssets(), assets = new AssetManager({ resolve: value => value, load: async () => { throw new Error('Unexpected load'); } });
    const library = new GltfLibrary(assets); library.register({ 'avatar-lukas': 'local.glb' });
    const model: ModelInstance = { root: new Group(), walkPace: vi.fn(() => 2.4), animate: vi.fn(), dispose: vi.fn() };
    vi.spyOn(library, 'instantiate').mockResolvedValue(model);
    const visuals = new EntityVisuals(new Scene(), sceneAssets, library);
    const snapshot = (tick: number, z: number): WorldSnapshot => ({ tick, entities: [{ id: 'player', renderable: { assetId: 'avatar-lukas' }, movement: { direction: { x: 0, z: 1 }, speed: 3 },
      animationState: { name: 'idle' }, transform: { position: { x: 0, y: 0, z }, rotationY: 0 } }] });
    try {
      const initial = snapshot(0, 0); visuals.sync(initial, initial, 'player'); await Promise.resolve(); visuals.animate(1, 0, 1 / 60);
      const next = snapshot(1, .05); visuals.sync(initial, next, 'player'); visuals.animate(1, 1 / 60, 1 / 60);
      expect(model.walkPace).toHaveBeenLastCalledWith(3);
      expect(model.animate).toHaveBeenLastCalledWith('walk', 1 / 60, 2.4);
      expect(visuals.position('player')!.z).toBe(.05);
    } finally { visuals.dispose(); library.dispose(); assets.dispose(); sceneAssets.dispose(); }
  });
});
