import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { parseWorldLifeClientMessage, parseWorldLifeDefinition, parseWorldLifeServerMessage } from '../../shared/world-life/validate.ts';
import { catPosition, schedulePhase } from '../../shared/world-life/phase.ts';
import { MARKET_WORLD_LIFE } from '../../shared/world-life/market.ts';
import type { HandRequest, SceneStateMessage, WorldLifeDefinition } from '../../shared/world-life/types.ts';
import type { WorldManifest } from '../../shared/map/manifest.ts';
import { GameMap } from '../src/world/GameMap.ts';
import { WorldLife } from '../src/game/WorldLife.ts';
import { World } from '../src/game/World.ts';
import type { PlacedPlayer } from '../src/game/ports.ts';
import { openDatabase, sqliteStores, transaction } from '../src/persistence/database.ts';
import { sqliteWorldLife } from '../src/persistence/worldLife.ts';
import { applyMigrations, loadMigrations } from '../src/persistence/migrate.ts';
import { BabylonService } from '../src/babylon/BabylonService.ts';
import { sqliteBabylon } from '../src/persistence/babylon.ts';
import { testLanguagePort } from '../src/babylon/TestLanguagePort.ts';
import { createGenerationQueue } from '../src/npc/GenerationQueue.ts';
import { systemClock, systemScheduler } from '../src/common/time.ts';
import { silentLogger } from '../src/common/logger.ts';

