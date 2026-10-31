import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { AssetManager } from '../../map/AssetManager';
import { GltfLibrary } from './GltfLibrary';

async function setup() {
  const file = await readFile(new URL('../../../e2e/fixtures/tablet-plain.glb', import.meta.url));
  const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const load = vi.fn(async () => bytes);
  const assets = new AssetManager({ resolve: (path) => path, load });
  const library = new GltfLibrary(assets);
  library.register({ tablet: 'tablet.glb' });
  return { assets, library, load };
}

async function instantiate(library: GltfLibrary, id = 'tablet') {
  const result = library.instantiate(id, new AbortController().signal);
  for (let attempt = 0; attempt < 100 && library.stats.queued === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 1));
  library.flush();
  return result;
}

describe('real embedded GLB parsing and animation', () => {
  it('parses once, shares template geometry, runs independent mixers and frees ownership', async () => {
    const { assets, library, load } = await setup();
    const a = await instantiate(library);
    const b = await instantiate(library);
    expect(load).toHaveBeenCalledTimes(1);
    const tabletA = a.root.getObjectByName('Tablet')!;
    const tabletB = b.root.getObjectByName('Tablet')!;
    expect(tabletA).not.toBe(tabletB);
    a.animate('idle', 0.1);
    expect(tabletA.position.y).toBeGreaterThan(tabletB.position.y);
    expect(library.stats.instances).toBe(2);
    a.dispose();
    expect(library.stats.resources).toBe(1);
    b.dispose();
    expect(library.stats.resources).toBe(0);
    library.dispose(); assets.dispose();
  });
});
