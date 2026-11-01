import { afterEach, expect, it } from 'vitest';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { io } from 'socket.io-client';
import { startApplication } from '../src/app/application.ts';
import { parseConfig } from '../src/app/config.ts';
import { createGame } from '../src/game/index.ts';
import { silentLogger } from '../src/common/logger.ts';
import { parseServerMessage } from '../../shared/protocol/validate.ts';
import type { ServerMessage } from '../../shared/protocol/types.ts';
import type { WorldLifeDefinition } from '../../shared/world-life/types.ts';
import { loadWorld } from '../src/world/loader.ts';
import { WorldLife } from '../src/game/WorldLife.ts';
import { buildRecords, nextOverride, validatePatch, type NpcContext } from '../src/content/NpcCatalog.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openDatabase, sqliteStores } from '../src/persistence/database.ts';
import { sqliteBabylon } from '../src/persistence/babylon.ts';
import { BabylonService, type BabylonDeps } from '../src/babylon/BabylonService.ts';
import { testLanguagePort } from '../src/babylon/TestLanguagePort.ts';
import type { LanguagePort } from '../src/babylon/ports.ts';
import { createGenerationQueue } from '../src/npc/GenerationQueue.ts';
import { systemClock, systemScheduler } from '../src/common/time.ts';
import { parseBabylonRequest } from '../../shared/babylon/validate.ts';
import { makeWorld, npc } from './a-helpers.ts';

/** ADMIN-SRV: real server, SQLite and Socket.IO; the administrator acts through the loopback HTTP API. */
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const NPCS = [npc('guide', 1, 6), npc('tutor', 3, 6, { assetId: 'history-guide', name: 'Учитель' })];

