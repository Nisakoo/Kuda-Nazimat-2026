import { expect, it } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import { addressKind, connectionBlock, connectionInfo, firewallHint, isLoopback, lanAddresses } from '../src/common/network.ts';
import { startApplication } from '../src/app/application.ts';
import { createGame } from '../src/game/index.ts';
import { memoryLogger, silentLogger } from '../src/common/logger.ts';
import { defer, setup } from './harness.ts';
import { createServer } from 'node:net';
import { writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseConfig, serverArguments } from '../src/app/config.ts';
import { databaseCheck, lanCheck, nodeCheck } from '../src/app/selfCheck.ts';
import { openDatabase } from '../src/persistence/database.ts';
import { makeWorld, npc } from './a-helpers.ts';

const entry = (address: string, internal = false): NetworkInterfaceInfo => ({ address, internal, family: 'IPv4', netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null });

it('lists non-loopback IPv4 per interface, private ranges first and link-local last (OFFLINE-002)', () => {
  const list = lanAddresses({ lo: [entry('127.0.0.1', true)], vpn: [entry('198.18.0.1')], eth: [entry('169.254.1.2')], wifi: [entry('192.168.1.96'), { ...entry('fe80::1'), family: 'IPv6', scopeid: 0 }], lab: [entry('10.0.0.5')], corp: [entry('172.20.1.1')] });
  expect(list.map((a) => a.address)).toEqual(['192.168.1.96', '10.0.0.5', '172.20.1.1', '198.18.0.1', '169.254.1.2']);
  expect(['172.15.0.1', '172.32.0.1', '11.0.0.1'].map(addressKind)).toEqual(['other', 'other', 'other']);
});

it('builds the connection block with the operator address and the right warnings', () => {
  const lan = lanAddresses({ wifi: [entry('192.168.1.96')], eth: [entry('169.254.1.2')] });
  const open = connectionInfo('0.0.0.0', 8080, lan, 'win32');
  expect(open.local).toBe('http://localhost:8080/'); expect(open.operator).toBe('http://localhost:8080/operator');
  expect(open.lan.map((a) => a.url)).toEqual(['http://192.168.1.96:8080/', 'http://169.254.1.2:8080/']);
  expect(open.warnings).toEqual([firewallHint('win32')]);
  const block = connectionBlock(open);
  expect(block).toContain('http://192.168.1.96:8080/'); expect(block).toContain('169.254.1.2:8080/'); expect(block).toMatch(/169\.254\.1\.2:8080\/\s+eth \(нет сети\)/);
  expect(connectionInfo('0.0.0.0', 8080, lanAddresses({ eth: [entry('169.254.1.2')] }), 'linux').warnings[0]).toContain('только режим одного компьютера');
  expect(connectionInfo('0.0.0.0', 8080, [], 'darwin').warnings[0]).toContain('только режим одного компьютера');
  const local = connectionInfo('127.0.0.1', 8080, lan, 'darwin');
  expect(local.lan).toEqual([]); expect(local.warnings).toEqual([expect.stringContaining('другие устройства не подключатся')]);
  expect(connectionInfo('192.168.1.96', 9000, lan, 'linux')).toMatchObject({ lan: [{ url: 'http://192.168.1.96:9000/' }], warnings: [expect.stringContaining('9000/tcp')] });
  for (const platform of ['win32', 'darwin', 'linux'] as const) expect(firewallHint(platform).length).toBeGreaterThan(20);
});

it('recognizes only loopback peers and parses --config/--port in any order (OFFLINE-003, 010)', () => {
  expect(['127.0.0.1', '::1', '::ffff:127.0.0.1'].every(isLoopback)).toBe(true);
  expect(['192.168.1.96', '::ffff:192.168.1.96', undefined].some(isLoopback)).toBe(false);
  expect(serverArguments(['--port', '9090'])).toMatchObject({ port: 9090 });
  expect(serverArguments(['--port', '9090', '--config', 'x.json']).configPath).toMatch(/x\.json$/);
  for (const args of [['--port', '0'], ['--port', '70000'], ['--port'], ['--host', 'x'], ['--port', '8o']]) expect(() => serverArguments(args)).toThrow('Использование');
});

