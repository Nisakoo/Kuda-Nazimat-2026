import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { expectCapture, resume } from './helpers';

let environment = 'development';
let processHandle: ChildProcess; let directory: string; let origin: string; let configFile: string;
async function startServer() {
  processHandle = spawn(process.execPath, ['../server/src/app/main.ts', '--config', configFile, '--env', environment], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server startup timeout: ${output}`)), 15000);
    const failed = (code: number | null) => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${output}`)); };
    processHandle.once('exit', failed);
    const ready = (chunk: Buffer) => {
      output += String(chunk);
      if ((output.includes('(app.ready)') || output.includes('ВАВИЛОН ЗАПУЩЕН'))) { clearTimeout(timeout); processHandle.off('exit', failed); resolve(); }
    };
    processHandle.stderr!.on('data', ready);
    processHandle.stdout!.on('data', ready);
  });
}
async function stopServer() {
  if (processHandle?.exitCode !== null || processHandle?.signalCode) return;
  const exited = once(processHandle, 'exit'); processHandle.kill('SIGTERM');
  const deadline = setTimeout(() => processHandle.kill('SIGKILL'), 11000);
  const [code] = await exited; clearTimeout(deadline); expect(code).toBe(0);
}
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'browser-auth-'));
  const portServer = createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
  const address = portServer.address(); if (!address || typeof address === 'string') throw new Error('No port');
  const port = address.port; await new Promise<void>((done) => portServer.close(() => done()));
  origin = `http://127.0.0.1:${port}`; configFile = join(directory, 'config.json');
  await writeFile(configFile, JSON.stringify({ clientDebug: false, logs: { fileLevel: 'off', consoleLevel: 'warn' }, host: '127.0.0.1', port, clientDir: resolve('dist'), worldDir: resolve('public'), contentDir: resolve('../server/content'), dbPath: join(directory, 'game.sqlite'), defaultMap: 'demo', disconnectGraceMs: 100, saveIntervalMs: 100, npc: { options: { delayMs: 1800 } } }));
  await startServer();
});
test.afterAll(async () => { await stopServer(); if (directory) await rm(directory, { recursive: true, force: true }); });

test('actual Socket.IO stream renders partial text, replaces it with the final, and cancels on close', async ({page}) => {
 test.setTimeout(60000);
 await page.goto(origin);
 await expect(page.getByRole('button',{name:'Вход разработчика',exact:true})).toBeVisible();
 await page.getByLabel('Имя игрока').fill('Stream inspector');
 await page.getByRole('button',{name:'Вход разработчика',exact:true}).click();
 await page.getByRole('button',{name:'Начать прогулку'}).click();await expectCapture(page,true);
 await page.keyboard.down('w');await page.waitForTimeout(1500);await page.keyboard.up('w');
 await page.keyboard.down('a');await page.waitForTimeout(1200);await page.keyboard.up('a');
 await page.keyboard.press('e');await expect(page.getByRole('dialog',{name:'Лея',exact:true})).toBeVisible();
 await page.getByLabel('Ваш вопрос').fill('Что хранит история?');await page.getByRole('button',{name:'Отправить',exact:true}).click();
 await expect(page.locator('.streaming-answer')).toBeVisible();
 const partial=await page.locator('.streaming-answer').innerText();expect(partial.length).toBeGreaterThan(4);
 await expect(page.locator('.streaming-answer')).toHaveCount(0,{timeout:10000});
 await expect(page.getByRole('dialog',{name:'Лея',exact:true})).toContainText('Приветствую');
 await page.getByLabel('Ваш вопрос').fill('Отменённый вопрос');await page.getByRole('button',{name:'Отправить',exact:true}).click();
 await expect(page.locator('.streaming-answer')).toBeVisible();await page.keyboard.press('Escape');
 await resume(page);
 await page.keyboard.press('e');await expect(page.getByLabel('Ваш вопрос')).toBeVisible();
 await page.waitForTimeout(2300);await expect(page.locator('.streaming-answer')).toHaveCount(0);
 await expect(page.getByRole('dialog',{name:'Лея',exact:true})).not.toContainText('Отменённый вопрос');
 await page.getByLabel('Ваш вопрос').fill('Новый вопрос');await page.getByRole('button',{name:'Отправить',exact:true}).click();
 await expect(page.locator('.streaming-answer')).toBeVisible();await expect(page.locator('.streaming-answer')).toHaveCount(0,{timeout:10000});
});

test('production disables guest/dev and a forced temporary-password change issues a usable session',async({page,request})=>{
 test.setTimeout(60000);await stopServer();environment='production';await startServer();
 const registered=await request.post(origin+'/api/auth/register',{data:{name:'Password inspector',password:'initial-secret-44'}});expect(registered.status()).toBe(201);
 const old=await registered.json();
 const reset=spawn(process.execPath,['../server/src/cli/auth.ts','reset-password','Password inspector','--config',configFile,'--env','production'],{stdio:['ignore','pipe','pipe']});
 let output='';reset.stdout!.on('data',data=>output+=data);const [code]=await once(reset,'exit');expect(code).toBe(0);
 const temporary=output.match(/»: ([^\n]+)/)?.[1];if(!temporary)throw new Error('Reset did not return a temporary password');
 await page.setViewportSize({width:390,height:844});await page.goto(origin);
 await expect(page.getByRole('button',{name:'Демонстрационный вход по имени',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Вход разработчика',exact:true})).toHaveCount(0);
 await page.getByLabel('Имя игрока').fill('Password inspector');await page.getByLabel('Пароль',{exact:true}).fill(temporary);
 await page.getByRole('button',{name:'Начать путешествие →',exact:true}).click();await expect(page.getByLabel('Новый пароль',{exact:true})).toBeVisible();
 await page.getByLabel('Текущий или временный пароль',{exact:true}).fill(temporary);await page.getByLabel('Новый пароль',{exact:true}).fill('changed-secret-55');
 const reply=page.waitForResponse(r=>r.url().endsWith('/api/auth/password')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Сменить пароль',exact:true}).click();const response=await reply;expect(response.ok()).toBe(true);const session=await response.json();
 await expect(page.getByRole('heading',{name:'Войти в город'})).toHaveCount(0);
 expect((await request.get(origin+'/api/auth/state',{headers:{Authorization:'Bearer '+session.token}})).status()).toBe(200);
 expect((await request.get(origin+'/api/auth/state',{headers:{Authorization:'Bearer '+old.token}})).status()).toBe(401);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
