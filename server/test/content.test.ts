import { beforeAll, expect, it } from 'vitest';
import { ContentError, MAP_FIGURE_MESSAGE, BABEL_MESSAGE, NpcCatalog } from '../src/content/NpcCatalog.ts';
import { sqliteNpcStore } from '../src/persistence/npcContent.ts';
import { openDatabase } from '../src/persistence/database.ts';
import { loadWorld, type LoadedWorld } from '../src/world/loader.ts';
import { World } from '../src/game/World.ts';
import { GameService } from '../src/game/GameService.ts';
import { memoryLogger, silentLogger } from '../src/common/logger.ts';
import { systemClock, systemScheduler } from '../src/common/time.ts';
import type { Channel } from '../src/game/ports.ts';
import { makeWorld, npc, SPAWN, WALL_MIN_X } from './a-helpers.ts';

let loaded: LoadedWorld;
// Lea is drawn from server data, the merchant is part of the map model, the shepherd is needed by BABEL.
beforeAll(async () => { loaded = await loadWorld(await makeWorld([npc('lea', -4, 0, { assetId: 'lea' }), npc('mark', 4, 0, { assetId: 'mark' }), npc('merchant', -4, 10), npc('shepherd', 4, 10, { assetId: 'shepherd' })])); });
const admin = { id: 'a1', name: 'Вера', ip: '10.0.0.7' };
function catalog(db = openDatabase(':memory:'), options: { mapFiguresFromServer?: boolean } = {}, logger = silentLogger) {
  const c = new NpcCatalog({ store: sqliteNpcStore(db), maps: (id) => loaded.maps.get(id), clock: systemClock, babelRequired: new Set(['shepherd']), mapFiguresFromServer: options.mapFiguresFromServer ?? false, logger });
  c.seed(loaded.npcs);
  return { c, db };
}
const code = (action: () => unknown) => { try { action(); return 'ok'; } catch (error) { return error instanceof ContentError ? `${error.code}: ${error.message}` : String(error); } };

it('S1: seeds once from the file, keeps edits across restarts and never lets the file overwrite them', () => {
  const { c, db } = catalog();
  expect(c.list().map((r) => [r.definition.id, r.definition.figure, r.revision])).toEqual([['lea', 'entity', 1], ['mark', 'entity', 1], ['merchant', 'map', 1], ['shepherd', 'entity', 1]]);
  c.update('lea', 1, { persona: 'Новая персона' }, admin);
  const restarted = new NpcCatalog({ store: sqliteNpcStore(db), maps: (id) => loaded.maps.get(id), clock: systemClock, babelRequired: new Set(), mapFiguresFromServer: false });
  restarted.seed(loaded.npcs);
  expect(restarted.record('lea')).toMatchObject({ revision: 2, updatedBy: 'Вера', definition: { persona: 'Новая персона' } });
  expect(restarted.changes(null, 200).filter((change) => change.action === 'seed')).toHaveLength(4);
});

it('CONTENT-005/011: validates behaviour fields, bumps revision and refuses a stale revision with the current record', () => {
  const { c } = catalog();
  expect(code(() => c.update('lea', 1, { topic: '' }, admin))).toMatch(/^INVALID/);
  expect(code(() => c.update('lea', 1, { interactionRadius: 11 }, admin))).toMatch(/^INVALID: Радиус/);
  expect(code(() => c.update('lea', 1, { name: 'x' } as never, admin))).toMatch(/^INVALID/);
  expect(c.update('lea', 1, { topic: '  Древний Вавилон ', interactionRadius: 3 }, admin)).toMatchObject({ revision: 2, definition: { topic: 'Древний Вавилон', interactionRadius: 3 } });
  try { c.update('lea', 1, { greeting: 'Привет' }, { ...admin, name: 'Борис' }); expect.unreachable(); }
  catch (error) { expect(error).toBeInstanceOf(ContentError); expect((error as ContentError).code).toBe('CONFLICT'); expect((error as ContentError).current?.revision).toBe(2); }
  expect(code(() => c.update('nobody', 1, { topic: 'x' }, admin))).toMatch(/^NOT_FOUND/);
});

it('S3: moves only to a standable point of the same map, away from other NPCs, with the surface height', () => {
  const { c } = catalog();
  expect(code(() => c.move('lea', 1, { x: WALL_MIN_X + 1, z: 0 }, admin))).toBe('INVALID: Точка непроходима или вне карты.');
  expect(code(() => c.move('lea', 1, { x: 900, z: 0 }, admin))).toBe('INVALID: Точка непроходима или вне карты.');
  expect(code(() => c.move('lea', 1, { x: 3.5, z: 0 }, admin))).toBe('INVALID: Слишком близко к другому NPC.');
  expect(code(() => c.move('lea', 1, { x: 'a', z: 0 }, admin))).toMatch(/^INVALID/);
  expect(c.move('lea', 1, { x: SPAWN.x, z: SPAWN.z, rotationY: 1 }, admin)).toMatchObject({ revision: 2, definition: { position: { x: SPAWN.x, y: 0, z: SPAWN.z }, rotationY: 1 } });
});

