/** STORE S3: real process SIGKILL between default 10-second saves; run explicitly on Node 24. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { io, type Socket } from 'socket.io-client';
import { makeWorld } from './a-helpers.ts';
import { parseServerMessage } from '../../shared/protocol/validate.ts';
import type { ServerMessage } from '../../shared/protocol/types.ts';

const world = await makeWorld([]); const root = dirname(world.worldDir);
const dbPath = join(root, 'game.sqlite'); const configPath = join(root, 'config.json');
const probe = createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
const address = probe.address(); assert(address && typeof address !== 'string');
const port = address.port; await new Promise<void>((resolve) => probe.close(() => resolve()));
await writeFile(join(root, 'index.html'), 'UI');
await writeFile(configPath, JSON.stringify({ ...world, host: '127.0.0.1', port, clientDir: root, dbPath, defaultMap: 'test' }));
const origin = `http://127.0.0.1:${port}`; const sockets: Socket[] = []; let child: ChildProcess | undefined;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean, ms = 12000) { const end = Date.now() + ms; while (!predicate()) { assert(Date.now() < end, 'deadline'); await delay(25); } }
async function start() {
  const processHandle = spawn(process.execPath, [fileURLToPath(new URL('../src/app/main.ts', import.meta.url)), '--config', configPath], { stdio: ['ignore', 'pipe', 'pipe'] }); child = processHandle;
  let output = ''; processHandle.stdout!.on('data', (chunk) => { output += String(chunk); }); processHandle.stderr!.on('data', (chunk) => { output += String(chunk); });
  await until(() => { assert.equal(processHandle.exitCode, null, output); return output.includes('Сервер доступен'); });
}
async function stop(signal: NodeJS.Signals) {
  assert(child); const exited = once(child, 'exit'); child.kill(signal); const [code, reason] = await exited;
  if (signal === 'SIGKILL') assert.equal(reason, 'SIGKILL'); else assert.equal(code, 0);
}
async function connect() {
  const session = await (await fetch(`${origin}/api/auth/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Crash test' }) })).json() as { token: string };
  const socket = io(`${origin}/game`, { auth: { version: 3, token: session.token }, transports: ['websocket'], reconnection: false, autoConnect: false }); sockets.push(socket);
  const packets: ServerMessage[] = []; let request = 0; let sequence = 0; socket.on('game', (raw) => packets.push(parseServerMessage(raw)));
  const connected = new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); socket.connect(); await connected;
  const send = (type: string, fields = {}) => { socket.emit('game', { v: 3, type, requestId: `r${++request}`, ...(type === 'input' ? { sprint: false, jumpId: 0 } : {}), ...fields }); };
  send('join', { mapId: 'test' }); await until(() => packets.some((p) => p.type === 'joined'));
  const joined = packets.find((p) => p.type === 'joined'); assert(joined?.type === 'joined'); const playerId = joined.playerId;
  async function move(x: number, z: number, ms: number) {
    const end = Date.now() + ms;
    while (Date.now() < end) { send('input', { sequence: ++sequence, direction: { x, z }, preparedChunks: ['0_0'] }); await delay(50); }
    send('input', { sequence: ++sequence, direction: { x: 0, z: 0 }, preparedChunks: ['0_0'] }); await delay(100);
  }
  async function snapshot() { send('resync', { revision: 0 }); await until(() => packets.some((p) => p.type === 'snapshot')); const packet = packets.find((p) => p.type === 'snapshot'); assert(packet?.type === 'snapshot'); return packet.snapshot.entities.find((e) => e.id === playerId)?.transform?.position; }
  return { joined, move, snapshot };
}
const deadline = setTimeout(() => { child?.kill('SIGKILL'); throw new Error('Crash recovery exceeded 40 seconds'); }, 40000);
try {
  await start(); const first = await connect(); await first.move(1, 0, 300);
  let saved: Record<string, unknown>; let lostWindowMs: number;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const read = () => db.prepare('SELECT map_id, x, y, z, rotation_y, updated_at FROM players WHERE id = ?').get(first.joined.playerId)!;
    await until(() => Number(read().x) > 0); saved = read();
    await first.move(0, -1, 500); assert.notEqual((await first.snapshot())?.z, saved.z); await delay(4500);
    assert.deepEqual(read(), saved); lostWindowMs = Date.now() - Number(saved.updated_at); assert(lostWindowMs < 10000);
    db.prepare('VACUUM INTO ?').run(join(root, 'backup.sqlite'));
    await stop('SIGKILL'); assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
  } finally { db.close(); }
  await start(); const restored = await connect(); assert.equal(restored.joined.playerId, first.joined.playerId);
  const position = restored.joined.snapshot.entities.find((e) => e.id === restored.joined.playerId)?.transform?.position;
  assert.deepEqual(position, { x: saved.x, y: saved.y, z: saved.z });
  const backup = new DatabaseSync(join(root, 'backup.sqlite'), { readOnly: true });
  try { assert.equal(backup.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok'); assert.equal(backup.prepare('SELECT z FROM players').get()!.z, saved.z); } finally { backup.close(); }
  await stop('SIGTERM');
  console.log(JSON.stringify({ node: process.version, saveIntervalMs: 10000, lostWindowMs, samePlayer: true, restoredCommittedPosition: true, integrity: 'ok', backupIntegrity: 'ok' }, null, 2));
} finally { clearTimeout(deadline); for (const socket of sockets) socket.disconnect(); if (child && child.exitCode === null && child.signalCode === null) await stop('SIGTERM'); await rm(root, { force: true, recursive: true }); }
