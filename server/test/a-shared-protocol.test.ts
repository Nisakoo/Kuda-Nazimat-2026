import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ProtocolError, parseClientMessage, parseServerMessage } from '../../shared/protocol/validate.ts';
import { loadWorld } from '../src/world/loader.ts';

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

describe('one walkability rule for client and server (SHARED-005 / S3)', () => {
  it('the client chunk guard imports the shared rule instead of a copy', () => {
    const guard = readFileSync(new URL('../../client/src/map/ChunkManager.ts', import.meta.url), 'utf8');
    expect(guard).toMatch(/from '(\.\.\/)+shared\/map\/walkability\.ts'/);
    expect(existsSync(new URL('../../client/src/shared/map/walkability.ts', import.meta.url))).toBe(false);
  });
  const demo = new URL('../../client/public/maps/demo/manifest.json', import.meta.url);
  it.runIf(existsSync(fileURLToPath(demo)))('demo control points: spawn is walkable, a collision cell and the outside are not', async () => {
    const world = await loadWorld({ worldDir: fileURLToPath(new URL('../../client/public/', import.meta.url)), maps: { market: 'maps/market/manifest.json', demo: 'maps/demo/manifest.json', science: 'maps/demo/science.json' }, contentDir: fileURLToPath(new URL('../content/', import.meta.url)) });
    const map = world.maps.get('demo')!; const m = map.manifest;
    expect(map.isWalkable(m.spawn.x, m.spawn.z)).toBe(true);
    const chunk = m.chunks.find((c) => c.x === 0 && c.z === 0)!;
    const cells = new Uint8Array(readFileSync(world.files.get(chunk.collisionUrl)!.absolutePath));
    const blocked = cells.findIndex((v) => v !== 0); expect(blocked).toBeGreaterThanOrEqual(0);
    const size = m.chunkSize / m.collisionResolution;
    const x = m.origin.x + chunk.x * m.chunkSize + ((blocked % m.collisionResolution) + 0.5) * size;
    const z = m.origin.z + chunk.z * m.chunkSize + (Math.floor(blocked / m.collisionResolution) + 0.5) * size;
    expect(map.isWalkable(x, z)).toBe(false);
    expect(map.isWalkable(m.origin.x - 1000, m.origin.z - 1000)).toBe(false);
  });
});
