import { afterEach, expect, it, vi } from 'vitest';
import * as responders from '../src/npc/adapters/index.ts';
import { writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { io, type Socket } from 'socket.io-client';
import { startApplication } from '../src/app/application.ts';
import { parseConfig } from '../src/app/config.ts';
import { createGame } from '../src/game/index.ts';
import { silentLogger } from '../src/common/logger.ts';
import { parseServerMessage } from '../../shared/protocol/validate.ts';
import { parseBabylonResult } from '../../shared/babylon/validate.ts';
import type { ServerMessage } from '../../shared/protocol/types.ts';
import { makeWorld, npc } from './a-helpers.ts';
import { testLanguagePort } from '../src/babylon/TestLanguagePort.ts';
import type { LanguagePort } from '../src/babylon/ports.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup(overrides: Record<string, unknown> = {}, language?: LanguagePort, mapId = 'test') {
  const world = await makeWorld([npc('guide', 0, 6, { mapId })], mapId); const root = dirname(world.worldDir);
  await writeFile(join(root, 'index.html'), '<main>UI</main>');
  const config = { ...parseConfig({ ...world, clientDir: root, dbPath: join(root, 'game.sqlite'), defaultMap: mapId, host: '127.0.0.1', staticChunkRadius: 0, saveIntervalMs: 50, disconnectGraceMs: 80, npc: { options: { delayMs: 100 } }, ...overrides }, join(root, 'config.json')), port: 0 };
  const app = await startApplication(config, createGame, silentLogger, language); const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('No address'); const origin = `http://127.0.0.1:${address.port}`;
  cleanups.push(async () => { await app.stop(); await rm(root, { force: true, recursive: true }); });
  const guest = async (name: string) => {
    const response = await fetch(`${origin}/api/auth/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    return await response.json() as { token: string; expiresAt: number };
  };
  async function connect(token: string, endpoint = origin) {
    const socket = io(`${endpoint}/game`, { auth: { version: 3, token }, transports: ['websocket'], reconnection: false, forceNew: true, autoConnect: false });
    cleanups.push(async () => { socket.disconnect(); });
    const packets: ServerMessage[] = []; socket.on('game', (raw) => packets.push(parseServerMessage(raw)));
    const connected = new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); socket.connect(); await connected;
    let count = 0;
    const command = (type: string, fields = {}) => { const requestId = `r${++count}`; socket.emit('game', { v: 3, type, requestId, ...(type === 'input' ? { sprint: false, jumpId: 0 } : {}), ...fields }); return requestId; };
    const wait = async (predicate: (p: ServerMessage) => boolean) => { await expect.poll(() => packets.find(predicate), { timeout: 3000 }).toBeDefined(); return packets.find(predicate)!; };
    return { socket, packets, command, wait };
  }
  return { app, config, origin, guest, connect };
}

async function authPost(origin: string, route: string, value?: unknown, token?: string) {
  return fetch(`${origin}/api/auth/${route}`, {
    method: 'POST', headers: { ...(value === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}
const authPassword = 'a sufficiently long password';

it('password registration restores pending state after restart, gates join, saves avatar and revokes the live session', async () => {
  const { app, config, origin, connect } = await setup();
  expect((await authPost(origin, 'register', { name: 'Protected', password: authPassword, extra: true })).status).toBe(400);
  const response = await authPost(origin, 'register', { name: 'Protected', password: authPassword });
  expect(response.status).toBe(201);
  const session = await response.json() as { token: string; expiresAt: number };
  expect(Object.keys(session).sort()).toEqual(['expiresAt', 'token']);
  expect((await authPost(origin, 'login', { name: 'protected', password: 'wrong password' })).status).toBe(401);
  expect((await authPost(origin, 'register', { name: 'PROTECTED', password: authPassword })).status).toBe(409);
  expect((await authPost(origin, 'guest', { name: 'Protected' })).status).toBe(401);
  const loginResponse = await authPost(origin, 'login', { name: 'protected', password: authPassword }); expect(loginResponse.status).toBe(200);
  const login = await loginResponse.json() as typeof session;
  const headers = { Authorization: `Bearer ${login.token}` };
  expect((await fetch(`${origin}/api/auth/state`)).status).toBe(401);
  expect(await (await fetch(`${origin}/api/auth/state`, { headers })).json()).toEqual({ requiresAvatar: true });
  const pending = await connect(login.token); const denied = pending.command('join', { mapId: 'test' });
  await pending.wait(p => p.type === 'error' && p.requestId === denied && p.code === 'FORBIDDEN');
  expect(pending.packets.some(p => p.type === 'joined')).toBe(false);
  await app.stop();
  const restarted = await startApplication(config, createGame, silentLogger); cleanups.push(() => restarted.stop());
  const address = restarted.server.address(); if (!address || typeof address === 'string') throw new Error('No restarted server');
  const nextOrigin = `http://127.0.0.1:${address.port}`;
  expect(await (await fetch(`${nextOrigin}/api/auth/state`, { headers })).json()).toEqual({ requiresAvatar: true });
  const save = await fetch(`${nextOrigin}/api/avatar`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ avatarId: 'dan' }) });
  expect(save.status).toBe(200);
  expect(await (await fetch(`${nextOrigin}/api/auth/state`, { headers })).json()).toEqual({ requiresAvatar: false });
  const live = await connect(login.token, nextOrigin); live.command('join', { mapId: 'test' });
  const joined = await live.wait(p => p.type === 'joined');
  expect(joined.type === 'joined' && joined.snapshot.entities.find(e => e.id === joined.playerId)?.renderable?.assetId).toBe('avatar-dan');
  expect((await authPost(nextOrigin, 'logout', undefined, login.token)).status).toBe(204);
  await live.wait(p => p.type === 'error' && p.code === 'UNAUTHORIZED');
  await expect.poll(() => live.socket.connected).toBe(false);
  expect((await fetch(`${nextOrigin}/api/auth/state`, { headers })).status).toBe(401);
  await expect(connect(login.token, nextOrigin)).rejects.toMatchObject({ data: { code: 'UNAUTHORIZED' } });
  const resumed = await authPost(nextOrigin, 'login', { name: 'Protected', password: authPassword });
  expect(resumed.status).toBe(200);
  const resumedSession = await resumed.json() as typeof session;
  expect(await (await fetch(`${nextOrigin}/api/auth/state`, { headers: { Authorization: `Bearer ${resumedSession.token}` } })).json()).toEqual({ requiresAvatar: false });
}, 20_000);

