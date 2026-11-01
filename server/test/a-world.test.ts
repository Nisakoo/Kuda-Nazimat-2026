import { beforeAll, describe, expect, it } from 'vitest';
import { AoiStream } from '../src/game/AoiStream.ts';
import { World } from '../src/game/World.ts';
import { GameService } from '../src/game/GameService.ts';
import { systemClock, systemScheduler } from '../src/common/time.ts';
import { silentLogger } from '../src/common/logger.ts';
import type { SavedPosition } from '../src/contracts.ts';
import type { Channel } from '../src/game/ports.ts';
import { loadWorld } from '../src/world/loader.ts';
import type { LoadedWorld } from '../src/world/loader.ts';
import { makeWorld, npc, SPAWN, WALL_MIN_X } from './a-helpers.ts';

const ALL_CHUNKS: string[] = [];
for (let z = -2; z <= 2; z++) for (let x = -2; x <= 2; x++) ALL_CHUNKS.push(`${x}_${z}`);

let loaded: LoadedWorld;
beforeAll(async () => { loaded = await loadWorld(await makeWorld([npc('guide', -4, 0)])); });

function walk(world: World, direction: { x: number; z: number }, seconds: number, prepared = ALL_CHUNKS): void {
  let now = 1000;
  for (let t = 0; t < seconds * 20; t++) { now += 50; world.setIntent('p', t + 1, direction, prepared, now); world.step(0.05, now); }
}
const fresh = (): World => { const w = new World(loaded.maps, loaded.npcs); w.add({ id: 'p', name: 'P', mapId: 'test', position: SPAWN, rotationY: 0 }); return w; };

it('replaces an existing demo position with a role spawn once and preserves movement on reconnect', () => {
  const world = fresh(); let force = true;
  let saved: SavedPosition = { mapId: 'test', position: SPAWN, rotationY: 0 };
  const position = { x: -2, y: 0, z: 5 };
  const game = new GameService(world, { load: () => saved, save: list => { saved = list[0]!; } }, systemClock, systemScheduler, {
    maxPlayers: 4, disconnectGraceMs: 100, broadcastEvery: 2,
    initialSpawn: () => ({ mapId: 'test', position, force }), didSpawn: () => { force = false; },
  }, silentLogger);
  const identity = { playerId: 'p', accountId: 'a', displayName: 'P' };
  const channel: Channel = { id: 'one', sessionKey: 'key', send() {}, close() {} };
  game.attach(identity, channel); expect(game.join(channel, 'test').ok).toBe(true);
  expect(world.locate('p')?.position).toEqual(position); expect(saved.position).toEqual(position); expect(force).toBe(false);
  walk(world, { x: -1, z: 0 }, 1); const moved = world.locate('p')!.position;
  const next = { ...channel, id: 'two' }; game.attach(identity, next); game.join(next, 'test');
  expect(world.locate('p')?.position).toEqual(moved); expect(moved.x).toBeLessThan(position.x);
});

it('resolves live positions by stable playerId without account or persisted-position lookup', () => {
  const world = fresh();
  const game = new GameService(world, { load() { throw new Error('Must not read persistence'); }, save() {} }, systemClock, systemScheduler, { maxPlayers: 4, disconnectGraceMs: 0, broadcastEvery: 2 }, silentLogger);
  expect(game.playerLocation('p')).toEqual({ mapId: 'test', position: SPAWN });
  expect(game.playerLocation('account-id')).toBeNull();
  const snapshot = game.playerLocation('p')!; Object.assign(snapshot.position, { x: 100 });
  expect(world.locate('p')!.position).toEqual(SPAWN);
  walk(world, { x: -1, z: 0 }, .5);
  expect(game.playerLocation('p')!.position.x).toBeLessThan(SPAWN.x);
  world.remove('p'); expect(game.playerLocation('p')).toBeNull();
});

describe('world loading (SERVER-WORLD-002)', () => {
  it('validates sizes and indexes chunk, collision, model and manifest files', () => {
    expect(loaded.maps.get('test')!.bootstrap.manifestUrl).toBe('maps/test/manifest.json');
    expect(loaded.files.get('maps/test/chunks/0_0.json')?.uses[0]?.kind).toBe('chunk');
    expect(loaded.files.has('assets/models/t.glb')).toBe(true);
  });
});

describe('authoritative movement (REALTIME-003)', () => {
  it('stops at a wall instead of passing through it', () => {
    const world = fresh();
    walk(world, { x: 1, z: 0 }, 4);
    const x = world.locate('p')!.position.x;
    expect(x).toBeGreaterThan(WALL_MIN_X - 1);
    expect(x + 0.25).toBeLessThanOrEqual(WALL_MIN_X);
  });

  it('slides along the wall when moving diagonally into it', () => {
    const world = fresh();
    walk(world, { x: Math.SQRT1_2, z: Math.SQRT1_2 }, 4);
    const p = world.locate('p')!.position;
    expect(p.x + 0.25).toBeLessThanOrEqual(WALL_MIN_X);
    expect(p.z).toBeGreaterThan(SPAWN.z + 5);
  });

  it('does not enter chunks the client has not prepared', () => {
    const world = fresh();
    walk(world, { x: 0, z: 1 }, 6, ['0_0']);
    expect(world.locate('p')!.position.z + 0.25).toBeLessThan(16);
    const still = fresh();
    walk(still, { x: 1, z: 0 }, 1, []);
    expect(still.locate('p')!.position).toEqual(SPAWN);
  });

  it('drops a stale intent after 250 ms (lost "stop" packet)', () => {
    const world = fresh();
    world.setIntent('p', 1, { x: -1, z: 0 }, ALL_CHUNKS, 1000);
    for (let i = 1; i <= 20; i++) world.step(0.05, 1000 + i * 50);
    expect(world.locate('p')!.position.x).toBeCloseTo(-0.15 * 5, 5);
  });

  it('ignores out-of-order input', () => {
    const world = fresh();
    world.setIntent('p', 5, { x: 0, z: 0 }, ALL_CHUNKS, 1000);
    world.setIntent('p', 4, { x: 1, z: 0 }, ALL_CHUNKS, 1001);
    world.step(0.05, 1002);
    expect(world.locate('p')!.position).toEqual(SPAWN);
  });
});

describe('AOI stream (PROTO-008 §3)', () => {
  it('sends whole changed entities, removals, and nothing when idle', () => {
    const stream = new AoiStream();
    const a = { id: 'a', transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0 }, character: { kind: 'player' as const, name: 'A' } };
    stream.reset([a]);
    expect(stream.diff([a])).toBeNull();
    const moved = { ...a, transform: { position: { x: 1, y: 0, z: 0 }, rotationY: 0 } };
    expect(stream.diff([moved, { id: 'b' }])).toEqual({ revision: 1, baseRevision: 0, upsert: [moved, { id: 'b' }], remove: [] });
    expect(stream.diff([moved])).toEqual({ revision: 2, baseRevision: 1, upsert: [], remove: ['b'] });
  });
});
