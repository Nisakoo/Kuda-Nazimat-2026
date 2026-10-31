import { expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadWorld } from '../src/world/loader.ts';
import { World } from '../src/game/World.ts';

it('authoritative market movement climbs the real stair, respects its rails and descends to the courtyard', async () => {
  const loaded = await loadWorld({ worldDir: fileURLToPath(new URL('../../client/public/', import.meta.url)), maps: { market: 'maps/market/manifest.json', demo: 'maps/demo/manifest.json', science: 'maps/demo/science.json' }, contentDir: fileURLToPath(new URL('../content/', import.meta.url)) });
  const world = new World(loaded.maps, loaded.npcs);
  world.add({ id: 'p', name: 'P', mapId: 'market', position: { x: -23, y: 0, z: 9 }, rotationY: 0 });
  let sequence = 0;
  const move = (x: number, z: number, steps: number) => {
    for (let i = 0; i < steps; i++) { sequence++; world.setIntent('p', sequence, { x, z }, ['-1_0'], sequence * 50); world.step(.05, sequence * 50); }
  };
  move(0, -1, 87);
  expect(world.locate('p')!.position.y).toBe(3);
  expect(world.locate('p')!.position.z).toBeCloseTo(-4.05);
  move(1, 0, 20);
  expect(world.locate('p')!.position.x).toBeLessThan(-22);
  expect(world.locate('p')!.position.y).toBe(3);
  move(0, 1, 87);
  expect(world.locate('p')!.position.y).toBe(0);
});