it('logout targets the matching session, preserves newer takeover and cancels its pending NPC without commit', async () => {
  const { origin, config, guest, connect } = await setup({ npc: { options: { delayMs: 600 } } });
  const old = await guest('Logout'); const first = await connect(old.token); first.command('join', { mapId: 'test' }); await first.wait(p => p.type === 'joined');
  const current = await guest('Logout'); const live = await connect(current.token); live.command('join', { mapId: 'test' }); await live.wait(p => p.type === 'joined');
  expect((await authPost(origin, 'logout', {}, old.token)).status).toBe(204);
  expect(live.socket.connected).toBe(true);
  const chat = live.command('chat-send', { text: 'Still controlling' }); await live.wait(p => p.type === 'chat' && p.requestId === chat);
  live.command('npc-question', { targetId: 'guide', text: 'Do not commit after logout' });
  await new Promise(resolve => setTimeout(resolve, 50));
  expect((await authPost(origin, 'logout', undefined, current.token)).status).toBe(204);
  await live.wait(p => p.type === 'error' && p.code === 'UNAUTHORIZED');
  await new Promise(resolve => setTimeout(resolve, 650));
  const db = new DatabaseSync(config.dbPath, { readOnly: true });
  try { expect(db.prepare('SELECT COUNT(*) AS n FROM npc_dialogue').get()!.n).toBe(0); } finally { db.close(); }
  expect(live.packets.some(p => p.type === 'npc-answer')).toBe(false);
});

