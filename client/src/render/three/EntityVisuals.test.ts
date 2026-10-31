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
    const body = a.getObjectByProperty('isMesh', true) as Mesh;
    expect(body.geometry).toBe((b.getObjectByProperty('isMesh', true) as Mesh).geometry);
    const disposed = vi.spyOn(body.geometry, 'dispose');
    visuals.animate(1, 0, 1/60);
    visuals.sync(initial, snapshot(entity('a', .4), entity('b')), 'a');
    visuals.animate(0.5, 1);
    expect(scene.getObjectByName('entity:a')).toBe(a);
    expect(a.getObjectByProperty('isMesh', true)).toBe(body);
    expect(a.position.x).toBe(.2);
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

it('animates observed movement with idle network states, stops at a wall, and resets a teleport',()=>{
  const assets=new SceneAssets();vi.spyOn(assets,'label').mockImplementation(()=>new Sprite());
  const scene=new Scene();const visuals=new EntityVisuals(scene,assets);
  const moving=(x:number):Entity=>({...entity('a',x),animationState:{name:'idle'}});
  let state=snapshot(moving(0));visuals.sync(state,state,'a');visuals.animate(1,0,1/60);
  const hip=scene.getObjectByName('hip-left')!;const original=hip.rotation.x;
  for(let i=1;i<=30;i++){
    const next=snapshot(moving(i*.05));visuals.sync(state,next,'a');visuals.animate(1,i/60,1/60);state=next;
  }
  expect(Math.abs(hip.rotation.x-original)).toBeGreaterThan(.1);
  visuals.sync(state,state,'a');
  for(let i=0;i<30;i++)visuals.animate(1,1+i/60,1/60);
  expect(hip.rotation.x).toBeCloseTo(original,3);
  const teleport=snapshot(moving(20));visuals.sync(state,teleport,'a');visuals.animate(.2,2,1/60);
  expect(visuals.position('a')!.x).toBe(20);
  visuals.animate(.4,2+1/60,1/60);
  expect(visuals.position('a')!.x).toBe(20);
  expect(hip.rotation.x).toBeCloseTo(original,3);
  visuals.dispose();assets.dispose();
});
