import { expect, test } from '@playwright/test';
import { expectCapture, resume } from './helpers';
test('V switches the camera; shotgun fires, reloads and ignores menu input',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/config.json',route=>route.fulfill({json:{session:'local',mapId:'demo',debug:true}}));
  await page.clock.install();await page.goto('/');
  await page.getByRole('button',{name:'Начать прогулку'}).click();await expectCapture(page,true);
  await page.clock.runFor(200);
  await expect(page.getByLabel('Дробовик')).toContainText('6 / 6');
  await expect(page.getByLabel('Вид камеры')).toHaveText('Третье лицо · V');
  const position=await page.getByLabel('Положение игрока').textContent();
  await page.keyboard.press('KeyV');await page.clock.runFor(250);
  await expect(page.getByLabel('Вид камеры')).toHaveText('Первое лицо · V');
  await expect(page.getByLabel('Положение игрока')).toHaveText(position!);
  await page.screenshot({path:'../tasks/evidence/shotgun/first-person.png'});
  await page.evaluate(()=>document.dispatchEvent(new MouseEvent('mousemove',{movementX:0,movementY:85})));
  for(let i=0;i<6;i++){await page.mouse.down();await page.mouse.up();await page.clock.runFor(750);}
  await page.screenshot({path:'../tasks/evidence/shotgun/impacts.png'});
  await expect(page.getByLabel('Дробовик')).toContainText('0 / 6');
  await page.mouse.down();await page.mouse.up();await page.clock.runFor(100);await expect(page.getByLabel('Дробовик')).toContainText('0 / 6');
  await page.keyboard.press('KeyR');await page.clock.runFor(850);await expect(page.getByLabel('Дробовик')).toContainText('Перезарядка');
  await page.screenshot({path:'../tasks/evidence/shotgun/reload.png'});
  await page.mouse.down();await page.mouse.up();await page.clock.runFor(1700);await expect(page.getByLabel('Дробовик')).toContainText('6 / 6');
  await page.keyboard.press('Escape');await expectCapture(page,false);await page.keyboard.press('KeyV');await page.keyboard.press('KeyR');
  await resume(page);await expect(page.getByLabel('Вид камеры')).toHaveText('Первое лицо · V');await expect(page.getByLabel('Дробовик')).toContainText('6 / 6');
  await page.keyboard.press('KeyV');await page.clock.runFor(100);await expect(page.getByLabel('Вид камеры')).toHaveText('Третье лицо · V');
  await page.screenshot({path:'../tasks/evidence/shotgun/third-person.png'});
  expect(errors).toEqual([]);
});