it('logout prevents an in-flight BABEL language action from committing', async () => {
  let started!: () => void, release!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const language: LanguagePort = { ...testLanguagePort, async translate(...args) { started(); await new Promise<void>(resolve => { release = resolve; }); return testLanguagePort.translate(...args); } };
  const { origin, guest, connect } = await setup({}, language, 'market');
  const session = await guest('BABEL logout'), peer = await guest('BABEL peer');
  const post = (action: unknown, requestId: string, token = session.token) => fetch(`${origin}/api/babylon`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ v: 2, requestId, action }) });
  for (const token of [session.token, peer.token]) expect((await post({ type: 'enroll', size: 2, native: 'ru', learning: 'en' }, 'enroll', token)).status).toBe(200);
  const client = await connect(session.token); client.command('join', { mapId: 'market' }); await client.wait(p => p.type === 'joined');
  const pending = post({ type: 'chat', text: 'Must not commit' }, 'chat'); await began;
  expect((await authPost(origin, 'logout', undefined, session.token)).status).toBe(204);
  release(); expect((await pending).status).toBe(503);
  expect((await post({ type: 'state' }, 'state')).status).toBe(401);
  const state = await (await post({ type: 'state' }, 'state', peer.token)).json() as { state: { messages: unknown[] } };
  expect(state.state.messages).toEqual([]);
});

it('full capacity rejects new authentication before creation but preserves existing seat takeover', async () => {
  const { origin, config, guest, connect } = await setup();
  expect((await authPost(origin, 'register', { name: 'Outside', password: authPassword })).status).toBe(201);
  for (let i = 0; i < 4; i++) { const session = await guest(`Seat ${i}`); const client = await connect(session.token); client.command('join', { mapId: 'test' }); await client.wait(p => p.type === 'joined'); }
  for (const [route, value] of [
    ['register', { name: 'Not created', password: authPassword }],
    ['guest', { name: 'No guest created' }],
    ['login', { name: 'Outside', password: authPassword }],
  ] as const) {
    const response = await authPost(origin, route, value); expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'FULL', message: expect.stringContaining('заполнен') } });
  }
  const db = new DatabaseSync(config.dbPath, { readOnly: true });
  try { expect(db.prepare('SELECT COUNT(*) AS n FROM accounts').get()!.n).toBe(5); expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n).toBe(5); } finally { db.close(); }
  const replacement = await guest('Seat 0'); expect(replacement.token).toBeDefined();
  const again = await connect(replacement.token); again.command('join', { mapId: 'test' }); await again.wait(p => p.type === 'joined');
}, 15_000);

