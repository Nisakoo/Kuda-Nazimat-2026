import { PASTURE_ORIGIN } from '../../shared/city/catalogue.ts';
import { expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { createAuthService } from '../src/auth/AuthService.ts';
import { openDatabase, sqliteStores } from '../src/persistence/database.ts';
import { sqliteBabylon } from '../src/persistence/babylon.ts';
import { BabylonService } from '../src/babylon/BabylonService.ts';
import { testLanguagePort } from '../src/babylon/TestLanguagePort.ts';
import { createHttpServer } from '../src/http/server.ts';
import { parseConfig } from '../src/app/config.ts';
import { silentLogger } from '../src/common/logger.ts';
import type { GameRuntime } from '../src/contracts.ts';
import type { BabylonAction, BabylonFailure, BabylonResult } from '../../shared/babylon/types.ts';
import { testCertificate } from './tls-helpers.ts';

it.each(['captured socket', 'range', 'role'] as const)('actual HTTP rechecks %s after BabylonService resolves and before NPC delivery', async loss => {
  const db = openDatabase(':memory:'), stores = sqliteStores(db), clock = { now: Date.now };
  const auth = createAuthService({ ...stores, clock, ttlMs: 60000 });
  const session = await auth.guest('Owner'), partner = await auth.guest('Partner');
  const verified = await auth.verify(session.token); if (!verified.ok) throw new Error('Missing fixture session');
  let controlId = 'original-socket', location = { mapId: 'market', position: { x: -3, y: 0, z: PASTURE_ORIGIN.z + 6 } }, ids = 0;
  const game: GameRuntime = {
    maps: [], attach() {}, activePlayers: () => 1, presence: () => [], closeSessions() {}, state: () => ({}), stats: () => null,
    async stop() {}, worldFile: () => ({ ok: false }), canAct: () => true, controlId: () => controlId,
  };
  const store = sqliteBabylon(db), answer = vi.fn(testLanguagePort.answer);
  const babylon = new BabylonService({ store, language: { ...testLanguagePort, answer },
    generate: (_player, _connection, work) => work(new AbortController().signal, Date.now() + 8000).then(text => ({ ok: true, text })),
    now: Date.now, monotonicNow: () => performance.now(), id: () => `id${++ids}`, location: () => location,
  });
  const config = parseConfig({}, '/tmp/babylon-delivery/config.json', 'test');
  const { server } = createHttpServer(config, { auth, game, babylon, clock, logger: silentLogger, npcReady: () => true, certificate: await testCertificate() });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing HTTP listener');
  let requests = 0;
  const post = async (token: string, action: BabylonAction, requestId = `request${++requests}`) => {
    const response = await fetch(`https://127.0.0.1:${address.port}/api/babylon`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ v: 2, requestId, action }),
    });
    return { status: response.status, body: await response.json() as BabylonResult | BabylonFailure };
  };
  let wrapper: ReturnType<typeof vi.spyOn> | undefined;
  try {
    for (const c of [session, partner]) expect((await post(c.token, { type: 'enroll', size: 2, native: 'ru', learning: 'en' })).status).toBe(200);
    const original = babylon.handle.bind(babylon);
    wrapper = vi.spyOn(babylon, 'handle').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[1].action.type === 'npc') {
        // All service checks and persistence have finished. Mutation occurs before the HTTP await continuation.
        expect(result.state.replies).toHaveLength(1);
        if (loss === 'captured socket') controlId = 'replacement-socket';
        if (loss === 'range') location = { mapId: 'market', position: { x: 100, y: 0, z: 100 } };
        if (loss === 'role') {
          const profile = store.profile(verified.identity.playerId)!, party = store.party(profile.groupId!)!;
          party.members.find(m => m.id === verified.identity.playerId)!.role = 2; store.saveParty(party);
        }
      }
      return result;
    });
    const result = await post(session.token, { type: 'npc', targetId: 'shepherd', text: 'Which food?' }, 'npc');
    expect(result.status).toBe(loss === 'captured socket' ? 401 : 403);
    expect('state' in result.body).toBe(false); expect('error' in result.body).toBe(true);
    expect(answer).toHaveBeenCalledOnce();
    // The result was committed before access changed. Denying delivery must not erase it or change polling semantics.
    const polling = await post(session.token, { type: 'state' });
    expect(polling.status).toBe(200);
    expect('state' in polling.body && polling.body.state.replies).toHaveLength(1);
  } finally {
    wrapper?.mockRestore();
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
    db.close();
  }
});
