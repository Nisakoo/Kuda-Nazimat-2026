import { expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import { SocketIOAdapter } from './SocketIOAdapter';
import { TestClock } from './testClock';

function setup() {
  const handlers = new Map<string, (...args: never[]) => void>();
  const socket = { connected: true, sendBuffer: [] as unknown[], volatile: { emit: vi.fn() }, on: vi.fn((event: string, callback: (...args: never[]) => void) => handlers.set(event, callback)), removeAllListeners: vi.fn(() => handlers.clear()), disconnect: vi.fn(), connect: vi.fn(), emit: vi.fn() };
  const factory = vi.fn(() => socket as unknown as Socket);
  const clock = new TestClock();
  const adapter = new SocketIOAdapter('http://school.local/app', clock, factory);
  const context = { kind: 'server' as const, session: { token: 'server-session-opaque', expiresAt: clock.now() + 100000 } };
  const trigger = (event: string, data?: unknown) => (handlers.get(event) as ((value?: unknown) => void) | undefined)?.(data);
  return { adapter, factory, socket, clock, context, trigger };
}
it('never constructs a real transport before valid server authorization', () => {
  const s = setup();
  s.adapter.connect(); s.adapter.connect({ kind: 'mock' });
  s.adapter.connect({ ...s.context, session: { ...s.context.session, expiresAt: 0 } });
  expect(s.factory).not.toHaveBeenCalled();
  s.adapter.connect(s.context);
  expect(s.factory).toHaveBeenCalledWith('http://school.local/game', expect.objectContaining({ path: '/app/socket.io', autoConnect: false, reconnection: false, auth: { version: 3, token: s.context.session.token } }));
  s.trigger('connect');
  expect(s.adapter.state.status).toBe('connected');
  s.adapter.send({ v: 3, type: 'join', requestId: 'r1', mapId: 'demo' });
  expect(s.socket.emit).toHaveBeenCalledOnce();
  s.adapter.send({ v: 3, type: 'input', sprint: false, jumpId: 0, requestId: 'i1', sequence: 1, direction: { x: 0, z: 0 }, preparedChunks: [] });
  expect(s.socket.volatile.emit).toHaveBeenCalledOnce();
  s.socket.connected = false;
  expect(s.adapter.send({ v: 3, type: 'join', requestId: 'r2', mapId: 'demo' })).toBe(false);
  s.adapter.dispose(); expect(s.clock.pending).toBe(0);
});
it('validates the separate authorized world-life channel and never retains hand actions offline', () => {
  const s = setup(); const listener = vi.fn(); s.adapter.subscribeWorldLife(listener);
  expect(s.adapter.sendWorldLife({ v: 1, type: 'scene-sync', requestId: 'offline' })).toBe(false);
  s.adapter.connect(s.context); s.trigger('connect');
  const packet = { v: 1 as const, type: 'hand' as const, requestId: 'h1', action: 'pickup' as const, targetId: 'apple-1' };
  expect(s.adapter.sendWorldLife(packet)).toBe(true);
  expect(s.socket.emit).toHaveBeenCalledWith('world-life', packet);
  const rejection = { v: 1, type: 'hand-result', requestId: 'h1', ok: false, code: 'BLOCKED', message: 'Место занято.' };
  s.trigger('world-life', rejection); expect(listener).toHaveBeenCalledWith(rejection);
  s.socket.emit.mockImplementation(() => { s.socket.sendBuffer.push(packet); });
  expect(s.adapter.sendWorldLife(packet)).toBe(false); expect(s.socket.sendBuffer).toEqual([]);
  s.socket.connected = false; expect(s.adapter.sendWorldLife(packet)).toBe(false);
  s.trigger('world-life', { ...rejection, hidden: true }); expect(s.adapter.state.status).toBe('error');
  expect(s.socket.removeAllListeners).toHaveBeenCalled(); s.adapter.dispose(); expect(s.clock.pending).toBe(0);
});

it('bounds retry frequency and stops timers and subscribers on disposal', () => {
  const s = setup(); const listener = vi.fn(); s.adapter.subscribeState(listener);
  s.adapter.connect(s.context);
  for (const delay of [1000, 2000, 4000]) {
    const calls = s.socket.connect.mock.calls.length;
    s.trigger('connect_error', new Error('offline')); s.trigger('connect_error', new Error('offline'));
    s.clock.advance(delay - 1); expect(s.socket.connect).toHaveBeenCalledTimes(calls);
    s.clock.advance(1); expect(s.socket.connect).toHaveBeenCalledTimes(calls + 1);
  }
  s.trigger('connect_error', new Error('offline'));
  expect(s.adapter.state.status).toBe('error');
  s.clock.advance(10000); expect(s.socket.connect).toHaveBeenCalledTimes(4);
  s.adapter.dispose(); const calls = listener.mock.calls.length;
  s.clock.advance(100000); expect(s.clock.pending).toBe(0); expect(listener).toHaveBeenCalledTimes(calls);
});
it('treats authorization rejection, expiry and incompatible packets as terminal', () => {
  for (const reason of ['auth', 'expiry', 'version']) {
    const s = setup(); s.adapter.connect(s.context);
    if (reason === 'auth') s.trigger('connect_error', { data: { code: 'UNAUTHORIZED' } });
    if (reason === 'expiry') s.clock.advance(100000);
    if (reason === 'version') { s.trigger('connect'); s.trigger('game', { v: 2, type: 'snapshot' }); }
    expect(s.adapter.state.status).toBe(reason === 'version' ? 'error' : 'unauthorized');
    const calls = s.socket.connect.mock.calls.length;
    s.clock.advance(100000); expect(s.socket.connect).toHaveBeenCalledTimes(calls);
    expect(s.clock.pending).toBe(0); s.adapter.dispose();
  }
});

it('preserves the takeover reason and never retries a rejected session', () => {
  const s = setup(); s.adapter.connect(s.context); s.trigger('connect');
  s.trigger('game', { v: 3, type: 'error', requestId: 'server', code: 'UNAUTHORIZED', message: 'Игра открыта в другом окне.' });
  expect(s.adapter.state).toEqual({ status: 'unauthorized', error: 'Игра открыта в другом окне.' });
  s.clock.advance(10000); expect(s.socket.connect).toHaveBeenCalledOnce(); s.adapter.dispose();
});

it('drops a packet queued by Socket.IO after ping expiry instead of replaying it', () => {
  const s = setup(); s.adapter.connect(s.context); s.trigger('connect');
  s.socket.emit.mockImplementation(() => { s.socket.sendBuffer.push({ type: 'chat-send' }); });
  expect(s.adapter.send({ v: 3, type: 'chat-send', requestId: 'r', text: 'Не повторять' })).toBe(false);
  expect(s.socket.sendBuffer).toEqual([]); s.adapter.dispose();
});
