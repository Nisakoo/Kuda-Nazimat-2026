import { describe, expect, it } from 'vitest';
import { initialMotion, stepMotion } from '../../shared/movement/simulation.ts';
import type { MotionState, MovementEnvironment, MovementIntent } from '../../shared/movement/simulation.ts';
import { isPathWalkable, isWalkable } from '../../shared/map/walkability.ts';
import { surfaceHeight, parseManifest } from '../../shared/map/manifest.ts';
import type { CeilingVolume, HeightSurface, WorldManifest } from '../../shared/map/manifest.ts';
import { GameMap } from '../src/world/GameMap.ts';
import { World } from '../src/game/World.ts';
import { parseClientMessage, parseServerMessage } from '../../shared/protocol/validate.ts';

const manifest: WorldManifest = { mapId: 'test', version: 1, worldBytes: 100000, chunkSize: 16, collisionResolution: 128, origin: { x: -8, z: -8 },
  spawn: { x: 0, y: 0, z: 0 }, chunks: [{ id: 'c', x: 0, z: 0, region: 'test', url: 'c.json', bytes: 1, collisionUrl: 'c.bin', collisionBytes: 16384, assets: [] }], models: {}, assets: {} };
const bootstrap = { manifestUrl: 'm.json', manifestBytes: 100, worldBytes: 100000, assets: {} };
const zero: MovementIntent = { direction: { x: 0, z: 0 }, sprint: false, jumpId: 0 };
function fixture(block: (x: number, z: number) => boolean = () => false, ceilings: readonly CeilingVolume[] = [], surfaces: readonly HeightSurface[] = []) {
  const data = new Uint8Array(128 * 128);
  for (let z = 0; z < 128; z++) for (let x = 0; x < 128; x++) if (block(-8 + x / 8, -8 + z / 8)) data[z * 128 + x] = 1;
  const lookup = ({ x, z }: { x: number; z: number }) => x === 0 && z === 0 ? data : undefined;
  const env: MovementEnvironment = { canTraverse: (a, b) => isPathWalkable(manifest, lookup, a, b), canRecover: (a, b) => isPathWalkable(manifest, lookup, a, b),
    canOccupy: p => isWalkable(manifest, lookup, p.x, p.z), heightAt: (x, z) => surfaceHeight(surfaces, x, z), ceilings, spawn: manifest.spawn };
  return { env, data, map: new GameMap({ ...manifest, ceilingVolumes: ceilings, heightSurfaces: surfaces }, bootstrap, new Map([['c', data]])) };
}
function run(state: MotionState, intent: MovementIntent, seconds: number, env: MovementEnvironment, hz = 20): MotionState {
  for (let i = 0; i < Math.round(seconds * hz); i++) state = stepMotion(state, intent, 1 / hz, env);
  return state;
}

