import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const out=dirname(fileURLToPath(import.meta.url));
const require=createRequire(resolve(out,'../../../client/package.json'));
const {chromium,expect}=require('@playwright/test');
const origin='http://127.0.0.1:4387';
const result={origin,startedAt:new Date().toISOString(),scope:'Independent static entry only; actual UI guest auth; no registration submit, enrollment, avatar, world, API injection or Settings Apply.',flows:[]};
await mkdir(join(out,'fresh-static'),{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});
for(const [width,height] of [[1622,970],[1280,800],[390,844],[640,480]]){
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
 const page=await context.newPage();page.setDefaultTimeout(12000);
 const f={width,height,dpr:1,screens:[],actions:[],errors:[],websockets:0,requests:[]};result.flows.push(f);
 page.on('websocket',()=>f.websockets++);page.on('pageerror',e=>f.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')f.errors.push(m.text())});
 page.on('request',r=>{if(r.url().includes('/api/')) f.requests.push({method:r.method(),url:r.url()})});
 async function state(){return page.evaluate(()=>{
  const gear=document.querySelector('button.settings-button');const rect=gear?.getBoundingClientRect();
  const name=e=>e?{tag:e.tagName,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),text:e.innerText?.trim().slice(0,100),cls:typeof e.className==='string'?e.className:''}:null;
  const dialogs=[...document.querySelectorAll('dialog[open]')];const modal=dialogs.find(d=>d.matches(':modal'));
  const x=rect?rect.x+rect.width/2:0,y=rect?rect.y+rect.height/2:0;const hit=document.elementFromPoint(x,y);
  return {canvas:document.querySelectorAll('canvas').length,pointerLocked:!!document.pointerLockElement,bundle:[...document.scripts].map(s=>s.src).filter(Boolean),active:name(document.activeElement),dialogs:dialogs.map(d=>({label:d.getAttribute('aria-labelledby'),modal:d.matches(':modal'),text:d.innerText.slice(0,100)})),gear:{rect:rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null,center:{x,y},hit:name(hit),hitIsGear:!!gear&&(gear===hit||gear.contains(hit)),insideModal:!!modal&&modal.contains(gear)},scroll:[...document.querySelectorAll('.entry-login-screen,dialog[open]')].map(e=>({class:e.className,top:e.scrollTop,left:e.scrollLeft,width:e.clientWidth,scrollWidth:e.scrollWidth,height:e.clientHeight,scrollHeight:e.scrollHeight}))};
 })}
 async function capture(label){const s=await state();if(s.canvas!==0||f.websockets!==0||s.pointerLocked)throw Error('Forbidden canvas/websocket/PointerLock');const file=`fresh-static/${label}-${width}x${height}.png`;await page.screenshot({path:join(out,file)});f.screens.push({label,file,...s,websockets:f.websockets});return s;}
 async function tabs(label,count=16){const order=[];for(let i=0;i<count;i++){await page.keyboard.press('Tab');order.push((await state()).active)}f.actions.push({label,order});return order;}
 try{
  await page.goto(origin,{waitUntil:'networkidle'});await expect(page.getByRole('heading',{name:'Войти в город'})).toBeVisible();
  let s=await capture('login');
  if(width===1622){await page.getByRole('button',{name:'Настройки',exact:true}).click();await expect(page.getByRole('dialog',{name:'Настройки',exact:true})).toBeVisible();await capture('settings-first-action');await page.getByRole('button',{name:'Закрыть настройки'}).click();f.actions.push({label:'Settings closed without Apply',state:await state()});}
  if(width===390){await page.mouse.click(s.gear.center.x,s.gear.center.y);f.actions.push({label:'R01 actual pointer click at gear center',state:await state()});await capture('login-gear-click');await tabs('Login actual Tab traversal',14);await capture('login-after-tabs');}
  await page.getByRole('tab',{name:'Регистрация',exact:true}).click();await capture('registration');
  await page.getByRole('tab',{name:'Вход',exact:true}).click();await page.getByLabel('Имя игрока',{exact:true}).fill(`indstatic-${width}-${Date.now().toString(36)}`);
  await page.getByRole('button',{name:'Демонстрационный вход по имени',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Куда отправимся?',exact:true})).toBeVisible();s=await capture('mode');
  await page.mouse.click(s.gear.center.x,s.gear.center.y);f.actions.push({label:'Mode root gear actual pointer click',state:await state()});
  await tabs('Mode actual Tab traversal');await capture('mode-after-tabs');
  const solo=page.getByRole('radio',{name:/^Одному/});await solo.click();await page.keyboard.press('ArrowRight');await expect(page.getByRole('radio',{name:/^С друзьями/})).toBeChecked();await capture('friends');
  await page.keyboard.press('Enter');await expect(page.getByRole('dialog',{name:'Ваши языки',exact:true})).toBeVisible();s=await capture('languages');
  await page.mouse.click(s.gear.center.x,s.gear.center.y);f.actions.push({label:'Languages root gear actual pointer click',state:await state()});await tabs('Languages actual Tab traversal',12);await capture('languages-after-tabs');
  if(width===640){await page.keyboard.press('Tab');await capture('languages-scrolled');}
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Куда отправимся?',exact:true})).toBeVisible();await capture('mode-return');
  const logout=page.waitForResponse(r=>r.url()===origin+'/api/auth/logout'&&r.request().method()==='POST');await page.keyboard.press('Escape');f.logoutStatus=(await logout).status();await expect(page.getByLabel('Имя игрока',{exact:true})).toHaveValue('');await capture('logged-out');f.ok=true;
 }catch(e){f.failure=String(e);f.ok=false;try{await capture('failure')}catch{}}
 finally{await context.close();await writeFile(join(out,'static-entry-results.json'),JSON.stringify(result,null,2)+'\n');}
 console.log(`${width}x${height}: ${f.ok?'OK':f.failure}; canvas0/ws${f.websockets}; ${f.screens.length} captures`);
}
await browser.close();result.finishedAt=new Date().toISOString();await writeFile(join(out,'static-entry-results.json'),JSON.stringify(result,null,2)+'\n');
if(result.flows.some(f=>!f.ok))process.exitCode=1;
