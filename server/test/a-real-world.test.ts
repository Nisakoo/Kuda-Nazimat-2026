import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadWorld } from '../src/world/loader.ts';
import { World } from '../src/game/World.ts';

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
  it('MOVE: prepared ceilings in all three real maps stop an otherwise reachable jump', async () => {
    const loaded = await loadWorld({ worldDir: publicDir, maps: { market: 'maps/market/manifest.json', demo: 'maps/demo/manifest.json', science: 'maps/demo/science.json' }, contentDir: fileURLToPath(new URL('../content/', import.meta.url)) });
    for (const map of loaded.maps.values()) {
      expect(map.manifest.chunks.every(chunk => (chunk.ceilingVolumes?.length ?? 0) <= 128)).toBe(true);
      const world = new World(loaded.maps, []);
      let tested = false;
      search: for (const chunk of map.manifest.chunks) for (const volume of chunk.ceilingVolumes ?? []) {
        for (let x = volume.minX; x <= volume.maxX; x += .25) for (let z = volume.minZ; z <= volume.maxZ; z += .25) {
          const y = map.heightAt(x, z);
          if (!map.isWalkable(x, z) || volume.bottomY < y + 1.85 || volume.bottomY >= y + 2.9) continue;
          if (map.ceilingsFor({ x, y, z }, { x, y, z }).some(v => x + .25 >= v.minX && x - .25 < v.maxX && z + .25 >= v.minZ && z - .25 < v.maxZ && y < v.topY && y + 1.8 > v.bottomY)) continue;
          world.add({ id: 'p', name: 'P', mapId: map.id, position: { x, y, z }, rotationY: 0 });
          expect(world.locate('p')!.position).toEqual({ x, y, z });
          let apex = y;
          world.setIntent('p', 1, { x: 0, z: 0 }, [chunk.id], 0, false, 1);
          for (let i = 1; i <= 30; i++) { world.step(.05, i * 50); apex = Math.max(apex, world.locate('p')!.position.y); }
          expect(apex, map.id).toBeGreaterThan(y);
          expect(apex + 1.8, map.id).toBeLessThanOrEqual(volume.bottomY + 1e-8);
          expect(world.aoi('p')[0]!.motion!.grounded, map.id).toBe(true);
          tested = true; break search;
        }
      }
      expect(tested, `reachable low ceiling: ${map.id}`).toBe(true);
    }
  });
});
