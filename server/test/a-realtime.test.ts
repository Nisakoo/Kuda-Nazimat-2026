import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { parseServerMessage } from '../../shared/protocol/validate.ts';
import type { ServerMessage } from '../../shared/protocol/types.ts';
import { silentLogger } from '../src/common/logger.ts';
import { systemClock, systemScheduler } from '../src/common/time.ts';
import type { GameRuntime, NpcQuestion, NpcQuestions, PlayerStore, SavedPosition, SessionVerifier } from '../src/contracts.ts';
import { createGame } from '../src/game/index.ts';
import { makeWorld, npc, SPAWN } from './a-helpers.ts';

const ACCOUNTS: Record<string, { accountId: string; playerId: string; displayName: string }> = {
  'token-anya-000000000001': { accountId: 'a1', playerId: 'p_anya', displayName: 'Аня' },
  'token-boris-00000000002': { accountId: 'a2', playerId: 'p_boris', displayName: 'Борис' },
  'token-vera-000000000003': { accountId: 'a3', playerId: 'p_vera', displayName: 'Вера' },
};
const sessions: SessionVerifier = { verify: async (token) => ACCOUNTS[token] ? { ok: true, identity: ACCOUNTS[token]!, expiresAt: Date.now() + 3_600_000 } : { ok: false } };
const saved = new Map<string, SavedPosition>();
const players: PlayerStore = { load: (id) => saved.get(id) ?? null, save: (list) => { for (const { id, ...rest } of list) saved.set(id, rest); } };
const asked: NpcQuestion[] = [];
const cancelled: string[] = [];
const npcs: NpcQuestions = {
  ask: async (q) => { asked.push(q); return { ok: true, text: `Ответ ${q.npc.name}` }; },
  cancel: () => {},
  cancelConnection: (id) => { cancelled.push(id); },
};

let game: GameRuntime;
let url: string;
const server = createServer();
const sockets: Socket[] = [];

