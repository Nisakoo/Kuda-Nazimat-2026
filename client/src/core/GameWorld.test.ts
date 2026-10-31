import { describe, expect, it } from 'vitest';
import { GameWorld } from './GameWorld';
import type { Entity } from './types';

const player: Entity = {
  id: 'player', transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0 },
  movement: { direction: { x: 0, z: 0 }, speed: 3 },
  character: { kind: 'player', name: 'Player' }, animationState: { name: 'idle' },
};
const npc: Entity = {
  id: 'npc', transform: { position: { x: 2, y: 0, z: 0 }, rotationY: 0 },
  interactable: { radius: 2, label: 'Talk' }, character: { kind: 'npc', name: 'Guide' },
};

describe('headless game world', () => {
  it('clamps a bounded local demo area and never changes replica positions locally', () => {
    const bounds = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
    const world = new GameWorld('local', [player], bounds);
    world.execute('player', { type: 'move', direction: { x: 1, z: 0 } });
    world.step(1);
    expect(world.getSnapshot().entities[0]?.transform?.position.x).toBe(1);
    world.step(1);
    expect(world.getSnapshot().entities[0]?.animationState?.name).toBe('idle');
    const replica = new GameWorld('replica', [], bounds);
    const outside = { ...player, transform: { position: { x: 50, y: 0, z: 0 }, rotationY: 0 } };
    replica.applySnapshot({ tick: 1, entities: [outside] });
    replica.step(1);
    expect(replica.getSnapshot().entities[0]?.transform?.position.x).toBe(50);
  });
  it('moves on the ground plane, normalizes diagonal speed and emits immutable events', () => {
    const world = new GameWorld('local', [player]);
    const before = world.getSnapshot();
    expect(world.execute('player', { type: 'move', direction: { x: 1, z: 1 } })).toEqual({ ok: true });
    world.step(1);
    const moved = world.getSnapshot().entities[0];
    expect(Math.hypot(moved?.transform?.position.x ?? 0, moved?.transform?.position.z ?? 0)).toBeCloseTo(3);
    expect(moved?.transform?.position.y).toBe(0);
    expect(moved?.transform?.rotationY).toBeCloseTo(Math.PI / 4);
    expect(moved?.animationState?.name).toBe('walk');
    expect(before.entities[0]?.transform?.position.x).toBe(0);
    expect(world.drainEvents()).toEqual([expect.objectContaining({ type: 'entity-moved', entityId: 'player' })]);
    expect(world.drainEvents()).toEqual([]);
    world.execute('player', { type: 'move', direction: { x: 0, z: 0 } });
    world.step(1);
    expect(world.getSnapshot().entities[0]?.animationState?.name).toBe('idle');
    expect(world.drainEvents()).toEqual([]);
  });

  it('accepts interactions at the radius boundary and rejects distant or self interactions', () => {
    const world = new GameWorld('local', [player, npc]);
    expect(world.execute('player', { type: 'interact', targetId: 'npc' })).toEqual({ ok: true });
    expect(world.drainEvents()).toEqual([{ type: 'interacted', actorId: 'player', targetId: 'npc' }]);
    world.execute('player', { type: 'move', direction: { x: -1, z: 0 } });
    world.step(1);
    expect(world.execute('player', { type: 'interact', targetId: 'npc' })).toEqual({ ok: false, reason: 'out-of-range' });
    expect(world.execute('player', { type: 'interact', targetId: 'player' })).toEqual({ ok: false, reason: 'invalid-target' });
  });

  it('reports duplicate, removed and incomplete entities without corrupting state', () => {
    const world = new GameWorld('local', [player]);
    expect(() => world.create(player)).toThrow('Duplicate');
    world.create(npc);
    expect(world.execute('npc', { type: 'move', direction: { x: 1, z: 0 } })).toEqual({ ok: false, reason: 'missing-component' });
    expect(world.remove('npc')).toBe(true);
    expect(world.remove('npc')).toBe(false);
    expect(world.execute('npc', { type: 'interact', targetId: 'player' })).toEqual({ ok: false, reason: 'missing-entity' });
    expect(world.execute('player', { type: 'interact', targetId: 'npc' })).toEqual({ ok: false, reason: 'missing-entity' });
    expect(world.getSnapshot().entities).toEqual([player]);
    expect(world.drainEvents()).toContainEqual({ type: 'entity-removed', entityId: 'npc' });
  });

  it('rejects non-finite movement without replacing valid state', () => {
    const world = new GameWorld('local', [player]);
    expect(world.execute('player', { type: 'move', direction: { x: NaN, z: 0 } })).toEqual({ ok: false, reason: 'invalid-direction' });
    expect(world.getSnapshot().entities).toEqual([player]);
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid simulation steps (%s)', (delta) => {
    const world = new GameWorld('local', [player]);
    expect(() => world.step(delta)).toThrow();
    expect(world.getSnapshot().tick).toBe(0);
  });

  it('applies authoritative state to a replica without simulating local commands', () => {
    const world = new GameWorld('replica');
    world.applySnapshot({ tick: 40, entities: [player, npc] });
    expect(world.execute('player', { type: 'move', direction: { x: 1, z: 0 } })).toEqual({ ok: false, reason: 'not-authoritative' });
    world.step(1);
    expect(world.getSnapshot()).toEqual({ tick: 40, entities: [player, npc] });
    const updated = { ...player, transform: { position: { x: 10, y: 0, z: 5 }, rotationY: 1 } };
    world.applySnapshot({ tick: 41, entities: [updated] });
    expect(world.getSnapshot()).toEqual({ tick: 41, entities: [updated] });
    expect(() => world.create(npc)).toThrow('Replica');
    expect(() => world.remove('player')).toThrow('Replica');
    expect(world.drainEvents()).toContainEqual({ type: 'state-replaced', tick: 41 });
  });

  it('rejects a malformed authoritative snapshot atomically', () => {
    const world = new GameWorld('replica', [player]);
    expect(() => world.applySnapshot({ tick: 2, entities: [npc, npc] })).toThrow('Duplicate');
    expect(world.getSnapshot()).toEqual({ tick: 0, entities: [player] });
    expect(() => world.applySnapshot({ tick: -1, entities: [] })).toThrow('tick');
    expect(new GameWorld('local').getSnapshot().tick).toBe(0);
  });
});
