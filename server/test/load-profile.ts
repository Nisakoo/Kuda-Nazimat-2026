/** REALTIME S7: explicit 60-second integration profile, not part of the fast unit suite. */
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { makeWorld, npc } from './a-helpers.ts';
import { startApplication } from '../src/app/application.ts';
import { parseConfig } from '../src/app/config.ts';
import { createGame } from '../src/game/index.ts';
import type { Logger } from '../src/common/logger.ts';
import { parseServerMessage } from '../../shared/protocol/validate.ts';
import { startTrusted } from './tls-helpers.ts';

const root = await mkdtemp(join(tmpdir(), 'load-profile-'));
const world = await makeWorld([npc('guide', 0, 6)]);
await writeFile(join(root, 'index.html'), 'UI');
const config = { ...parseConfig({ ...world, host: '127.0.0.1', clientDir: root, dbPath: join(root, 'game.sqlite'), defaultMap: 'test', npc: { options: { delayMs: 5000 } } }, join(root, 'config.json'), 'test'), port: 0 };
const steps: Record<string, unknown>[] = []; const logs: string[] = []; const warnings: Record<string, number> = {};
const logger: Logger = { child: () => logger, debug() {}, info(event, _msg, fields) { if (event === 'game.tick.stats' && fields) steps.push(fields); }, warn(event) { warnings[event] = (warnings[event] ?? 0) + 1; }, error(event) { logs.push(event); }, fatal(event) { logs.push(event); } };
const app = await startTrusted(startApplication, config, createGame, logger);
const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('No port');
const origin = `https://127.0.0.1:${address.port}`;
const sockets: Socket[] = []; const timers: ReturnType<typeof setInterval>[] = [];
const intervals: number[] = []; let last = 0; let answers = 0; let timeouts = 0; let deltas = 0;
try {
  for (let i = 0; i < 4; i++) {
    const session = await (await fetch(`${origin}/api/auth/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Load ${i}` }) })).json() as { token: string };
    const socket = io(`${origin}/game`, { auth: { version: 3, token: session.token }, transports: ['websocket'], reconnection: false, autoConnect: false }); sockets.push(socket);
    let request = 0; let sequence = 0; const began = performance.now();
    const send = (type: string, fields = {}) => socket.emit('game', { v: 3, type, requestId: `r${++request}`, ...(type === 'input' ? { sprint: false, jumpId: 0 } : {}), ...fields });
    socket.on('game', (raw) => {
      const packet = parseServerMessage(raw);
      if (packet.type === 'npc-answer') answers++;
      if (packet.type === 'error' && packet.code === 'UNAVAILABLE') timeouts++;
      if (packet.type === 'delta') { deltas++; if (i === 0) { const now = performance.now(); if (last) intervals.push(now - last); last = now; } }
    });
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
    const joined = new Promise<void>((resolve) => { const handler = (raw: unknown) => { if (parseServerMessage(raw).type === 'joined') { socket.off('game', handler); resolve(); } }; socket.on('game', handler); });
    send('join', { mapId: 'test' }); await joined;
    timers.push(setInterval(() => send('input', { sequence: ++sequence, direction: { x: Math.floor((performance.now() - began) / 300) % 2 ? -1 : 1, z: 0 }, preparedChunks: ['0_0'] }), 50));
    timers.push(setInterval(() => send('chat-send', { text: 'Нагрузка' }), 1100));
  }
  let round = 0;
  const questions = () => { for (const socket of sockets) socket.emit('game', { v: 3, type: 'npc-question', requestId: `q${round}`, targetId: 'guide', text: 'История' }); round++; };
  questions(); timers.push(setInterval(questions, 10000));
  await new Promise<void>((resolve) => setTimeout(resolve, 61000));
  const sorted = intervals.sort((a, b) => a - b); const p95 = sorted[Math.floor(sorted.length * .95)];
  const result = { node: process.version, players: 4, durationMs: 61000, npcDelayMs: 5000, steps, broadcast: { samples: sorted.length, p95Ms: p95, maxMs: sorted.at(-1) }, deltas, answers, unavailable: timeouts, errors: logs, warnings };
  if (!steps.length || answers < 1 || timeouts < 1 || sorted.length < 100 || logs.length) throw new Error(`Profile incomplete: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result, null, 2));
} finally { for (const timer of timers) clearInterval(timer); for (const socket of sockets) socket.disconnect(); await app.stop(); await rm(root, { recursive: true, force: true }); await rm(dirname(world.worldDir), { recursive: true, force: true }); }