it('S4/S5: disable, enable and delete; map figures and BABEL NPCs are protected, behaviour edits stay allowed; one flag lifts the map rule', () => {
  const { c } = catalog();
  expect(c.setEnabled('mark', 1, false, admin).state).toBe('disabled');
  expect(c.active().map((n) => n.id)).not.toContain('mark');
  expect(c.setEnabled('mark', 2, true, admin).state).toBe('active');
  expect(c.remove('mark', 3, admin).state).toBe('deleted');
  expect(c.list().map((r) => r.definition.id)).not.toContain('mark'); expect(c.list(true).map((r) => r.definition.id)).toContain('mark');
  expect(code(() => c.update('mark', 4, { topic: 'x' }, admin))).toMatch(/^NOT_FOUND/);
  for (const action of [() => c.move('merchant', 1, { x: SPAWN.x, z: SPAWN.z }, admin), () => c.setEnabled('merchant', 1, false, admin), () => c.remove('merchant', 1, admin)]) expect(code(action)).toBe(`FORBIDDEN: ${MAP_FIGURE_MESSAGE}`);
  expect(c.update('merchant', 1, { persona: 'Ворчливый торговец', interactionRadius: 4 }, admin).revision).toBe(2);
  for (const action of [() => c.setEnabled('shepherd', 1, false, admin), () => c.remove('shepherd', 1, admin)]) expect(code(action)).toBe(`FORBIDDEN: ${BABEL_MESSAGE}`);
  expect(c.move('shepherd', 1, { x: SPAWN.x, z: SPAWN.z }, admin).revision).toBe(2);
  expect(c.restrictions('merchant')).toEqual({ mapFigure: true, babelRequired: false });
  const lifted = catalog(undefined, { mapFiguresFromServer: true }).c;
  expect(lifted.restrictions('merchant').mapFigure).toBe(false); expect(lifted.setEnabled('merchant', 1, false, admin).state).toBe('disabled');
});

it('S7: every change is logged with author, IP and from/to in the database, and only field names in the server log', () => {
  const logger = memoryLogger(); const { c } = catalog(undefined, {}, logger);
  c.update('lea', 1, { persona: 'Секретная новая персона', topic: 'Другая тема' }, admin);
  c.move('lea', 2, { x: SPAWN.x, z: SPAWN.z }, admin);
  const [move, update] = c.changes('lea', 10);
  expect(update).toMatchObject({ action: 'update', actorId: 'a1', actorName: 'Вера', ip: '10.0.0.7', revision: 2, changes: { persona: { to: 'Секретная новая персона' }, topic: { to: 'Другая тема' } } });
  expect(move).toMatchObject({ action: 'move', revision: 3, changes: { position: { to: { x: SPAWN.x, z: SPAWN.z } } } });
  expect(logger.records.find((r) => r.event === 'content.npc.changed' && r.action === 'update')).toMatchObject({ npcId: 'lea', fields: ['persona', 'topic'], actorName: 'Вера', ip: '10.0.0.7' });
  expect(JSON.stringify(logger.records)).not.toContain('Секретная новая персона');
  code(() => c.remove('shepherd', 1, admin));
  expect(logger.records.some((r) => r.event === 'content.npc.rejected' && r.npcId === 'shepherd')).toBe(true);
});

it('S2/S4: the running world uses the catalogue live — new topic in the AOI, new persona for the next question, disabled NPC gone', () => {
  const { c } = catalog();
  const world = new World(loaded.maps, c);
  const game = new GameService(world, { load: () => null, save() {} }, systemClock, systemScheduler, { maxPlayers: 4, disconnectGraceMs: 100, broadcastEvery: 2 }, silentLogger);
  const channel: Channel = { id: 'c', sessionKey: 'k', send() {}, close() {} };
  game.attach({ playerId: 'p', accountId: 'a', displayName: 'P' }, channel); game.join(channel, 'test');
  c.move('lea', 1, { x: SPAWN.x - 1.5, z: SPAWN.z }, admin);
  c.update('lea', 2, { persona: 'Сменённая персона', topic: 'Новая тема' }, admin);
  const interaction = game.interact(channel, 'lea');
  expect(interaction.ok && interaction.npc.persona).toBe('Сменённая персона');
  expect(world.aoi('p').find((e) => e.id === 'lea')?.interactable?.label).toBe('Новая тема');
  c.setEnabled('lea', 3, false, admin);
  expect(world.aoi('p').some((e) => e.id === 'lea')).toBe(false);
  expect(game.interact(channel, 'lea')).toEqual({ ok: false, reason: 'not-found' });
});
