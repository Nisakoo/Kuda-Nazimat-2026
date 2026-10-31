import { expect, it } from 'vitest';
import { MARKET_GOATS, MARKET_ITEMS, MARKET_PEOPLE, MarketSession } from './MarketSession';

function advance(session: MarketSession, seconds: number) {
  while (seconds > 1e-8) { const dt = Math.min(1, seconds); session.update(dt); seconds -= dt; }
}
function go(session: MarketSession, id: string) {
  const target = session.getSnapshot().entities.find(e => e.id === id)!.transform!.position;
  const player = session.getSnapshot().entities.find(e => e.id === session.playerId)!.transform!.position;
  const x = target.x-player.x, z = target.z-player.z;
  session.send({ type: 'move', direction: { x, z } });
  advance(session, Math.hypot(x,z)/3 || .01);
  session.send({ type: 'move', direction: { x: 0, z: 0 } }); session.update(.01);
}
it('requires the matching nearby merchant and keeps unwanted purchases in the inventory', () => {
  const session = new MarketSession();
  session.buy('fruit-seller', 'dates'); expect(session.market.inventory.dates).toBe(0);
  go(session, 'fruit-seller');session.buy('fruit-seller','water');expect(session.market.inventory.water).toBe(0);
  session.buy('fruit-seller','dates');expect(session.market.inventory.dates).toBe(1);
  go(session,'fabric-seller');session.buy('fabric-seller','fabric');expect(session.market.inventory.fabric).toBe(1);
});
it('keeps wrong feed, consumes correct feed once and finishes all four steps', () => {
  const session=new MarketSession();
  for(const person of MARKET_PEOPLE) { go(session,person.id);for(const item of MARKET_ITEMS.filter(item=>item.seller===person.id))session.buy(person.id,item.id); }
  go(session,'black-goat');session.select('dates');session.feed('black-goat');expect(session.market.fed).toEqual([]);expect(session.market.inventory.dates).toBe(1);
  for(const goat of MARKET_GOATS){go(session,goat.id);session.select(goat.food);session.feed(goat.id);session.feed(goat.id);expect(session.market.inventory[goat.food]).toBe(0);}
  expect(session.market.completed).toBe(true);expect(session.market.fed).toHaveLength(4);expect(session.market.inventory.fabric).toBe(1);
  const seconds=session.market.seconds;advance(session, 3);expect(session.market.seconds).toBe(seconds);
});
it('bounds and copies carved stones and resets local data on a new session', () => {
  const session=new MarketSession();const points: [number,number][][]=[[[10,20],[30,40]]];
  expect(session.carve(points)).toBe(true);points[0]![0]![0]=300;
  expect(session.market.stones[0]![0]![0]).toEqual([10,20]);
  expect(session.carve([[[NaN,2]]])).toBe(false);
  expect(session.carve([Array.from({length:257},()=>[1,2] as const)])).toBe(false);
  for(let i=0;i<7;i++)expect(session.carve([[[1,2]]])).toBe(true);
  expect(session.carve([[[1,2]]])).toBe(false);expect(new MarketSession().market.stones).toEqual([]);
});
it('edits and removes a bounded local vocabulary', () => {
  const session=new MarketSession();expect(session.saveWord('','goat','')).toBe(false);
  expect(session.saveWord('goat','коза','с колокольчиком')).toBe(true);const id=session.market.words[0]!.id;
  session.saveWord('kid','козлёнок','',id);expect(session.market.words[0]!.word).toBe('kid');
  session.removeWord(id);expect(session.market.words).toEqual([]);expect(session.market.wordsAdded).toBe(1);
});

it('starts the result timer only after the walk begins', () => {
  const session = new MarketSession();advance(session, 5);expect(session.market.seconds).toBe(0);
  session.beginTour();advance(session, 3);expect(session.market.seconds).toBeCloseTo(3);
});
