import { describe, expect, it, vi } from 'vitest';
import { Mesh, Scene, Sprite } from 'three';
import type { Entity, WorldSnapshot } from '../../core/types';
import { EntityVisuals } from './EntityVisuals';
import { SceneAssets } from './SceneAssets';
import { ResourcePool } from './ResourcePool';

const entity = (id: string, x = 0): Entity => ({ id, renderable: { assetId: 'demo-player' }, transform: { position: { x, y: 0, z: 0 }, rotationY: 0 } });
const snapshot = (...entities: Entity[]): WorldSnapshot => ({ tick: 0, entities });

describe('visual identity and resource ownership', () => {
  it('keeps meshes across movement, interpolates positions and releases shared resources after the last entity', () => {
    const assets = new SceneAssets();
    vi.spyOn(assets, 'label').mockImplementation(() => new Sprite());
    const scene = new Scene();
    const visuals = new EntityVisuals(scene, assets);
    const initial = snapshot(entity('a'), entity('b'));
    visuals.sync(initial, initial, 'a');
    const a = scene.getObjectByName('entity:a')!;
    const b = scene.getObjectByName('entity:b')!;
    const body = a.children[0] as Mesh;
    expect(body.geometry).toBe((b.children[0] as Mesh).geometry);
    const disposed = vi.spyOn(body.geometry, 'dispose');
    visuals.sync(initial, snapshot(entity('a', 4), entity('b')), 'a');
    visuals.animate(0.5, 1);
    expect(scene.getObjectByName('entity:a')).toBe(a);
    expect(a.children[0]).toBe(body);
    expect(a.position.x).toBe(2);
    visuals.sync(initial, snapshot(entity('b')), 'a');
    expect(scene.getObjectByName('entity:a')).toBeUndefined();
    expect(disposed).not.toHaveBeenCalled();
    expect(scene.getObjectByName('entity:b')).toBe(b);
    visuals.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    assets.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it('shares resources across owners and disposes only after the final release', () => {
    const pool = new ResourcePool<{ dispose(): void }>();
    const resource = { dispose: vi.fn() };
    expect(pool.acquire('same', () => resource)).toBe(pool.acquire('same', () => { throw new Error('duplicate'); }));
    pool.release('same');
    expect(resource.dispose).not.toHaveBeenCalled();
    pool.release('same');
    pool.dispose();
    expect(resource.dispose).toHaveBeenCalledTimes(1);
  });
});
