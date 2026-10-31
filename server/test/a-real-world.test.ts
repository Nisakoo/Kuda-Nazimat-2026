import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadWorld } from '../src/world/loader.ts';

const publicDir = fileURLToPath(new URL('../../client/public/', import.meta.url));
const generated = (name: string) => fileURLToPath(new URL(`../../client/src/shared/${name}.generated.ts`, import.meta.url));
const ready = existsSync(`${publicDir}maps/market/manifest.json`) && existsSync(generated('marketWorld'));
/** Bootstraps the client generator embedded for its local session. */
const embedded = (name: string, constant: string): unknown => {
  const source = readFileSync(generated(name), 'utf8');
  return JSON.parse(source.split(`export const ${constant} = `)[1]!.split(' as const;')[0]!);
};

// Requires `npm --prefix client run world:generate`; skipped (= unverified) otherwise.
describe.runIf(ready)('real client worlds (SERVER-WORLD S1, SERVER-DEMO-005)', () => {
  it('loads market/demo/science with server NPC content and matches the client bootstrap byte for byte', async () => {
    const world = await loadWorld({
      worldDir: publicDir,
      maps: { market: 'maps/market/manifest.json', demo: 'maps/demo/manifest.json', science: 'maps/demo/science.json' },
      contentDir: fileURLToPath(new URL('../content/', import.meta.url)),
    });
    expect(world.maps.get('market')!.bootstrap).toEqual(embedded('marketWorld', 'MARKET_WORLD'));
    expect(world.maps.get('demo')!.bootstrap).toEqual(embedded('demoWorld', 'DEMO_WORLD'));
    const market = world.maps.get('market')!;
    expect(market.isWalkable(market.spawn.x, market.spawn.z)).toBe(true);
    expect(world.npcs.filter((n) => n.mapId === 'market').map((n) => n.id).sort()).toEqual(['fabric-seller', 'fruit-seller', 'potter', 'shepherd']);
  });
});