const fixtures = JSON.parse(readFileSync(new URL('../../shared/world-life/fixtures.json',import.meta.url),'utf8')) as {direction:string;valid:boolean;packet:unknown}[];
export const sceneFixture = parseWorldLifeServerMessage(fixtures.find(f => f.direction === 'server' && f.valid && (f.packet as {type:string}).type === 'scene-state')!.packet) as SceneStateMessage;
const copy = <T>(v:T):T => structuredClone(v);
const pos=(x:number,z:number,y=0)=>({x,y,z});
const player=(id='p1',x=0,z=0,rotationY=0):PlacedPlayer=>({id,name:id,mapId:'test',position:pos(x,z),rotationY});
const pickup=(requestId='pick',targetId='apple-1'):HandRequest=>({v:1,type:'hand',requestId,action:'pickup',targetId});
const place=(requestId='place'):HandRequest=>({v:1,type:'hand',requestId,action:'place'});
export function mapFixture(definition:WorldLifeDefinition=copy(sceneFixture.definition),wall=false):GameMap {
  const resolution=160, data=new Uint8Array(resolution*resolution);
  if (wall) for(let z=0;z<resolution;z++) for(let x=112;x<128;x++) data[z*resolution+x]=1; // x 8..12
  const entry={id:'0_0',x:0,z:0,region:'test',url:'test.json',bytes:1,collisionUrl:'c.bin',collisionBytes:data.length,assets:['t']};
  const manifest:WorldManifest={worldLife:definition,mapId:'test',version:1,worldBytes:100000,chunkSize:40,collisionResolution:resolution,spawn:pos(0,0),origin:{x:-20,z:-20},chunks:[entry],models:{t:'t.glb'},assets:{'assets/models/t.glb':{bytes:100,memory:100}}};
  return new GameMap(manifest,{manifestUrl:'manifest.json',manifestBytes:1000,worldBytes:100000,assets:manifest.assets},new Map([['0_0',data]]));
}
function domain(definition=copy(sceneFixture.definition),wall=false){const map=mapFixture(definition,wall);const maps=new Map([['test',map]]);const life=new WorldLife(maps,1000,'scene-test');life.setApples(copy(sceneFixture.apples));return {map,maps,life};}
const dbs:DatabaseSync[]=[], dirs:string[]=[];
afterEach(()=>{for(const db of dbs.splice(0)){try{db.close();}catch{}}for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
function durable(){const dir=mkdtempSync(join(tmpdir(),'world-life-'));dirs.push(dir);const path=join(dir,'game.sqlite');let db=openDatabase(path);dbs.push(db);const people=['A','B','C','D'].map(n=>sqliteStores(db).accounts.findOrCreate(n,n,1));let store=sqliteWorldLife(db);const d=domain();d.life.setApples(store.initialize([d.map.manifest.worldLife!]));return {...d,people,path,get db(){return db;},get store(){return store;},act(p:PlacedPlayer,r:HandRequest,others:readonly PlacedPlayer[]=[]){const result=store.execute(p.id,p.mapId,r,apples=>d.life.decideHand(p,r,apples,[p,...others],true));d.life.setApples(result.apples,result.changed);return result.result;},restart(){db.close();db=openDatabase(path);dbs.push(db);store=sqliteWorldLife(db);d.life.setApples(store.initialize([d.map.manifest.worldLife!]));}};}

describe('world-life executable contract',()=>{
  for(const [i,f] of fixtures.entries())it(`fixture ${i} ${f.direction} valid=${f.valid}`,()=>{const parse=f.direction==='client'?parseWorldLifeClientMessage:parseWorldLifeServerMessage;if(f.valid)expect(()=>parse(f.packet)).not.toThrow();else expect(()=>parse(f.packet)).toThrow();});
  it('rejects invalid references, counts, schedule, paths and protected fields',()=>{
    const valid=sceneFixture.definition;
    for(const mutate of [(d:WorldLifeDefinition)=>({...d,seed:Infinity}),(d:WorldLifeDefinition)=>({...d,instances:d.instances.slice(1)}),(d:WorldLifeDefinition)=>({...d,flock:{...d.flock,count:7}}),(d:WorldLifeDefinition)=>({...d,wind:{...d.wind,schedule:{...d.wind.schedule,periodMs:10}}})])expect(()=>parseWorldLifeDefinition(mutate(copy(valid)))).toThrow();
    expect(()=>parseWorldLifeDefinition(valid,{})).toThrow();
    expect(()=>parseWorldLifeDefinition(valid,{t:'t.glb'},'other')).toThrow();
    expect(()=>parseWorldLifeClientMessage({...pickup(),holderId:'victim'})).toThrow();
    expect(()=>parseWorldLifeClientMessage({...pickup(),requestId:'x'.repeat(65537)})).toThrow();
  });
  it('publishes a reusable production catalogue with 5 stable apples and 4 reserved RAM pots',()=>{
    const parsed=parseWorldLifeDefinition(MARKET_WORLD_LIFE,Object.fromEntries(MARKET_WORLD_LIFE.templates.map(t=>[t.assetId,`${t.assetId}.glb`])),'market');
    expect(parsed.templates).toHaveLength(42);
    expect(parsed.instances.filter(i=>i.templateId==='pickup-apple').map(i=>i.id)).toEqual(['market-apple-1','market-apple-2','market-apple-3','market-apple-4','market-apple-5']);
    expect(parsed.instances.filter(i=>i.templateId==='pushable-pot')).toHaveLength(4);
  });
  it('computes the same late-join phase and closed cat route without per-client randomness',()=>{
    const d=sceneFixture.definition;
    expect(schedulePhase(11000,d.flock.schedule)).toEqual({active:true,phase:0.1});
    expect(schedulePhase(131000,d.flock.schedule)).toEqual(schedulePhase(11000,d.flock.schedule));
    expect(catPosition(d.cats[1]!,1000)).toEqual(d.cats[1]!.route[0]);
    expect(catPosition(d.cats[1]!,12000)).toEqual(d.cats[1]!.route[0]);
    expect(domain().life.snapshot('test',131000)?.epochMs).toBe(1000);
  });
});

it('atomic race has one winner; changed intent conflicts; lost reply and 5 restarts preserve ownership and all 5 IDs',async()=>{
  const f=durable(),a=player(f.people[0]!.playerId),b=player(f.people[1]!.playerId);
  const results=await Promise.all([Promise.resolve().then(()=>f.act(a,pickup('race-a'))),Promise.resolve().then(()=>f.act(b,pickup('race-b')))]);
  expect(results.filter(r=>r.ok)).toHaveLength(1);expect(results[1]).toMatchObject({ok:false,code:'NOT_FOUND'});
  const original=results[0]!; // No delivery or client ACK is required for this committed result.
  expect(f.act(a,pickup('race-a'))).toEqual(original);
  expect(f.act(a,place('race-a'))).toMatchObject({ok:false,code:'CONFLICT'});
  expect(f.act(a,pickup('second','apple-2'))).toMatchObject({ok:false,code:'HANDS_FULL'});
  for(let i=0;i<5;i++){f.restart();expect(f.act(a,pickup('race-a'))).toEqual(original);const state=f.life.snapshot('test',2000)!;expect(new Set(state.apples.map(a=>a.id)).size).toBe(5);expect(state.apples.filter(a=>a.state==='held')).toHaveLength(1);}
  expect(f.db.prepare('SELECT count(*) AS n FROM world_apples').get()!.n).toBe(5);
  expect(f.db.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok');
});

it('all 4 actual BABEL roles can pick up and place without changing BABEL inventory',async()=>{
  const f=durable();const queue=createGenerationQueue({clock:systemClock,scheduler:systemScheduler,logger:silentLogger},{maxConcurrent:1,maxUnfinished:4,timeoutMs:1000});
  let n=0;const babel=new BabylonService({store:sqliteBabylon(f.db),language:testLanguagePort,generate:queue.generate,now:Date.now,id:()=>`b${++n}`,location:()=>null});
  for(const p of f.people)await babel.handle(p,{v:2,requestId:`enroll-${p.playerId}`,action:{type:'enroll',size:4,native:'ru',learning:'en'}},p.playerId);
  for(const [index,p] of f.people.entries()){
    expect(babel.state(p).party?.role).toBe(index+1);const before=copy(babel.state(p).inventory);
    // Restore the same apple to its original free support between roles.
    const actor=player(p.playerId,0,0);expect(f.act(actor,pickup(`role-${index}`))).toMatchObject({ok:true,action:'pickup'});
    expect(f.act(player(p.playerId,0,0.1),place(`drop-${index}`))).toMatchObject({ok:true,action:'place'});
    expect(babel.state(p).inventory).toEqual(before);
  }
});

it('rejects far/wall pickup, empty hand, occupied and airborne placement, and preserves durable failure receipts',()=>{
  const f=durable(),id=f.people[0]!.playerId;
  expect(f.act(player(id,-18,15),pickup('far'))).toMatchObject({code:'TOO_FAR'});
  expect(f.act(player(id),place('empty'))).toMatchObject({code:'HANDS_EMPTY'});
  expect(f.act(player(id),pickup('yes'))).toMatchObject({ok:true});
  const blocked=f.act(player(id),place('occupied'),[player('other',0,.9)]);expect(blocked).toMatchObject({code:'BLOCKED'});
  expect(f.act(player(id),place('occupied'))).toEqual(blocked);
  expect(f.act({...player(id),position:pos(0,0,1)},place('air'))).toMatchObject({code:'BLOCKED'});
  const w=domain(copy(sceneFixture.definition),true);const apples=copy(sceneFixture.apples).map(a=>a.id==='apple-1'?{...a,state:'world' as const,position:pos(8.75,0)}:a);
  expect(w.life.decideHand(player(id,7,0),pickup('wall'),apples,[],true)).toMatchObject({code:'BLOCKED'});
  const held=sceneFixture.apples.map(a=>a.id==='apple-1'?{id:a.id,mapId:a.mapId,state:'held' as const,holderId:id}:a);
  expect(w.life.decideHand(player(id,7,0,Math.PI/2),place('wall-place'),held,[],true)).toMatchObject({code:'BLOCKED'});
  expect(f.act(player(id,19.5,0,Math.PI/2),place('edge'))).toMatchObject({code:'BLOCKED'});
});

it('rolls back apple and receipt on a receipt write failure; the same request can then succeed',()=>{
  const f=durable(),a=player(f.people[0]!.playerId);
  f.db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON world_hand_receipts BEGIN SELECT RAISE(ABORT,'fixture'); END");
  expect(()=>f.act(a,pickup('atomic'))).toThrow('fixture');
  expect(f.db.prepare("SELECT state FROM world_apples WHERE id='apple-1'").get()!.state).toBe('world');
  expect(f.db.prepare('SELECT count(*) AS n FROM world_hand_receipts').get()!.n).toBe(0);
  f.db.exec('DROP TRIGGER fail_receipt');expect(f.act(a,pickup('atomic'))).toMatchObject({ok:true});
});

it('requires the actual grounded flag even at the first sub-centimetre rising jump step',()=>{
  const f=durable(),id=f.people[0]!.playerId;
  expect(f.act(player(id),pickup('hold-before-jump'))).toMatchObject({ok:true});
  const world=new World(f.maps,[],undefined,{},f.life);world.add(player(id));
  world.setIntent(id,1,{x:0,z:0},['0_0'],1,false,1);world.step(.001,1);
  const actor=world.locate(id)!;expect(actor.position.y).toBeGreaterThan(0);expect(actor.position.y).toBeLessThan(.05);expect(world.isGrounded(id)).toBe(false);
  const apples=f.store.initialize([f.map.manifest.worldLife!]);
  expect(f.life.decideHand(actor,place('rising'),apples,world.placedPlayers(),world.isGrounded(id))).toMatchObject({ok:false,code:'BLOCKED'});
});

it('SQLite independently enforces the one-slot invariant and immutable seed IDs',()=>{
  const f=durable();const id=f.people[0]!.playerId;
  f.act(player(id),pickup());
  expect(()=>f.db.prepare("UPDATE world_apples SET state='held',holder_id=?,x=NULL,y=NULL,z=NULL WHERE id='apple-2'").run(id)).toThrow();
  expect(()=>f.store.initialize([{...sceneFixture.definition,instances:sceneFixture.definition.instances.map(i=>i.id==='apple-1'?{...i,id:'renamed'}:i)}])).toThrow('catalogue');
  expect(f.db.prepare('SELECT count(*) AS n FROM world_apples').get()!.n).toBe(5);
  expect(()=>f.store.initialize([])).toThrow('catalogue removed');
  expect(f.db.prepare('SELECT count(*) AS n FROM world_apples').get()!.n).toBe(5);
});

it('movement pushes a RAM pot, reconnect preserves it, and a new world resets it',()=>{
  const f=domain();const world=new World(f.maps,[],undefined,{},f.life);world.add(player('p1',-4,0));
  for(let i=1;i<=6;i++){world.setIntent('p1',i,{x:0,z:1},['0_0'],i*50);world.step(.05,i*50);}
  const moved=f.life.snapshot('test',1400)!.pots[0]!.position;expect(moved.z).toBeGreaterThan(1);
  world.resetInput('p1');expect(f.life.snapshot('test',1500)!.pots[0]!.position).toEqual(moved);
  const restarted=domain();expect(restarted.life.snapshot('test',2000)!.pots[0]!.position).toEqual(pos(-4,1));
});

it('blocked pot movement cannot cross a wall, leave its zone, hit another pot/apple/player, or pass an unprepared chunk',()=>{
  const f=domain();const pots=f.life.snapshot('test',1000)!.pots;const prepared=new Set(['0_0']);const p=player('p1',-4,.5);
  expect(f.life.tryPush(p,pos(-4,.7),[p,player('other',-4,1.6)],prepared,true)).toBe(false);
  f.life.setApples(sceneFixture.apples.map(a=>a.id==='apple-1'?{...a,state:'world' as const,position:pos(-4,1.55)}:a));
  expect(f.life.tryPush(p,pos(-4,.7),[p],prepared,true)).toBe(false);
  f.life.setApples(copy(sceneFixture.apples));
  expect(f.life.tryPush(p,pos(-4,.7),[p],new Set(),true)).toBe(false);
  expect(f.life.tryPush(p,pos(-4,3),[p],prepared,true)).toBe(false);
  expect(f.life.snapshot('test',1100)!.pots).toEqual(pots);
  // Square footprint corners must block even when circular center distances would not.
  expect(f.life.tryPush(player('p1',-4,.4),pos(-4,.6),[player('other',-3.5,1.7)],prepared,true)).toBe(false);
  const nearPot=copy(sceneFixture.definition);
  const nearInstances=nearPot.instances.map(i=>i.id==='pot-2'?{...i,position:pos(-4,1.7),zone:{minX:-5,maxX:-3,minZ:1,maxZ:3}}:i);
  const packed=domain({...nearPot,instances:nearInstances});
  expect(packed.life.tryPush(player('p1',-4,.4),pos(-4,.7),[],prepared,true)).toBe(false);
  // Add a static wall immediately past an initially free pot; swept bitmap rejects it.
  const d=copy(sceneFixture.definition);const inst=d.instances.map(i=>i.id==='pot-1'?{...i,position:pos(7.4,1),zone:{minX:6,maxX:10,minZ:-1,maxZ:3}}:i);
  const w=domain({...d,instances:inst},true);const actor=player('p2',6.9,1);
  expect(w.life.tryPush(actor,pos(7.4,1),[actor],prepared,true)).toBe(false);
  expect(w.life.snapshot('test',1100)!.pots[0]!.position).toEqual(pos(7.4,1));
});

it('reserves reset footprints for durable apples and restores an overlapping player at the existing safe spawn',()=>{
  const f=durable(),id=f.people[0]!.playerId;
  expect(f.act(player(id),pickup('hold'))).toMatchObject({ok:true});
  const p=player('pusher',-4,.4);
  expect(f.life.tryPush(p,pos(-4,.7),[p],new Set(['0_0']),true)).toBe(true);
  expect(f.act(player(id,-4,.1),place('reset-footprint'))).toMatchObject({code:'BLOCKED'});
  const restarted=domain();const world=new World(restarted.maps,[],undefined,{},restarted.life);
  world.add(player(id,-4,1));expect(world.locate(id)?.position).toEqual(restarted.map.spawn);
  const corrupted=sceneFixture.apples.map(a=>a.id==='apple-1'?{...a,state:'world' as const,position:pos(-4,1)}:a);
  expect(()=>restarted.life.setApples(corrupted)).toThrow('Unsafe durable apple');
});

it('upgrades the pre-merge world-life v3 database, preserving held apples, receipts and migration timestamps across restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-world-life-')); dirs.push(dir);
  const path = join(dir, 'old.sqlite'); const old = new DatabaseSync(path); dbs.push(old);
  const migrations = loadMigrations();
  transaction(old, () => applyMigrations(old, [...migrations.slice(0, 2), { version: 3, sql: migrations[3]!.sql }], 10));
  old.exec("INSERT INTO accounts VALUES('a','Old','old',1); INSERT INTO players(id,account_id,updated_at) VALUES('p','a',1)");
  const store = sqliteWorldLife(old); store.initialize([sceneFixture.definition]);
  const result = store.execute('p', 'test', pickup(), () => ({ v: 1, type: 'hand-result', requestId: 'pick', ok: true, action: 'pickup', apple: { id: 'apple-1', mapId: 'test', state: 'held', holderId: 'p' } }));
  old.close();
  for (let restart = 0; restart < 2; restart++) {
    const db = openDatabase(path, 20 + restart); dbs.push(db);
    expect(db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all()).toEqual([
      { version: 1, applied_at: 10 }, { version: 2, applied_at: 10 }, { version: 3, applied_at: 20 }, { version: 4, applied_at: 10 },
    ]);
    expect(db.prepare('SELECT password_hash FROM accounts').get()!.password_hash).toBeNull();
    expect(sqliteWorldLife(db).execute('p', 'test', pickup(), () => { throw new Error('Receipt must be replayed'); })).toEqual({ ...result, changed: false });
    expect(db.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok');
    db.close();
  }
});

it.each([2, 3])('migrates an actual v%i DB to v4 without losing account, position or NPC history; future/failed migration rolls back',(version)=>{
  const dir=mkdtempSync(join(tmpdir(),'life-v2-'));dirs.push(dir);const path=join(dir,'old.sqlite');const old=new DatabaseSync(path);dbs.push(old);
  old.exec('PRAGMA foreign_keys=ON');transaction(old,()=>applyMigrations(old,loadMigrations().slice(0,version),1));
  const p={accountId:'old-account',playerId:'old-player',displayName:'Old'};
  old.exec("INSERT INTO accounts(id,name,name_key,created_at) VALUES('old-account','Old','old',1); INSERT INTO players(id,account_id,map_id,x,y,z,rotation_y,updated_at) VALUES('old-player','old-account','test',2,0,3,1,1); INSERT INTO npc_dialogue(player_id,npc_id,question,answer,created_at) VALUES('old-player','npc','Q','A',2)");
  if (version === 3) old.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run('preserved-password-hash',p.accountId);
  old.close();
  const upgraded=openDatabase(path);dbs.push(upgraded);expect(upgraded.prepare('SELECT max(version) AS v FROM schema_migrations').get()!.v).toBe(4);
  if (version === 3) expect(upgraded.prepare('SELECT password_hash FROM accounts WHERE id = ?').get(p.accountId)!.password_hash).toBe('preserved-password-hash');
  expect(upgraded.prepare('SELECT count(*) AS n FROM world_apples').get()!.n).toBe(0);
  const restored=sqliteStores(upgraded);expect(restored.accounts.findOrCreate('Old','old',3)).toEqual(p);expect(restored.players.load(p.playerId)?.position).toEqual(pos(2,3));expect(restored.dialogue.history(p.playerId,'npc')).toEqual([{question:'Q',answer:'A'}]);
  expect(()=>transaction(upgraded,()=>applyMigrations(upgraded,[...loadMigrations(),{version:5,sql:'CREATE TABLE transient(id INTEGER); INSERT INTO missing VALUES(1)'}],4))).toThrow();
  expect(upgraded.prepare("SELECT name FROM sqlite_master WHERE name='transient'").get()).toBeUndefined();
  upgraded.prepare('INSERT INTO schema_migrations VALUES(5,4)').run();upgraded.close();expect(()=>openDatabase(path)).toThrow('Не удалось открыть БД');
});
