import { expect, it, vi } from 'vitest';
import { World } from '../src/game/World.ts';
import { loadWorld } from '../src/world/loader.ts';
import { makeWorld, npc, SPAWN } from './a-helpers.ts';

/** A simulation bug is emulated by poisoning one step of the shared kinematics (OBS-005 / S4). */
const poison = vi.hoisted(() => ({ playerAt: null as { x: number; z: number } | null }));
vi.mock('../../shared/movement/simulation.ts', async (original) => {
  const real = await original<typeof import('../../shared/movement/simulation.ts')>();
  return {
    ...real,
    stepMotion: (...args: Parameters<typeof real.stepMotion>) => {
      const next = real.stepMotion(...args);
      const at = args[0].position;
      return poison.playerAt && at.x === poison.playerAt.x && at.z === poison.playerAt.z ? { ...next, position: { ...next.position, x: Number.NaN } } : next;
    },
  };
});

it('S4: a non-finite position is reported and the player returns to safe support without affecting others', async () => {
  const loaded = await loadWorld(await makeWorld([npc('guide', -4, 0)]));
  const reported: { name: string; fields: Record<string, unknown> }[] = [];
  const world = new World(loaded.maps, loaded.npcs, undefined, { invariant: (name, fields) => reported.push({ name, fields }) });
  world.add({ id: 'p', name: 'P', mapId: 'test', position: SPAWN, rotationY: 0 });
  world.add({ id: 'q', name: 'Q', mapId: 'test', position: { x: -2, y: 0, z: 2 }, rotationY: 0 });
  world.setIntent('p', 1, { x: 0, z: 0 }, [...loaded.maps.get('test')!.manifest.chunks.map(chunk => chunk.id)], 1000);
  poison.playerAt = { x: SPAWN.x, z: SPAWN.z };
  world.step(0.05, 1000);
  poison.playerAt = null;
  expect(reported).toEqual([{ name: 'player.position.finite', fields: { playerId: 'p', mapId: 'test' } }]);
  const p = world.locate('p')!.position; expect([p.x, p.y, p.z].every(Number.isFinite)).toBe(true);
  expect(world.aoi('q').every((entity) => Number.isFinite(entity.transform?.position.x ?? 0))).toBe(true);
  expect(world.locate('q')!.position).toMatchObject({ x: -2, z: 2 });
});
