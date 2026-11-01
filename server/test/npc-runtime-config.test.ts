import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { createHttpServer } from '../src/http/server.ts';
import { parseConfig } from '../src/app/config.ts';
import { createAuthService } from '../src/auth/AuthService.ts';
import { silentLogger } from '../src/common/logger.ts';
import { memoryStores } from './memory.ts';
import type { GameRuntime } from '../src/contracts.ts';
import { NPC_TIMING, npcRequestWaitMs, parseGameRuntimeConfig, validNpcTimeoutMs } from '../../shared/protocol/npcTiming.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

it('validates the small public timing contract without admitting server-only fields', () => {
  for (const npcTimeoutMs of [1, 2000, 30000, 60000, 300000]) {
    expect(parseGameRuntimeConfig({ npcTimeoutMs })).toEqual({ npcTimeoutMs });
    expect(npcRequestWaitMs(npcTimeoutMs)).toBe(npcTimeoutMs + 2000);
  }
  for (const raw of [null, [], {}, { npcTimeoutMs: 300001 }, { npcTimeoutMs: 0 }, { npcTimeoutMs: 1.5 },
    { npcTimeoutMs: '60000' }, { npcTimeoutMs: NaN }, { npcTimeoutMs: Infinity }, { npcTimeoutMs: 60000, options: {} }]) {
    expect(() => parseGameRuntimeConfig(raw)).toThrow();
  }
  expect(validNpcTimeoutMs(-1)).toBe(false); expect(() => npcRequestWaitMs(300001)).toThrow();
  expect(NPC_TIMING.defaultMs).toBe(30000);
});

it('publishes only the effective NPC timeout with no-store and existing CORS rules, without auth or inference', async () => {
  const config = parseConfig({ npc: { timeoutMs: 60000, options: { privatePath: '/private/weights', modelDigest: 'secret-digest' } },
    corsOrigins: ['http://school-client.local'] }, '/tmp/game.json');
  const stores = memoryStores(); const auth = createAuthService(stores.accounts, stores.sessions, { now: () => 1 }, 1000);
  const game: GameRuntime = { maps: [], attach() {}, activePlayers: () => 0, async stop() {}, worldFile: () => ({ ok: false }) };
  const http = createHttpServer(config, { auth, game, npcReady: () => false, logger: silentLogger });
  http.server.listen(0, '127.0.0.1'); await once(http.server, 'listening');
  cleanup.push(async () => { http.server.closeAllConnections(); await new Promise<void>(resolve => http.server.close(() => resolve())); });
  const address = http.server.address();
  if (!address || typeof address === 'string') throw new Error('fixture address');
  const url = `http://127.0.0.1:${address.port}/api/game-config`;
  const response = await fetch(url, { headers: { Origin: 'http://school-client.local' } });
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://school-client.local');
  const text = await response.text(); expect(JSON.parse(text)).toEqual({ npcTimeoutMs: 60000 });
  expect(text).not.toMatch(/options|privatePath|weights|modelDigest|secret-digest/);
  expect(parseGameRuntimeConfig(JSON.parse(text)).npcTimeoutMs).toBe(config.npc.timeoutMs);
  expect((await fetch(url, { headers: { Origin: 'http://untrusted.local' } })).headers.get('Access-Control-Allow-Origin')).toBeNull();
  expect((await fetch(url, { method: 'POST' })).status).toBe(404);
  http.rejectNewRequests(); expect((await fetch(url)).status).toBe(503);
});
