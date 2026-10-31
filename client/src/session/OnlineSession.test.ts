import { expect, it, vi } from 'vitest';
import type { Entity } from '../core/types';
import type { ClientMessage } from '../shared/protocol/types';
import { MockNetworkAdapter } from '../multiplayer/MockNetworkAdapter';
import { TestClock } from '../multiplayer/testClock';
import { OnlineSession } from './OnlineSession';

const player = (id: string, x = 0): Entity => ({ id, character: { kind: 'player', name: id }, transform: { position: { x, y: 0, z: 0 }, rotationY: 0 }, movement: { direction: { x: 0, z: 0 }, speed: 3 } });
const world = { manifestUrl: 'manifest.json', manifestBytes: 100, worldBytes: 1000000, assets: {} };
function setup() {
  const clock = new TestClock(); const sent: ClientMessage[] = [];
  const adapter = new MockNetworkAdapter(clock, (message, transport) => {
    sent.push(message);
    if (message.type === 'join') transport.receive({ v: 1, type: 'joined', requestId: message.requestId, playerId: 'p1', revision: 0, snapshot: { tick: 0, entities: [player('p1'), player('p2')] }, world });
  });
  const session = new OnlineSession(adapter, 'demo', clock); const notices = vi.fn(); session.subscribeNotices(notices);
  session.connect({ kind: 'mock' }); clock.advance(100);
  return { clock, adapter, session, sent, notices };
}
it('sends bounded intentions, gates unprepared movement and never assigns local authoritative positions', () => {
  const s = setup();
  expect(s.session.playerId).toBe('p1'); expect(s.session.state.status).toBe('connected');
  s.session.setMovementGuard(() => false); s.session.setPreparedChunks(['0_0']);
  s.session.send({ type: 'move', direction: { x: 1, z: 0 } });
  for (let i = 0; i < 30; i++) { s.session.update(1 / 60); s.clock.advance(17); }
  let inputs = s.sent.filter((message) => message.type === 'input');
  expect(inputs.length).toBeLessThanOrEqual(11);
  expect(inputs.at(-1)).toMatchObject({ direction: { x: 0, z: 0 }, preparedChunks: ['0_0'] });
  s.session.setMovementGuard(() => true); s.session.update(0.05); s.clock.advance(100);
  inputs = s.sent.filter((message) => message.type === 'input');
  expect(inputs.at(-1)).toMatchObject({ direction: { x: 1, z: 0 } });
  expect(s.session.getSnapshot().entities[0]!.transform!.position.x).toBe(0);
  s.session.send({ type: 'move', direction: { x: 0, z: 0 } }); s.clock.advance(100);
  expect(s.sent.at(-1)).toMatchObject({ direction: { x: 0, z: 0 } }); // still stops when update is paused
  s.session.dispose(); expect(s.clock.pending).toBe(0);
});
it('drops stale deltas, requests resync after a gap and interpolates remote data independently', () => {
  const s = setup();
  s.adapter.receive({ v: 1, type: 'delta', baseRevision: 0, revision: 1, tick: 1, upsert: [player('p2', 10)], remove: [] }); s.clock.advance(50);
  const visual = s.session.getRenderState();
  expect(s.session.getSnapshot().entities.find((e) => e.id === 'p2')!.transform!.position.x).toBe(10);
  expect(visual.alpha).toBeLessThan(1);
  s.adapter.receive({ v: 1, type: 'delta', baseRevision: 0, revision: 1, tick: 0, upsert: [player('p2', 99)], remove: [] }); s.clock.advance(0);
  expect(s.session.getSnapshot().tick).toBe(1);
  s.adapter.receive({ v: 1, type: 'delta', baseRevision: 2, revision: 3, tick: 3, upsert: [], remove: [] }); s.clock.advance(50);
  expect(s.sent.at(-1)?.type).toBe('resync');
  s.adapter.receive({ v: 1, type: 'snapshot', revision: 3, snapshot: { tick: 3, entities: [player('p1', 2), player('p2', 20)] } }); s.clock.advance(0);
  expect(s.session.getSnapshot().tick).toBe(3); s.session.dispose();
});
it('correlates NPC replies, deduplicates chat, times out failures and discards actions on reconnect', () => {
  const s = setup();
  const requestId = s.session.askNpc('guide', 'Вопрос'); s.clock.advance(50);
  s.adapter.receive({ v: 1, type: 'npc-answer', requestId, targetId: 'other', text: 'wrong' }); s.clock.advance(0);
  expect(s.notices).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'npc' }));
  s.adapter.receive({ v: 1, type: 'npc-answer', requestId, targetId: 'guide', text: 'answer' }); s.clock.advance(0);
  expect(s.notices).toHaveBeenCalledWith(expect.objectContaining({ type: 'npc', text: 'answer' }));
  const chat = { v: 1, type: 'chat', requestId: 'remote', messageId: 'm1', playerId: 'p2', name: 'Peer', text: '<script>test</script>' };
  s.adapter.receive(chat); s.adapter.receive(chat); s.clock.advance(0);
  expect(s.notices.mock.calls.filter(([notice]) => notice.type === 'chat')).toHaveLength(1);
  s.session.chat('no reply'); s.clock.advance(10001);
  expect(s.notices).toHaveBeenCalledWith(expect.objectContaining({ type: 'request-error', message: expect.stringContaining('10 секунд') }));
  s.session.chat('pending'); s.adapter.drop(); s.clock.advance(1000); s.session.reconnect(); s.clock.advance(100);
  expect(s.sent.filter((message) => message.type === 'chat-send' && message.text === 'pending')).toHaveLength(0);
  expect(s.session.state.status).toBe('connected'); s.session.dispose(); expect(s.clock.pending).toBe(0);
});
