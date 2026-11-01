/** NEXT S11: real generated market, auth, Socket.IO, SQLite and four active players.
 * This measures server runtime only. It does not qualify a target laptop or browser GPU.
 */
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { startApplication } from '../src/app/application.ts';
import { parseConfig } from '../src/app/config.ts';
import { createGame } from '../src/game/index.ts';
import { createLogger } from '../src/common/logger.ts';
import { parseServerMessage } from '../../shared/protocol/validate.ts';
import type { SceneStateMessage } from '../../shared/world-life/types.ts';

const directory = await mkdtemp(join(tmpdir(), 'world-next-profile-'));
const config = { ...parseConfig({ host: '127.0.0.1', clientDir: resolve('client/dist'), worldDir: resolve('client/public'), contentDir: resolve('server/content'), dbPath: join(directory, 'game.sqlite'), defaultMap: 'market', saveIntervalMs: 500 }, join(directory, 'config.json')), port: 0 };
const steps: Record<string, unknown>[] = [];
const errors: string[] = [];
const logger = createLogger(record => {
  if (record.event === 'game.tick.stats') steps.push({ p50: record.p50, p95: record.p95, max: record.max, broadcastP95: record.broadcastP95, players: record.players });
  if (record.level === 'error' || record.level === 'fatal' || (record.level === 'warn' && record.event !== 'auth.passwordless.enabled')) errors.push(`${record.event}: ${record.msg}`);
}, 'world-next-profile');
const startupBegan = performance.now();
const app = await startApplication(config, createGame, logger);
const startupMs = performance.now() - startupBegan;
console.log(JSON.stringify({ startupMs }));
const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('No port');
const origin = `http://127.0.0.1:${address.port}`;
const sockets: Socket[] = [];
const timers: ReturnType<typeof setInterval>[] = [];
let deltas = 0;
let scenePackets = 0;
const scenes: SceneStateMessage[] = [];
const durationMs = 61000;
try {
  for (let index = 0; index < 4; index++) {
    const response = await fetch(`${origin}/api/auth/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `World profile ${index}` }) });
    if (!response.ok) throw new Error(`Auth failed ${response.status}`);
    const session = await response.json() as { token: string };
    const socket = io(`${origin}/game`, { auth: { version: 3, token: session.token }, transports: ['websocket'], autoConnect: false, reconnection: false }); sockets.push(socket);
    let sequence = 0;
    let request = 0;
    socket.on('game', raw => { const packet = parseServerMessage(raw); if (packet.type === 'delta') deltas++; if (packet.type === 'error') errors.push(`${packet.code}: ${packet.message}`); });
    socket.on('world-life', (packet: SceneStateMessage) => { if (packet.type === 'scene-state') { scenePackets++; scenes[index] = packet; } });
    await new Promise<void>((done, reject) => { socket.once('connect', done); socket.once('connect_error', reject); socket.connect(); });
    const joined = new Promise<void>((done, reject) => {
      const timeout = setTimeout(() => reject(new Error('Join timed out')), 10000);
      const handler = (raw: unknown) => { if (parseServerMessage(raw).type === 'joined') { clearTimeout(timeout); socket.off('game', handler); done(); } };
      socket.on('game', handler);
    });
    socket.emit('game', { v: 3, type: 'join', requestId: `join${index}`, mapId: 'market' }); await joined;
    socket.emit('world-life', { v: 1, type: 'scene-sync', requestId: `scene${index}` });
    const began = performance.now();
    // Small alternating paths stay in the initial street and produce authoritative updates.
    timers.push(setInterval(() => socket.emit('game', { v: 3, type: 'input', requestId: `p${index}_${++request}`, sequence: ++sequence, direction: { x: 0, z: Math.floor((performance.now() - began) / 1200) % 2 ? -1 : 1 }, preparedChunks: ['0_0'], sprint: false, jumpId: 0 }), 50));
  }
  await new Promise<void>(done => setTimeout(done, durationMs));
  const report = { baseRevision: '09fd771', node: process.version, players: 4, durationMs, startupMs, backend: 'real generated world and temporary SQLite; explicit test LLM', steps, deltas, scenePackets, scenes: scenes.map(scene => ({ sceneId: scene.sceneId, epochMs: scene.epochMs, cats: scene.definition.cats.length, pots: scene.pots.length, apples: scene.apples.length })), errors, targetHardware: `${process.platform}/${process.arch}; browser GPU measured separately` };
  await writeFile(process.env.PROFILE_OUTPUT ?? 'tasks/evidence/next-main-merge/server-four-player-profile.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (errors.length || steps.length < 1 || deltas < 100 || scenes.length !== 4 || scenes.some(scene => scene.definition.cats.length !== 3 || scene.pots.length !== 4 || scene.apples.length !== 5) || new Set(scenes.map(scene => scene.sceneId)).size !== 1) throw new Error('Four-player profile failed');
} finally { for (const timer of timers) clearInterval(timer); for (const socket of sockets) socket.disconnect(); await app.stop(); await rm(directory, { recursive: true, force: true }); }
