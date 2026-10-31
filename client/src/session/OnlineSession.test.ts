import { initialMotion, motionStatus } from '../../../shared/movement/simulation.ts';
import { expect, it, vi } from 'vitest';
import type { Entity } from '../core/types';
import type { ClientMessage } from '../../../shared/protocol/types.ts';
import { MockNetworkAdapter } from '../multiplayer/MockNetworkAdapter';
import { TestClock } from '../multiplayer/testClock';
import { OnlineSession } from './OnlineSession';

const player = (id: string, x = 0): Entity => ({ id, motion: motionStatus(initialMotion({ x, y: 0, z: 0 })), character: { kind: 'player', name: id }, transform: { position: { x, y: 0, z: 0 }, rotationY: 0 }, movement: { direction: { x: 0, z: 0 }, speed: 3 } });
const world = { manifestUrl: 'manifest.json', manifestBytes: 100, worldBytes: 1000000, assets: {} };
function setup() {
  const clock = new TestClock(); const sent: ClientMessage[] = [];
  const adapter = new MockNetworkAdapter(clock, (message, transport) => {
    sent.push(message);
    if (message.type === 'join') transport.receive({ v: 3, type: 'joined', requestId: message.requestId, playerId: 'p1', revision: 0, snapshot: { tick: 0, entities: [player('p1'), player('p2'), player('p3')] }, world });
  });
  const session = new OnlineSession(adapter, 'demo', clock); const notices = vi.fn(); session.subscribeNotices(notices);
  session.connect({ kind: 'mock' }); clock.advance(100);
  return { clock, adapter, session, sent, notices };
}
it('MOVE-012: sends a diagonal intention when its tangent is ready', () => {
  const s = setup();
  s.session.setMovementGuard(position => position.x <= 0);
  s.session.send({ type: 'move', direction: { x: 1, z: 1 } });
  s.session.update(.05); s.clock.advance(100);
  expect(s.sent.filter(message => message.type === 'input').at(-1)).toMatchObject({ direction: { x: expect.closeTo(Math.SQRT1_2), z: expect.closeTo(Math.SQRT1_2) } });
  s.session.dispose();
});
it('retains a short Space between sends, retransmits its ID, clears without ID reuse and never replays after reconnect', () => {
  const s = setup();
  s.session.send({ type: 'jump' }); s.session.send({ type: 'sprint', held: true }); s.clock.advance(100);
  expect(s.sent.filter(m => m.type === 'input').at(-1)).toMatchObject({ jumpId: 1, sprint: true });
  s.session.update(.05); s.clock.advance(100);
  expect(s.sent.filter(m => m.type === 'input').at(-1)).toMatchObject({ jumpId: 1 });
  s.session.send({ type: 'clear-input' }); s.clock.advance(100);
  expect(s.sent.filter(m => m.type === 'input').at(-1)).toMatchObject({ jumpId: 0, sprint: false });
  s.session.send({ type: 'jump' }); s.session.update(.05); s.clock.advance(100);
  expect(s.sent.filter(m => m.type === 'input').at(-1)).toMatchObject({ jumpId: 2 });
  s.adapter.drop(); s.session.reconnect(); s.clock.advance(100); s.session.update(.05); s.clock.advance(100);
  expect(s.sent.filter(m => m.type === 'input').at(-1)).toMatchObject({ jumpId: 0, sprint: false });
  s.session.dispose();
});
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
  s.adapter.receive({ v: 3, type: 'delta', baseRevision: 0, revision: 1, tick: 1, upsert: [player('p2', 10), player('p3', -10)], remove: [] }); s.clock.advance(50);
  expect(s.session.getSnapshot().tick).toBe(0);
  s.session.update(1 / 60);
  const visual = s.session.getRenderState();
  expect(s.session.getSnapshot().entities.find((e) => e.id === 'p2')!.transform!.position.x).toBe(10);
  expect(visual.alpha).toBeLessThan(1);
  expect(visual.previous.entities.find((e) => e.id === 'p3')!.transform!.position.x).toBe(0);
  expect(visual.current.entities.find((e) => e.id === 'p3')!.transform!.position.x).toBe(-10);
  s.adapter.receive({ v: 3, type: 'delta', baseRevision: 0, revision: 1, tick: 0, upsert: [player('p2', 99)], remove: [] }); s.clock.advance(0);
  s.session.update(1 / 60);
  expect(s.session.getSnapshot().tick).toBe(1);
  s.adapter.receive({ v: 3, type: 'delta', baseRevision: 2, revision: 3, tick: 3, upsert: [], remove: [] }); s.clock.advance(50);
  s.session.update(1 / 60); s.clock.advance(50);
  expect(s.sent.at(-1)?.type).toBe('resync');
  s.adapter.receive({ v: 3, type: 'snapshot', revision: 3, snapshot: { tick: 3, entities: [player('p1', 2), player('p2', 20)] } }); s.clock.advance(0);
  s.session.update(1 / 60);
  expect(s.session.getSnapshot().tick).toBe(3); s.session.dispose();
});
it('bounds incoming updates while paused and resynchronizes instead of replaying an overflow', () => {
  const s = setup();
  for (let i = 1; i <= 100; i++) s.adapter.receive({ v: 3, type: 'delta', baseRevision: i - 1, revision: i, tick: i, upsert: [player('p2', i)], remove: [] });
  s.clock.advance(0);
  expect(s.session.getSnapshot().tick).toBe(0);
  s.session.update(1 / 60); s.clock.advance(50);
  expect(s.sent.at(-1)?.type).toBe('resync');
  expect(s.session.getSnapshot().tick).toBe(0);
  s.session.dispose(); expect(s.clock.pending).toBe(0);
});
it('correlates NPC replies, deduplicates chat, times out failures and discards actions on reconnect', () => {
  const s = setup();
  const requestId = s.session.askNpc('guide', 'Вопрос'); s.clock.advance(50);
  s.adapter.receive({ v: 3, type: 'npc-answer', requestId, targetId: 'other', text: 'wrong' }); s.clock.advance(0);
  expect(s.notices).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'npc' }));
  s.adapter.receive({ v: 3, type: 'npc-answer', requestId, targetId: 'guide', text: 'answer' }); s.clock.advance(0);
  expect(s.notices).toHaveBeenCalledWith(expect.objectContaining({ type: 'npc', text: 'answer' }));
  const chat = { v: 3, type: 'chat', requestId: 'remote', messageId: 'm1', playerId: 'p2', name: 'Peer', text: '<script>test</script>' };
  s.adapter.receive(chat); s.adapter.receive(chat); s.clock.advance(0);
  expect(s.notices.mock.calls.filter(([notice]) => notice.type === 'chat')).toHaveLength(1);
  s.session.chat('no reply'); s.clock.advance(10001);
  expect(s.notices).toHaveBeenCalledWith(expect.objectContaining({ type: 'request-error', message: expect.stringContaining('10 секунд') }));
  s.session.chat('pending'); s.adapter.drop(); s.clock.advance(1000); s.session.reconnect(); s.clock.advance(100);
  expect(s.sent.filter((message) => message.type === 'chat-send' && message.text === 'pending')).toHaveLength(0);
  expect(s.session.state.status).toBe('connected'); s.session.dispose(); expect(s.clock.pending).toBe(0);
});
it('delivers one text message to two independent sessions over a controlled test network', () => {
  const clock = new TestClock(); const peers: MockNetworkAdapter[] = []; let messageCount = 0;
  const sessions = ['p1', 'p2'].map((id) => {
    const adapter = new MockNetworkAdapter(clock, (message, sender) => {
      if (message.type === 'join') sender.receive({ v: 3, type: 'joined', requestId: message.requestId, playerId: id, revision: 0, snapshot: { tick: 0, entities: [player('p1'), player('p2')] }, world });
      if (message.type === 'chat-send') for (const peer of peers) peer.receive({ v: 3, type: 'chat', requestId: message.requestId, messageId: `m${++messageCount}`, playerId: id, name: id, text: message.text });
    });
    peers.push(adapter); return new OnlineSession(adapter, 'demo', clock);
  });
  const first = vi.fn(); const second = vi.fn(); sessions[0]!.subscribeNotices(first); sessions[1]!.subscribeNotices(second);
  for (const session of sessions) session.connect({ kind: 'mock' }); clock.advance(100);
  sessions[0]!.chat('Привет <b>мир</b>'); clock.advance(100);
  for (const listener of [first, second]) expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat', message: expect.objectContaining({ playerId: 'p1', text: 'Привет <b>мир</b>' }) }));
  for (const session of sessions) session.dispose(); expect(clock.pending).toBe(0);
});

