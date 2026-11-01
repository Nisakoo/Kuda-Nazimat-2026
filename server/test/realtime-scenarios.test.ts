import { expect, it } from 'vitest';
import type { ServerMessage } from '../../shared/protocol/types.ts';
import { setup } from './harness.ts';

/** REALTIME S3–S6 on the full application (HTTP login, Socket.IO, SQLite); a-realtime.test.ts covers S1 and AUTH S4. */
const CHUNKS = ['0_0', '-1_0', '1_0', '0_1', '0_-1'];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const position = (m: ServerMessage | undefined, id: string) => (m?.type === 'delta' ? m.upsert : m?.type === 'joined' || m?.type === 'snapshot' ? m.snapshot.entities : []).find((e) => e.id === id)?.transform?.position;

async function players(names: string[], overrides: Record<string, unknown> = {}) {
  const server = await setup(overrides);
  const result = [];
  for (const name of names) {
    const client = await server.connect((await server.guest(name)).token);
    client.command('join', { mapId: 'test' });
    const joined = await client.wait((p) => p.type === 'joined'); if (joined.type !== 'joined') throw new Error();
    let sequence = 0;
    const walk = async (direction: { x: number; z: number }, ms: number) => {
      for (let t = 0; t < ms; t += 50) { client.command('input', { sequence: ++sequence, direction, preparedChunks: CHUNKS }); await sleep(50); }
    };
    result.push({ ...client, id: joined.playerId, joined, walk });
  }
  return { server, players: result };
}

it('S3: forged fields, foreign playerId and v2 are rejected; an input flood is dropped silently', async () => {
  const { players: [anya, boris] } = await players(['Аня', 'Борис']);
  const start = position(anya!.joined, anya!.id)!;
  anya!.socket.emit('game', { v: 3, type: 'input', requestId: 'forged', sequence: 1, direction: { x: 0, z: 0 }, preparedChunks: [], sprint: false, jumpId: 0, position: { x: 99, y: 0, z: 99 } });
  anya!.socket.emit('game', { v: 3, type: 'chat-send', requestId: 'foreign', text: 'от чужого имени', playerId: boris!.id });
  for (const id of ['forged', 'foreign']) expect(await anya!.wait((p) => p.type === 'error' && p.requestId === id)).toMatchObject({ code: 'INVALID' });
  // 40 inputs in one burst: the token bucket keeps at most 30, without an error per packet.
  const errors = () => anya!.packets.filter((p) => p.type === 'error').length;
  const before = errors();
  for (let sequence = 1; sequence <= 40; sequence++) anya!.socket.emit('game', { v: 3, type: 'input', requestId: `flood${sequence}`, sequence, direction: { x: 0, z: 0 }, preparedChunks: CHUNKS, sprint: false, jumpId: 0 });
  await sleep(300); expect(errors()).toBe(before);
  const now = await boris!.wait((p) => p.type === 'joined');
  expect(position(now, anya!.id) ?? start).toMatchObject({ x: start.x, z: start.z });
  expect(boris!.packets.some((p) => p.type === 'chat')).toBe(false);
  anya!.socket.emit('game', { v: 2, type: 'resync', requestId: 'old', revision: 0 });
  expect(await anya!.wait((p) => p.type === 'error' && p.requestId === 'old')).toMatchObject({ code: 'VERSION' });
  await expect.poll(() => anya!.socket.connected).toBe(false);
});

it('S4: resync answers the current revision and the next delta builds on it; leaving the AOI removes the entity', async () => {
  const { players: [anya, boris] } = await players(['Аня', 'Борис'], { aoiRadius: 5 });
  await anya!.walk({ x: 0, z: 1 }, 400);
  await expect.poll(() => boris!.packets.some((p) => p.type === 'delta')).toBe(true);
  boris!.command('resync', { revision: 0 });
  const snapshot = await boris!.wait((p) => p.type === 'snapshot'); if (snapshot.type !== 'snapshot') throw new Error();
  const before = boris!.packets.slice(0, boris!.packets.indexOf(snapshot)).filter((p) => p.type === 'delta').at(-1) as Extract<ServerMessage, { type: 'delta' }>;
  expect(snapshot.revision).toBe(before.revision);
  await anya!.walk({ x: -1, z: 0 }, 2500);
  const removed = await boris!.wait((p) => p.type === 'delta' && p.remove.includes(anya!.id)); if (removed.type !== 'delta') throw new Error();
  const following = boris!.packets.filter((p) => p.type === 'delta' && p.revision > snapshot.revision);
  expect(following[0]).toMatchObject({ baseRevision: snapshot.revision });
});

