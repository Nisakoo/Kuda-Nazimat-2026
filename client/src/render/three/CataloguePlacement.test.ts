import { describe, expect, it } from 'vitest';
import placement from '../../../e2e/catalogue-placement.json';
import { MARKET_WORLD_LIFE } from '../../../../shared/world-life/market.ts';

describe('data-only catalogue preview', () => {
  it('uses stable instance IDs and existing static templates without new game rules', () => {
    expect(new Set(placement.objects.map(object => object.id)).size).toBe(placement.objects.length);
    for (const object of placement.objects.filter(object => object.assetId !== 'floor')) {
      const template = MARKET_WORLD_LIFE.templates.find(template => template.assetId === object.assetId);
      expect(template?.behavior).toBe('static');
      expect(Object.values(object.transform.position).every(Number.isFinite)).toBe(true);
      expect(Number.isFinite(object.transform.rotationY)).toBe(true);
    }
    const benches = placement.objects.filter(object => object.assetId === 'bench');
    expect(benches).toHaveLength(2);
    expect(benches[0]!.transform).not.toEqual(benches[1]!.transform);
  });
});
