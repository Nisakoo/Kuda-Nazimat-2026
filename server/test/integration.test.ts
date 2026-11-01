import { expect, it, vi } from 'vitest';
import { defer, setup } from './harness.ts';
import * as responders from '../src/npc/adapters/index.ts';
import { DatabaseSync } from 'node:sqlite';
import { io, type Socket } from 'socket.io-client';
import type { ServerMessage } from '../../shared/protocol/types.ts';
import { testLanguagePort } from '../src/babylon/TestLanguagePort.ts';
import type { LanguagePort } from '../src/babylon/ports.ts';

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