describe('MOVE contact and full footprint', () => {
  it.each(['x', 'z'] as const)('slides along both sides of a %s wall with bounded displacement', axis => {
    const tangent = axis === 'x' ? 'z' : 'x';
    for (const side of [-1, 1]) {
      const { env } = fixture((x, z) => Math.abs(axis === 'x' ? x : z) < .125);
      const position = { x: 0, y: 0, z: 0, [axis]: side * .5 };
      let state = initialMotion(position);
      const intent = { ...zero, direction: { [axis]: -side * Math.SQRT1_2, [tangent]: Math.SQRT1_2 } as { x: number; z: number } };
      state = run(state, intent, 1, env);
      expect(state.position[tangent]).toBeCloseTo(3 * Math.SQRT1_2, 6);
      expect(Math.hypot(state.position.x - position.x, state.position.z - position.z)).toBeLessThanOrEqual(3 + 1e-8);
      expect(env.canOccupy(state.position)).toBe(true);
      const beforeEscape = Math.abs(state.position[axis]);
      state = stepMotion(state, { ...zero, direction: { [axis]: side, [tangent]: 0 } as { x: number; z: number } }, .05, env);
      expect(Math.abs(state.position[axis])).toBeGreaterThan(beforeEscape);
    }
  });
  it('checks the interior of the footprint and the entire swept path, including a missing chunk', () => {
    const { env } = fixture((x, z) => x === 1 && z === 0);
    expect(env.canOccupy({ x: 1.0625, y: 0, z: .0625 })).toBe(false);
    const start = { x: 0, y: 0, z: 0 }, end = { x: 3, y: 0, z: 0 };
    expect(env.canOccupy(end)).toBe(true);
    expect(env.canTraverse(start, end)).toBe(false);
    const state = stepMotion(initialMotion(start), { ...zero, direction: { x: 1, z: 0 }, sprint: true }, 1, env);
    expect(state.position.x).toBeLessThan(.751);
    expect(env.canTraverse({ x: 7, y: 0, z: 0 }, { x: 9, y: 0, z: 0 })).toBe(false);
  });
  it('leaves an inner corner, rounds an outer corner and traverses a passage wider than the footprint', () => {
    const inner = fixture((x, z) => x >= 1 || z >= 1).env;
    let state = run(initialMotion(manifest.spawn), { ...zero, direction: { x: Math.SQRT1_2, z: Math.SQRT1_2 } }, 1, inner);
    expect(state.position.x).toBeLessThan(.75); expect(state.position.z).toBeLessThan(.75);
    const corner = state.position;
    state = stepMotion(state, { ...zero, direction: { x: -1, z: 0 } }, .05, inner);
    expect(state.position.x).toBeLessThan(corner.x); expect(state.position.z).toBe(corner.z);
    const outer = fixture((x, z) => x >= 1 && x < 2 && z >= 1 && z < 2).env;
    state = run(initialMotion({ x: .5, y: 0, z: 1.5 }), { ...zero, direction: { x: Math.SQRT1_2, z: Math.SQRT1_2 } }, 1, outer);
    expect(state.position.x).toBeGreaterThan(1); expect(state.position.z).toBeGreaterThan(3);
    const passage = fixture(x => x < -.375 || x >= .375).env;
    state = run(initialMotion(manifest.spawn), { ...zero, sprint: true, direction: { x: 0, z: 1 } }, 1, passage);
    expect(state.position.z).toBeCloseTo(5, 6); expect(passage.canOccupy(state.position)).toBe(true);
  });
  it('recovers overlap on the last safe side, with a bounded fallback and diagnostic', () => {
    const { env } = fixture((x) => x >= 1 && x < 2);
    let state = { ...initialMotion(manifest.spawn), position: { x: .85, y: 0, z: 0 } };
    state = stepMotion(state, zero, .05, env);
    expect(state.recoveryReason).toBe('nearby'); expect(state.position.x).toBeLessThan(.75);
    state = stepMotion({ ...state, position: { x: 1.5, y: 0, z: 0 } }, zero, .05, env);
    expect(state.recoveryReason).toBe('safe-position'); expect(state.position.x).toBeLessThan(.75);
  });
});

