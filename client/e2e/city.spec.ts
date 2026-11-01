import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { loadWorld } from '../../server/src/world/loader';
import type { GameMap } from '../../server/src/world/GameMap';
import { CITY_BOUNDS, CITY_OUTLINE, CITY_RESIDENTS } from '../../shared/city/catalogue';
import { createFromHub, resume, hudWindow } from './helpers';

let child: ChildProcess, directory: string, origin: string, database: DatabaseSync, world: GameMap;
const evidence = resolve(process.env.CITY_EVIDENCE_DIR ?? '../tasks/evidence/map-ui-completion');
let recordTrail = true;
let walkerName = 'city inspector';
const trail: { district: string; x: number; z: number }[] = [];
test.use({ trace: 'off', screenshot: 'off', video: 'off', viewport: { width: 1920, height: 1080 } });
test.beforeAll(async () => {
 directory=await mkdtemp(join(tmpdir(),'city-real-'));await mkdir(evidence,{recursive:true});
 const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const address=listener.address();if(!address||typeof address==='string')throw new Error('No port');
 const port=address.port;await new Promise<void>(done=>listener.close(()=>done()));origin=`http://127.0.0.1:${port}`;
 const config=join(directory,'config.json');await writeFile(config,JSON.stringify({clientDebug:false,logs:{fileLevel:'off',consoleLevel:'warn'},host:'127.0.0.1',port,clientDir:resolve('dist'),worldDir:resolve('public'),contentDir:resolve('../server/content'),dbPath:join(directory,'game.sqlite'),defaultMap:'market',disconnectGraceMs:100,saveIntervalMs:100,npc:{options:{delayMs:1200}}}));
 child=spawn(process.execPath,['../server/src/app/main.ts','--config',config],{stdio:['ignore','pipe','pipe']});let output='';
 await new Promise<void>((done,reject)=>{const timer=setTimeout(()=>reject(new Error(output||'Startup timeout')),15000);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server ${code}: ${output}`));});child.stderr!.on('data',data=>{output+=data;});child.stdout!.on('data',data=>{output+=data;if(output.includes('ВАВИЛОН ЗАПУЩЕН')){clearTimeout(timer);done();}});});
 database=new DatabaseSync(join(directory,'game.sqlite'),{readOnly:true});
 const loaded=await loadWorld({worldDir:resolve('public'),contentDir:resolve('../server/content'),maps:{market:'maps/market/manifest.json',demo:'maps/demo/manifest.json',science:'maps/demo/science.json'}});world=loaded.maps.get('market')!;
});
test.afterAll(async()=>{if(trail.length)await writeFile(join(evidence,'walk.json'),JSON.stringify(trail,null,2));database?.close();if(child&&child.exitCode===null&&!child.signalCode){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}if(directory)await rm(directory,{recursive:true,force:true});});
function position(){const row=database.prepare("SELECT x,z FROM players p JOIN accounts a ON a.id=p.account_id WHERE a.name_key=?").get(walkerName);if(!row)throw new Error('No walker');return {x:Number(row.x),z:Number(row.z)};}
function route(from:{x:number;z:number},to:{x:number;z:number}) {
 const life=world.manifest.worldLife;
 const pots=life?.instances.filter(instance=>life.templates.find(template=>template.id===instance.templateId)?.behavior==='pushable')??[];
 const clearOfPots=(x:number,z:number)=>pots.every(pot=>pot.zone
  ? x<pot.zone.minX-.6||x>pot.zone.maxX+.6||z<pot.zone.minZ-.6||z>pot.zone.maxZ+.6
  : Math.hypot(x-pot.position.x,z-pot.position.z)>1.2);
 const unit=1, key=(x:number,z:number)=>`${x},${z}`, start={x:Math.round(from.x/unit),z:Math.round(from.z/unit)};
 const open=[start],previous=new Map<string,string|null>([[key(start.x,start.z),null]]),points=new Map([[key(start.x,start.z),start]]);
 let end='';
 for(let index=0;index<open.length;index++){
  const p=open[index]!;if(Math.hypot(p.x*unit-to.x,p.z*unit-to.z)<1.3){end=key(p.x,p.z);break;}
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
   const x=p.x+dx!,z=p.z+dz!,id=key(x,z);if(previous.has(id))continue;
   // Planning must include the standing body's clearance, and leave room for
   // input/network timing around edges. Bitmap-only paths can cross low masonry.
   if(!clearOfPots(x*unit,z*unit)||![-.35,0,.35].every(offset=>world.canTraverse({x:p.x*unit+offset,y:0,z:p.z*unit+offset},{x:x*unit+offset,y:0,z:z*unit+offset}) && world.isSafeSupport(x*unit+offset,z*unit+offset)))continue;
   previous.set(id,key(p.x,p.z));const next={x,z};points.set(id,next);open.push(next);
  }
 }
 if(!end)throw new Error(`No walking route from ${JSON.stringify(from)} to ${JSON.stringify(to)}`);
 const path:{x:number;z:number}[]=[];for(let id:string|null=end;id;id=previous.get(id)??null){const p=points.get(id)!;path.push({x:p.x*unit,z:p.z*unit});}path.reverse();
 return path.filter((p,i)=>i===0||i===path.length-1||((p.x-path[i-1]!.x)!==(path[i+1]!.x-p.x))||((p.z-path[i-1]!.z)!==(path[i+1]!.z-p.z)));
}
async function walk(page:Page,target:{x:number;z:number},district:string){
 await resume(page);const path=route(position(),target);console.log('WALK',district,'segments',path.length);
 for(const waypoint of path){
  for(const axis of ['x','z'] as const){
   for(let correction=0;correction<6;correction++){
    const before=position(),delta=waypoint[axis]-before[axis];if(Math.abs(delta)<.3)break;
    const key=axis==='x'?(delta>0?'d':'a'):(delta>0?'s':'w');
    await page.keyboard.down(key);const deadline=Date.now()+Math.abs(delta)/2*1000+5000;
    while(Date.now()<deadline){await page.waitForTimeout(60);const remaining=(waypoint[axis]-position()[axis])*Math.sign(delta);if(remaining<.25)break;}
    await page.keyboard.up(key);await page.waitForTimeout(140);
    if(Math.abs(position()[axis]-before[axis])<.08)throw new Error(`Blocked at ${JSON.stringify(position())}, toward ${JSON.stringify(waypoint)} (${district})`);
   }
  }
 }
 expect(Math.hypot(position().x-target.x,position().z-target.z),district).toBeLessThan(2.4);
 if(recordTrail){trail.push({district,...position()});await writeFile(join(evidence,'walk.json'),JSON.stringify(trail,null,2));}
}
async function shot(page:Page,name:string){
 if(process.env.CITY_CAPTURE === 'off')return;
 // The capture budget includes retries. New work is capped at three. Never overwrite or reset this budget.
 const files=(await readdir(evidence)).filter(file=>file.endsWith('.png'));
 if(files.some(file=>file.endsWith(`-${name}.png`)))return;
 if(files.length>=Number(process.env.CITY_CAPTURE_LIMIT??3))throw new Error('User screenshot budget exhausted');
 await page.screenshot({path:join(evidence,`${files.length+1}-${name}.png`)});console.log('SHOT',files.length+1,name);
}
test('walks every district with real keyboard input, checks UI and captures at most seven images',async({page})=>{
 test.setTimeout(900000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin);await page.getByLabel('Имя игрока').fill('City inspector');await page.getByRole('button',{name:'Демонстрационный вход по имени',exact:true}).click();await createFromHub(page);
 await page.waitForTimeout(500);await page.mouse.wheel(0,400);await page.waitForTimeout(300);
 // Seven planned pictures. Every other check uses DOM/real authoritative positions, never another capture.
 await shot(page,'market');
 const tours=[
  {ids:['bakery','mill'],shot:'bakery-mill'},
  {ids:['garden','homes'],shot:'garden-homes'},
  {ids:['palace','gardens'],shot:'palace-gardens'},
  {ids:['fountain','school','dye'],shot:'school-dye'},
  {ids:['tower','dock','gate','guest','pasture'],shot:''},
 ];
 for(const tour of tours){
  for(const id of tour.ids){const npc=CITY_RESIDENTS.find(n=>n.location===id)!;await walk(page,{x:npc.x,z:npc.z},id);
   await page.keyboard.press('e');await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('dialog')).toContainText(npc.name);await page.keyboard.press('Escape');await resume(page);
  }
  await page.waitForTimeout(400);if(tour.shot)await shot(page,tour.shot);
 }
 await walk(page,CITY_RESIDENTS.find(n=>n.id==='nindada')!,'gardens-recheck');await page.waitForTimeout(700);await shot(page,'gardens-fixed');
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Помощь',exact:true}).click();await expect(page.getByRole('dialog',{name:'Как играть'})).toBeVisible();
 for(const width of [1920,390]){await page.setViewportSize({width,height:width===390?844:1080});expect(await page.getByRole('dialog').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);await page.getByRole('button',{name:'Назад',exact:true}).focus();await expect(page.getByRole('button',{name:'Назад',exact:true})).toBeFocused();}
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Пауза'})).toBeVisible();await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByLabel('Громкость').fill('45');await page.keyboard.press('Escape');await resume(page);
 await hudWindow(page,'3');await page.getByRole('button',{name:'Весь город',exact:true}).click();await expect(page.getByRole('dialog',{name:'Карта Вавилона'})).toContainText('Районы города');
 await page.locator('.city-map-index summary').click();await expect(page.locator('.city-map-index')).toContainText('15 / 15');
 await shot(page,'map-390');expect(errors).toEqual([]);
});

test('whole-city overview fits narrow and wide screens without horizontal cropping',async({page})=>{
 test.setTimeout(60000);
 await page.goto(origin);await page.getByLabel('Имя игрока').fill('Map inspector');await page.getByRole('button',{name:'Демонстрационный вход по имени',exact:true}).click();await createFromHub(page);
 await hudWindow(page,'3');await page.getByRole('button',{name:'Весь город',exact:true}).click();
 await expect(page.locator('.city-outline')).toHaveAttribute('points',CITY_OUTLINE.map(point=>point.join(',')).join(' '));
 for(const width of [390,1920]){
  await page.setViewportSize({width,height:width===390?844:1080});
  await expect.poll(()=>page.locator('.map-frame').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  const inside=await page.locator('.world-map').evaluate((node,cityBounds)=>{
   const svg=node as SVGSVGElement, rect=svg.getBoundingClientRect(),matrix=svg.getScreenCTM()!;
   return [[cityBounds.minX,cityBounds.minZ],[cityBounds.maxX,cityBounds.minZ],[cityBounds.minX,cityBounds.maxZ],[cityBounds.maxX,cityBounds.maxZ]].every(([x,z])=>{const point=new DOMPoint((x!-z!)*.8660254,(x!+z!)*.5).matrixTransform(matrix);return point.x>=rect.left&&point.x<=rect.right&&point.y>=rect.top&&point.y<=rect.bottom;});
  },CITY_BOUNDS);expect(inside).toBe(true);
  const svg=page.locator('.world-map'),box=await svg.boundingBox();if(!box)throw Error('Map bounds');
  const before=await svg.evaluate(node=>{const svg=node as SVGSVGElement;return {x:svg.viewBox.baseVal.x,y:svg.viewBox.baseVal.y,scale:svg.getScreenCTM()!.a};});
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+24,box.y+box.height/2+24,{steps:4});await page.mouse.up();
  const after=await svg.evaluate(node=>({x:(node as SVGSVGElement).viewBox.baseVal.x,y:(node as SVGSVGElement).viewBox.baseVal.y}));
  expect(before.x-after.x).toBeCloseTo(24/before.scale,1);expect(before.y-after.y).toBeCloseTo(24/before.scale,1);
  await page.getByRole('button',{name:'Рынок и окрестности',exact:true}).click();await page.getByRole('button',{name:'Весь город',exact:true}).click();
 }
});


test('city task UI starts at the resident, rejects the wrong recipe amount, and updates the HUD',async({page})=>{
 test.setTimeout(120000);recordTrail=false;walkerName='task inspector';
 await page.goto(origin);await page.getByLabel('Имя игрока').fill('Task inspector');await page.getByRole('button',{name:'Демонстрационный вход по имени',exact:true}).click();await createFromHub(page);
 await walk(page,CITY_RESIDENTS.find(n=>n.id==='ibbi')!,'bakery-task');await page.keyboard.press('e');
 await page.getByRole('button',{name:'Принять задание',exact:true}).click();
 await expect(page.getByLabel('Текущее задание',{exact:true})).toContainText('Bread for the shepherd');
 await page.keyboard.press('Escape');await walk(page,CITY_RESIDENTS.find(n=>n.id==='shamhat')!,'mill-task');await page.keyboard.press('e');
 await page.getByRole('button',{name:'One bag',exact:true}).click();await expect(page.locator('.city-active')).toContainText('Шаг 1 / 5');
 await page.getByRole('button',{name:'Two bags',exact:true}).click();
 await expect(page.getByLabel('Текущее задание',{exact:true})).toContainText('2 / 5');
 await page.keyboard.press('Escape');await resume(page);await hudWindow(page,'Tab');await expect(page.getByRole('dialog')).toContainText('Take dates');
});


test('living city: carry artifacts, scatter birds, feeding camels, walking mule and detailed map',async({page})=>{
 test.setTimeout(180000);recordTrail=false;walkerName='life inspector';
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 let scene:import('../../shared/world-life/types').SceneStateMessage|null=null;
 const currentScene=():import('../../shared/world-life/types').SceneStateMessage|null=>scene;
 page.on('websocket',socket=>socket.on('framereceived',frame=>{const text=String(frame.payload),start=text.indexOf('["world-life",');if(start<0)return;try{const packet=JSON.parse(text.slice(start))[1];if(packet.type==='scene-state')scene=packet;}catch{}}));
 await page.goto(origin);await page.getByLabel('Имя игрока').fill('Life inspector');await page.getByRole('button',{name:'Демонстрационный вход по имени',exact:true}).click();await createFromHub(page);
 await expect.poll(()=>currentScene()?.birds?.length).toBe(12);
 await walk(page,{x:-1.6,z:9},'tablet');await expect(page.getByLabel('Предмет в руке')).toContainText('Поднять табличку');await page.keyboard.press('f');
 await expect(page.getByLabel('Предмет в руке')).toContainText('Положить табличку');
 expect(database.prepare("SELECT state FROM world_apples WHERE id='city-tablet-market'").get()?.state).toBe('held');
 await walk(page,{x:0,z:10.5},'place-tablet');await page.keyboard.press('f');
 await expect.poll(()=>database.prepare("SELECT state FROM world_apples WHERE id='city-tablet-market'").get()?.state).toBe('world');
 await walk(page,{x:7,z:9},'birds');await expect.poll(()=>currentScene()?.birds?.find(b=>b.id==='city-bird-1')?.startedMs).not.toBeNull();
 await walk(page,{x:1,z:10},'birds-return');await expect.poll(()=>currentScene()?.birds?.find(b=>b.id==='city-bird-1')?.startedMs,{timeout:15000}).toBeNull();
 await walk(page,{x:21.5,z:31},'camels');await page.waitForTimeout(700);await shot(page,'camel-feeding');
 expect(currentScene()?.definition.packAnimals?.filter(a=>a.behavior==='feed')).toHaveLength(2);
 await walk(page,{x:-30,z:32.6},'mule');await page.waitForTimeout(700);await shot(page,'mule-circuit');
 const mule=currentScene()?.definition.packAnimals?.find(a=>a.kind==='mule');
 expect(mule?.route).toHaveLength(12);
 expect(mule!.route.reduce((sum,p)=>sum+p.z/12,0)).toBeCloseTo(24.802,2);
 await walk(page,CITY_RESIDENTS.find(n=>n.id==='sharrum')!,'boat-approach');
 expect(Math.hypot(position().x-CITY_RESIDENTS.find(n=>n.id==='sharrum')!.x,position().z-CITY_RESIDENTS.find(n=>n.id==='sharrum')!.z)).toBeLessThan(2.7);
 await hudWindow(page,'3');await page.getByRole('button',{name:'Весь город',exact:true}).click();
 expect(await page.locator('.city-map-details polygon').count()).toBeGreaterThan(100);
 await page.getByRole('button',{name:'Жители',exact:true}).click();await expect(page.getByRole('button',{name:'Жители',exact:true})).toHaveAttribute('aria-pressed','true');
 const frame=page.locator('.map-frame'),before=await page.locator('.world-map').getAttribute('viewBox');await frame.focus();await page.keyboard.press('ArrowRight');expect(await page.locator('.world-map').getAttribute('viewBox')).not.toBe(before);
 await page.getByRole('button',{name:'К игроку',exact:true}).click();await page.getByRole('button',{name:'Рынок и окрестности',exact:true}).click();await page.getByRole('button',{name:'Весь город',exact:true}).click();
 await page.setViewportSize({width:1280,height:900});await shot(page,'detailed-map');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await frame.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();expect(errors).toEqual([]);
});