// ── Real server (OFFLINE-018) ────────────────────────────────────────────────
const lan = lanAddresses().find((a) => a.kind !== 'link-local') ?? lanAddresses()[0];

it.skipIf(!lan)(`two players over a non-loopback IPv4 (${lan?.address ?? 'нет адреса — пропуск, не успех'}): login, movement, chat and protected world`, async () => {
  const { port, connect } = await setup({ host: '0.0.0.0' });
  const base = `http://${lan!.address}:${port}`;
  const login = async (name: string) => (await (await fetch(`${base}/api/auth/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })).json()) as { token: string };
  const [anya, boris] = [await login('Аня'), await login('Борис')];
  const a = await connect(anya.token, lan!.address); const b = await connect(boris.token, lan!.address);
  a.command('join', { mapId: 'test' }); const joined = await a.wait((p) => p.type === 'joined'); if (joined.type !== 'joined') throw new Error();
  b.command('join', { mapId: 'test' }); await b.wait((p) => p.type === 'joined');
  expect((await fetch(`${base}/world/maps/test/manifest.json`, { headers: { Authorization: `Bearer ${anya.token}` } })).status).toBe(200);
  expect((await fetch(`${base}/world/maps/test/manifest.json`)).status).toBe(401);
  const startX = joined.snapshot.entities.find((e) => e.id === joined.playerId)!.transform!.position.x;
  for (let sequence = 1; sequence <= 6; sequence++) { a.command('input', { sequence, direction: { x: 1, z: 0 }, preparedChunks: ['0_0'] }); await new Promise((resolve) => setTimeout(resolve, 50)); }
  await b.wait((p) => p.type === 'delta' && p.upsert.some((e) => e.id === joined.playerId && e.transform!.position.x > startX));
  const chat = a.command('chat-send', { text: 'Привет по сети' });
  await b.wait((p) => p.type === 'chat' && p.requestId === chat && p.text === 'Привет по сети');
});

it.skipIf(!lan)('operator screen and status are 404 from a non-loopback address', async () => {
  const { port } = await setup({ host: '0.0.0.0' });
  for (const path of ['/operator', '/api/operator/status', '/api/operator/metrics', '/api/operator/accounts']) expect((await fetch(`http://${lan!.address}:${port}${path}`)).status).toBe(404);
});

it('operator screen shows seats, presence and NPC state without secrets; logs carry IP but no tokens or texts (OFFLINE-010, 016)', async () => {
  const logger = memoryLogger(); const lines = logger.records;
  const { origin, guest, connect } = await setup({ disconnectGraceMs: 300 }, undefined, 'test', logger);
  const session = await guest('Аня'); const client = await connect(session.token);
  client.command('join', { mapId: 'test' }); const joined = await client.wait((p) => p.type === 'joined'); if (joined.type !== 'joined') throw new Error();
  const chat = client.command('chat-send', { text: 'секретный текст' }); await client.wait((p) => p.type === 'chat' && p.requestId === chat);
  const page = await fetch(`${origin}/operator`);
  expect(page.status).toBe(200); expect(page.headers.get('content-security-policy')).toContain("default-src 'none'"); expect(await page.text()).toContain('/api/operator/status');
  const status = await (await fetch(`${origin}/api/operator/status`)).json() as { addresses: string[]; players: unknown[]; seats: unknown; npc: string; uptimeSeconds: number };
  expect(status.addresses[0]).toMatch(/^http:\/\/localhost:\d+\/$/);
  expect(status).toMatchObject({ players: [{ name: 'Аня', mapId: 'test', connected: true, releaseInMs: null }], seats: { used: 1, max: 4 }, npc: 'ready' });
  expect(status).toMatchObject({ environment: 'test', version: '0.1.0', performance: { rssBytes: expect.any(Number), heapBytes: expect.any(Number) } });
  const takeover = await connect((await guest('аня')).token);
  await client.wait((p) => p.type === 'error' && p.code === 'UNAUTHORIZED');
  takeover.socket.disconnect();
  await expect.poll(async () => ((await (await fetch(`${origin}/api/operator/status`)).json()) as { players: { connected: boolean; releaseInMs: number | null }[] }).players[0]).toMatchObject({ connected: false });
  await expect.poll(() => lines.some((l) => l.event === 'game.seat.release')).toBe(true);
  const text = JSON.stringify(lines);
  expect(lines.find((l) => l.event === 'realtime.join')).toMatchObject({ playerId: joined.playerId, mapId: 'test', ip: expect.stringMatching(/127\.0\.0\.1/) });
  for (const event of ['realtime.closed_by_server', 'realtime.disconnect']) expect(lines.some((l) => l.event === event && typeof l.ip === 'string' && l.playerId === joined.playerId)).toBe(true);
  expect(text).not.toContain(session.token); expect(text).not.toContain('секретный текст');
  const body = JSON.stringify(status); expect(body).not.toContain(session.token); expect(body).not.toContain('секретный текст');
});

it('a busy port fails with a clear message and a way out (OFFLINE-003)', async () => {
  const { app, config } = await setup();
  const address = app.server.address(); if (!address || typeof address === 'string') throw new Error();
  await expect(startApplication({ ...config, port: address.port }, createGame, silentLogger)).rejects.toThrow(`Порт ${address.port} уже занят`);
});

it('lan:check reports every start precondition and fails on a busy port, missing build/world or a newer database (OFFLINE-008)', async () => {
  const world = await makeWorld([npc('guide', 0, 6)]); const root = dirname(world.worldDir);
  defer(() => rm(root, { recursive: true, force: true }));
  const blocker = createServer(); await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve)); defer(() => new Promise((resolve) => blocker.close(() => resolve())));
  const busyPort = (blocker.address() as { port: number }).port;
  const config = { ...parseConfig({ ...world, defaultMap: 'test', clientDir: root, dbPath: join(root, 'game.sqlite'), host: '127.0.0.1' }, join(root, 'config.json')), port: 0 };
  const byName = (checks: { name: string; ok: boolean; detail: string }[]) => Object.fromEntries(checks.map((c) => [c.name, c]));
  let checks = byName(await lanCheck(config, { addresses: [], platform: 'linux', node: '24.15.0' }));
  expect(checks['Клиент']!.ok).toBe(false); expect(checks['Мир']!.ok).toBe(true); expect(checks['БД']!.detail).toContain('будет создана');
  expect(checks['Сеть']!.detail).toContain('только режим одного компьютера'); expect(checks['Брандмауэр']!.detail).toContain('ufw');
  await writeFile(join(root, 'index.html'), 'UI'); openDatabase(config.dbPath).close();
  checks = byName(await lanCheck({ ...config, port: busyPort }, { addresses: [], node: '22.12.0' }));
  expect(checks['Клиент']!.ok).toBe(true); expect(checks['БД']).toMatchObject({ ok: true, detail: expect.stringContaining('открывается') });
  expect(checks['Порт']!.ok).toBe(false); expect(checks['Node']!.ok).toBe(false);
  expect((await lanCheck(config, { node: '24.15.0' })).every((c) => c.ok)).toBe(true);
  expect(databaseCheck(config.dbPath, 0)).toMatchObject({ ok: false, detail: expect.stringContaining('новее сервера') });
  expect((await lanCheck({ ...config, worldDir: join(root, 'missing') })).find((c) => c.name === 'Мир')!.ok).toBe(false);
  expect(nodeCheck('25.0.0').ok).toBe(false);
});