describe('MOVE jump, ceilings and support', () => {
  it.each([20, 30, 60, 120])('has the specified height/duration at %i Hz and consumes airborne requests', hz => {
    const { env } = fixture(); let state = initialMotion(manifest.spawn); let apex = 0; let landed = 0;
    for (let i = 0; i < hz * 2; i++) {
      state = stepMotion(state, { ...zero, jumpId: i < hz / 4 ? 1 : 2 }, 1 / hz, env);
      apex = Math.max(apex, state.position.y);
      if (i > 0 && state.grounded && !landed) landed = (i + 1) / hz;
    }
    expect(apex).toBeCloseTo(1.215, 1); expect(landed).toBeGreaterThanOrEqual(.85); expect(landed).toBeLessThanOrEqual(.95);
    expect(state.jumpAck).toBe(2); expect(state.position.y).toBe(0);
    expect(stepMotion(state, { ...zero, jumpId: 3 }, 1 / hz, env).phase).toBe('rising');
  });
  it('hits a measured ceiling and falls without passing through it', () => {
    const ceiling = { minX: -2, maxX: 2, minZ: -2, maxZ: 2, bottomY: 2.2, topY: 2.5 };
    const { env } = fixture(() => false, [ceiling]); let state = initialMotion(manifest.spawn); let apex = 0; let falling = false;
    for (let i = 0; i < 40; i++) { state = stepMotion(state, { ...zero, jumpId: 1 }, .05, env); apex = Math.max(apex, state.position.y); falling ||= state.phase === 'falling'; }
    expect(apex).toBeLessThanOrEqual(.4 + 1e-8); expect(falling).toBe(true); expect(state.grounded).toBe(true);
    expect(parseManifest({ ...manifest, ceilingVolumes: [ceiling] }, bootstrap).ceilingVolumes).toEqual([ceiling]);
    for (const volumes of [null, [ { ...ceiling, topY: 2 } ], Array(129).fill(ceiling), [{ ...ceiling, bottomY: NaN }]]) expect(() => parseManifest({ ...manifest, ceilingVolumes: volumes }, bootstrap)).toThrow();
  });
  it('does not tunnel down through a thin roof or turn its top into a new floor', () => {
    const { env } = fixture(() => false, [{ minX: 1, maxX: 3, minZ: -1, maxZ: 1, bottomY: 2, topY: 2.001 }]);
    const state = { ...initialMotion(manifest.spawn), position: { x: 2, y: 2.1, z: 0 }, grounded: false, phase: 'falling' as const, verticalVelocity: -10 };
    const recovered = stepMotion(state, zero, .05, env);
    expect(recovered.position).toEqual(manifest.spawn); expect(recovered.recoveryReason).toBe('forbidden-roof'); expect(recovered.grounded).toBe(true);
  });
  it('jumps from a ramp and returns to its support; blocks the side of a high platform and falls off an open edge', () => {
    const ramp = { minX: -2, maxX: 2, minZ: -5, maxZ: 5, startY: 3, endY: 0 };
    const { env } = fixture(() => false, [], [ramp]);
    const start = { x: 0, y: 1.5, z: 0 };
    const landed = run(initialMotion(start), { ...zero, jumpId: 1 }, 1.5, env);
    expect(landed.position.y).toBe(1.5);
    const blocked = run(initialMotion({ x: -3, y: 0, z: 0 }), { ...zero, direction: { x: 1, z: 0 } }, .5, env);
    expect(blocked.position.x).toBeLessThan(-2);
    const falling = run(initialMotion(start), { ...zero, direction: { x: 1, z: 0 } }, 1, env);
    expect(falling.phase).toBe('falling'); expect(falling.position.y).toBeLessThan(1.5);
    expect(run(falling, zero, 1, env).position.y).toBe(0);
  });
});

