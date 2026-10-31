import { expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import { SocketIOAdapter } from './SocketIOAdapter';
import { TestClock } from './testClock';

function setup() {
  const handlers = new Map<string, (...args: never[]) => void>();
  const socket = { connected: true, volatile: { emit: vi.fn() }, on: vi.fn((event: string, callback: (...args: never[]) => void) => handlers.set(event, callback)), removeAllListeners: vi.fn(() => handlers.clear()), disconnect: vi.fn(), connect: vi.fn(), emit: vi.fn() };
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
  expect(s.factory).toHaveBeenCalledWith('http://school.local/game', expect.objectContaining({ path: '/app/socket.io', autoConnect: false, reconnection: false, auth: { version: 1, token: s.context.session.token } }));
  s.trigger('connect');
  expect(s.adapter.state.status).toBe('connected');
  s.adapter.send({ v: 1, type: 'join', requestId: 'r1', mapId: 'demo' });
  expect(s.socket.volatile.emit).toHaveBeenCalledOnce();
  s.socket.connected = false;
  expect(s.adapter.send({ v: 1, type: 'join', requestId: 'r2', mapId: 'demo' })).toBe(false);
  s.adapter.dispose(); expect(s.clock.pending).toBe(0);
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
