import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase, sqliteStores } from '../src/persistence/database.ts';
import { sqliteBabylon } from '../src/persistence/babylon.ts';
import { BabylonService } from '../src/babylon/BabylonService.ts';
import { testLanguagePort } from '../src/babylon/TestLanguagePort.ts';
import { CITY_QUESTS } from '../src/city/quests.ts';
import { CITY_RESIDENTS } from '../../shared/city/catalogue.ts';
import { parseBabylonRequest, parseBabylonResult } from '../../shared/babylon/validate.ts';
import type { BabylonAction } from '../../shared/babylon/types.ts';
import type { BabylonLocation } from '../src/babylon/ports.ts';

const cleanup: (()=>void)[] = [];
afterEach(()=>{ for(const action of cleanup.splice(0))action(); });
function setup() {
 const dir=mkdtempSync(join(tmpdir(),'city-')),path=join(dir,'game.sqlite');let db:DatabaseSync=openDatabase(path);
 cleanup.push(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const stores=sqliteStores(db),players=['Guide','Carrier','Visitor','Fourth'].map(name=>stores.accounts.findOrCreate(name,name,1));
 const positions=new Map<string,BabylonLocation>();let sequence=0;
 const make=()=>new BabylonService({store:sqliteBabylon(db),language:testLanguagePort,generate:async()=>({ok:false,reason:'server-busy'}),now:Date.now,monotonicNow:()=>performance.now(),id:()=>`city-${++sequence}`,location:id=>positions.get(id)??null});
 let service=make();
 return {players,positions,get service(){return service;},get db(){return db;},
  near(index:number,id:string) { const npc=CITY_RESIDENTS.find(n=>n.id===id)!;positions.set(players[index]!.accountId,{mapId:'market',position:{x:npc.x,y:0,z:npc.z}}); },
  call(index:number,action:BabylonAction,requestId=`op-${++sequence}`) { return service.handle(players[index]!,parseBabylonRequest({v:2,requestId,action}),players[index]!.playerId).then(parseBabylonResult); },
  restart(){db.close();db=openDatabase(path);service=make();},
 };
}
it('all four waves: every quest completes with persistent server steps, retries and private discovery',async()=>{
 const f=setup();await f.call(0,{type:'enroll',size:1,native:'ru',learning:'en'});
 for(const quest of CITY_QUESTS){
  f.near(0,quest.giver);await f.call(0,{type:'city-start',questId:quest.id});
  for(let index=0;index<quest.steps.length;index++){
   const step=quest.steps[index]!;f.near(0,step.target);
   const action={type:'city-step' as const,questId:quest.id,step:index,choice:String(step.correct),targetId:step.target};
   const receipt=`${quest.id}-${index}`;await f.call(0,action,receipt);await f.call(0,action,receipt);
   if(index===0){f.restart();expect(f.service.state(f.players[0]!).city?.active?.step??quest.steps.length).toBe(quest.steps.length===1?quest.steps.length:1);}
  }
  expect(f.service.state(f.players[0]!).city?.completed).toContain(quest.id);
 }
 f.restart();expect(f.service.state(f.players[0]!).city?.completed).toHaveLength(CITY_QUESTS.length);
 expect(f.service.state(f.players[0]!).city?.discovered.length).toBeGreaterThan(8);
 expect(f.service.state(f.players[2]!).city?.discovered).toEqual([]);
 expect(f.service.state(f.players[2]!).city?.completed).toEqual([]);
 expect(f.db.prepare('PRAGMA integrity_check').get()).toEqual({integrity_check:'ok'});
});
it('cooperation: only reader gets the clue, only actor can advance, stale/wrong/remote actions are rejected',async()=>{
 const f=setup();for(const i of [0,1])await f.call(i,{type:'enroll',size:2,native:'ru',learning:i===0?'en':'es'});
 const quest=CITY_QUESTS.find(q=>q.id==='QUEST-003')!;f.near(0,quest.giver);await f.call(0,{type:'city-start',questId:quest.id});
 expect(f.service.state(f.players[0]!).city?.active?.clue).toContain('two bags');
 expect(f.service.state(f.players[1]!).city?.active?.clue).toBeNull();
 expect(f.service.state(f.players[1]!).city?.active?.options.map(o=>o.label)).toContain('Dos sacos');
 const step=quest.steps[0]!,action={type:'city-step' as const,questId:quest.id,step:0,targetId:step.target,choice:String(step.correct)};
 f.near(0,step.target);await expect(f.call(0,action)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(f.call(1,action)).rejects.toMatchObject({code:'FORBIDDEN'});
 f.near(1,step.target);await f.call(1,{...action,choice:'0'});expect(f.service.state(f.players[1]!).city?.active?.step).toBe(0);
 await f.call(1,action);await expect(f.call(1,action)).rejects.toMatchObject({code:'FORBIDDEN'});
 f.restart();expect(f.service.state(f.players[0]!).city?.active?.step).toBe(1);
 await expect(f.call(2,action)).rejects.toMatchObject({code:'NOT_READY'});
});
it('atomic city receipts roll back progress and strict actions reject spoofed ownership/steps',async()=>{
 const f=setup();await f.call(0,{type:'enroll',size:1,native:'ru',learning:'en'});f.near(0,'kuddu');
 f.db.exec("CREATE TRIGGER fail_city BEFORE INSERT ON babel_operations BEGIN SELECT RAISE(ABORT,'receipt failure'); END");
 await expect(f.call(0,{type:'city-start',questId:'QUEST-002'})).rejects.toThrow('receipt failure');
 expect(f.service.state(f.players[0]!).city?.active).toBeNull();
 f.db.exec('DROP TRIGGER fail_city');
 for(const action of [{type:'city-start',questId:'QUEST-002',playerId:'other'},{type:'city-step',questId:'QUEST-002',step:-1,targetId:'potter',choice:'1'},{type:'city-step',questId:'QUEST-002',step:'0',targetId:'potter',choice:'1'}])expect(()=>parseBabylonRequest({v:2,requestId:'invalid',action})).toThrow();
});

it('tour accepts three distinct chosen places, persists the choice and rejects repeated visits',async()=>{
 const f=setup();await f.call(0,{type:'enroll',size:1,native:'ru',learning:'en'});f.near(0,'herodotus');await f.call(0,{type:'city-start',questId:'QUEST-005'});
 for(const [step,targetId] of ['belu','ishme','fruit-seller'].entries()){
  f.near(0,targetId);await f.call(0,{type:'city-step',questId:'QUEST-005',step,targetId,choice:'0'});f.restart();
  if(step<2){expect(f.service.state(f.players[0]!).city?.active?.targets).not.toContain(targetId);await expect(f.call(0,{type:'city-step',questId:'QUEST-005',step:step+1,targetId,choice:'0'})).rejects.toMatchObject({code:'FORBIDDEN'});}
 }
 expect(f.service.state(f.players[0]!).city?.active?.targetId).toBe('apil');
});
