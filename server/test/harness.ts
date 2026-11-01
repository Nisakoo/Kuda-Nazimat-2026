import { afterEach, expect } from 'vitest';
import { writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { io } from 'socket.io-client';
import { startApplication, type AppObservability } from '../src/app/application.ts';
import { parseConfig } from '../src/app/config.ts';
import { createGame } from '../src/game/index.ts';
import { silentLogger, type Logger } from '../src/common/logger.ts';
import { parseServerMessage } from '../../shared/protocol/validate.ts';
import type { ServerMessage } from '../../shared/protocol/types.ts';
import type { LanguagePort } from '../src/babylon/ports.ts';
import { makeWorld, npc } from './a-helpers.ts';

/** A real server (HTTP, Socket.IO, SQLite) on a temporary world; every outgoing packet passes parseServerMessage. */
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
/** Runs after the current test, in reverse order of registration. */
export function defer(cleanup: () => Promise<void>): void { cleanups.push(cleanup); }
export async function setup(overrides: Record<string, unknown> = {}, language?: LanguagePort, mapId = 'test', logger: Logger = silentLogger, obs?: AppObservability) {
  const world = await makeWorld([npc('guide', 0, 6, { mapId })], mapId); const root = dirname(world.worldDir);
  await writeFile(join(root, 'index.html'), '<main>UI</main>');
  const config = { ...parseConfig({ ...world, clientDir: root, dbPath: join(root, 'game.sqlite'), defaultMap: mapId, host: '127.0.0.1', staticChunkRadius: 0, saveIntervalMs: 50, disconnectGraceMs: 80, npc: { options: { delayMs: 100 } }, ...overrides }, join(root, 'config.json'), 'test'), port: 0 };
  const app = await startApplication(config, createGame, logger, language, obs); const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('No address'); const port = address.port; const origin = `http://127.0.0.1:${port}`;
  cleanups.push(async () => { await app.stop(); await rm(root, { force: true, recursive: true }); });
  const guest = async (name: string) => {
    const response = await fetch(`${origin}/api/auth/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    return await response.json() as { token: string; expiresAt: number };
  };
  async function connect(token: string, host = '127.0.0.1') {
    const socket = io(`http://${host}:${port}/game`, { auth: { version: 3, token }, transports: ['websocket'], reconnection: false, forceNew: true, autoConnect: false });
    cleanups.push(async () => { socket.disconnect(); });
    const packets: ServerMessage[] = []; socket.on('game', (raw) => packets.push(parseServerMessage(raw)));
    const connected = new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); socket.connect(); await connected;
    let count = 0;
    const command = (type: string, fields = {}) => { const requestId = `r${++count}`; socket.emit('game', { v: 3, type, requestId, ...(type === 'input' ? { sprint: false, jumpId: 0 } : {}), ...fields }); return requestId; };
    const wait = async (predicate: (p: ServerMessage) => boolean) => { await expect.poll(() => packets.find(predicate), { timeout: 3000 }).toBeDefined(); return packets.find(predicate)!; };
    return { socket, packets, command, wait };
  }
  /** JSON POST; body parsed when there is one. */
  const post = async (path: string, value: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as Record<string, any> | null, headers: response.headers };
  };
  return { app, config, origin, port, guest, connect, post };
}
