import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openDatabase, sqliteStores } from '../src/persistence/database.ts';
import { createAuthService, hashToken } from '../src/auth/AuthService.ts';
import { parseConfig } from '../src/app/config.ts';
import { createHttpServer } from '../src/http/server.ts';
import { createNpcDialogueService } from '../src/npc/NpcDialogueService.ts';
import { systemClock, systemScheduler } from '../src/common/time.ts';
import { silentLogger } from '../src/common/logger.ts';
import { memoryStores } from './memory.ts';
import type { GameRuntime } from '../src/contracts.ts';

const directories: string[] = []; const databases: DatabaseSync[] = [];
function directory() { const path = mkdtempSync(join(tmpdir(), 'platform-')); directories.push(path); return path; }
function database() { const path = join(directory(), 'game.sqlite'); const db = openDatabase(path); databases.push(db); return { path, db, stores: sqliteStores(db) }; }
/** Windows without developer mode forbids symlinks; the escaping-alias check then runs against a missing file. */
function linkIfPermitted(target: string, path: string): void { try { symlinkSync(target, path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error; } }
afterEach(() => { for (const db of databases.splice(0)) { try { db.close(); } catch {} } for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('SQLite v1', () => {
  it('migrates with WAL/FK/FTS5, restores identity, positions and private history', () => {
    const { path, db, stores } = database();
    expect(db.prepare('PRAGMA journal_mode').get()!.journal_mode).toBe('wal');
    expect(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys).toBe(1);
    db.exec('CREATE VIRTUAL TABLE temp.fts_probe USING fts5(text)');
    const player = stores.accounts.findOrCreate('Аня', 'аня', 1);
    expect(player.playerId).toMatch(/^p_[a-z0-9]{16}$/);
    expect(stores.players.load(player.playerId)).toBeNull();
    stores.players.save([{ id: player.playerId, mapId: 'demo', position: { x: 1, y: 0, z: 2 }, rotationY: 3 }]);
    for (let i = 0; i < 51; i++) stores.dialogue.append(player.playerId, 'npc', `q${i}`, `a${i}`, i);
    expect(db.prepare('SELECT count(*) AS n FROM npc_dialogue').get()!.n).toBe(50);
    expect(stores.dialogue.history(player.playerId, 'npc').map((d) => d.question)).toEqual(['q45', 'q46', 'q47', 'q48', 'q49', 'q50']);
    expect(stores.dialogue.history('another', 'npc')).toEqual([]);
    db.close();
    const reopened = openDatabase(path); databases.push(reopened); const restored = sqliteStores(reopened);
    expect(restored.accounts.findOrCreate('аня', 'аня', 2)).toEqual(player);
    expect(restored.players.load(player.playerId)?.position.x).toBe(1);
    expect(restored.dialogue.history(player.playerId, 'npc')).toHaveLength(6);
  });
  it('rolls back partial account creation, batch save and dialogue retention on failures', () => {
    const { db, stores } = database();
    db.exec("CREATE TRIGGER fail_player BEFORE INSERT ON players BEGIN SELECT RAISE(ABORT, 'test'); END");
    expect(() => stores.accounts.findOrCreate('Аня', 'аня', 1)).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM accounts').get()!.n).toBe(0);
    db.exec('DROP TRIGGER fail_player'); const p = stores.accounts.findOrCreate('Аня', 'аня', 1);
    expect(() => stores.players.save([{ id: p.playerId, mapId: 'demo', position: { x: 1, y: 0, z: 0 }, rotationY: 0 }, { id: 'missing', mapId: 'demo', position: { x: 1, y: 0, z: 0 }, rotationY: 0 }])).toThrow();
    expect(stores.players.load(p.playerId)).toBeNull();
    db.exec("CREATE TRIGGER fail_dialogue BEFORE INSERT ON npc_dialogue BEGIN SELECT RAISE(ABORT, 'test'); END");
    expect(() => stores.dialogue.append(p.playerId, 'npc', 'q', 'a', 1)).toThrow();
    expect(stores.dialogue.history(p.playerId, 'npc')).toEqual([]);
  });
  it('rejects a future schema and prunes sessions older than one day only', () => {
    const { db, stores, path } = database(); const p = stores.accounts.findOrCreate('Аня', 'аня', 1);
    for (const expiresAt of [9, 10, 11]) stores.sessions.create({ tokenHash: `hash${expiresAt}`, accountId: p.accountId, createdAt: 0, expiresAt });
    stores.sessions.prune(10); expect(stores.sessions.find('hash9')).toBeNull(); expect(stores.sessions.find('hash10')).not.toBeNull();
    db.prepare('INSERT INTO schema_migrations VALUES (999, 0)').run();
    expect(() => openDatabase(path)).toThrow('Не удалось открыть БД');
  });
  it('backs up a live WAL database and recovers after SIGKILL', async () => {
    const { db, stores, path } = database(); const p = stores.accounts.findOrCreate('Аня', 'аня', 1);
    const backup = join(directory(), 'backup.sqlite'); db.prepare('VACUUM INTO ?').run(backup);
    const copy = new DatabaseSync(backup); databases.push(copy);
    expect(copy.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok');
    expect(copy.prepare('SELECT name FROM accounts').get()!.name).toBe('Аня');
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.argv[1]); db.prepare('UPDATE players SET map_id=?,x=1,y=0,z=2,rotation_y=0 WHERE id=?').run('demo',process.argv[2]); console.log('saved'); setInterval(()=>{},1000);`, path, p.playerId], { stdio: ['ignore', 'pipe', 'pipe'] });
    try { await once(child.stdout!, 'data'); child.kill('SIGKILL'); await once(child, 'exit'); }
    finally { child.kill('SIGKILL'); }
    expect(db.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok');
    expect(stores.players.load(p.playerId)?.position.x).toBe(1);
  });
});

it('auth creates opaque hash-only sessions, preserves identity and expires at boundary', async () => {
  const stores = memoryStores(); let now = 100;
  const auth = createAuthService(stores.accounts, stores.sessions, { now: () => now }, 1000);
  const a = auth.guest(' Аня '); const b = auth.guest('аня');
  expect(Object.keys(a)).toEqual(['token', 'expiresAt']); expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(b.token).not.toBe(a.token);
  expect((await auth.verify(a.token))).toEqual(await auth.verify(b.token));
  expect(JSON.stringify([...stores.tokens])).not.toContain(a.token); expect(stores.tokens.has(hashToken(a.token))).toBe(true);
  now = a.expiresAt; expect(await auth.verify(a.token)).toEqual({ ok: false }); expect(await auth.verify('bad')).toEqual({ ok: false });
});

it('validates configuration keys, types, paths and scheduler bounds', () => {
  const path = '/tmp/config/config.json'; const config = parseConfig({}, path);
  expect(config.clientDir).toBe(resolve('/tmp/client/dist')); expect(config.npc.timeoutMs).toBe(8000);
  for (const input of [{ typo: true }, { port: '8080' }, { npc: { timeoutMs: 10000 } }, { npc: { extra: 1 } }, { maps: { market: '../secret' } }, { corsOrigins: ['*'] }, { defaultMap: 'missing' }, { logWorldAccess: 1 }, { npc: { streamTimeoutMs: 60001 } }, { language: { adapter: '' } }, { language: { extra: 1 } }, { language: { options: [] } }]) expect(() => parseConfig(input, path)).toThrow();
  expect(config.language).toEqual({ adapter: 'test', options: {} }); expect(config.npc.streamTimeoutMs).toBe(30000);
});

it('serves public UI/config, strict guest login, protected world and allowlisted CORS without secrets', async () => {
  const root = directory(); mkdirSync(join(root, 'maps')); writeFileSync(join(root, 'index.html'), 'UI'); writeFileSync(join(root, 'config.json'), 'secret'); writeFileSync(join(root, 'maps/private.json'), 'world'); linkIfPermitted(join(root, 'maps/private.json'), join(root, 'alias'));
  const stores = memoryStores(); const auth = createAuthService(stores.accounts, stores.sessions, { now: () => 100 }, 1000);
  const logs: unknown[] = [];
  const game: GameRuntime = { maps: [], attach() {}, activePlayers: () => 0, presence: () => [{ name: 'Аня', mapId: 'market', connected: false, releaseInMs: 4000 }], async stop() {}, worldFile(path) { return path === 'near' ? { ok: true, file: { absolutePath: join(root, 'maps/private.json'), bytes: 5, contentType: 'application/json' } } : { ok: false }; } };
  const config = parseConfig({ clientDir: root, corsOrigins: ['http://localhost:5173'], logWorldAccess: true }, join(root, 'config.json'));
  const { server } = createHttpServer(config, { auth, game, npcReady: () => true, logger: { ...silentLogger, info: (message, fields) => logs.push({ message, fields }) } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  try {
    expect(await (await fetch(url)).text()).toBe('UI');
    expect(await (await fetch(`${url}/config.json`)).json()).toEqual({ session: 'online', serverUrl: null, mapId: 'market', chunkRadius: null, debug: false });
    expect(await (await fetch(`${url}/api/health`)).json()).toEqual({ status: 'ok', protocol: 3, npc: 'ready' });
    for (const path of ['/maps/private.json', '/assets/models/x', '//config.json', '/alias', '/%2e%2e%2fsecret', '/missing']) expect((await fetch(url + path)).status).toBe(404);
    expect((await fetch(`${url}/world/near`)).status).toBe(401);
    for (const name of ['', 'x'.repeat(33), 'x\n']) expect((await fetch(`${url}/api/auth/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })).status).toBe(400);
    for (const value of [{ name: 'Аня', extra: 1 }, { name: 'x'.repeat(1100) }]) expect((await fetch(`${url}/api/auth/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })).status).toBe(400);
    const oversizedChunked = await new Promise<number>((resolve, reject) => {
      const req = request(`${url}/api/auth/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
      req.on('error', reject); req.write('{"name":"'); req.write('x'.repeat(2000)); req.end('"}');
    });
    expect(oversizedChunked).toBe(400);
    const response = await fetch(`${url}/api/auth/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Аня' }) });
    const session = await response.json() as { token: string; expiresAt: number }; expect(Object.keys(session)).toEqual(['token', 'expiresAt']);
    const headers = { Authorization: `Bearer ${session.token}` };
    expect((await fetch(`${url}/world/near`, { headers })).status).toBe(200); expect((await fetch(`${url}/world/far`, { headers })).status).toBe(404);
    const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Headers': 'Authorization' } });
    expect(preflight.status).toBe(204); expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    expect((await fetch(url, { headers: { Origin: 'http://evil.test' } })).headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(JSON.stringify(logs)).not.toContain(session.token); expect(JSON.stringify(logs)).not.toContain(hashToken(session.token));
    expect(logs).toHaveLength(2);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

it('the 52nd NPC answer is unavailable when SQLite fails, retaining exactly 50 committed records', async () => {
  const { db, stores } = database(); const player = stores.accounts.findOrCreate('Аня', 'аня', 1);
  const npc = createNpcDialogueService({ dialogue: stores.dialogue, clock: systemClock, scheduler: systemScheduler, logger: silentLogger,
    responder: { async start() {}, async stop() {}, async answer(request) { return { text: `Ответ ${request.question}` }; } },
  }, { maxConcurrent: 1, maxUnfinished: 4, timeoutMs: 8000 });
  await npc.start();
  const base = { connectionId: 'c', player, npc: { id: 'n', name: 'Лея', topic: 'История', persona: 'Спокойная', greeting: 'Привет' } };
  for (let i = 1; i <= 51; i++) expect((await npc.ask({ ...base, requestId: `r${i}`, question: `Вопрос ${i}` })).ok).toBe(true);
  db.exec("CREATE TRIGGER fail_52 BEFORE INSERT ON npc_dialogue BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
  expect(await npc.ask({ ...base, requestId: 'r52', question: 'Вопрос 52' })).toEqual({ ok: false, reason: 'unavailable' });
  expect(db.prepare('SELECT count(*) AS n FROM npc_dialogue').get()!.n).toBe(50);
  expect(stores.dialogue.history(player.playerId, 'n').at(-1)?.question).toBe('Вопрос 51'); await npc.stop();
});
