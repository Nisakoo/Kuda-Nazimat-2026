import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localLlmForTest } from '../src/npc/adapters/localLlm.ts';
import { expect, it, vi } from 'vitest';
import { defer, setup } from './harness.ts';
import * as responders from '../src/npc/adapters/index.ts';
import { DatabaseSync } from 'node:sqlite';
import { io, type Socket } from 'socket.io-client';
import { startApplication } from '../src/app/application.ts';
import { createGame } from '../src/game/index.ts';
import { silentLogger } from '../src/common/logger.ts';
import { parseBabylonResult } from '../../shared/babylon/validate.ts';
import type { ServerMessage } from '../../shared/protocol/types.ts';
import { testLanguagePort } from '../src/babylon/TestLanguagePort.ts';
import type { LanguagePort } from '../src/babylon/ports.ts';
import { startTrusted } from './tls-helpers.ts';

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
  expect((await authPost(origin, 'guest', { name: 'Protected' })).status).toBe(403);
  const loginResponse = await authPost(origin, 'login', { name: 'protected', password: authPassword }); expect(loginResponse.status).toBe(200);
  const login = await loginResponse.json() as typeof session;
  const headers = { Authorization: `Bearer ${login.token}` };
  expect((await fetch(`${origin}/api/auth/state`)).status).toBe(401);
  expect(await (await fetch(`${origin}/api/auth/state`, { headers })).json()).toEqual({ requiresAvatar: true });
  const pending = await connect(login.token); const denied = pending.command('join', { mapId: 'test' });
  await pending.wait(p => p.type === 'error' && p.requestId === denied && p.code === 'FORBIDDEN');
  expect(pending.packets.some(p => p.type === 'joined')).toBe(false);
  await app.stop();
  const restarted = await startTrusted(startApplication, config, createGame, silentLogger); defer(() => restarted.stop());
  const address = restarted.server.address(); if (!address || typeof address === 'string') throw new Error('No restarted server');
  const nextOrigin = `https://127.0.0.1:${address.port}`;
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
  expect(state.partyPositions).toEqual([{ id: one.playerId, name: 'Task A', x: 0, z: -58 }]);
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
  const db = new DatabaseSync(config.dbPath, { readOnly: true }); defer(async () => { db.close(); });
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
  const db = new DatabaseSync(config.dbPath, { readOnly: true }); defer(async () => { db.close(); });
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

it('streams an NPC answer over a real socket only on request, and npc-cancel ends it without an answer (PROTO-007)', async () => {
  const { config, guest, connect } = await setup({ npc: { options: { delayMs: 600 } } });
  const client = await connect((await guest('Поток')).token); client.command('join', { mapId: 'test' }); await client.wait((p) => p.type === 'joined');
  const streamed = client.command('npc-question', { targetId: 'guide', text: 'История', stream: true });
  const answer = await client.wait((p) => p.type === 'npc-answer' && p.requestId === streamed);
  const partials = client.packets.filter((p) => p.type === 'npc-partial' && p.requestId === streamed);
  expect(partials.length).toBeGreaterThan(0);
  const seqs = partials.map((p) => p.type === 'npc-partial' ? p.seq : 0); expect(seqs).toEqual([...seqs].sort((a, b) => a - b)); expect(new Set(seqs).size).toBe(seqs.length);
  for (const p of partials) if (p.type === 'npc-partial' && answer.type === 'npc-answer') expect(answer.text.startsWith(p.text)).toBe(true);
  const answerIndex = client.packets.indexOf(answer);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(client.packets.slice(answerIndex).some((p) => p.type === 'npc-partial')).toBe(false);

  const plain = client.command('npc-question', { targetId: 'guide', text: 'Без потока' });
  await client.wait((p) => p.type === 'npc-answer' && p.requestId === plain);
  expect(client.packets.some((p) => p.type === 'npc-partial' && p.requestId === plain)).toBe(false);

  const cancelled = client.command('npc-question', { targetId: 'guide', text: 'Отменить', stream: true });
  await client.wait((p) => p.type === 'npc-partial' && p.requestId === cancelled);
  const cancel = client.command('npc-cancel', { questionId: cancelled });
  await client.wait((p) => p.type === 'npc-cancelled' && p.requestId === cancel && p.questionId === cancelled);
  const after = client.packets.length; await new Promise((resolve) => setTimeout(resolve, 800));
  expect(client.packets.slice(after).some((p) => 'requestId' in p && p.requestId === cancelled)).toBe(false);
  const db = new DatabaseSync(config.dbPath, { readOnly: true });
  try { expect(db.prepare('SELECT count(*) AS n FROM npc_dialogue').get()!.n).toBe(2); } finally { db.close(); }
  const next = client.command('npc-question', { targetId: 'guide', text: 'Слот свободен' });
  await client.wait((p) => p.type === 'npc-answer' && p.requestId === next);
});

