import { describe, expect, it } from 'vitest';
import { EntityManager } from './EntityManager';
import type { Entity } from './types';

const entity: Entity = {
  id: 'player', transform: { position: { x: 1, y: 0, z: 2 }, rotationY: 0 },
  movement: { direction: { x: 0, z: 0 }, speed: 3 },
  renderable: { assetId: 'player' }, character: { kind: 'player', name: 'Player' },
  interactable: { radius: 2, label: 'Talk' }, animationState: { name: 'idle' },
};

describe('entity storage', () => {
  it('keeps serializable components and protects stored state from input/output mutation', () => {
    const input = { ...entity, transform: { position: { x: 1, y: 0, z: 2 }, rotationY: 0 } };
    const manager = new EntityManager([input]);
    input.transform.position.x = 99;
    const stored = manager.get('player');
    expect(stored).toEqual(entity);
    expect(Object.isFrozen(stored?.transform?.position)).toBe(true);
    expect(Object.isFrozen(manager.all())).toBe(true);
    expect(JSON.parse(JSON.stringify(manager.all()))).toEqual([entity]);
  });

  it('rejects duplicate creation atomically and handles already removed IDs', () => {
    const manager = new EntityManager([entity]);
    expect(() => manager.create({ id: 'player' })).toThrow('Duplicate');
    expect(manager.get('player')).toEqual(entity);
    expect(manager.remove('player')).toBe(true);
    expect(manager.remove('player')).toBe(false);
    expect(manager.get('player')).toBeUndefined();
    expect(manager.replace(entity)).toBe(false);
    expect(manager.all()).toEqual([]);
  });

  it('validates a replacement before changing the stored entity', () => {
    const manager = new EntityManager([entity]);
    expect(() => manager.replace({ ...entity, transform: { position: { x: NaN, y: 0, z: 0 }, rotationY: 0 } })).toThrow();
    expect(manager.get('player')).toEqual(entity);
  });

  it.each<Entity>([
    { id: '' },
    { id: 'bad', movement: { speed: -1, direction: { x: 0, z: 0 } } },
    { id: 'bad', movement: { speed: 1, direction: { x: 1, z: 1 } } },
    { id: 'bad', interactable: { radius: Infinity, label: 'bad' } },
  ])('rejects invalid component data: %j', (bad) => {
    expect(() => new EntityManager([bad])).toThrow();
  });
});