describe('MOVE stamina and authority', () => {
  it('splits exhaustion time, restores after a second, and requires release before a new sprint', () => {
    // An unbounded flat fixture is useful for the 20 m sprint.
    const { env: base } = fixture(); const env = { ...base, canOccupy: () => true, canTraverse: () => true, canRecover: () => true };
    const input = { ...zero, sprint: true, direction: { x: 1, z: 0 } };
    const exhausted = run(initialMotion(manifest.spawn), input, 4, env);
    expect(exhausted.position.x).toBeCloseTo(20, 6); expect(exhausted.stamina).toBe(0); expect(exhausted.sprintBlocked).toBe(true);
    let held = run(exhausted, input, 6, env);
    expect(held.stamina).toBeCloseTo(100); expect(held.sprintBlocked).toBe(true); expect(held.position.x).toBeCloseTo(38);
    held = stepMotion(held, zero, .05, env); expect(held.sprintBlocked).toBe(false);
    expect(stepMotion(held, input, .05, env).locomotion).toBe('sprint');
    const split = stepMotion({ ...initialMotion(manifest.spawn), stamina: .5 }, input, .1, env);
    expect(split.position.x).toBeCloseTo(.02 * 5 + .08 * 3, 6); expect(split.stamina).toBe(0);
  });
  it('does not drain in a wall or missing chunk, drains while sliding, and allows a zero-stamina jump', () => {
    const { env } = fixture((x) => x >= 1);
    const start = initialMotion({ x: .74, y: 0, z: 0 });
    const blocked = run(start, { ...zero, sprint: true, direction: { x: 1, z: 0 } }, 1, env);
    expect(blocked.stamina).toBe(100);
    const slide = run(start, { ...zero, sprint: true, direction: { x: Math.SQRT1_2, z: Math.SQRT1_2 } }, 1, env);
    expect(slide.stamina).toBeCloseTo(75, 6);
    expect(stepMotion({ ...start, stamina: 0 }, { ...zero, jumpId: 1 }, .05, env).phase).toBe('rising');
  });
  it('server uses identical kinetics; timeout/reconnect stop horizontal intent while falling and preserve stamina', () => {
    const { map, env } = fixture(); const world = new World(new Map([['test', map]]), []);
    world.add({ id: 'p', name: 'P', mapId: 'test', position: manifest.spawn, rotationY: 0 });
    let local = initialMotion(manifest.spawn);
    for (let i = 1; i <= 6; i++) {
      const intent = { ...zero, direction: { x: 1, z: 0 }, sprint: true, jumpId: 1 };
      world.setIntent('p', i, intent.direction, ['c'], i * 50, true, 1); world.step(.05, i * 50);
      local = stepMotion(local, intent, .05, env);
      const player = world.aoi('p')[0]!;
      expect(player.transform!.position).toEqual(local.position); expect(player.motion!.stamina).toBeCloseTo(local.stamina, 6);
      expect(() => parseServerMessage({ v: 3, type: 'snapshot', revision: i, snapshot: { tick: i, entities: world.aoi('p') } })).not.toThrow();
    }
    const stock = world.aoi('p')[0]!.motion!.stamina; world.resetInput('p');
    for (let i = 0; i < 20; i++) world.step(.05, 1000 + i * 50);
    expect(world.aoi('p')[0]!.motion!.grounded).toBe(true);
    expect(world.aoi('p')[0]!.motion!.stamina).toBeLessThan(100); expect(world.aoi('p')[0]!.motion!.stamina).toBeGreaterThanOrEqual(stock);
    expect(world.locate('p')!.position.x).toBeCloseTo(local.position.x, 6);
    world.add({ id: 'p', name: 'P', mapId: 'test', position: { x: 0, y: 50, z: 0 }, rotationY: 0 });
    expect(world.locate('p')!.position.y).toBe(0);
  });
  it('strict v3 rejects old versions, forged state, nonfinite IDs and missing sprint', () => {
    const input = { v: 3, type: 'input', requestId: 'r', sequence: 1, direction: { x: 0, z: 0 }, preparedChunks: ['c'], sprint: true, jumpId: 1 };
    expect(parseClientMessage(input)).toEqual(input);
    for (const extra of [{ v: 1 }, { v: 2 }, { stamina: 100 }, { speed: 50 }, { jumpId: Infinity }, { jumpId: -1 }, { sprint: undefined }]) expect(() => parseClientMessage({ ...input, ...extra })).toThrow();
  });
});

it('holds the initial spawn against movement and jump until its collision window is prepared', () => {
  const { map } = fixture(); const world = new World(new Map([['test', map]]), []);
  world.add({ id: 'p', name: 'P', mapId: 'test', position: { x: 0, y: 50, z: 0 }, rotationY: 0 });
  for (let i = 1; i <= 40; i++) {
    world.setIntent('p', i, { x: 1, z: 0 }, i % 2 ? [] : ['unknown'], i * 50, true, i);
    world.step(.05, i * 50);
    expect(world.locate('p')!.position).toEqual(manifest.spawn);
  }
  world.setIntent('p', 41, { x: 0, z: 0 }, ['c'], 2050, false, 0); world.step(.05, 2050);
  expect(world.locate('p')!.position).toEqual(manifest.spawn);
  world.setIntent('p', 42, { x: 1, z: 0 }, ['c'], 2100); world.step(.05, 2100);
  expect(world.locate('p')!.position.x).toBeGreaterThan(0);
});
