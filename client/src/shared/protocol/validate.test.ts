import { expect, it } from 'vitest';
import fixtures from '../../../../shared/protocol/fixtures.json';
import { parseClientMessage, parseServerMessage, parseServerSession, ProtocolError } from '../../../../shared/protocol/validate.ts';

it.each(fixtures)('validates portable $direction fixtures (valid=$valid)', ({ direction, valid, packet }) => {
  const parse = direction === 'client' ? parseClientMessage : parseServerMessage;
  if (valid) expect(parse(JSON.stringify(packet))).toEqual(packet);
  else expect(() => parse(packet)).toThrow(ProtocolError);
});
it('rejects oversized text, invalid directions, duplicate AOI IDs and non-finite values', () => {
  expect(() => parseClientMessage({ v: 1, type: 'chat-send', requestId: 'r', text: 'я'.repeat(501) })).toThrow();
  expect(() => parseClientMessage({ v: 1, type: 'input', requestId: 'r', sequence: 1, direction: { x: 1, z: 1 }, preparedChunks: [] })).toThrow();
  expect(() => parseClientMessage({ v: 1, type: 'input', requestId: 'r', sequence: 1, direction: { x: NaN, z: 0 }, preparedChunks: [] })).toThrow();
  const duplicate = { v: 1, type: 'snapshot', revision: 0, snapshot: { tick: 0, entities: [{ id: 'a' }, { id: 'a' }] } };
  expect(() => parseServerMessage(duplicate)).toThrow();
  expect(() => parseServerMessage(' '.repeat(262145))).toThrow();
});
it('returns detached data and validates server session expiry without a mock bypass', () => {
  const raw = { v: 1, type: 'snapshot', revision: 1, snapshot: { tick: 1, entities: [{ id: 'p' }] } };
  const parsed = parseServerMessage(raw); raw.snapshot.entities[0]!.id = 'changed';
  expect(parsed).toMatchObject({ snapshot: { entities: [{ id: 'p' }] } });
  expect(parseServerSession({ token: 'server-session-opaque', expiresAt: 2000 }, 1000).expiresAt).toBe(2000);
  expect(() => parseServerSession({ token: 'mock', expiresAt: 2000 }, 1000)).toThrow();
  expect(() => parseServerSession({ token: 'server-session-opaque', expiresAt: 1000 }, 1000)).toThrow();
});
