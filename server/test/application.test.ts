import { afterEach, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startApplication } from '../src/app/application.ts';
import { parseConfig } from '../src/app/config.ts';
import { silentLogger } from '../src/common/logger.ts';
import type { CreateGame, GameDeps } from '../src/contracts.ts';
import { openDatabase, sqliteStores } from '../src/persistence/database.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'application-')); roots.push(root);
  mkdirSync(join(root, 'client')); mkdirSync(join(root, 'world')); writeFileSync(join(root, 'client/index.html'), 'UI');
  const path = join(root, 'config.json');
  writeFileSync(path, JSON.stringify({ host: '127.0.0.1', clientDir: 'client', worldDir: 'world', dbPath: 'game.sqlite', npc: { options: { delayMs: 1 } } }));
  const config = { ...parseConfig(JSON.parse(readFileSync(path, 'utf8')), path), port: 0 };
  return { root, path, config };
}
it('assembles exclusively through the frozen contract, restarts with memory and saves on stop', async () => {
  const { config } = fixture(); let deps!: GameDeps; let savedId = '';
  const createGame: CreateGame = async (_config, injected) => {
    deps = injected;
    return { maps: [{ mapId: 'demo', chunks: 1, worldBytes: 1000 }], worldFile: () => ({ ok: false }), attach() {}, activePlayers: () => 1, presence: () => [], closeSessions() {}, state: () => ({}), stats: () => null,
      async stop() { if (savedId) deps.players.save([{ id: savedId, mapId: 'demo', position: { x: 2, y: 0, z: 3 }, rotationY: 1 }]); } };
  };
  const app = await startApplication(config, createGame, silentLogger);
  const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('No address');
  const session = await (await fetch(`http://127.0.0.1:${address.port}/api/auth/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Аня' }) })).json() as { token: string };
  const verified = await deps.sessions.verify(session.token); if (!verified.ok) throw new Error('No session'); savedId = verified.identity.playerId;
  const question = { connectionId: 'c1', requestId: 'r1', player: verified.identity, npc: { id: 'n', name: 'Пастух', topic: 'Козы', persona: 'Заботливый пастух', greeting: 'Здравствуй' }, question: 'Что ест козлёнок?' };
  const first = await deps.npc.ask(question); expect(first.ok).toBe(true);
  const started = Date.now(); await app.stop(); await app.stop(); expect(Date.now() - started).toBeLessThan(10000);
  const secondApp = await startApplication(config, createGame, silentLogger);
  try {
    expect((await deps.sessions.verify(session.token)).ok).toBe(true);
    expect(deps.players.load(savedId)?.position).toEqual({ x: 2, y: 0, z: 3 });
    const second = await deps.npc.ask({ ...question, connectionId: 'c2' });
    expect(second.ok && second.text).toContain('В прошлый раз ты спрашивал: “Что ест козлёнок?”'); expect(second).not.toEqual(first);
  } finally { await secondApp.stop(); }
});
it('fails before listening for missing client/world, invalid adapter, or failed game validation', async () => {
  const { config, root } = fixture(); let called = false;
  const game: CreateGame = async () => { called = true; throw new Error('Invalid world manifest'); };
  await expect(startApplication({ ...config, clientDir: join(root, 'missing') }, game, silentLogger)).rejects.toThrow('npm --prefix client run build'); expect(called).toBe(false);
  await expect(startApplication({ ...config, worldDir: join(root, 'missing') }, game, silentLogger)).rejects.toThrow('world:generate');
  await expect(startApplication({ ...config, npc: { ...config.npc, adapter: 'missing' } }, game, silentLogger)).rejects.toThrow('npc.adapter');
  await expect(startApplication({ ...config, language: { adapter: 'missing', options: {} } }, game, silentLogger)).rejects.toThrow('language.adapter');
  await expect(startApplication(config, game, silentLogger)).rejects.toThrow('Invalid world manifest');
  const db = openDatabase(config.dbPath); expect(db.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok'); db.close();
});
it('inspect reads a running WAL database without secrets and backup restores a separate copy', () => {
  const { config, path, root } = fixture(); const db = openDatabase(config.dbPath); const stores = sqliteStores(db);
  const player = stores.accounts.findOrCreate('Аня', 'аня', 1);
  const question = 'Q'.repeat(100); stores.dialogue.append(player.playerId, 'npc', question, 'private answer', 1);
  stores.sessions.create({ tokenHash: 'secret-token-hash', accountId: player.accountId, createdAt: 1, expiresAt: Date.now() + 10000 });
  try {
    const output = execFileSync(process.execPath, [fileURLToPath(new URL('../src/cli/inspect.ts', import.meta.url)), '--config', path], { encoding: 'utf8' });
    expect(output).toContain('Аня'); expect(output).toContain(config.dbPath); expect(output).toContain('Q'.repeat(60));
    expect(output).not.toContain('Q'.repeat(61)); expect(output).not.toContain('secret-token-hash'); expect(output).not.toContain('private answer');
    const backup = join(root, 'copy.sqlite'); execFileSync(process.execPath, [fileURLToPath(new URL('../src/cli/backup.ts', import.meta.url)), backup, '--config', path]);
    const copy = openDatabase(backup); expect(sqliteStores(copy).accounts.findOrCreate('аня', 'аня', 2)).toEqual(player); copy.close();
    expect(() => execFileSync(process.execPath, [fileURLToPath(new URL('../src/cli/backup.ts', import.meta.url)), backup, '--config', path], { stdio: 'pipe' })).toThrow();
  } finally { db.close(); }
});
// Windows cannot deliver SIGTERM to a child gracefully, so the handler is triggered from inside the process there.
it('SIGTERM closes the process within ten seconds after saving through PlayerStore', async () => {
  const { root, config } = fixture();
  const seed = openDatabase(config.dbPath); const player = sqliteStores(seed).accounts.findOrCreate('Аня', 'аня', 1); seed.close();
  const application = new URL('../src/app/application.ts', import.meta.url).href;
  const shutdown = new URL('../src/app/shutdown.ts', import.meta.url).href;
  const logger = new URL('../src/common/logger.ts', import.meta.url).href;
  const script = `import {startApplication} from ${JSON.stringify(application)}; import {shutdownOnSignals} from ${JSON.stringify(shutdown)}; import {silentLogger} from ${JSON.stringify(logger)};
    const config=${JSON.stringify(config)}; const app=await startApplication(config, async (_config,deps)=>({maps:[],attach(){},worldFile(){return {ok:false}},activePlayers(){return 1},presence(){return []},closeSessions(){},state(){return {}},stats(){return null},async stop(){deps.players.save([{id:${JSON.stringify(player.playerId)},mapId:'demo',position:{x:7,y:0,z:8},rotationY:0}])}}),silentLogger);
    shutdownOnSignals(app,silentLogger); process.stdin.once('data',()=>process.emit('SIGTERM')); process.stdin.unref(); console.log('ready');`;
  const file = join(root, 'signal.mjs'); writeFileSync(file, script);
  const child = spawn(process.execPath, [file], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    await once(child.stdout!, 'data'); const start = Date.now();
    if (process.platform === 'win32') child.stdin!.write('stop\n'); else child.kill('SIGTERM');
    const [code] = await once(child, 'exit'); expect(code).toBe(0); expect(Date.now() - start).toBeLessThan(10000);
    const db = openDatabase(config.dbPath); expect(sqliteStores(db).players.load(player.playerId)?.position.x).toBe(7); db.close();
  } finally { child.kill('SIGKILL'); }
});
