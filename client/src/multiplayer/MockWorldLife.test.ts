import { expect, it } from 'vitest';
import type { WorldLifeServerMessage } from '../../../shared/world-life/types.ts';
import { parseWorldLifeClientMessage, parseWorldLifeServerMessage } from '../../../shared/world-life/validate.ts';
import { MockNetworkAdapter } from './MockNetworkAdapter';
import { MockWorldLife } from './MockWorldLife';
import { TestClock } from './testClock';

it('uses the shared runtime shape for explicit mock pickup, one slot, rejection, place and repeat', () => {
  const clock = new TestClock();
  const actor = { id: 'mock-player', transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0 } };
  const backend = new MockWorldLife('demo', 0, actor.transform.position);
  const adapter = new MockNetworkAdapter(clock, undefined, (message, transport) => backend.receive(message, transport, actor, clock.now()));
  const received: WorldLifeServerMessage[] = []; adapter.subscribeWorldLife(message => { received.push(parseWorldLifeServerMessage(message)); });
  adapter.connect(); clock.advance(100);
  expect(adapter.sendWorldLife({ v: 1, type: 'scene-sync', requestId: 'offline' })).toBe(false);
  adapter.connect({ kind: 'mock' }); clock.advance(100);
  const pickup = parseWorldLifeClientMessage({ v: 1, type: 'hand', requestId: 'pickup', action: 'pickup', targetId: 'mock-apple-0' });
  expect(adapter.sendWorldLife(pickup)).toBe(true); clock.advance(100);
  expect(received[0]).toMatchObject({ type: 'hand-result', ok: true, action: 'pickup', apple: { state: 'held', holderId: actor.id } });
  adapter.sendWorldLife(pickup); clock.advance(100);
  expect(received.at(-1)).toMatchObject({ type: 'scene-state', revision: 1 });
  adapter.sendWorldLife({ v: 1, type: 'hand', requestId: 'another', action: 'pickup', targetId: 'mock-apple-1' }); clock.advance(100);
  expect(received.at(-2)).toMatchObject({ type: 'hand-result', ok: false, code: 'HANDS_FULL' });
  adapter.sendWorldLife({ v: 1, type: 'hand', requestId: 'place', action: 'place' }); clock.advance(100);
  expect(received.at(-2)).toMatchObject({ type: 'hand-result', ok: true, action: 'place' });
  const state = received.at(-1);
  expect(state?.type === 'scene-state' && state.apples.filter(apple => apple.state === 'held')).toEqual([]);
  adapter.sendWorldLife(pickup); clock.advance(100);
  // Historical success must not alter the current authoritative mock state.
  expect(received.at(-2)).toMatchObject({ ok: true, action: 'pickup', apple: { state: 'held' } });
  expect(received.at(-1)).toMatchObject({ type: 'scene-state', revision: 2 });
  adapter.drop(); adapter.connect({ kind: 'mock' }); clock.advance(100);
  adapter.sendWorldLife({ v: 1, type: 'scene-sync', requestId: 'resync' }); clock.advance(100);
  expect(received.at(-1)).toMatchObject({ type: 'scene-state', revision: 2 });
  expect(() => adapter.sendWorldLife({ v: 1, type: 'hand', requestId: 'bad', action: 'place', position: { x: 0, y: 0, z: 0 } } as never)).toThrow();
  adapter.dispose(); expect(clock.pending).toBe(0);
});

it('reports malformed mock world-life state instead of accepting a hidden fallback', () => {
  const clock = new TestClock(); const adapter = new MockNetworkAdapter(clock);
  adapter.connect({ kind: 'mock' }); clock.advance(100);
  adapter.receiveWorldLife({ v: 3, type: 'scene-state' });
  expect(adapter.state.status).toBe('error');
  adapter.dispose();
});
