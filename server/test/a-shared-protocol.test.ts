import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ProtocolError, parseClientMessage, parseServerMessage } from '../../shared/protocol/validate.ts';

interface Fixture { direction: 'client' | 'server'; valid: boolean; code?: string; packet: unknown }
const load = (url: URL): Fixture[] => JSON.parse(readFileSync(url, 'utf8')) as Fixture[];
const shared = load(new URL('../../shared/protocol/fixtures.json', import.meta.url));
const clientUrl = new URL('../../client/src/shared/protocol/fixtures.json', import.meta.url);

function outcome(fixture: Fixture): string {
  const parse = fixture.direction === 'client' ? parseClientMessage : parseServerMessage;
  try { parse(fixture.packet); return 'valid'; }
  catch (error) { return error instanceof ProtocolError ? error.code : 'crash'; }
}

describe('PROTO v1 fixtures (SHARED-004)', () => {
  it.each(shared)('$direction valid=$valid', (fixture) => {
    const result = outcome(fixture);
    if (fixture.valid) expect(result).toBe('valid');
    else expect(result).toBe(fixture.code ?? 'INVALID');
  });
});

describe('client/shared source (SHARED-006)', () => {
  if (existsSync(fileURLToPath(clientUrl))) {
    it('client fixtures give the same outcome', () => {
      for (const fixture of load(clientUrl)) expect(outcome(fixture) === 'valid', JSON.stringify(fixture.packet)).toBe(fixture.valid);
    });
  } else {
    it('the migrated client imports shared directly and has no duplicate parser', () => {
      expect(existsSync(new URL('../../client/src/shared/protocol/validate.ts', import.meta.url))).toBe(false);
      const adapter = readFileSync(new URL('../../client/src/multiplayer/SocketIOAdapter.ts', import.meta.url), 'utf8');
      expect(adapter).toContain("from '../../../shared/protocol/validate.ts'");
    });
  }
});
