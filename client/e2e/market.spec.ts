import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectCapture } from './helpers';

async function position(page: Page) {
  const text=(await page.getByLabel('Положение игрока').textContent())!;
  const values=text.match(/X (-?[\d.]+) · Z (-?[\d.]+)/)!; return {x:Number(values[1]),z:Number(values[2])};
}
async function walk(page:Page,axis:'x'|'z',target:number) {
  for(let count=0;count<160;count++){
    const here=(await position(page))[axis];if(Math.abs(here-target)<.25)return;
    const key=axis==='x'?(here<target?'d':'a'):(here<target?'s':'w');
    await page.keyboard.down(key);await page.clock.runFor(Math.min(200,Math.abs(here-target)/3*1000));await page.keyboard.up(key);await page.clock.runFor(100);
  }
  throw new Error(`Blocked at ${JSON.stringify(await position(page))}, destination ${axis}=${target}`);
}
async function closeAndResume(page:Page) {await page.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('button',{name:'Продолжить',exact:true}).click();await expectCapture(page,true);}
async function interact(page:Page,name:string){await page.keyboard.press('e');await page.clock.runFor(100);await expect(page.getByRole('dialog',{name,exact:true})).toBeVisible();await expectCapture(page,false);}

test('market route buys goods, rejects wrong feed, streams pasture and finishes four goats',async({page})=>{
  test.setTimeout(120000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const requests:string[]=[];page.on('request',r=>requests.push(r.url()));
  await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:4173'?route.fallback():route.abort());
  await page.route('**/config.json',route=>route.fulfill({json:{mapId:'market',debug:true,chunkRadius:0}}));
  await page.clock.install();await page.goto('/');
  await expect(page.getByRole('dialog',{name:'Добро пожаловать в Вавилон'})).toBeVisible();
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.getByRole('button',{name:'Начать прогулку'}).click();await expectCapture(page,true);
  await page.clock.runFor(300);
  await page.screenshot({path:'test-results/market-start.png'});
  await walk(page,'z',.5);await walk(page,'x',-2);
  await interact(page,'Торговец фруктами');
  for(const name of ['Финики','Красные плоды','Жёлтые фрукты'])await page.getByRole('button',{name:`Взять: ${name}`,exact:true}).click();
  await closeAndResume(page);await walk(page,'x',2.2);await walk(page,'z',-.5);
  await interact(page,'Гончар');await page.getByRole('button',{name:'Взять: Вода в кувшине',exact:true}).click();await closeAndResume(page);
  await walk(page,'x',0);await walk(page,'z',-26);await walk(page,'x',-1);
  await expect(page.getByRole('heading',{name:'Пастбище у рынка',exact:true})).toBeVisible();
  await interact(page,'Пастух');await expect(page.getByRole('dialog')).toContainText('Колокольчик'.toLowerCase());await closeAndResume(page);
  await walk(page,'x',0);await walk(page,'z',-31);await walk(page,'x',2);
  await interact(page,'Чёрная коза');await page.getByRole('button',{name:'Финики · 1',exact:true}).click();await page.getByRole('button',{name:'Дать выбранный корм'}).click();
  await expect(page.getByRole('status').filter({hasText:'Коза отказалась'})).toBeVisible();await expect(page.getByRole('button',{name:'Финики · 1',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Красные плоды · 1',exact:true}).click();await page.getByRole('button',{name:'Дать выбранный корм'}).click();await closeAndResume(page);
  await walk(page,'x',-3);await interact(page,'Белая коза');await page.getByRole('button',{name:'Финики · 1',exact:true}).click();await page.getByRole('button',{name:'Дать выбранный корм'}).click();await closeAndResume(page);
  await walk(page,'z',-35);await interact(page,'Рыжая коза');await page.getByRole('button',{name:'Жёлтые фрукты · 1',exact:true}).click();await page.getByRole('button',{name:'Дать выбранный корм'}).click();await closeAndResume(page);
  await page.screenshot({path:'test-results/market-pasture.png'});
  await walk(page,'x',3);await interact(page,'Светло-серый козлёнок');await page.getByRole('button',{name:'Вода в кувшине · 1',exact:true}).click();await page.getByRole('button',{name:'Дать выбранный корм'}).click();
  await expect(page.getByRole('dialog',{name:'Спасибо за помощь!'})).toContainText('Все четыре козы сыты');
  await page.screenshot({path:'test-results/market-results.png'});
  const cache=(await page.getByLabel('Кеш мира').textContent())!.match(/^(\d+) \/ (\d+)/)!;expect(Number(cache[1])).toBeLessThanOrEqual(Number(cache[2]));
  expect(errors).toEqual([]);expect(requests.every(url=>new URL(url).origin==='http://127.0.0.1:4173')).toBe(true);
});

test('client stone draft survives closing and vocabulary can be edited without moving the player',async({page})=>{
  await page.setViewportSize({width:640,height:480});
  await page.goto('/');await page.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('button',{name:'Начать прогулку'}).click();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Камень',exact:true}).click();const canvas=page.getByLabel('Камень для рисунка');await canvas.scrollIntoViewIfNeeded();const box=(await canvas.boundingBox())!;
  await page.mouse.move(box.x+40,box.y+40);await page.mouse.down();await page.mouse.move(box.x+100,box.y+100,{steps:5});await page.mouse.up();
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('button',{name:'Камень',exact:true}).click();await expect(canvas.locator('polyline')).toHaveCount(1);
  await page.getByRole('button',{name:'Высечь · 0/8',exact:true}).click();await expect(page.getByLabel('Высеченный камень 1')).toBeVisible();await expect(canvas.locator('polyline')).toHaveCount(0);
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('button',{name:'Словарь',exact:true}).click();
  await page.getByLabel('Слово',{exact:true}).fill('goat');await page.getByLabel('Перевод',{exact:true}).fill('коза');await page.getByRole('button',{name:'Добавить слово',exact:true}).click();
  await page.getByRole('button',{name:'Изменить',exact:true}).click();await page.getByLabel('Слово',{exact:true}).fill('kid');await page.getByRole('button',{name:'Сохранить слово',exact:true}).click();await expect(page.locator('.word-list')).toContainText('kid');
  await page.screenshot({path:'test-results/market-words-small.png'});
  await page.getByRole('button',{name:'Удалить',exact:true}).click();await expect(page.locator('.word-list li')).toHaveCount(0);await expectCapture(page,false);
});