it('S5: a reconnect inside the grace period is invisible to the observer and keeps the position', async () => {
  const { server, players: [anya, boris] } = await players(['Аня', 'Борис'], { disconnectGraceMs: 1500 });
  await anya!.walk({ x: 1, z: 0 }, 300); await sleep(600); // past the 250 ms intent timeout and a broadcast
  const before = position(boris!.packets.filter((p) => p.type === 'delta' && position(p, anya!.id)).at(-1), anya!.id)!;
  anya!.socket.disconnect(); await sleep(300);
  const again = await server.connect((await server.guest('аня')).token);
  again.command('join', { mapId: 'test' });
  const joined = await again.wait((p) => p.type === 'joined'); if (joined.type !== 'joined') throw new Error();
  expect(joined.playerId).toBe(anya!.id); expect(position(joined, anya!.id)).toMatchObject({ x: before.x, z: before.z });
  await sleep(300);
  expect(boris!.packets.some((p) => p.type === 'delta' && p.remove.includes(anya!.id))).toBe(false);
  const last = boris!.packets.filter((p) => p.type === 'delta').at(-1);
  if (last?.type === 'delta') expect(last.upsert.filter((e) => e.character?.kind === 'player' && e.id !== boris!.id).length).toBeLessThanOrEqual(1);
});

it('S6: interact succeeds near the NPC and is FORBIDDEN 5 m away; chat reaches both with unique ids and stays text', async () => {
  const { players: [anya, boris] } = await players(['Аня', 'Борис']);
  const near = anya!.command('interact', { targetId: 'guide' });
  expect(await anya!.wait((p) => 'requestId' in p && p.requestId === near && (p.type === 'interacted' || p.type === 'error'))).toMatchObject({ type: 'interacted', targetId: 'guide' });
  await boris!.walk({ x: 1, z: 0 }, 1800); await sleep(200);
  const far = boris!.command('interact', { targetId: 'guide' });
  expect(await boris!.wait((p) => 'requestId' in p && p.requestId === far && (p.type === 'interacted' || p.type === 'error'))).toMatchObject({ type: 'error', code: 'FORBIDDEN' });
  const a = anya!.command('chat-send', { text: '<script>alert(1)</script>' });
  await sleep(1100); // chat bucket: one message per second per player
  const b = boris!.command('chat-send', { text: 'ответ' });
  for (const client of [anya!, boris!]) for (const requestId of [a, b]) await client.wait((p) => p.type === 'chat' && p.requestId === requestId);
  const chats = anya!.packets.filter((p) => p.type === 'chat');
  expect(new Set(chats.map((p) => p.type === 'chat' && p.messageId)).size).toBe(chats.length);
  expect(chats.find((p) => p.type === 'chat' && p.requestId === a)).toMatchObject({ playerId: anya!.id, text: '<script>alert(1)</script>' });
  expect(boris!.packets.find((p) => p.type === 'chat' && p.requestId === b)).toMatchObject({ playerId: boris!.id });
});

it('S3: chat is limited to one message per second after a burst of three; more than ten invalid packets in 10 s disconnect', async () => {
  const { players: [anya] } = await players(['Аня']);
  const ids = [1, 2, 3, 4].map((n) => anya!.command('chat-send', { text: `сообщение ${n}` }));
  for (const id of ids.slice(0, 3)) await anya!.wait((p) => p.type === 'chat' && p.requestId === id);
  expect(await anya!.wait((p) => p.type === 'error' && p.requestId === ids[3])).toMatchObject({ code: 'RATE_LIMIT' });
  for (let n = 0; n < 11; n++) anya!.socket.emit('game', { v: 3, type: 'bogus', requestId: `bad${n}` });
  await expect.poll(() => anya!.socket.connected).toBe(false);
});
