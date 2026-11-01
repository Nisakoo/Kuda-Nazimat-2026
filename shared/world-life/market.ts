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

// Millstone local (0,-7), after the mill's authored .9 scale/.18 rotation and (1,-1) offset.
// Keep the complete mule outside the canopy posts and drive lever, inside the surrounding worktables.
// The geometry-clearance test binds this center to CITY_LAYOUT and checks the smoothed whole circuit.
const millstone = position(-31 + 6.3 * Math.sin(.18), 31 - 6.3 * Math.cos(.18));
const muleRoute = Array.from({ length: 12 }, (_, index) => position(
  millstone.x + Math.sin(index * Math.PI / 6) * 4.3,
  millstone.z + Math.cos(index * Math.PI / 6) * 4.3,
));
const camels=[position(20.5,26.5),position(23,26.5)];
export const MARKET_WORLD_LIFE: WorldLifeDefinition = {
  v: 1,
  mapId: 'market',
  seed: 170106,
  templates: [
    ...STATIC_ASSETS.map((id): ObjectTemplate => ({ id, assetId: id, behavior: 'static', animation: 'idle' })),
    ...['camel','mule'].map((kind):ObjectTemplate=>({id:kind,assetId:`city-${kind}`,behavior:'animated',animation:'idle'})),
    { id: 'cat', assetId: 'cat', behavior: 'animated', animation: 'idle' },
    { id: 'bird', assetId: 'bird', behavior: 'animated', animation: 'idle' },
    { id: 'pushable-pot', assetId: 'pushable-pot', behavior: 'pushable', animation: 'idle' },
    ...['pickup-tablet','pickup-jug','pickup-basket'].map((id):ObjectTemplate=>({id,assetId:id,behavior:'pickup',animation:'idle'})),
    { id: 'pickup-apple', assetId: 'pickup-apple', behavior: 'pickup', animation: 'idle' },
  ],
  instances: [
    {id:'city-mule',templateId:'mule',position:muleRoute[0]!,rotationY:Math.PI/2},
    ...camels.map((position,index)=>({id:`city-camel-${index+1}`,templateId:'camel',position,rotationY:0})),
    ...[
      ['city-tablet-market','pickup-tablet',-1.6,9], ['city-jug-market','pickup-jug',3,8.8], ['city-basket-market','pickup-basket',-2.2,11],
      ['city-tablet-school','pickup-tablet',-30,-57], ['city-jug-fountain','pickup-jug',0,-25],
      ['city-basket-garden','pickup-basket',27,-26], ['city-basket-mill','pickup-basket',-29,36],
      ['city-tablet-guest','pickup-tablet',26,35], ['city-jug-dye','pickup-jug',-30,-28],
      ['city-basket-dock','pickup-basket',-61,35.5], ['city-tablet-palace','pickup-tablet',-59,-26],
      ['city-jug-homes','pickup-jug',25,-56],
    ].map(([id,templateId,x,z])=>({id:String(id),templateId:String(templateId),position:position(Number(x),Number(z)),rotationY:.3})),
    ...[
      ['city-pot-bakery',29,7], ['city-pot-dye',-27,-28], ['city-pot-garden',27,-24.5], ['city-pot-guest',28,37.5],
    ].map(([id,x,z])=>({id:String(id),templateId:'pushable-pot',position:position(Number(x),Number(z)),rotationY:0,zone:{minX:Number(x)-.9,maxX:Number(x)+.9,minZ:Number(z)-.9,maxZ:Number(z)+.9}})),
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
  packAnimals: [
    {instanceId:'city-mule',kind:'mule',behavior:'walk',route:muleRoute,cycleMs:22000},
    ...camels.map((position,index)=>({instanceId:`city-camel-${index+1}`,kind:'camel' as const,behavior:'feed' as const,route:[position],cycleMs:12000+index*1400})),
  ],
  perches: [
    [7.5,9], [8.4,9.4], [7.8,10.2], [-2,27], [-.8,27.8], [-2.3,28.5],
    [-3,-25], [-1.8,-24.2], [-3.5,-23.6], [-29,34], [-27.8,34.8], [-29.5,35.4],
  ].map(([x,z],index)=>({id:`city-bird-${index+1}`,position:position(x!,z!),rotationY:index*1.7})),
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
