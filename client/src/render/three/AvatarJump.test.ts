import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { Scene, Sprite, Vector3 } from 'three';
import type { WorldSnapshot } from '../../core/types';
import type { MotionStatus } from '../../../../shared/world/types';
import { AssetManager } from '../../map/AssetManager';
import { GltfLibrary } from './GltfLibrary';
import { EntityVisuals } from './EntityVisuals';
import { SceneAssets } from './SceneAssets';

for (const id of ['lukas', 'nic', 'dan', 'ksu', 'fallback']) {
  it.each([30, 60])(`${id} raises both arms in air and lowers them after landing at %i FPS`, async fps => {
    const bytes = id === 'fallback' ? new ArrayBuffer(0) : await readFile(new URL(`../../../public/assets/models/avatars/${id}.glb`, import.meta.url)).then(file => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
    const resources = new AssetManager({ resolve: path => path, load: async () => bytes });
    const library = new GltfLibrary(resources);
    if (id !== 'fallback') library.register({ model: 'avatar.glb' });
    const assets = new SceneAssets(); vi.spyOn(assets, 'label').mockImplementation(() => new Sprite());
    const scene = new Scene(), visuals = new EntityVisuals(scene, assets, library);
    let tick = 0;
    const snapshot = (phase: MotionStatus['phase'], moving = false): WorldSnapshot => ({ tick: ++tick, entities: [{
      id: 'player', renderable: { assetId: 'model' }, character: { kind: 'player', name: id }, equipment: { tool: 'jug' },
      transform: { position: { x: moving ? tick / fps : 0, y: phase === 'grounded' ? 0 : .4, z: 0 }, rotationY: 0 },
      animationState: { name: moving ? 'walk' : 'idle' },
      motion: { grounded: phase === 'grounded', phase, verticalVelocity: phase === 'rising' ? 4 : -2, locomotion: moving ? 'walk' : 'idle', stamina: 100, sprintBlocked: false, jumpAck: 1 },
    }] });
    let state = snapshot('grounded');
    try {
      visuals.sync(state, state, 'player');
      if (id !== 'fallback') {
        for (let i = 0; i < 100 && !library.stats.queued; i++) await new Promise(resolve => setTimeout(resolve, 1));
        library.flush();
        for (let i = 0; i < 100 && !scene.getObjectByName('avatar'); i++) await new Promise(resolve => setTimeout(resolve, 1));
        expect(scene.getObjectByName('avatar')).toBeDefined();
      }
      const arms = ['left', 'right'].map(side => scene.getObjectByName(`shoulder-${side}`)!);
      const held = scene.getObjectByName('held:jug')!, joint = held.parent!;
      const heldOffset = held.position.toArray();
      const advance = (phase: MotionStatus['phase'], moving = false) => {
        const next = snapshot(phase, moving); visuals.sync(state, next, 'player'); visuals.animate(1, tick / fps, 1 / fps); state = next;
      };
      for (let i = 0; i < fps / 5; i++) advance('grounded');
      for (const arm of arms) expect(Math.abs(arm.rotation.x)).toBeLessThan(.2);
      for (const phase of ['rising', 'falling'] as const) {
        for (let i = 0; i < fps / 5; i++) advance(phase, true);
        for (const arm of arms) {
          expect(arm.rotation.x).toBeLessThan(-2.5);
          if (id !== 'fallback') {
            const wrist = arm.getObjectByName(arm.name.replace('shoulder', 'wrist'))!;
            expect(wrist.getWorldPosition(new Vector3()).y - arm.getWorldPosition(new Vector3()).y).toBeGreaterThan(.25);
          }
        }
        expect(visuals.position('player')!.y).toBe(.4);
        expect(held.parent).toBe(joint); expect(held.position.toArray()).toEqual(heldOffset);
      }
      for (let i = 0; i < fps / 3; i++) advance('grounded', true);
      for (const arm of arms) expect(Math.abs(arm.rotation.x)).toBeLessThan(.6);
      for (let i = 0; i < fps / 2; i++) advance('grounded');
      for (const arm of arms) expect(Math.abs(arm.rotation.x)).toBeLessThan(.2);
      expect(visuals.position('player')!.y).toBe(0);
    } finally { visuals.dispose(); assets.dispose(); library.dispose(); resources.dispose(); }
  });
}