it('smooths the camera-followed player between network updates without changing authority or extrapolating', () => {
  const s = setup();
  s.clock.advance(40);
  s.adapter.receive({ v: 3, type: 'delta', baseRevision: 0, revision: 1, tick: 2, upsert: [player('p1', 0.5)], remove: [] });
  s.clock.advance(0); s.session.update(1 / 60);
  const renderedX = () => {
    const { previous, current, alpha } = s.session.getRenderState();
    const x = (snapshot: typeof current) => snapshot.entities.find((entity) => entity.id === 'p1')!.transform!.position.x;
    return x(previous) + (x(current) - x(previous)) * alpha;
  };
  expect(renderedX()).toBe(0);
  const samples = [];
  for (let frame = 0; frame < 6; frame++) { s.clock.advance(100 / 6); samples.push(renderedX()); }
  for (let frame = 0; frame < samples.length; frame++) expect(samples[frame]).toBeCloseTo((frame + 1) / 12);
  expect(s.session.getSnapshot().entities.find((entity) => entity.id === 'p1')!.transform!.position.x).toBe(0.5);
  s.clock.advance(1000); expect(renderedX()).toBe(0.5);
  s.adapter.drop(); expect(renderedX()).toBe(0.5);
  s.session.dispose();
});

it('smooths the local avatar with the same history while keeping authoritative position current',()=>{
  const s=setup();
  s.adapter.receive({v: 3,type:'delta',baseRevision:0,revision:1,tick:1,upsert:[player('p1',.3)],remove:[]});
  s.clock.advance(50);s.session.update(1/60);
  const view=s.session.getRenderState();
  expect(view.previous.entities.find(e=>e.id==='p1')!.transform!.position.x).toBe(0);
  expect(view.current.entities.find(e=>e.id==='p1')!.transform!.position.x).toBe(.3);
  expect(view.alpha).toBeLessThan(1);
  expect(s.session.getSnapshot().entities.find(e=>e.id==='p1')!.transform!.position.x).toBe(.3);
  s.clock.advance(500);
  const held=s.session.getRenderState();
  expect(held.previous).toBe(held.current); // no extrapolation when the buffer runs out
  s.session.dispose();
});
