import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { setup, defer } from './harness.ts';
import { testLanguagePort } from '../src/babylon/TestLanguagePort.ts';
import type { LanguagePort } from '../src/babylon/ports.ts';
import { MetricsRegistry } from '../src/common/metrics.ts';
import { silentLogger } from '../src/common/logger.ts';
import { sqliteBabylon } from '../src/persistence/babylon.ts';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

it.each(['disconnect', 'same-token takeover', 'logout', 'expiry'] as const)('real BABEL %s aborts promptly but holds the physical slot until worker settlement', async loss => {
  const began = deferred<void>(), physicalStop = deferred<string>(); let signal!: AbortSignal;
  let calls = 0;
  const language: LanguagePort = { ...testLanguagePort, async translate(_text, _source, _target, abort) {
    if (++calls === 1) { signal = abort; began.resolve(); return physicalStop.promise; }
    return 'translated';
  } };
  let snapshot!: () => unknown;
  const server = await setup(loss === 'expiry' ? { sessionTtlMs: 1800 } : {}, language, 'market', silentLogger,
    { metrics: new MetricsRegistry(), setSnapshot(value) { snapshot = value; } });
  const a = await server.guest('Owner'), b = await server.guest('Other');
  let ids = 0;
  const call = (token: string, action: unknown, requestId = `b${++ids}`) => server.post('/api/babylon', { v: 2, requestId, action }, { Authorization: `Bearer ${token}` });
  for (const c of [a, b]) expect((await call(c.token, { type: 'enroll', size: 2, native: 'ru', learning: 'en' })).status).toBe(200);
  const first = await server.connect(a.token); first.command('join', { mapId: 'market' }); await first.wait(p => p.type === 'joined');
  const db = new DatabaseSync(server.config.dbPath); defer(async () => { db.close(); });
  const row = db.prepare('SELECT s.id AS sessionId, p.id AS playerId FROM sessions s JOIN players p ON p.account_id = s.account_id JOIN accounts a ON a.id = s.account_id WHERE a.name = ?').get('Owner')!;
  sqliteBabylon(db).transaction(() => sqliteBabylon(db).appendNpcReply(String(row.playerId), String(row.sessionId), { id: 'memory', npcId: 'potter', question: 'remember', text: 'retained', language: 'en' }));
  const pending = call(a.token, { type: 'suggest', word: 'water' }); await began.promise;
  const queueState = () => (snapshot() as { npc: { running: number; unfinished: number } }).npc;
  expect(queueState()).toMatchObject({ running: 1, unfinished: 1 });
  if (loss === 'disconnect') first.socket.disconnect();
  if (loss === 'same-token takeover') {
    const replacement = await server.connect(a.token); replacement.command('join', { mapId: 'market' }); await replacement.wait(p => p.type === 'joined');
  }
  if (loss === 'logout') expect((await server.post('/api/auth/logout', {}, { Authorization: `Bearer ${a.token}` })).status).toBe(204);
  try {
    await expect.poll(() => signal.aborted, { timeout: 3000 }).toBe(true);
    expect((await pending).status).toBe(503);
    expect(queueState()).toMatchObject({ running: 1, unfinished: 1 });
    if (loss !== 'expiry' && loss !== 'logout') {
      const state = await call(a.token, { type: 'state' });
      expect(state.status).toBe(200); expect(state.body!.state.replies).toHaveLength(1);
      // The inherited one/player limit also applies after the same session gains another transport.
      expect((await call(a.token, { type: 'suggest', word: 'water' })).status).toBe(429);
    } else expect((await call(a.token, { type: 'state' })).status).toBe(401);
    if (loss !== 'expiry') {
      const queued = call(b.token, { type: 'suggest', word: 'water' });
      await expect.poll(() => queueState().unfinished).toBe(2); expect(calls).toBe(1);
      physicalStop.resolve('late old result'); expect((await queued).status).toBe(200); expect(calls).toBe(2);
    } else physicalStop.resolve('late old result');
    await expect.poll(() => queueState().unfinished).toBe(0);
    expect(sqliteBabylon(db).npcReplies(String(row.playerId), String(row.sessionId))).toHaveLength(1);
  } finally { physicalStop.resolve('cleanup'); }
});