it('equipment HTTP is authenticated, bounded, owner-only, persistent and visible to nearby players', async () => {
  const { origin, config, guest, connect } = await setup();
  const a = await guest('Equipment A'), b = await guest('Equipment B');
  const headers = { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' };
  const post = (value: unknown) => fetch(`${origin}/api/equipment`, { method: 'POST', headers, body: JSON.stringify(value) });
  expect((await fetch(`${origin}/api/equipment`)).status).toBe(401);
  expect(await (await fetch(`${origin}/api/equipment`, { headers })).json()).toEqual({ tool: null });
  for (const value of [{ tool: 'apple' }, { tool: 'bag', playerId: 'other' }, { tool: 'x'.repeat(2048) }, {}, []]) expect((await post(value)).status).toBe(400);
  const first = await connect(a.token); first.command('join', { mapId: 'test' }); const joined = await first.wait(p => p.type === 'joined'); if (joined.type !== 'joined') throw new Error();
  const peer = await connect(b.token); peer.command('join', { mapId: 'test' }); await peer.wait(p => p.type === 'joined');
  for (const tool of ['bag', 'jug'] as const) {
    expect(await (await post({ tool })).json()).toEqual({ tool });
    const changed = (p: ServerMessage) => p.type === 'delta' && p.upsert.some(e => e.id === joined.playerId && e.equipment?.tool === tool);
    await first.wait(changed); await peer.wait(changed);
  }
  expect(await (await fetch(`${origin}/api/equipment`, { headers: { Authorization: `Bearer ${b.token}` } })).json()).toEqual({ tool: null });
  const db = new DatabaseSync(config.dbPath, { readOnly: true });
  try { expect(db.prepare('SELECT equipped_tool FROM players WHERE id = ?').get(joined.playerId)!.equipped_tool).toBe('jug'); } finally { db.close(); }
  expect(await (await post({ tool: null })).json()).toEqual({ tool: null });
  await peer.wait(p => p.type === 'delta' && p.upsert.some(e => e.id === joined.playerId && !e.equipment));
});

it('BABEL polling returns only task peer positions outside AOI and omits released actors', async () => {
  const { origin, guest, connect } = await setup({ aoiRadius: 8 }, undefined, 'market');
  const a = await guest('Task A'), b = await guest('Task B'), outsider = await guest('Unrelated');
  let sequence = 0;
  const post = (token: string, action: unknown) => fetch(`${origin}/api/babylon`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ v: 2, requestId: `peer${++sequence}`, action }) });
  for (const session of [a, b]) expect((await post(session.token, { type: 'enroll', size: 2, native: 'ru', learning: 'en' })).status).toBe(200);
  const first = await connect(a.token); first.command('join', { mapId: 'market' }); const one = await first.wait(p => p.type === 'joined'); if (one.type !== 'joined') throw new Error();
  const peer = await connect(b.token); peer.command('join', { mapId: 'market' }); const two = await peer.wait(p => p.type === 'joined'); if (two.type !== 'joined') throw new Error();
  expect(two.snapshot.entities.some(e => e.id === one.playerId)).toBe(false);
  const third = await connect(outsider.token); third.command('join', { mapId: 'market' }); const other = await third.wait(p => p.type === 'joined'); if (other.type !== 'joined') throw new Error();
  const state = parseBabylonResult(await (await post(b.token, { type: 'state' })).json()).state;
  expect(state.partyPositions).toEqual([{ id: one.playerId, name: 'Task A', x: 0, z: -26 }]);
  expect(state.partyPositions.some(p => p.id === other.playerId)).toBe(false);
  expect(parseBabylonResult(await (await post(outsider.token, { type: 'state' })).json()).state.partyPositions).toEqual([]);
  expect((await post(b.token, { type: 'state', playerId: other.playerId })).status).toBe(400);
  first.socket.disconnect(); await new Promise(resolve => setTimeout(resolve, 180));
  expect(parseBabylonResult(await (await post(b.token, { type: 'state' })).json()).state.partyPositions).toEqual([]);
});