it('a LanguagePort that fails to start makes only BABEL language actions unavailable and is still stopped', async () => {
  let stopped = 0;
  const language: LanguagePort = { ...testLanguagePort, async start() { throw new Error('model missing'); }, async stop() { stopped++; } };
  const { app, origin, guest, connect } = await setup({}, language, 'market');
  const player = await guest('Без переводчика');
  const post = (action: unknown, requestId: string) => fetch(`${origin}/api/babylon`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${player.token}` }, body: JSON.stringify({ v: 2, requestId, action }) });
  expect((await post({ type: 'enroll', size: 1, native: 'ru', learning: 'en' }, 'enroll')).status).toBe(200);
  const client = await connect(player.token); client.command('join', { mapId: 'market' }); await client.wait((p) => p.type === 'joined');
  expect((await post({ type: 'suggest', word: 'коза' }, 'suggest')).status).toBe(503);
  expect((await post({ type: 'word-save', word: 'goat', translation: 'коза', note: '' }, 'word')).status).toBe(200);
  await app.stop(); expect(stopped).toBe(1);
});

it.each(['ollama', 'mlx'] as const)('%s supervisor fixture integrates actual game delivery, private history and SQLite (not a model test)', async (backend) => {
  const dir = await mkdtemp(join(tmpdir(), 'game-llm-worker-'));
  defer(async () => { await rm(dir, { recursive: true, force: true }); });
  const workerPath = join(dir, 'fixture.cjs');
  await writeFile(workerPath, `const readline=require('node:readline');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
 if(m.op==='start')send({type:'ready'});
 else if(m.op==='answer')send({type:'answer',text:'Fixture, не модель. Предыдущих вопросов: '+m.request.history.length});
 else if(m.op==='stop')process.exit(0);
});`);
  const options = backend === 'ollama'
    ? { python: process.execPath, executable: '/fixture/ollama', modelsDir: '/fixture/models', tokenizerDir: '/fixture/tokenizer', tokenizerManifest: '/fixture/tokenizer.json', model: 'qwen3.5:2b-q4_K_M', modelDigest: 'a'.repeat(64), runnerVersion: '0.40.13' }
    : { python: process.execPath, modelDir: '/fixture/mlx', modelManifest: '/fixture/model.json', runnerVersion: '0.32.2' };
  const factory = vi.spyOn(responders, 'createResponder').mockImplementation((name, input, deps) => {
    expect(name).toBe(backend);
    return localLlmForTest(backend, input, deps, { workerPath, workerPrefix: [], platform: 'darwin', arch: 'arm64' });
  });
  let server: Awaited<ReturnType<typeof setup>>;
  try { server = await setup({ npc: { adapter: backend, options } }); } finally { factory.mockRestore(); }
  const { origin, config, guest, connect } = server;
  expect(await (await fetch(`${origin}/api/health`)).json()).toEqual({ status: 'ok', protocol: 3, npc: 'ready' });
  const client = await connect((await guest('LLM fixture')).token); client.command('join', { mapId: 'test' }); await client.wait(p => p.type === 'joined');
  const db = new DatabaseSync(config.dbPath, { readOnly: true });
  try {
    for (let i = 0; i < 2; i++) {
      const requestId = client.command('npc-question', { targetId: 'guide', text: 'Вопрос' });
      const result = await client.wait(p => p.type === 'npc-answer' && p.requestId === requestId);
      expect(result.type === 'npc-answer' && result.text).toContain('Предыдущих вопросов: ' + i);
      expect(db.prepare('SELECT count(*) AS n FROM npc_dialogue').get()!.n).toBe(i + 1);
    }
    const other = await connect((await guest('Другой игрок')).token); other.command('join', { mapId: 'test' }); await other.wait(p => p.type === 'joined');
    const requestId = other.command('npc-question', { targetId: 'guide', text: 'Вопрос' });
    const result = await other.wait(p => p.type === 'npc-answer' && p.requestId === requestId);
    expect(result.type === 'npc-answer' && result.text).toContain('Предыдущих вопросов: 0');
  } finally { db.close(); }
});

it.each(['ollama', 'mlx'])('configured %s without installed artifacts leaves the actual game available, without fallback', async (adapter) => {
  const options = adapter === 'ollama'
    ? { python: '/not-installed/python', executable: '/not-installed/ollama', modelsDir: '/not-installed/models', tokenizerDir: '/not-installed/tokenizer', tokenizerManifest: '/not-installed/tokenizer-sha256.json', model: 'qwen3.5:2b-q4_K_M', modelDigest: 'a'.repeat(64), runnerVersion: '0.40.13', startupTimeoutMs: 1000 }
    : { python: '/not-installed/python', modelDir: '/not-installed/model', modelManifest: '/not-installed/model-sha256.json', runnerVersion: '0.32.2', startupTimeoutMs: 1000 };
  const { origin, config, guest, connect } = await setup({ npc: { adapter, options } });
  expect(await (await fetch(`${origin}/api/health`)).json()).toEqual({ status: 'ok', protocol: 3, npc: 'unavailable' });
  const client = await connect((await guest('Без реального runtime')).token);
  client.command('join', { mapId: 'test' }); await client.wait(p => p.type === 'joined');
  const chatId = client.command('chat-send', { text: 'Мир продолжает работать' }); await client.wait(p => p.type === 'chat' && p.requestId === chatId);
  const requestId = client.command('npc-question', { targetId: 'guide', text: 'Привет' });
  const result = await client.wait(p => p.type === 'error' && p.requestId === requestId);
  expect(result.type === 'error' && result.code).toBe('UNAVAILABLE');
  expect(client.packets.some(p => p.type === 'npc-answer')).toBe(false);
  const db = new DatabaseSync(config.dbPath, { readOnly: true });
  try { expect(db.prepare('SELECT count(*) AS n FROM npc_dialogue').get()!.n).toBe(0); } finally { db.close(); }
});

it('exposes only public health to other origins while authenticated APIs keep their CORS restrictions', async () => {
  const { origin } = await setup();
  const headers = { Origin: 'http://192.168.1.20:8080' };
  const health = await fetch(`${origin}/api/health`, { headers });
  expect(health.status).toBe(200);
  expect(health.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(health.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  expect(await health.json()).toMatchObject({ status: 'ok', protocol: 3 });
  const auth = await fetch(`${origin}/api/auth/state`, { headers });
  expect(auth.status).toBe(401);
  expect(auth.headers.get('Access-Control-Allow-Origin')).toBeNull();
});