beforeAll(async () => {
  const world = await makeWorld([npc('near', 1, 6), npc('far', -10, -10)]);
  game = await createGame({
    ...world, maxPlayers: 2, tickHz: 20, broadcastHz: 10, aoiRadius: 64, staticChunkRadius: 1,
    disconnectGraceMs: 300, saveIntervalMs: 60_000, corsOrigins: [],
  }, { sessions, players, npc: npcs, clock: systemClock, scheduler: systemScheduler, logger: silentLogger });
  game.attach(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/game`;
});
afterAll(async () => { for (const s of sockets) s.disconnect(); await game.stop('test'); server.close(); });

/** Client with a validated inbox: every packet must pass the shared parser (PROTO v1). */
function client(token: string, version = 3) {
  const socket = io(url, { path: '/socket.io', auth: { version, token }, transports: ['websocket'], reconnection: false, forceNew: true });
  sockets.push(socket);
  const inbox: ServerMessage[] = [];
  const waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  socket.on('game', (raw: unknown) => {
    const message = parseServerMessage(raw);
    inbox.push(message);
    for (const w of [...waiters]) if (w.match(message)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(message); }
  });
  let seq = 0; let req = 0;
  const api = {
    socket, inbox,
    next: (match: (m: ServerMessage) => boolean, ms = 3000) => new Promise<ServerMessage>((resolve, reject) => {
      const found = inbox.find(match); if (found) { resolve(found); return; }
      const timer = setTimeout(() => reject(new Error('timeout waiting for message')), ms);
      waiters.push({ match, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    }),
    send: (message: Record<string, unknown>) => { const requestId = `r${++req}`; socket.emit('game', { v: 3, requestId, ...message }); return requestId; },
    input: (direction: { x: number; z: number }, preparedChunks = ['0_0', '1_0', '0_1', '-1_0', '0_-1']) => api.send({ type: 'input', sprint: false, jumpId: 0, sequence: ++seq, direction, preparedChunks }),
    connected: () => new Promise<void>((resolve, reject) => { socket.on('connect', () => resolve()); socket.on('connect_error', reject); }),
    refused: () => new Promise<string | undefined>((resolve) => socket.on('connect_error', (e: Error & { data?: { code?: string } }) => resolve(e.data?.code))),
  };
  return api;
}
async function joined(token: string) {
  const c = client(token);
  await c.connected();
  const requestId = c.send({ type: 'join', mapId: 'test' });
  const message = await c.next((m) => m.type === 'joined' && m.requestId === requestId);
  return { ...c, joined: message as Extract<ServerMessage, { type: 'joined' }> };
}
const positionOf = (m: ServerMessage, id: string) => (m.type === 'delta' ? m.upsert : m.type === 'joined' || m.type === 'snapshot' ? m.snapshot.entities : []).find((e) => e.id === id)?.transform?.position;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const disconnect = async (c: { socket: Socket }) => { c.socket.disconnect(); await sleep(50); };

describe('handshake (AUTH-003, PROTO-008 §1)', () => {
  it('rejects a missing token and a wrong protocol version', async () => {
    expect(await client('nope').refused()).toBe('UNAUTHORIZED');
    expect(await client('token-anya-000000000001', 2).refused()).toBe('VERSION');
    expect(await client('token-anya-000000000001', 1).refused()).toBe('VERSION');
  });
});

describe('two players (REALTIME-002, 005)', () => {
  it('joins with a valid snapshot and bootstrap, then syncs movement through deltas', async () => {
    const anya = await joined('token-anya-000000000001');
    expect(anya.joined.playerId).toBe('p_anya');
    expect(anya.joined.world.manifestUrl).toBe('maps/test/manifest.json');
    const near = anya.joined.snapshot.entities.find((e) => e.id === 'near');
    expect(near?.interactable?.label).toBe('Тема');
    expect(near?.renderable).toBeUndefined();

    const boris = await joined('token-boris-00000000002');
    expect(boris.joined.snapshot.entities.some((e) => e.id === 'p_anya')).toBe(true);
    for (let i = 0; i < 10; i++) { anya.input({ x: -1, z: 0 }); await sleep(50); }
    const delta = await boris.next((m) => m.type === 'delta' && (positionOf(m, 'p_anya')?.x ?? 0) < SPAWN.x - 0.5);
    if (delta.type !== 'delta') throw new Error('expected delta');
    expect(delta.revision).toBe(delta.baseRevision + 1);
    expect(boris.inbox.filter((m) => m.type === 'delta').every((m) => m.type === 'delta' && (m.upsert.length > 0 || m.remove.length > 0))).toBe(true);

    // NPC-001: near target gets an answer via NpcQuestions, far target is refused.
    const asking = anya.send({ type: 'npc-question', targetId: 'far', text: 'Привет?' });
    expect(await anya.next((m) => m.type === 'error' && m.requestId === asking)).toMatchObject({ code: 'FORBIDDEN' });
    for (let i = 0; i < 10; i++) { anya.input({ x: 1, z: 0 }); await sleep(50); }
    await sleep(300);
    const question = anya.send({ type: 'npc-question', targetId: 'near', text: '  Что ты знаешь?  ' });
    expect(await anya.next((m) => m.type === 'npc-answer' && m.requestId === question)).toMatchObject({ targetId: 'near', text: 'Ответ NPC near' });
    expect(asked.at(-1)).toMatchObject({ question: 'Что ты знаешь?', player: { playerId: 'p_anya' }, npc: { id: 'near', persona: 'Персона' } });

    // REALTIME-008: chat reaches both, with the sender's requestId; control characters are refused.
    const said = anya.send({ type: 'chat-send', text: '<b>привет</b>' });
    expect(await boris.next((m) => m.type === 'chat' && m.requestId === said)).toMatchObject({ playerId: 'p_anya', name: 'Аня', text: '<b>привет</b>' });
    await anya.next((m) => m.type === 'chat' && m.requestId === said);
    const bad = anya.send({ type: 'chat-send', text: 'a\u0007b' });
    expect(await anya.next((m) => m.type === 'error' && m.requestId === bad)).toMatchObject({ code: 'INVALID' });

    // SERVER-WORLD-006: files around the player only; nothing for an unknown account or path.
    expect(game.worldFile('maps/test/manifest.json', 'a1').ok).toBe(true);
    expect(game.worldFile('maps/test/chunks/1_0.json', 'a1').ok).toBe(true);
    expect(game.worldFile('maps/test/chunks/2_0.json', 'a1').ok).toBe(false);
    expect(game.worldFile('maps/test/chunks/0_0.json', 'a3').ok).toBe(false);
    expect(game.worldFile('../package.json', 'a1').ok).toBe(false);

    // SERVER-006: third account while two seats are taken.
    expect(await client('token-vera-000000000003').refused()).toBe('UNAVAILABLE');

    // AUTH-005: a second tab of Anya takes over; the first gets UNAUTHORIZED from "server" and is closed.
    const before = game.activePlayers();
    const firstTabId = anya.socket.id;
    const tab2 = await joined('token-anya-000000000001');
    expect(await anya.next((m) => m.type === 'error' && m.requestId === 'server')).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(tab2.joined.playerId).toBe('p_anya');
    expect(game.activePlayers()).toBe(before);
    await sleep(100);
    expect(anya.socket.connected).toBe(false);
    expect(firstTabId).toBeTruthy();
    expect(cancelled).toContain(firstTabId);

    // REALTIME-006: after the grace period the seat is freed and the position saved.
    await disconnect(tab2);
    await disconnect(boris);
    await sleep(500);
    expect(game.activePlayers()).toBe(0);
    expect(saved.get('p_anya')?.mapId).toBe('test');
  });
});

describe('protocol hygiene (REALTIME-001, PROTO-008 §5)', () => {
  it('requires join first, rejects duplicate requestIds and unknown fields', async () => {
    const vera = client('token-vera-000000000003');
    await vera.connected();
    const early = vera.send({ type: 'interact', targetId: 'near' });
    expect(await vera.next((m) => m.type === 'error' && m.requestId === early)).toMatchObject({ code: 'NOT_READY' });
    vera.socket.emit('game', { v: 3, type: 'join', requestId: 'dup', mapId: 'test' });
    await vera.next((m) => m.type === 'joined');
    vera.socket.emit('game', { v: 3, type: 'join', requestId: 'dup', mapId: 'test' });
    expect(await vera.next((m) => m.type === 'error' && m.requestId === 'dup')).toMatchObject({ code: 'INVALID' });
    const forged = vera.send({ type: 'input', sequence: 1, direction: { x: 0, z: 0 }, preparedChunks: [], position: { x: 99, y: 0, z: 0 } });
    expect(await vera.next((m) => m.type === 'error' && m.requestId === forged)).toMatchObject({ code: 'INVALID' });
    vera.socket.emit('game', { v: 3, type: 'resync', requestId: 'rs', revision: 0 });
    expect(await vera.next((m) => m.type === 'snapshot')).toMatchObject({ type: 'snapshot' });
  });
});
