import { expect, it, vi } from 'vitest';
import { initialMotion, motionStatus } from '../../../shared/movement/simulation.ts';
import type { ClientMessage } from '../../../shared/protocol/types.ts';
import type { SceneStateMessage, WorldLifeClientMessage } from '../../../shared/world-life/types.ts';
import { MockNetworkAdapter } from '../multiplayer/MockNetworkAdapter';
import { MockWorldLife } from '../multiplayer/MockWorldLife';
import { TestClock } from '../multiplayer/testClock';
import { OnlineSession } from './OnlineSession';

function setup() {
  const clock = new TestClock();
  const sent: WorldLifeClientMessage[] = []; const game: ClientMessage[] = [];
  const actor = { id: 'p1', motion: motionStatus(initialMotion({ x: 0, y: 0, z: 0 })), transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0 }, character: { kind: 'player' as const, name: 'P1' } };
  const adapter = new MockNetworkAdapter(clock, (message, peer) => {
    game.push(message);
    if (message.type === 'join') peer.receive({ v: 3, type: 'joined', requestId: message.requestId, playerId: actor.id, revision: 0, snapshot: { tick: 0, entities: [actor] }, world: { manifestUrl: 'manifest.json', manifestBytes: 1, worldBytes: 100, assets: {} } });
  }, message => { sent.push(message); });
  const scene = new MockWorldLife('demo', 0, actor.transform.position).snapshot(100);
  const session = new OnlineSession(adapter, 'demo', clock);
  const notices = vi.fn(); session.subscribeNotices(notices);
  session.connect({ kind: 'mock' }); clock.advance(100);
  const deliver = (state: SceneStateMessage = scene) => { adapter.receiveWorldLife(state); clock.advance(0); };
  return { clock, sent, game, adapter, scene, session, notices, deliver };
}

it('sends one nearest pickup intention on the separate channel and never changes hands optimistically', () => {
  const s = setup();
  expect(s.session.carry()).toBeNull();
  s.deliver();
  expect(s.session.carryState).toMatchObject({ heldItemId: null, hint: 'Поднять яблоко' });
  const requestId = s.session.carry();
  expect(requestId).toBeTruthy(); expect(s.session.carry()).toBeNull();
  expect(s.session.carryState).toMatchObject({ pending: true, heldItemId: null });
  s.clock.advance(50);
  expect(s.sent.filter(message => message.type === 'hand')).toEqual([{ v: 1, type: 'hand', action: 'pickup', targetId: 'mock-apple-0', requestId }]);
  expect(s.game.some(message => (message.type as string) === 'hand')).toBe(false);
  // Wrong correlation and wrong target must not finish the pending action.
  s.adapter.receiveWorldLife({ v: 1, type: 'hand-result', requestId: 'other', ok: false, code: 'BLOCKED', message: 'wrong' });
  s.adapter.receiveWorldLife({ v: 1, type: 'hand-result', requestId, ok: true, action: 'pickup', apple: { id: 'mock-apple-1', mapId: 'demo', state: 'held', holderId: 'p1' } });
  s.clock.advance(0); expect(s.session.carryState.pending).toBe(true);
  s.adapter.receiveWorldLife({ v: 1, type: 'hand-result', requestId, ok: true, action: 'pickup', apple: { id: 'mock-apple-0', mapId: 'demo', state: 'held', holderId: 'p1' } });
  s.clock.advance(0);
  expect(s.session.carryState).toMatchObject({ pending: false, heldItemId: null });
  const held: SceneStateMessage = { ...s.scene, revision: 1, serverTimeMs: 200, apples: s.scene.apples.map(apple => apple.id === 'mock-apple-0' ? { id: apple.id, mapId: 'demo', state: 'held', holderId: 'p1' } : apple) };
  s.deliver(held);
  expect(s.session.carryState).toMatchObject({ heldItemId: 'mock-apple-0', hint: 'Положить яблоко' });
  const placeId = s.session.carry(); s.clock.advance(50);
  expect(s.sent.filter(message => message.type === 'hand').at(-1)).toEqual({ v: 1, type: 'hand', action: 'place', requestId: placeId });
  s.adapter.receiveWorldLife({ v: 1, type: 'hand-result', requestId: placeId, ok: false, code: 'BLOCKED', message: 'Место занято.' }); s.clock.advance(0);
  expect(s.session.carryState).toMatchObject({ pending: false, heldItemId: 'mock-apple-0', error: 'Место занято.' });
  s.session.dispose(); expect(s.clock.pending).toBe(0);
});

it('retains authoritative scene state across movement and ignores stale states and receipts', () => {
  const s = setup(); s.deliver();
  const updated = { ...s.scene, revision: 2, serverTimeMs: 200, pots: s.scene.pots.map((pot, i) => i ? pot : { ...pot, position: { ...pot.position, x: pot.position.x + .2 } }) };
  s.deliver(updated); s.deliver();
  expect(s.session.worldLife).toEqual(updated);
  s.adapter.receive({ v: 3, type: 'delta', baseRevision: 0, revision: 1, tick: 1, upsert: [], remove: [] }); s.clock.advance(0); s.session.update(.05);
  expect(s.session.worldLife).toEqual(updated);
  s.adapter.receiveWorldLife({ v: 1, type: 'hand-result', requestId: 'old', ok: true, action: 'place', apple: s.scene.apples[0] }); s.clock.advance(0);
  expect(s.session.worldLife).toEqual(updated);
  const restart = { ...s.scene, sceneId: 'new-process', revision: 0, serverTimeMs: 300 };
  s.deliver(restart); expect(s.session.worldLife).toEqual(restart);
  s.session.dispose();
});

it('times out without replay, clears on disconnect, and uses distinct durable IDs after a new session', () => {
  const s = setup(); s.deliver(); const firstId = s.session.carry(); s.clock.advance(10001);
  expect(s.session.carryState).toMatchObject({ pending: false, error: expect.stringContaining('10 секунд'), heldItemId: null });
  expect(s.sent.filter(message => message.type === 'hand')).toHaveLength(1);
  s.session.carry(); s.adapter.drop(); s.clock.advance(100);
  expect(s.session.carryState).toMatchObject({ pending: false, hint: null, heldItemId: null });
  s.session.reconnect(); s.clock.advance(100); s.deliver();
  const nextId = s.session.carry(); expect(nextId).not.toBe(firstId);
  s.session.dispose(); expect(s.clock.pending).toBe(0);
  const other = setup(); other.deliver(); expect(other.session.carry()).not.toBe(firstId); other.session.dispose();
});

it('uses the existing path boundary for the pickup hint without changing MOVE controls', () => {
  const s = setup(); s.deliver(); s.session.setMovementGuard(() => true, () => false);
  expect(s.session.carryState.hint).toBeNull(); expect(s.session.carry()).toBeNull();
  s.session.setMovementGuard(() => true, () => true);
  s.session.carry(); s.session.send({ type: 'sprint', held: true }); s.session.send({ type: 'jump' }); s.session.send({ type: 'move', direction: { x: 1, z: 0 } });
  s.session.update(.05); s.clock.advance(100);
  expect(s.game.filter(message => message.type === 'input').at(-1)).toMatchObject({ direction: { x: 1, z: 0 }, sprint: true, jumpId: 1 });
  s.session.dispose();
});
