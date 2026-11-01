import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApplication } from '../src/app/application.ts';
import { parseConfig } from '../src/app/config.ts';
import * as responderAdapters from '../src/npc/adapters/index.ts';
import type { NpcAnswerRequest, LocalTranslationRequest } from '../src/npc/NpcResponder.ts';
import { memoryLogger } from '../src/common/logger.ts';
import type { CreateGame, GameDeps } from '../src/contracts.ts';
import type { BabylonAction, BabylonResult } from '../../shared/babylon/types.ts';
import { NPCS } from '../src/babylon/content.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); vi.restoreAllMocks(); });

it.each([
  { adapter: 'local', initiallyReady: true },
  { adapter: 'local', initiallyReady: false },
  { adapter: 'test', initiallyReady: false },
] as const)('composition borrows one responder: $adapter, runtime ready=$initiallyReady', async ({ adapter, initiallyReady }) => {
  const root = mkdtempSync(join(tmpdir(), 'local-language-app-'));
  mkdirSync(join(root, 'client')); mkdirSync(join(root, 'world')); writeFileSync(join(root, 'client/index.html'), 'test');
  let app: Awaited<ReturnType<typeof startApplication>> | undefined;
  cleanups.push(async () => { await app?.stop(); rmSync(root, { recursive: true, force: true }); });
  const config = { ...parseConfig({ host: '127.0.0.1', clientDir: 'client', worldDir: 'world', dbPath: 'game.sqlite',
    language: { adapter }, npc: { adapter: 'ollama' },
  }, join(root, 'config.json')), port: 0 };
  let healthy = initiallyReady;
  const responder = {
    start: vi.fn(async () => {}), stop: vi.fn(async () => { healthy = false; }),
    status: () => healthy ? 'ready' as const : 'unavailable' as const,
    answer: vi.fn(async (q: NpcAnswerRequest) => ({ text: `${q.locale}:answer` })),
    translate: vi.fn(async (q: LocalTranslationRequest) => ({ text: `${q.target}:translation` })),
  };
  const factory = vi.spyOn(responderAdapters, 'createResponder').mockReturnValue(responder);
  let deps!: GameDeps;
  const createGame: CreateGame = async (_config, injected) => {
    deps = injected;
    return { maps: [], attach() {}, worldFile: () => ({ ok: false }), activePlayers: () => 1, presence: () => [], closeSessions() {}, state: () => ({}), stats: () => null,
      canAct: () => true, controlId: () => 'socket', location: () => ({ mapId: 'market', position: { x: 4.6, y: 0, z: -.5 } }), async stop() {},
    };
  };
  const logger = memoryLogger();
  app = await startApplication(config, createGame, logger);
  const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
  const base = `http://127.0.0.1:${address.port}`;
  const status = async () => (await (await fetch(base + '/api/operator/status')).json()) as { npc: string; language: string };
  expect(await status()).toMatchObject({ npc: initiallyReady ? 'ready' : 'unavailable', language: adapter === 'test' || initiallyReady ? 'ready' : 'unavailable' });
  expect(logger.records.some(r => r.event === 'language.ready')).toBe(adapter === 'test' || initiallyReady);
  expect(factory).toHaveBeenCalledTimes(1); expect(responder.start).toHaveBeenCalledTimes(1);
  if (adapter === 'test' || initiallyReady) {
    const login = await (await fetch(base + '/api/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Learner' }) })).json() as { token: string };
    let ids = 0;
    const call = async (action: BabylonAction) => {
      const response = await fetch(base + '/api/babylon', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` },
        body: JSON.stringify({ v: 2, requestId: `r${++ids}`, action }) });
      const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200); return body as BabylonResult;
    };
    await call({ type: 'enroll', size: 1, native: 'ru', learning: 'en' });
    await call({ type: 'npc', targetId: 'potter', text: 'hello' });
    const translation = await call({ type: 'suggest', word: 'goat' });
    if (adapter === 'local') {
      expect(translation.suggestion).toBe('ru:translation');
      expect(responder.answer.mock.calls[0]![0].locale).toBe('en'); expect(responder.translate).toHaveBeenCalledTimes(1);
      const verified = await deps.sessions.verify(login.token); if (!verified.ok || !verified.sessionId) throw new Error('Missing AUTH');
      const ordinary = await deps.npc.ask({ sessionId: verified.sessionId, authorize: () => deps.sessions.isActive!(verified.sessionId!, verified.identity.playerId),
        connectionId: 'ordinary', requestId: 'ordinary', player: verified.identity, npc: NPCS.potter!, question: 'hello' });
      expect(ordinary).toEqual({ ok: true, text: 'ru:answer' }); expect(responder.answer).toHaveBeenCalledTimes(2);
      healthy = false; expect((await status()).language).toBe('unavailable');
    } else {
      expect(translation.suggestion).toBe('коза'); expect(responder.answer).not.toHaveBeenCalled(); expect(responder.translate).not.toHaveBeenCalled();
    }
  }
  await app.stop(); await app.stop(); expect(responder.stop).toHaveBeenCalledTimes(1);
});
