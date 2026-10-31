import { expect, it } from 'vitest';
import { parseManifest, surfaceHeight } from '../../shared/map/manifest.ts';
const ramp = { minX: 0, maxX: 2, minZ: 0, maxZ: 10, startY: 3, endY: 0 };
const manifest = { mapId: 'test', version: 1, worldBytes: 1000, chunkSize: 32, collisionResolution: 16, spawn: { x: 1, y: 0, z: 10 }, origin: { x: 0, z: 0 }, chunks: [], models: {}, assets: {} };
const bootstrap = { manifestUrl: 'map.json', worldBytes: 1000, manifestBytes: 100, assets: {} };
it('reads continuous ramp height and level landing with flat default outside', () => {
  const surfaces = [ramp, { ...ramp, minZ: -2, maxZ: 0, endY: 3 }];
  expect(surfaceHeight(surfaces, 1, 10)).toBe(0);
  expect(surfaceHeight(surfaces, 1, 5)).toBe(1.5);
  expect(surfaceHeight(surfaces, 1, 0)).toBe(3);
  expect(surfaceHeight(surfaces, 1, -1)).toBe(3);
  expect(surfaceHeight(surfaces, 3, 5)).toBe(0);
  expect(parseManifest({ ...manifest, heightSurfaces: surfaces }, bootstrap).heightSurfaces).toEqual(surfaces);
  expect(parseManifest(manifest, bootstrap).heightSurfaces).toBeUndefined();
});
it('rejects malformed, oversized, overlapping and unwalkably steep ramps', () => {
  for (const surfaces of [null, {}, Array(129).fill(ramp), [{ ...ramp, minX: NaN }], [{ ...ramp, maxZ: 0 }], [{ ...ramp, startY: 100 }], [{ ...ramp, endY: Infinity }], [ramp, ramp]]) {
    expect(() => parseManifest({ ...manifest, heightSurfaces: surfaces }, bootstrap)).toThrow();
  }
});
