// Real server + four authenticated browser clients. Test LLM; loopback, not LAN qualification.
import { chromium } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { startApplication } from '../../server/src/app/application.ts';
import { parseConfig } from '../../server/src/app/config.ts';
import { createGame } from '../../server/src/game/index.ts';
import { createLogger } from '../../server/src/common/logger.ts';
import { distribution } from './render-summary.mjs';

const output = resolve(process.argv[2] ?? join(tmpdir(), 'competition-2026-artifacts', 'render-online')); await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'render-online-'));
const records = [], errors = [];
const config = { ...parseConfig({ host: '127.0.0.1', clientDir: resolve('dist'), worldDir: resolve('public'), contentDir: resolve('../server/content'), dbPath: join(temp, 'world.sqlite'), tls: { dir: join(temp, 'tls') }, defaultMap: 'market', clientDebug: true, logs: { fileLevel: 'off' } }, join(temp, 'config.json'), 'test'), port: 0 };
let app, browser; const pages = [];
try {
  app = await startApplication(config, createGame, createLogger(record => {
    if (record.event === 'game.tick.stats') records.push(record);
    if (record.level === 'error' || record.level === 'fatal') errors.push({ event: record.event, message: record.msg });
  }, 'render-measurement'));
  const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('No server port');
  const origin = `https://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
  await context.addInitScript(() => {
    localStorage.setItem('world.graphics-quality', 'balanced');
    const probe = window.onlineRenderProbe = { active: false, calls: 0, frames: [], overflow: 0 };
    const proto = WebGL2RenderingContext.prototype;
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const original = proto[name]; proto[name] = function(...args) {
        if (probe.active && this.canvas.getAttribute('aria-label') === 'Трёхмерная сцена') probe.calls++;
        return original.apply(this, args);
      };
    }
    const fence = proto.fenceSync; proto.fenceSync = function(...args) {
      if (probe.active && this.canvas.getAttribute('aria-label') === 'Трёхмерная сцена') {
        if (probe.frames.length < 12000) probe.frames.push({ at: performance.now(), calls: probe.calls }); else probe.overflow++;
        probe.calls = 0;
      }
      return fence.apply(this, args);
    };
  });
  for (let index = 0; index < 4; index++) {
    const page = await context.newPage(); pages.push(page);
    page.on('pageerror', error => errors.push({ player: index + 1, message: error.message }));
    await page.goto(origin); await page.getByLabel('Имя игрока').fill(`Render probe ${index + 1}`);
    await page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true }).click();
    await page.getByRole('heading', { name: 'Личный кабинет' }).waitFor();
    const save = page.getByRole('button', { name: 'Сохранить профиль', exact: true }); if (await save.isEnabled()) await save.click();
    if (index === 0) {
      await page.getByRole('button', { name: 'Создать игру', exact: true }).click();
      await page.getByRole('radio', { name: /С друзьями/ }).check();
      await page.getByLabel('Число игроков').selectOption('4');
      await page.getByRole('button', { name: 'Далее →', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
      await page.getByLabel('IP-адрес').waitFor();
      await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
    }
    await page.locator('canvas[aria-label="Трёхмерная сцена"]').waitFor({ timeout: 60000 });
    await page.getByLabel('Состояние связи').filter({ hasText: 'Подключён' }).waitFor({ timeout: 60000 });
    console.log(`online player ${index + 1} connected`);
  }
  await pages[3].waitForTimeout(5000);
  const samples = [];
  for (let round = 0; round < 3; round++) {
    for (const page of pages) await page.evaluate(() => { const p = window.onlineRenderProbe; p.frames = []; p.calls = 0; p.active = true; });
    const hud = [];
    for (let step = 0; step < 6; step++) {
      await pages[3].waitForTimeout(10000);
      hud.push(await Promise.all(pages.map(page => page.getByLabel('Производительность').textContent())));
      console.log(`online round ${round + 1}/3: ${(step + 1) * 10}s`);
    }
    const raw = await Promise.all(pages.map(page => page.evaluate(() => { window.onlineRenderProbe.active = false; return { ...window.onlineRenderProbe, resources: document.querySelector('[aria-label="Ресурсы сцены"]')?.textContent, chunks: document.querySelector('[aria-label="Кеш мира"]')?.textContent }; })));
    samples.push({ round: round + 1, hud, raw, summaries: raw.map(p => ({ frames: p.frames.length, intervals: distribution(p.frames.slice(1).map((f, i) => f.at - p.frames[i].at)), calls: distribution(p.frames.map(f => f.calls)) })) });
  }
  await writeFile(join(output, 'four-player.json'), JSON.stringify({ players: 4, network: 'real HTTPS/WSS loopback; four Chrome tabs on one M4', llm: 'test', quality: 'balanced', viewport: [1280, 800], deviceDpr: 2, gpuDuration: null, gpuDurationReason: 'production renderer diagnostics disabled; isolated baseline measures GPU', samples, records, errors }));
  if (errors.length || samples.some(s => s.raw.some(p => p.frames.length < 100 || p.overflow))) throw new Error('Invalid online capture');
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), errors, records, pages: await Promise.all(pages.map(page => page.locator('body').innerText().catch(() => 'unavailable'))) }, null, 2));
  throw error;
} finally { await browser?.close(); await app?.stop(); await rm(temp, { recursive: true, force: true }); }
