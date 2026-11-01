import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { io } from 'socket.io-client';
import { attachGateway } from '../src/realtime/gateway.ts';
import type { GameService } from '../src/game/GameService.ts';
import type { NpcQuestion, PlayerIdentity } from '../src/contracts.ts';
import type { ServerMessage } from '../../shared/protocol/types.ts';
import type { TimerHandle } from '../src/common/time.ts';
import { silentLogger } from '../src/common/logger.ts';
import { answerRequest } from './responderContract.ts';

it.each(['AUTH', 'control', 'range'] as const)('gateway rechecks %s at delayed partial flush and terminal delivery', async loss => {
  const identity: PlayerIdentity = { accountId: 'a', playerId: 'p', displayName: 'Player' };
  let active = true, controlling = true, near = true;
  const timers = new Map<TimerHandle, { ms: number; callback(): void }>();
  let partial!: (text: string) => void, finish!: (answer: { ok: true; text: string }) => void, asked!: NpcQuestion;
  const game = {
    canAdmit: () => true, attach: () => true, detach() {}, identityOf: () => identity,
    isControlling: () => controlling,
    interact: () => near ? { ok: true, npc: answerRequest().npc } : { ok: false, reason: 'too-far' },
  } as unknown as GameService;
  const server = createServer();
  const gateway = attachGateway(server, { game, sessions: {
    verify: async () => ({ ok: true, identity, sessionId: 'verified-auth-id', expiresAt: Date.now() + 100000 }),
    isActive: (id, playerId) => active && id === 'verified-auth-id' && playerId === 'p',
  }, npc: {
    ask(q, onPartial) { asked = q; partial = onPartial!; return new Promise(resolve => { finish = resolve; }); },
    cancel() {}, cancelConnection() {},
  }, clock: { now: Date.now }, scheduler: {
    setTimeout(callback, ms) { const handle = {} as TimerHandle; timers.set(handle, { ms, callback }); return handle; },
    clearTimeout(handle) { timers.delete(handle); },
  }, logger: silentLogger, corsOrigins: [] });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No listener');
  const socket = io(`http://127.0.0.1:${address.port}/game`, { auth: { version: 3, token: 'only-auth-input' }, transports: ['websocket'], reconnection: false, autoConnect: false });
  const packets: ServerMessage[] = []; socket.on('game', packet => packets.push(packet));
  try {
    const connected = new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); socket.connect(); await connected;
    socket.emit('game', { v: 3, type: 'npc-question', requestId: 'question', targetId: 'n', text: 'hello', stream: true });
    await expect.poll(() => partial).toBeDefined();
    expect(asked.sessionId).toBe('verified-auth-id'); expect(asked.authorize()).toBe(true);
    partial('first'); await expect.poll(() => packets.filter(p => p.type === 'npc-partial').length).toBe(1);
    partial('pending must not escape');
    if (loss === 'AUTH') active = false;
    if (loss === 'control') controlling = false;
    if (loss === 'range') near = false;
    expect(asked.authorize()).toBe(false);
    const flush = [...timers.values()].find(timer => timer.ms === 100); expect(flush).toBeDefined(); flush!.callback();
    finish({ ok: true, text: 'late terminal must not escape' });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(packets.filter(p => p.type === 'npc-partial').map(p => p.type === 'npc-partial' && p.text)).toEqual(['first']);
    expect(packets.some(p => p.type === 'npc-answer')).toBe(false);
  } finally { socket.disconnect(); await gateway.close(); server.close(); }
});
