import { chromium } from '/data/worktrees/ui-hud-669eb5/client/node_modules/playwright/index.mjs';
import {writeFileSync} from 'node:fs';
const dir='/data/worktrees/ui-hud-669eb5/tasks/evidence/ui-entry-fidelity-2026-07-02';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1622,height:970}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:5300/entry-component-preview',{waitUntil:'networkidle',timeout:60000});
await page.getByLabel('Имя игрока').waitFor({timeout:60000});
const result=[];
for(const [width,height] of [[1622,970],[1280,800],[390,844],[640,480]]){
 await page.setViewportSize({width,height});await page.waitForTimeout(100);await page.screenshot({path:`${dir}/login-${width}.png`});
 result.push(await page.evaluate(()=>({screen:'login',viewport:[innerWidth,innerHeight],panel:document.querySelector('.entry-login').getBoundingClientRect().toJSON(),scroll:[document.querySelector('.entry-login-screen').scrollHeight,document.querySelector('.entry-login-screen').clientHeight],pageOverflow:document.documentElement.scrollWidth>innerWidth})));
}
await page.getByRole('button',{name:'Настроить подключение',exact:true}).scrollIntoViewIfNeeded();
await page.screenshot({path:`${dir}/login-640-scrolled.png`});
result.push({shortConnectionVisible:await page.getByRole('button',{name:'Настроить подключение',exact:true}).isVisible()});
await page.setViewportSize({width:1622,height:970});
await page.getByLabel('Имя игрока').fill('Мира');
await page.getByRole('button',{name:'Демонстрационный вход по имени',exact:true}).click();
await page.getByRole('dialog',{name:'Куда отправимся?'}).waitFor({timeout:30000});
for(const [width,height] of [[1622,970],[1280,800],[390,844],[640,480]]){
 await page.setViewportSize({width,height});await page.waitForTimeout(100);await page.screenshot({path:`${dir}/mode-${width}.png`});
 result.push(await page.evaluate(()=>({screen:'mode',viewport:[innerWidth,innerHeight],panel:document.querySelector('.entry-sign').getBoundingClientRect().toJSON(),scroll:[document.querySelector('.entry-setup').scrollHeight,document.querySelector('.entry-setup').clientHeight],pageOverflow:document.documentElement.scrollWidth>innerWidth})));
}
await page.getByRole('button',{name:'Далее: языки →',exact:true}).click();
result.push({focusAfterNext:await page.evaluate(()=>document.activeElement?.tagName)});
await page.screenshot({path:`${dir}/languages-640.png`});
await page.keyboard.press('Escape');result.push({focusAfterEscape:await page.evaluate(()=>({tag:document.activeElement?.tagName,checked:document.activeElement?.checked}))});
await page.setViewportSize({width:390,height:844});
await page.getByRole('radio',{name:/С друзьями/}).check({force:true});await page.screenshot({path:`${dir}/friends-390.png`});
await page.keyboard.press('Escape');await page.getByLabel('Пароль',{exact:true}).waitFor();
await page.getByLabel('Пароль',{exact:true}).fill('ephemeral-test');await page.getByRole('button',{name:'Показать пароль',exact:true}).click();
result.push({eyeType:await page.getByLabel('Пароль',{exact:true}).getAttribute('type')});
await page.getByRole('tab',{name:'Регистрация',exact:true}).click();
result.push({passwordAfterTab:await page.getByLabel('Пароль',{exact:true}).inputValue()});await page.screenshot({path:`${dir}/register-390.png`});
await page.getByLabel('Пароль',{exact:true}).fill('registration-secret');
await page.getByRole('button',{name:'Зарегистрироваться →',exact:true}).click();
result.push({passwordAfterSubmit:await page.getByLabel('Пароль',{exact:true}).inputValue()});
await page.getByRole('tab',{name:'Вход',exact:true}).click();
await page.getByLabel('Пароль',{exact:true}).fill('login-secret');
await page.getByRole('button',{name:'Начать путешествие →',exact:true}).click();
result.push({passwordAfterLoginSubmit:await page.getByLabel('Пароль',{exact:true}).inputValue(),calls:await page.evaluate(()=>window.calls.map(call=>[call[0],call[1],call[2]?'[redacted]':undefined]))});
await page.getByRole('tab',{name:'Вход',exact:true}).focus();await page.keyboard.press('ArrowRight');
result.push({tabArrowFocus:await page.evaluate(()=>({id:document.activeElement?.id,selected:document.activeElement?.getAttribute('aria-selected')}))});
await page.evaluate(()=>window.previewShow('login','Неверное имя или пароль. Проверьте данные и повторите вход.'));
await page.screenshot({path:`${dir}/error-390.png`});
writeFileSync(`${dir}/private-preview.json`,JSON.stringify({fixture:'Isolated component layout and callback checks. Not backend acceptance.',result,errors},null,2));
await browser.close();console.log(JSON.stringify({result,errors},null,2));
