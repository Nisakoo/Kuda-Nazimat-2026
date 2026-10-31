import { afterEach, expect, it } from 'vitest';
import { writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { io, type Socket } from 'socket.io-client';
import { startApplication } from '../src/app/application.ts';
import { parseConfig } from '../src/app/config.ts';
import { createGame } from '../src/game/index.ts';
import { silentLogger } from '../src/common/logger.ts';
import { parseServerMessage } from '../../shared/protocol/validate.ts';
import type { ServerMessage } from '../../shared/protocol/types.ts';
import { makeWorld, npc } from './a-helpers.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup(overrides: Record<string, unknown> = {}) {
  const world = await makeWorld([npc('guide', 0, 6)]); const root = dirname(world.worldDir);
  await writeFile(join(root, 'index.html'), '<main>UI</main>');
  const config = { ...parseConfig({ ...world, clientDir: root, dbPath: join(root, 'game.sqlite'), defaultMap: 'test', host: '127.0.0.1', staticChunkRadius: 0, saveIntervalMs: 50, disconnectGraceMs: 80, npc: { options: { delayMs: 100 } }, ...overrides }, join(root, 'config.json')), port: 0 };
  const app = await startApplication(config, createGame, silentLogger); const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('No address'); const origin = `http://127.0.0.1:${address.port}`;
  cleanups.push(async () => { await app.stop(); await rm(root, { force: true, recursive: true }); });
  const guest = async (name: string) => {
    const response = await fetch(`${origin}/api/auth/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    return await response.json() as { token: string; expiresAt: number };
  };
  async function connect(token: string) {
    const socket = io(`${origin}/game`, { auth: { version: 1, token }, transports: ['websocket'], reconnection: false, forceNew: true, autoConnect: false });
    cleanups.push(async () => { socket.disconnect(); });
    const packets: ServerMessage[] = []; socket.on('game', (raw) => packets.push(parseServerMessage(raw)));
    const connected = new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); socket.connect(); await connected;
    let count = 0;
    const command = (type: string, fields = {}) => { const requestId = `r${++count}`; socket.emit('game', { v: 1, type, requestId, ...fields }); return requestId; };
    const wait = async (predicate: (p: ServerMessage) => boolean) => { await expect.poll(() => packets.find(predicate), { timeout: 3000 }).toBeDefined(); return packets.find(predicate)!; };
    return { socket, packets, command, wait };
  }
  return { app, config, origin, guest, connect };
}
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
it('session expiry closes the real socket and rejects protected HTTP and old tokens', async () => {
  const { origin, guest, connect } = await setup({ sessionTtlMs: 700 }); const session = await guest('Короткая');
  const client = await connect(session.token); client.command('join', { mapId: 'test' }); await client.wait((p) => p.type === 'joined');
  await client.wait((p) => p.type === 'error' && p.code === 'UNAUTHORIZED'); expect(client.socket.connected).toBe(false);
  expect((await fetch(`${origin}/world/maps/test/manifest.json`, { headers: { Authorization: `Bearer ${session.token}` } })).status).toBe(401);
  const rejected: Socket = io(`${origin}/game`, { auth: { version: 1, token: session.token }, reconnection: false, autoConnect: false });
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
