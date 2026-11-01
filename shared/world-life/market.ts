import type { ObjectTemplate, WorldLifeDefinition } from './types.ts';

/** Pure authored production data. The map generator attaches this value to manifest.worldLife. */
const STATIC_ASSETS = [
  'house', 'wall', 'fence', 'paving', 'table', 'shelf', 'crate', 'basket', 'fruit', 'dates',
  'fabric-roll', 'canopy', 'cart', 'bench', 'scroll-table', 'bowl', 'jar', 'palm', 'planter',
  'vines', 'grass', 'merchant', 'shepherd', 'goat', 'courtyard-ground', 'stepped-building',
  'main-portal', 'exterior-stair', 'courtyard-arch', 'rest-canopy', 'courtyard-plants',
  'courtyard-lanterns', 'babel-symbols', 'courtyard-vessel', 'courtyard-planter',
  'courtyard-palm', 'courtyard-lantern', 'textile-sign',
] as const;
const position = (x: number, z: number, y = 0) => ({ x, y, z });
const potteryZone = { minX: 4.4, maxX: 7.3, minZ: 3.8, maxZ: 6.4 };

export const MARKET_WORLD_LIFE: WorldLifeDefinition = {
  v: 1,
  mapId: 'market',
  seed: 170106,
  templates: [
    ...STATIC_ASSETS.map((id): ObjectTemplate => ({ id, assetId: id, behavior: 'static', animation: 'idle' })),
    { id: 'cat', assetId: 'cat', behavior: 'animated', animation: 'idle' },
    { id: 'bird', assetId: 'bird', behavior: 'animated', animation: 'idle' },
    { id: 'pushable-pot', assetId: 'pushable-pot', behavior: 'pushable', animation: 'idle' },
    { id: 'pickup-apple', assetId: 'pickup-apple', behavior: 'pickup', animation: 'idle' },
  ],
  instances: [
    // These replace the 3 removed ground vessels at the pottery stall and the removed vessel at (-3.7,7).
    { id: 'market-pot-1', templateId: 'pushable-pot', position: position(5.2,4.6), rotationY: 0, zone: potteryZone },
    { id: 'market-pot-2', templateId: 'pushable-pot', position: position(6.6,4.6), rotationY: 0, zone: potteryZone },
    { id: 'market-pot-3', templateId: 'pushable-pot', position: position(6,5.3), rotationY: 0, zone: potteryZone },
    { id: 'market-pot-4', templateId: 'pushable-pot', position: position(-3.7,7), rotationY: 0, zone: { minX: -4.7, maxX: -2.7, minZ: 6, maxZ: 8 } },
    { id: 'market-apple-1', templateId: 'pickup-apple', position: position(.8,6.4), rotationY: 0 },
    { id: 'market-apple-2', templateId: 'pickup-apple', position: position(-1.1,4.5), rotationY: .5 },
    { id: 'market-apple-3', templateId: 'pickup-apple', position: position(1.2,1.8), rotationY: 1 },
    { id: 'market-apple-4', templateId: 'pickup-apple', position: position(1,-59), rotationY: 1.5 },
    { id: 'market-apple-5', templateId: 'pickup-apple', position: position(-30,8), rotationY: 2 },
    { id: 'market-cat-sleep', templateId: 'cat', position: position(-7,7), rotationY: 1 },
    { id: 'market-cat-walk', templateId: 'cat', position: position(-7,-59), rotationY: 0 },
    { id: 'market-cat-wash', templateId: 'cat', position: position(-31,8), rotationY: -.8 },
  ],
  cats: [
    { instanceId: 'market-cat-sleep', behavior: 'sleep', route: [position(-7,7)], cycleMs: 6000, pauseMs: 0 },
    { instanceId: 'market-cat-walk', behavior: 'walk', route: [position(-7,-59),position(-5,-59),position(-5,-61),position(-7,-61)], cycleMs: 24000, pauseMs: 4000 },
    { instanceId: 'market-cat-wash', behavior: 'wash', route: [position(-31,8)], cycleMs: 8000, pauseMs: 1000 },
  ],
  flock: {
    assetId: 'bird', count: 5,
    // East of the tower: never cross its silhouette or require a route above its upper levels.
    route: [position(10,-25,14),position(9,-5,14),position(8,12,14)],
    schedule: { periodMs: 120000, durationMs: 10000, offsetMs: 10000 },
  },
  wind: {
    strength: .15, gustStrength: .35,
    schedule: { periodMs: 60000, durationMs: 3000, offsetMs: 5000 },
  },
};
