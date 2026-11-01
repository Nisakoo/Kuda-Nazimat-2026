import { readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { startApplication } from '../src/app/application.ts';
import { parseConfig } from '../src/app/config.ts';
import { createGame } from '../src/game/index.ts';
import { silentLogger } from '../src/common/logger.ts';
import { parseServerMessage } from '../../shared/protocol/validate.ts';
import { parseWorldLifeServerMessage } from '../../shared/world-life/validate.ts';
import type { WorldLifeServerMessage, SceneStateMessage, HandResultMessage, WorldLifeDefinition } from '../../shared/world-life/types.ts';
import { makeWorld } from './a-helpers.ts';
import { startTrusted } from './tls-helpers.ts';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
it('real HTTP auth, 4 BABEL roles, world-life sockets, pickup race, lost reply, takeover and durable restart agree',async()=>{
  const world=await makeWorld([]);const root=dirname(world.worldDir);cleanups.push(()=>rm(root,{recursive:true,force:true}));
  const fixture=JSON.parse(await readFile(new URL('../../shared/world-life/fixtures.json',import.meta.url),'utf8')) as {valid:boolean;packet:{type:string;definition?:WorldLifeDefinition}}[];
  const baseDefinition=fixture.find(f=>f.valid&&f.packet.type==='scene-state')!.packet.definition!;
  const definition={...baseDefinition,templates:baseDefinition.templates.map(t=>t.id==='apple'?{...t,assetId:'pickup-apple'}:t)};
  const manifestPath=join(world.worldDir,'maps/test/manifest.json');const manifest=JSON.parse(await readFile(manifestPath,'utf8')) as Record<string,unknown>;manifest.worldLife=definition;
  const before=(await readFile(manifestPath)).byteLength;
  const appleModel=Buffer.alloc(100,9);await writeFile(join(world.worldDir,'assets/models/apple.glb'),appleModel);
  (manifest.models as Record<string,string>)['pickup-apple']='apple.glb';
  (manifest.assets as Record<string,{bytes:number;memory:number}>)['assets/models/apple.glb']={bytes:appleModel.length,memory:1000};
  const chunks=manifest.chunks as {id:string;assets:string[]}[];
  chunks.find(c=>c.id==='0_0')!.assets.push('pickup-apple');
  expect(chunks.find(c=>c.id==='2_2')!.assets).not.toContain('pickup-apple');
  const resources=Number(manifest.worldBytes)-before+appleModel.length;
  for(let i=0;i<10;i++){const total=resources+Buffer.byteLength(JSON.stringify(manifest));if(total===manifest.worldBytes)break;manifest.worldBytes=total;}
  await writeFile(manifestPath,JSON.stringify(manifest));await writeFile(join(root,'index.html'),'<main>test</main>');
  const config={...parseConfig({...world,clientDir:root,dbPath:join(root,'game.sqlite'),defaultMap:'test',host:'127.0.0.1',staticChunkRadius:0,saveIntervalMs:50,disconnectGraceMs:80,npc:{options:{delayMs:0}}},join(root,'config.json')),port:0};
  let app=await startTrusted(startApplication, config,createGame,silentLogger);cleanups.push(async()=>{await app.stop();});
  const origin=()=>{const a=app.server.address();if(!a||typeof a==='string')throw new Error('No address');return `https://127.0.0.1:${a.port}`;};
  const guest=async(name:string)=>await(await fetch(`${origin()}/api/auth/guest`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})})).json() as {token:string};
  const auth=await Promise.all(['Role1','Role2','Role3','Role4'].map(guest));
  for(const [index,a] of auth.entries()){
    const res=await fetch(`${origin()}/api/babylon`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${a.token}`},body:JSON.stringify({v:2,requestId:`enroll-${index}`,action:{type:'enroll',size:4,native:'ru',learning:'en'}})});
    expect(res.status).toBe(200);expect((await res.json() as {state:{party:{role:number}}}).state.party.role).toBe(index+1);
  }
  const db=new DatabaseSync(config.dbPath);cleanups.push(async()=>{db.close();});
  const people=db.prepare('SELECT p.id,a.name FROM players p JOIN accounts a ON a.id=p.account_id ORDER BY a.name').all();
  const starts=[[0,0],[0,0],[-5,5],[-10,5]];
  for(const [i,p] of people.entries())db.prepare('UPDATE players SET map_id=\'test\',x=?,y=0,z=?,rotation_y=0 WHERE id=?').run(starts[i]![0]!,starts[i]![1]!,String(p.id));
  // Compare complete profiles, including the unchanged BABEL inventory.
  const inventory=()=>db.prepare('SELECT * FROM babel_profiles ORDER BY player_id').all().map(row=>JSON.stringify(row));
  const inventoryBefore=inventory();
  const connect=async(token:string,joinWorld=true)=>{
    const socket:Socket=io(`${origin()}/game`,{auth:{version:3,token},transports:['websocket'],reconnection:false,forceNew:true,autoConnect:false});cleanups.push(async()=>{socket.disconnect();});
    const life:WorldLifeServerMessage[]=[],game:ReturnType<typeof parseServerMessage>[]=[];let drop:string|null=null;
    socket.on('world-life',(raw:unknown)=>{const p=parseWorldLifeServerMessage(raw);if(p.type==='hand-result'&&p.requestId===drop){drop=null;return;}life.push(p);});socket.on('game',(raw:unknown)=>game.push(parseServerMessage(raw)));
    const connected=new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});socket.connect();await connected;
    if(joinWorld){socket.emit('game',{v:3,type:'join',requestId:'join',mapId:'test'});await expect.poll(()=>game.some(p=>p.type==='joined')).toBe(true);await expect.poll(()=>life.some(p=>p.type==='scene-state')).toBe(true);}
    return {socket,life,game,dropNext(id:string){drop=id;},send(requestId:string,action='pickup',targetId?:string){socket.emit('world-life',{v:1,type:'hand',requestId,action,...(targetId&&{targetId})});},async result(id:string){await expect.poll(()=>life.find(p=>p.type==='hand-result'&&p.requestId===id)).toBeDefined();return life.find(p=>p.type==='hand-result'&&p.requestId===id) as HandResultMessage;}};
  };
  const early=await connect(auth[0]!.token,false);early.send('early','pickup','apple-1');expect(await early.result('early')).toMatchObject({ok:false,code:'NOT_READY'});early.socket.disconnect();
  await expect(connect('invalid-token',false)).rejects.toMatchObject({data:{code:'UNAUTHORIZED'}});
  const clients=[];for(const a of auth)clients.push(await connect(a.token));
  const scene=clients[0]!.life.find(p=>p.type==='scene-state') as SceneStateMessage;
  expect(clients.every(c=>c.life.some(p=>p.type==='scene-state'&&p.sceneId===scene.sceneId&&p.epochMs===scene.epochMs))).toBe(true);
  expect(scene.apples).toHaveLength(5);expect(scene.pots).toHaveLength(4);
  const [a,b,c,d]=clients as [typeof clients[number],typeof clients[number],typeof clients[number],typeof clients[number]];
  a.send('race-a','pickup','apple-1');b.send('race-b','pickup','apple-1');const raced=await Promise.all([a.result('race-a'),b.result('race-b')]);expect(raced.filter(r=>r.ok)).toHaveLength(1);
  const winner=raced[0]!.ok?a:b,loser=raced[0]!.ok?b:a;
  winner.send(raced[0]!.ok?'race-a':'race-b','place');expect(await winner.result(raced[0]!.ok?'race-a':'race-b')).toMatchObject({ok:true});
  await expect.poll(()=>winner.life.some(p=>p.type==='hand-result'&&!p.ok&&p.code==='CONFLICT')).toBe(true);
  c.dropNext('lost');c.send('lost','pickup','apple-3');await expect.poll(()=>db.prepare("SELECT state FROM world_apples WHERE id='apple-3'").get()!.state).toBe('held');expect(c.life.some(p=>p.type==='hand-result'&&p.requestId==='lost')).toBe(false);
  c.send('lost','pickup','apple-3');expect(await c.result('lost')).toMatchObject({ok:true,apple:{holderId:people[2]!.id}});
  d.send('role4','pickup','apple-4');expect(await d.result('role4')).toMatchObject({ok:true});
  const sceneCounts=clients.map(client=>client.life.filter(p=>p.type==='scene-state').length);
  for(let i=1;i<=12;i++){loser.socket.emit('game',{v:3,type:'input',requestId:'move-current',sequence:i,direction:{x:1,z:0},sprint:false,jumpId:0,preparedChunks:['0_0']});await sleep(100);}
  expect(loser.game.some(p=>p.type==='error'&&p.code==='INVALID')).toBe(false);
  expect(clients.every((client,i)=>client.life.filter(p=>p.type==='scene-state').length>sceneCounts[i]!)).toBe(true);
  loser.socket.emit('game',{v:3,type:'input',requestId:'stop',sequence:13,direction:{x:0,z:0},sprint:false,jumpId:0,preparedChunks:['0_0']});
  loser.send('other-apple','pickup','apple-2');expect(await loser.result('other-apple')).toMatchObject({ok:true});
  for(let i=14;i<=20;i++){loser.socket.emit('game',{v:3,type:'input',requestId:'move-current',sequence:i,direction:{x:0,z:1},sprint:false,jumpId:0,preparedChunks:['0_0']});await sleep(50);}
  // Remote holders must update while MOVE deltas are still flowing, not only after an idle gap.
  expect(clients.every(client=>{const latest=client.life.filter((p):p is SceneStateMessage=>p.type==='scene-state').at(-1);return latest?.apples.filter(a=>a.state==='held').length===4;})).toBe(true);
  expect(db.prepare("SELECT count(*) AS n FROM world_apples WHERE state='held'").get()!.n).toBe(4);expect(inventory()).toEqual(inventoryBefore);
  const takeover=await connect(auth[2]!.token);expect(takeover.life.find(p=>p.type==='scene-state')).toMatchObject({apples:expect.arrayContaining([{id:'apple-3',mapId:'test',state:'held',holderId:people[2]!.id}])});
  await expect.poll(()=>c.socket.connected).toBe(false);takeover.send('lost','pickup','apple-3');expect(await takeover.result('lost')).toMatchObject({ok:true});
  const saved=db.prepare('SELECT * FROM world_apples ORDER BY id').all();await app.stop();
  // Resume outside the original scene's chunk window, without releasing the held apple.
  db.prepare('UPDATE players SET x=60,y=0,z=60 WHERE id=?').run(String(people[2]!.id));
  app=await startTrusted(startApplication, config,createGame,silentLogger);
  const restored=await connect(auth[2]!.token);restored.send('lost','pickup','apple-3');expect(await restored.result('lost')).toMatchObject({ok:true});expect(db.prepare('SELECT * FROM world_apples ORDER BY id').all()).toEqual(saved);expect(inventory()).toEqual(inventoryBefore);
  expect(restored.life.find(p=>p.type==='scene-state')).toMatchObject({apples:expect.arrayContaining([{id:'apple-3',mapId:'test',state:'held',holderId:people[2]!.id}])});
  expect((restored.life.find(p=>p.type==='scene-state') as SceneStateMessage).sceneId).not.toBe(scene.sceneId);
  const headers={Authorization:`Bearer ${auth[2]!.token}`};
  expect((await fetch(`${origin()}/world/assets/models/apple.glb`,{headers})).status).toBe(200);
  expect((await fetch(`${origin()}/world/maps/test/chunks/0_0.json`,{headers})).status).toBe(404);
  expect((await fetch(`${origin()}/world/maps/test/chunks/2_2.json`,{headers})).status).toBe(200);
  expect((await fetch(`${origin()}/world/assets/models/apple.glb`)).status).toBe(401);
  // A real polling client stops reading after join. MOVE deltas must not build an unbounded queue.
  const moving=await connect(auth[0]!.token);
  const endpoint=`${origin()}/socket.io/?EIO=4&transport=polling`;
  const handshake=await(await fetch(endpoint)).text();const sid=(JSON.parse(handshake.slice(1)) as {sid:string}).sid;
  const polling=`${endpoint}&sid=${sid}`;
  const post=(body:string)=>fetch(polling,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body});
  expect((await post(`40/game,${JSON.stringify({version:3,token:auth[3]!.token})}`)).status).toBe(200);
  expect(await(await fetch(polling)).text()).toContain('40/game,');
  expect((await post(`42/game,${JSON.stringify(['game',{v:3,type:'join',requestId:'slow-join',mapId:'test'}])}`)).status).toBe(200);
  for(let i=1;i<=80;i++){moving.socket.emit('game',{v:3,type:'input',requestId:'move-current',sequence:i,direction:{x:Math.floor(i/10)%2?1:-1,z:0},sprint:false,jumpId:0,preparedChunks:['0_0']});await sleep(50);}
  expect((await fetch(polling)).status).toBe(400);
  expect(moving.socket.connected).toBe(true);
},20000);