it('avatar settings persist and update nearby sockets without arbitrary models', async () => {
  const { origin, guest, connect, config } = await setup();
  const a = await guest('Avatar A'), b = await guest('Avatar B');
  const headers = { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' };
  const get = (token = a.token) => fetch(`${origin}/api/avatar`, { headers: { Authorization: `Bearer ${token}` } });
  const post = (value: unknown) => fetch(`${origin}/api/avatar`, { method: 'POST', headers, body: JSON.stringify(value) });
  expect((await get('')).status).toBe(401);
  expect(await (await get()).json()).toEqual({ avatarId: null });
  for (const value of [{ avatarId: 'evil.glb' }, { avatarId: null }, { avatarId: 'nic', playerId: 'other' }]) expect((await post(value)).status).toBe(400);
  const first = await connect(a.token); first.command('join', { mapId: 'test' });
  const joined = await first.wait(p => p.type === 'joined'); if (joined.type !== 'joined') throw new Error();
  expect(joined.snapshot.entities.find(e => e.id === joined.playerId)?.renderable?.assetId).toBe('demo-player');
  const peer = await connect(b.token); peer.command('join', { mapId: 'test' }); await peer.wait(p => p.type === 'joined');
  const response = await post({ avatarId: 'dan' }); expect(response.status).toBe(200); expect(await response.json()).toEqual({ avatarId: 'dan' });
  const changed = (p: ServerMessage) => p.type === 'delta' && p.upsert.some(e => e.id === joined.playerId && e.renderable?.assetId === 'avatar-dan');
  await first.wait(changed); await peer.wait(changed);
  expect(await (await get(b.token)).json()).toEqual({ avatarId: null });
  const db = new DatabaseSync(config.dbPath, { readOnly: true });
  try { expect(db.prepare('SELECT avatar_id FROM players WHERE id = ?').get(joined.playerId)?.avatar_id).toBe('dan'); } finally { db.close(); }
  first.socket.disconnect(); await new Promise(resolve => setTimeout(resolve, 180));
  const again = await connect(a.token); again.command('join', { mapId: 'test' });
  const restored = await again.wait(p => p.type === 'joined'); if (restored.type !== 'joined') throw new Error();
  expect(restored.snapshot.entities.find(e => e.id === joined.playerId)?.renderable?.assetId).toBe('avatar-dan');
});

it('real HTTP auth, join, private world, periodic/grace save and NPC commit work together', async () => {
  const { config, origin, guest, connect } = await setup(); const session = await guest('Аня');
  const headers = { Authorization: `Bearer ${session.token}` };
  expect((await fetch(`${origin}/world/maps/test/manifest.json`, { headers })).status).toBe(404);
  const client = await connect(session.token); client.command('join', { mapId: 'test' });
  const joined = await client.wait((p) => p.type === 'joined'); if (joined.type !== 'joined') throw new Error();
  expect((await fetch(`${origin}/world/maps/test/manifest.json`, { headers })).status).toBe(200);
  expect((await fetch(`${origin}/world/maps/test/chunks/0_0.json`, { headers })).status).toBe(200);
  expect((await fetch(`${origin}/world/maps/test/chunks/2_2.json`, { headers })).status).toBe(404);
  client.command('input', { sequence: 1, direction: { x: 1, z: 0 }, preparedChunks: ['0_0'] });
  const db = new DatabaseSync(config.dbPath, { readOnly: true }); cleanups.push(async () => { db.close(); });
  await expect.poll(() => Number(db.prepare('SELECT x FROM players WHERE id = ?').get(joined.playerId)!.x)).toBeGreaterThan(0);
  const requestId = client.command('npc-question', { targetId: 'guide', text: 'История' });
  await client.wait((p) => p.type === 'npc-answer' && p.requestId === requestId);
  expect(db.prepare('SELECT count(*) AS n FROM npc_dialogue WHERE player_id = ?').get(joined.playerId)!.n).toBe(1);
  client.socket.disconnect(); await new Promise((resolve) => setTimeout(resolve, 150));
  const savedX = Number(db.prepare('SELECT x FROM players WHERE id = ?').get(joined.playerId)!.x);
  const again = await connect((await guest('аня')).token); again.command('join', { mapId: 'test' });
  const restored = await again.wait((p) => p.type === 'joined'); if (restored.type !== 'joined') throw new Error();
  expect(restored.playerId).toBe(joined.playerId); expect(restored.snapshot.entities.find((e) => e.id === joined.playerId)?.transform?.position.x).toBe(savedX);
});

it('v3 jump/sprint are authoritative over a real socket; takeover and a released seat preserve stamina and SQLite saves support', async () => {
  const { config, guest, connect } = await setup(); const session = await guest('Движение');
  const first = await connect(session.token); first.command('join', { mapId: 'test' });
  const joined = await first.wait(p => p.type === 'joined'); if (joined.type !== 'joined') throw new Error();
  const entity = (p: ServerMessage) => (p.type === 'delta' ? p.upsert : p.type === 'snapshot' || p.type === 'joined' ? p.snapshot.entities : []).find(e => e.id === joined.playerId);
  first.command('input', { sequence: 1, direction: { x: -1, z: 0 }, preparedChunks: ['0_0'], sprint: true, jumpId: 1 });
  const airborne = await first.wait(p => entity(p)?.motion?.phase === 'rising');
  expect(entity(airborne)!.motion).toMatchObject({ jumpAck: 1, locomotion: 'sprint' });
  const stock = entity(airborne)!.motion!.stamina; expect(stock).toBeLessThan(100);
  first.command('input', { sequence: 2, direction: { x: 0, z: 0 }, preparedChunks: ['0_0'], sprint: false, jumpId: 2 });
  await first.wait(p => entity(p)?.motion?.jumpAck === 2);
  const db = new DatabaseSync(config.dbPath, { readOnly: true }); cleanups.push(async () => { db.close(); });
  await expect.poll(() => Number(db.prepare('SELECT y FROM players WHERE id = ?').get(joined.playerId)!.y)).toBe(0);
  const next = await connect(session.token); next.command('join', { mapId: 'test' });
  const takeover = await next.wait(p => p.type === 'joined');
  expect(entity(takeover)!.motion!.stamina).toBeLessThanOrEqual(stock);
  expect(entity(takeover)!.motion!.jumpAck).toBe(0);
  next.socket.disconnect(); await new Promise(resolve => setTimeout(resolve, 180));
  const returned = await connect(session.token); returned.command('join', { mapId: 'test' });
  const restored = await returned.wait(p => p.type === 'joined');
  expect(entity(restored)!.motion).toMatchObject({ grounded: true, phase: 'grounded', jumpAck: 0 });
  expect(entity(restored)!.motion!.stamina).toBeLessThan(100);
});

it('BABEL HTTP requires auth and the controlling seat, rejects forged ownership and cannot commit after takeover', async () => {
  let started!: () => void, release!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const language: LanguagePort = { ...testLanguagePort, async translate(...args) { started(); await new Promise<void>(resolve => { release = resolve; }); return testLanguagePort.translate(...args); } };
  const { origin, guest, connect } = await setup({}, language, 'market');
  const a = await guest('Отправитель'), b = await guest('Получатель');
  let sequence = 0;
  const post = (token: string, action: unknown, requestId = `b${++sequence}`) => fetch(`${origin}/api/babylon`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ v: 2, requestId, action }) });
  expect((await post('', { type: 'state' })).status).toBe(401);
  for (const p of [a, b]) expect((await post(p.token, { type: 'enroll', size: 2, native: 'ru', learning: 'en' })).status).toBe(200);
  expect((await post(a.token, { type: 'carve', drawing: [[[1, 1]]] })).status).toBe(403);
  expect((await post(a.token, { type: 'word-save', word: 'goat', translation: 'коза', note: '', playerId: 'victim' })).status).toBe(400);
  const first = await connect(a.token); first.command('join', { mapId: 'market' }); await first.wait(p => p.type === 'joined');
  const oldChat = first.command('chat-send', { text: 'Обход перевода' }); await first.wait(p => p.type === 'error' && p.requestId === oldChat);
  const pending = post(a.token, { type: 'chat', text: 'Купи финики' }); await began;
  const nextToken = (await guest('Отправитель')).token;
  const next = await connect(nextToken); next.command('join', { mapId: 'market' }); await next.wait(p => p.type === 'joined');
  release(); expect((await pending).status).toBe(503);
  expect((await post(a.token, { type: 'carve', drawing: [[[1, 1]]] })).status).toBe(403);
  expect((await post(nextToken, { type: 'carve', drawing: [[[1, 1]]] }, 'stone')).status).toBe(200);
  expect((await post(nextToken, { type: 'carve', drawing: [[[1, 1]]] }, 'stone')).status).toBe(200);
  const state = await (await post(b.token, { type: 'state' })).json() as { state: { messages: unknown[]; stones: unknown[] } };
  expect(state.state.messages).toEqual([]); expect(state.state.stones).toHaveLength(1);
});
it('session expiry closes the real socket and rejects protected HTTP and old tokens', async () => {
  const { origin, guest, connect } = await setup({ sessionTtlMs: 700 }); const session = await guest('Короткая');
  const client = await connect(session.token); client.command('join', { mapId: 'test' }); await client.wait((p) => p.type === 'joined');
  await client.wait((p) => p.type === 'error' && p.code === 'UNAUTHORIZED'); expect(client.socket.connected).toBe(false);
  expect((await fetch(`${origin}/world/maps/test/manifest.json`, { headers: { Authorization: `Bearer ${session.token}` } })).status).toBe(401);
  const rejected: Socket = io(`${origin}/game`, { auth: { version: 3, token: session.token }, reconnection: false, autoConnect: false });
  try { const failed = new Promise<Error & { data?: { code: string } }>((resolve) => rejected.once('connect_error', resolve)); rejected.connect(); const error = await failed; expect(error.data?.code).toBe('UNAUTHORIZED'); }
  finally { rejected.disconnect(); }
});
it('takeover cancels a running NPC answer before SQLite commit and preserves the player', async () => {
  const { config, guest, connect } = await setup({ npc: { options: { delayMs: 800 } } }); const session = await guest('Аня');
  const first = await connect(session.token); first.command('join', { mapId: 'test' }); const joined = await first.wait((p) => p.type === 'joined');
  first.command('npc-question', { targetId: 'guide', text: 'Не сохранять' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const next = await connect((await guest('АНЯ')).token); next.command('join', { mapId: 'test' }); const again = await next.wait((p) => p.type === 'joined');
  expect(joined.type === 'joined' && again.type === 'joined' && again.playerId).toBe(joined.type === 'joined' && joined.playerId);
  await first.wait((p) => p.type === 'error' && p.code === 'UNAUTHORIZED');
  await new Promise((resolve) => setTimeout(resolve, 850));
  const db = new DatabaseSync(config.dbPath, { readOnly: true }); try { expect(db.prepare('SELECT count(*) AS n FROM npc_dialogue').get()!.n).toBe(0); } finally { db.close(); }
  expect(first.packets.some((p) => p.type === 'npc-answer')).toBe(false); expect(next.packets.some((p) => p.type === 'npc-answer')).toBe(false);
});

it('failed responder startup leaves real movement and chat available with a degraded health status', async () => {
  const factory = vi.spyOn(responders, 'createResponder').mockReturnValue({ async start() { throw new Error('private adapter failure'); }, async stop() {}, async answer() { throw new Error('must not run'); } });
  let server: Awaited<ReturnType<typeof setup>>;
  try { server = await setup(); } finally { factory.mockRestore(); }
  const { origin, config, guest, connect } = server;
  expect(await (await fetch(`${origin}/api/health`)).json()).toEqual({ status: 'ok', protocol: 3, npc: 'unavailable' });
  const client = await connect((await guest('Без модели')).token); client.command('join', { mapId: 'test' }); await client.wait((p) => p.type === 'joined');
  const chatId = client.command('chat-send', { text: 'Чат работает' }); await client.wait((p) => p.type === 'chat' && p.requestId === chatId);
  client.command('input', { sequence: 1, direction: { x: 1, z: 0 }, preparedChunks: ['0_0'] });
  const db = new DatabaseSync(config.dbPath, { readOnly: true });
  try { await expect.poll(() => Number(db.prepare('SELECT x FROM players').get()!.x)).toBeGreaterThan(0); } finally { db.close(); }
  const npcId = client.command('npc-question', { targetId: 'guide', text: 'История' });
  const error = await client.wait((p) => p.type === 'error' && p.requestId === npcId);
  expect(error.type === 'error' && error.code).toBe('UNAVAILABLE'); expect(JSON.stringify(error)).not.toContain('private adapter failure');
});

it('an enrolled BABEL player can still use legacy chat and NPCs on the old maps', async () => {
  const { origin, guest, connect } = await setup(); const session = await guest('Старые карты');
  expect((await fetch(`${origin}/api/babylon`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ v: 2, requestId: 'enroll', action: { type: 'enroll', size: 1, native: 'ru', learning: 'en' } }) })).status).toBe(200);
  const client = await connect(session.token); client.command('join', { mapId: 'test' }); await client.wait(p => p.type === 'joined');
  const chat = client.command('chat-send', { text: 'Прежняя карта' }); await client.wait(p => p.type === 'chat' && p.requestId === chat);
  const question = client.command('npc-question', { targetId: 'guide', text: 'История' }); await client.wait(p => p.type === 'npc-answer' && p.requestId === question);
});