async function withScene(world: Awaited<ReturnType<typeof makeWorld>>): Promise<void> {
  const fixture = JSON.parse(await readFile(new URL('../../shared/world-life/fixtures.json', import.meta.url), 'utf8')) as { valid: boolean; packet: { type: string; definition?: WorldLifeDefinition } }[];
  const base = fixture.find((f) => f.valid && f.packet.type === 'scene-state')!.packet.definition!;
  const definition = { ...base, templates: base.templates.map((t) => t.id === 'apple' ? { ...t, assetId: 'pickup-apple' } : t) };
  const manifestPath = join(world.worldDir, 'maps/test/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>; manifest.worldLife = definition;
  const before = (await readFile(manifestPath)).byteLength;
  const model = Buffer.alloc(100, 9); await writeFile(join(world.worldDir, 'assets/models/apple.glb'), model);
  (manifest.models as Record<string, string>)['pickup-apple'] = 'apple.glb';
  (manifest.assets as Record<string, { bytes: number; memory: number }>)['assets/models/apple.glb'] = { bytes: model.length, memory: 1000 };
  (manifest.chunks as { id: string; assets: string[] }[]).find((c) => c.id === '0_0')!.assets.push('pickup-apple');
  const resources = Number(manifest.worldBytes) - before + model.length;
  for (let i = 0; i < 10; i++) { const total = resources + Buffer.byteLength(JSON.stringify(manifest)); if (total === manifest.worldBytes) break; manifest.worldBytes = total; }
  await writeFile(manifestPath, JSON.stringify(manifest));
}

async function start(options: { scene?: boolean; delayMs?: number } = {}) {
  const world = await makeWorld(NPCS); const root = dirname(world.worldDir);
  if (options.scene) await withScene(world);
  await writeFile(join(root, 'index.html'), '<main>UI</main>');
  const config = { ...parseConfig({ ...world, clientDir: root, dbPath: join(root, 'game.sqlite'), defaultMap: 'test', host: '127.0.0.1', staticChunkRadius: 0, saveIntervalMs: 50, disconnectGraceMs: 80, npc: { options: { delayMs: options.delayMs ?? 50 } } }, join(root, 'config.json'), 'test'), port: 0 };
  let app = await startApplication(config, createGame, silentLogger);
  cleanups.push(async () => { await app.stop(); await rm(root, { force: true, recursive: true }); });
  const origin = () => { const a = app.server.address(); if (!a || typeof a === 'string') throw new Error('No address'); return `http://127.0.0.1:${a.port}`; };
  const op = async (method: string, path: string, value?: unknown, headers?: Record<string, string>) => {
    const response = await fetch(`${origin()}${path}`, { method, headers: headers ?? { Origin: origin(), 'X-Operator': '1', ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    const text = await response.text();
    return { status: response.status, body: (text && response.headers.get('content-type')?.startsWith('application/json') ? JSON.parse(text) : text) as any };
  };
  const guest = async (name: string) => (await (await fetch(`${origin()}/api/auth/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })).json()) as { token: string };
  async function player(name: string) {
    const { token } = await guest(name);
    const socket = io(`${origin()}/game`, { auth: { version: 3, token }, transports: ['websocket'], reconnection: false, forceNew: true, autoConnect: false });
    cleanups.push(async () => { socket.disconnect(); });
    const packets: ServerMessage[] = []; socket.on('game', (raw) => packets.push(parseServerMessage(raw)));
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
    let count = 0;
    const command = (type: string, fields = {}) => { const requestId = `r${++count}`; socket.emit('game', { v: 3, type, requestId, ...fields }); return requestId; };
    const wait = async (predicate: (p: ServerMessage) => boolean) => { await expect.poll(() => packets.find(predicate), { timeout: 3000 }).toBeDefined(); return packets.find(predicate)!; };
    command('join', { mapId: 'test' }); await wait((p) => p.type === 'joined');
    return { token, socket, packets, command, wait };
  }
  const restart = async (between?: () => void) => { await app.stop(); between?.(); app = await startApplication(config, createGame, silentLogger); };
  return { op, player, restart, config, origin, guest };
}

const entityIn = (p: ServerMessage, id: string) => p.type === 'delta' ? p.upsert.find((e) => e.id === id) : undefined;

it('ADMIN-SRV S1, S2, S7: live edits reach players and the model, persist, reset and are journaled once', async () => {
  const { op, player, restart } = await start();
  expect((await op('GET', '/api/operator/journal?action=npc.seed')).body.total).toBe(2);
  const list = (await op('GET', '/api/operator/npcs')).body;
  expect(list.npcs.map((n: any) => [n.id, n.embedded, n.editable.includes('position')])).toEqual([['guide', true, false], ['tutor', false, true]]);
  expect(list.appearances).toEqual(expect.arrayContaining(['history-guide', 'avatar-dan']));

  const a = await player('Ада');
  const changed = await op('PATCH', '/api/operator/npcs/guide', { topic: 'Фрукты и финики', greeting: 'Свежие финики!' });
  expect(changed.status).toBe(200);
  expect(changed.body.npc).toMatchObject({ topic: 'Фрукты и финики', overridden: ['topic', 'greeting'] });
  expect((await a.wait((p) => entityIn(p, 'guide')?.interactable?.label === 'Фрукты и финики'))).toBeDefined();
  const question = a.command('npc-question', { targetId: 'guide', text: 'Что продаёшь?' });
  const answer = await a.wait((p) => p.type === 'npc-answer' && p.requestId === question);
  expect(answer.type === 'npc-answer' && answer.text.startsWith('Свежие финики!')).toBe(true);

  // S2: the embedded figure cannot move or change appearance; nothing is written.
  for (const patch of [{ position: { x: 2, z: 6 } }, { assetId: 'avatar-dan' }, { mapId: 'test' }]) {
    const refused = await op('PATCH', '/api/operator/npcs/guide', patch);
    expect([refused.status, refused.body.error.code]).toEqual([400, 'INVALID']);
  }
  expect((await op('PATCH', '/api/operator/npcs/tutor', { position: { x: 9999, z: 9999 } })).status).toBe(400);
  expect((await op('PATCH', '/api/operator/npcs/tutor', { name: 'x'.repeat(81) })).status).toBe(400);
  expect((await op('PATCH', '/api/operator/npcs/tutor', { persona: 'две\nстроки' })).status).toBe(400);
  expect((await op('PATCH', '/api/operator/npcs/tutor', { secret: 1 })).status).toBe(400);
  const moved = await op('PATCH', '/api/operator/npcs/tutor', { position: { x: 4, z: 7 }, assetId: 'avatar-dan', rotationY: 1 });
  expect(moved.body.npc).toMatchObject({ position: { x: 4, z: 7 }, assetId: 'avatar-dan' });
  await a.wait((p) => entityIn(p, 'tutor')?.renderable?.assetId === 'avatar-dan');
  expect((await op('GET', '/api/operator/journal?action=npc.update')).body.total).toBe(2);

  await restart();
  const after = (await op('GET', '/api/operator/npcs/guide')).body;
  expect(after.npc.topic).toBe('Фрукты и финики');
  expect(after.history.map((e: any) => e.action)).toEqual(['npc.update', 'npc.seed']);
  expect(after.history[0]).toMatchObject({ actor: 'admin', before: { topic: 'Тема', greeting: 'Привет' }, after: { topic: 'Фрукты и финики', greeting: 'Свежие финики!' } });
  expect((await op('GET', '/api/operator/journal?action=npc.seed')).body.total).toBe(2);
  const reset = await op('POST', '/api/operator/npcs/guide/reset', {});
  expect(reset.body.npc).toMatchObject({ topic: 'Тема', greeting: 'Привет', overridden: [] });
});

it('ADMIN-SRV S3, S4, S9: withdrawn NPC cancels the question, disappears and returns; created NPC is live; access is guarded', async () => {
  const { op, player, origin } = await start({ delayMs: 1500 });
  const a = await player('Бэла');
  await a.wait((p) => (p.type === 'joined' && p.snapshot.entities.some((e) => e.id === 'guide')));
  const question = a.command('npc-question', { targetId: 'guide', text: 'Привет' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect((await op('PATCH', '/api/operator/npcs/guide', { enabled: false })).body.npc).toMatchObject({ enabled: false });
  const failure = await a.wait((p) => p.type === 'error' && p.requestId === question);
  expect(failure).toMatchObject({ code: 'UNAVAILABLE', message: 'Собеседник сейчас недоступен.' });
  expect(a.packets.some((p) => p.type === 'npc-answer')).toBe(false);
  await a.wait((p) => p.type === 'delta' && p.remove.includes('guide'));
  const interact = a.command('interact', { targetId: 'guide' });
  expect(await a.wait((p) => p.type === 'error' && p.requestId === interact)).toMatchObject({ code: 'FORBIDDEN' });
  await op('PATCH', '/api/operator/npcs/guide', { enabled: true });
  await a.wait((p) => entityIn(p, 'guide') !== undefined);

  // Delete and restore, journal actions in order.
  expect((await op('DELETE', '/api/operator/npcs/guide')).body.npc).toMatchObject({ deleted: true, editable: [] });
  expect((await op('PATCH', '/api/operator/npcs/guide', { name: 'Новый' })).status).toBe(409);
  expect((await op('GET', '/api/operator/npcs')).body.npcs.map((n: any) => n.id)).toEqual(['tutor']);
  expect((await op('GET', '/api/operator/npcs?deleted=1')).body.npcs.map((n: any) => n.id)).toEqual(['guide', 'tutor']);
  expect((await op('POST', '/api/operator/npcs/guide/restore', {})).body.npc).toMatchObject({ deleted: false, enabled: true });
  const actions = (await op('GET', '/api/operator/journal?target=npc&id=guide&order=asc')).body.entries.map((e: any) => e.action);
  expect(actions).toEqual(['npc.seed', 'npc.disable', 'npc.enable', 'npc.delete', 'npc.restore']);

  // S4: created NPC with a player appearance.
  const created = await op('POST', '/api/operator/npcs', { id: 'baker', mapId: 'test', name: 'Пекарь', topic: 'Хлеб', persona: 'Добродушный', greeting: 'Тёплый хлеб!', position: { x: -1, z: 6 }, assetId: 'avatar-dan' });
  expect(created.status).toBe(201);
  expect(created.body.npc).toMatchObject({ origin: 'admin', embedded: false, interactionRadius: 2.5, assetId: 'avatar-dan' });
  await a.wait((p) => entityIn(p, 'baker')?.renderable?.assetId === 'avatar-dan');
  expect((await op('POST', '/api/operator/npcs', { ...created.body.npc, id: 'baker', position: { x: -1, z: 6 }, original: undefined })).status).toBe(400);
  expect((await op('POST', '/api/operator/npcs', { id: 'baker', mapId: 'test', name: 'П', topic: 'Т', persona: 'П', greeting: 'П', position: { x: -1, z: 6 }, assetId: 'avatar-dan' })).status).toBe(409);
  expect((await op('POST', '/api/operator/npcs', { id: 'other', mapId: 'test', name: 'П', topic: 'Т', persona: 'П', greeting: 'П', position: { x: -1, z: 6 }, assetId: 'unknown-model' })).status).toBe(400);
  expect((await op('POST', '/api/operator/npcs/baker/reset', {})).status).toBe(409);

  // S9: CSRF guard and loopback-only routes.
  const forged = await op('PATCH', '/api/operator/npcs/guide', { name: 'Взлом' }, { 'Content-Type': 'application/json', Origin: 'http://evil.example' });
  expect(forged.status).toBe(403);
  expect((await op('PATCH', '/api/operator/npcs/guide', { name: 'Взлом' }, { 'Content-Type': 'application/json', Origin: origin() })).status).toBe(403);
  expect((await op('GET', '/api/operator/npcs/guide')).body.npc.name).toBe('NPC guide');
  const lan = (await import('node:os')).networkInterfaces();
  const address = Object.values(lan).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  if (address) {
    // The test server listens on 127.0.0.1 only; a LAN address cannot even connect, which is stricter than 404.
    await expect(fetch(`http://${address}:${new URL(origin()).port}/api/operator/npcs`)).rejects.toThrow();
  }
});

it('ADMIN-SRV S6, S8: scene reset returns held apples; account card, journal and CSV never contain secrets', async () => {
  const { op, guest, restart, config, origin } = await start({ scene: true });
  const { token } = await guest('Мира');
  await guest('Мира');
  expect((await op('GET', '/api/operator/world')).body.maps[0].scene.apples.length).toBeGreaterThan(0);
  // A held apple, as a completed pickup leaves it: written while the server is stopped.
  let apple = ''; let playerId = '';
  await restart(() => {
    const db = new DatabaseSync(config.dbPath);
    playerId = String(db.prepare("SELECT p.id FROM players p JOIN accounts a ON a.id = p.account_id WHERE a.name_key = 'мира'").get()!.id);
    apple = String(db.prepare('SELECT id FROM world_apples ORDER BY id LIMIT 1').get()!.id);
    db.prepare("UPDATE world_apples SET state = 'held', x = NULL, y = NULL, z = NULL, holder_id = ? WHERE id = ?").run(playerId, apple);
    db.close();
  });
  const held = (await op('GET', '/api/operator/world')).body.maps[0].scene;
  expect(held.apples.find((x: any) => x.id === apple)).toMatchObject({ state: 'held', holderId: playerId });
  const reset = await op('POST', '/api/operator/world/test/reset-scene', {});
  expect(reset.status).toBe(200);
  expect(reset.body).toMatchObject({ mapId: 'test', skipped: { pots: [], apples: [] } });
  const after = (await op('GET', '/api/operator/world')).body.maps[0].scene;
  expect(after.apples.find((x: any) => x.id === apple)).toMatchObject({ state: 'world', position: held.apples.find((x: any) => x.id === apple).home });
  expect(after.revision).toBeGreaterThan(held.revision);
  expect((await op('POST', '/api/operator/world/nowhere/reset-scene', {})).status).toBe(404);

  // S8: account actions through the existing AUTH-010 routes are journaled without the temporary password.
  const resetPassword = await op('POST', '/api/operator/actions/reset-password', { name: 'Мира' });
  const temporary = String(resetPassword.body.temporaryPassword);
  expect(temporary.length).toBeGreaterThan(5);
  await op('POST', '/api/operator/actions/revoke', { name: 'Мира' });
  const found = (await op('GET', '/api/operator/accounts?q=мир')).body.accounts;
  expect(found).toEqual([expect.objectContaining({ name: 'Мира', hasPassword: true, mustChangePassword: true, activeSessions: 0, lockedUntil: null, mapId: null })]);
  const card = (await op('GET', `/api/operator/account?name=${encodeURIComponent('мира')}`)).body.account;
  expect(card.history.map((h: any) => h.action)).toEqual(expect.arrayContaining(['account.reset-password', 'account.revoke', 'login']));
  expect(card.history.filter((h: any) => h.action === 'login')).toHaveLength(2);
  expect((await op('GET', '/api/operator/account?name=nobody')).status).toBe(404);
  const journal = await op('GET', '/api/operator/journal?target=account');
  const csv = await op('GET', '/api/operator/journal.csv');
  expect(csv.status).toBe(200);
  expect(csv.body.startsWith('id,время')).toBe(true); // fetch's text() drops the BOM; the bytes keep it for Excel
  const bytes = new Uint8Array(await (await fetch(`${origin()}/api/operator/journal.csv`)).arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(csv.body).toContain('world.reset-scene');
  const filtered = await op('GET', '/api/operator/journal.csv?action=account.revoke');
  expect(filtered.body.trim().split('\r\n')).toHaveLength(2);
  for (const output of [JSON.stringify(journal.body), csv.body, JSON.stringify(card)]) {
    expect(output).not.toContain(temporary); expect(output).not.toContain(token); expect(output).not.toMatch(/scrypt|token_hash/);
  }
});

it('ADMIN-SRV-008: a pot whose home is occupied by a player stays; the rest go home', async () => {
  const world = await makeWorld([]); cleanups.push(() => rm(dirname(world.worldDir), { recursive: true, force: true }));
  await withScene(world);
  const loaded = await loadWorld({ worldDir: world.worldDir, maps: world.maps, contentDir: world.contentDir });
  const life = new WorldLife(loaded.maps, 0, 'scene');
  const view = life.view('test')!;
  const pots = (life as unknown as { pots: Map<string, { id: string; position: { x: number; y: number; z: number } }[]> }).pots.get('test')!;
  expect(pots.length).toBeGreaterThan(1);
  for (const pot of pots) pot.position = { ...pot.position, x: pot.position.x + 0.5 };
  const home = view.pots[0]!.home;
  const plan = life.resetPots('test', [{ id: 'p', name: 'P', mapId: 'test', position: home, rotationY: 0 }])!;
  expect(plan.skipped).toEqual([view.pots[0]!.id]);
  expect(plan.reset).toBe(pots.length - 1);
  expect(life.view('test')!.pots.slice(1).every((p) => p.position.x === p.home.x)).toBe(true);
  expect(life.resetPots('nowhere', [])).toBeNull();
});

it('NpcCatalog: file layer keeps only differences, orphans are reported, created NPCs need a full record', () => {
  const base = [npc('a', 0, 0), npc('b', 1, 1, { assetId: 'm' })] as never[];
  const context: NpcContext = { surface: (mapId, x) => mapId === 'test' && x < 100 ? 0 : null, appearances: new Set(['m']) };
  const { records, orphaned } = buildRecords(base, [
    { npcId: 'a', origin: 'content', fields: { topic: 'Новая' }, enabled: false, deletedAt: null, updatedAt: 1 },
    { npcId: 'gone', origin: 'content', fields: {}, enabled: true, deletedAt: null, updatedAt: 1 },
    { npcId: 'half', origin: 'admin', fields: { name: 'x' }, enabled: true, deletedAt: null, updatedAt: 1 },
  ]);
  expect(orphaned).toEqual(['gone', 'half']);
  const a = records.find((r) => r.id === 'a')!;
  expect([a.npc.topic, a.enabled, a.embedded, a.overridden]).toEqual(['Новая', false, true, ['topic']]);
  // Changing the topic back to the file's value leaves only the on/off state in the layer.
  const back = validatePatch(a, { topic: 'Тема' }, context, new Set(['test']));
  expect(nextOverride(a, back, 2)).toMatchObject({ fields: {}, enabled: false });
  expect(nextOverride(a, { ...back, enabled: true }, 2)).toBeNull();
  const b = records.find((r) => r.id === 'b')!;
  expect(validatePatch(b, { mapId: 'test' }, context, new Set(['test'])).fields.position).toEqual({ x: 1, y: 0, z: 1 });
  expect(() => validatePatch(b, { mapId: 'other' }, context, new Set(['test']))).toThrow('Карта');
});

it('ADMIN-SRV S5: BABEL answers with the live profile and refuses a withdrawn quest NPC; unknown NPCs keep the task content', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'admin-babel-')); const db = openDatabase(join(dir, 'game.sqlite'));
  cleanups.push(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  const person = sqliteStores(db).accounts.findOrCreate('A', 'a', 1);
  const heard: unknown[] = [];
  const language: LanguagePort = { ...testLanguagePort, answer: (npc, ...rest) => { heard.push(npc); return testLanguagePort.answer(npc, ...rest); } };
  const live = new Map<string, ReturnType<NonNullable<BabylonDeps['npc']>>>();
  const queue = createGenerationQueue({ clock: systemClock, scheduler: systemScheduler, logger: silentLogger }, { maxConcurrent: 1, maxUnfinished: 4, timeoutMs: 8000 });
  let ids = 0; let requests = 0;
  const service = new BabylonService({ store: sqliteBabylon(db), language, generate: queue.generate, now: Date.now, monotonicNow: () => performance.now(), id: () => `id${++ids}`,
    location: () => ({ mapId: 'market', position: { x: -4.5, y: 0, z: 0.5 } }), npc: (id) => live.get(id) });
  const call = (action: Record<string, unknown>) => service.handle(person, parseBabylonRequest({ v: 2, requestId: `r${++requests}`, action }), person.playerId, async () => true, { sessionId: 's', isActive: () => true });
  await call({ type: 'enroll', size: 1, native: 'ru', learning: 'en' });
  await call({ type: 'npc', targetId: 'fruit-seller', text: 'Hello' });
  expect(heard.at(-1)).toMatchObject({ id: 'fruit-seller', greeting: expect.stringContaining('Добро пожалова') });
  live.set('fruit-seller', { profile: { id: 'fruit-seller', name: 'Эриба', topic: 'Финики', persona: 'Шумный', greeting: 'Свежие финики!' }, mapId: 'market', x: 50, z: 50 });
  await call({ type: 'npc', targetId: 'fruit-seller', text: 'Hello' });
  expect(heard.at(-1)).toMatchObject({ name: 'Эриба', greeting: 'Свежие финики!', x: -4.5 });
  live.set('fruit-seller', null);
  await expect(call({ type: 'npc', targetId: 'fruit-seller', text: 'Hello' })).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Собеседник сейчас недоступен.' });
  await expect(call({ type: 'buy', targetId: 'fruit-seller', item: 'dates' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  // A created NPC on the market answers through BABEL at its own position; buying needs a task trader.
  live.set('baker', { profile: { id: 'baker', name: 'Пекарь', topic: 'Хлеб', persona: 'Добрый', greeting: 'Хлеб!' }, mapId: 'market', x: -4, z: 0 });
  await call({ type: 'npc', targetId: 'baker', text: 'Hello' });
  expect(heard.at(-1)).toMatchObject({ id: 'baker', greeting: 'Хлеб!' });
  await expect(call({ type: 'buy', targetId: 'baker', item: 'dates' })).rejects.toMatchObject({ code: 'INVALID' });
});
