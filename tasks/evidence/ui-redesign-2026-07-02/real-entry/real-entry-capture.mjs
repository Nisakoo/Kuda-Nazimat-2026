import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

const out = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(out, '../../../../client/package.json'));
const { chromium, expect: baseExpect } = require('@playwright/test');
const expect = baseExpect.configure({ timeout: 60000 });
const origin = 'http://127.0.0.1:4387';
const sizes = [[1622, 970], [1280, 800], [390, 844], [640, 480]];
const result = { origin, capturedAt: new Date().toISOString(), note: 'Manual evidence only. No enrollment or world entry.', flows: [] };
await mkdir(out, { recursive: true });

for (const [width, height] of sizes) {
  const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium' });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const flow = { viewport: { width, height, deviceScaleFactor: 1 }, screenshots: [], errors: [], websocketCount: 0 };
  page.on('console', message => { if (message.type() === 'error') flow.errors.push(message.text()); });
  page.on('pageerror', error => flow.errors.push(error.message));
  page.on('websocket', () => { flow.websocketCount++; });
  async function capture(name) {
    const snapshot = await page.evaluate(() => {
      const box = element => { const r = element.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) }; };
      const shown = element => { const r = element.getBoundingClientRect(), s = getComputedStyle(element); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const root = document.scrollingElement;
      const controls = [...document.querySelectorAll('button, input, select, [role="radio"], [role="tab"]')].filter(shown).map(element => {
        const bounds = box(element);
        return { tag: element.tagName.toLowerCase(), name: (element.getAttribute('aria-label') || element.innerText || element.getAttribute('name') || '').trim().slice(0, 100), disabled: !!element.disabled, bounds, outsideViewport: bounds.x < -1 || bounds.y < -1 || bounds.right > innerWidth + 1 || bounds.bottom > innerHeight + 1 };
      });
      const scrollable = [...document.querySelectorAll('body, dialog[open], .entry-login-screen, .entry-card, .entry-content')].filter(shown).map(element => ({ tag: element.tagName.toLowerCase(), className: typeof element.className === 'string' ? element.className : '', bounds: box(element), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
      return { innerWidth, innerHeight, documentWidth: root?.scrollWidth, documentHeight: root?.scrollHeight, canvasCount: document.querySelectorAll('canvas').length, controls, scrollable };
    });
    if (snapshot.canvasCount !== 0 || flow.websocketCount !== 0) throw new Error(`Unexpected world context before confirmation: ${name}`);
    const file = `${name}-${width}x${height}.png`;
    await page.screenshot({ path: join(out, file), fullPage: false });
    flow.screenshots.push({ screen: name, file, ...snapshot, websocketCount: flow.websocketCount });
  }
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Войти в город' })).toBeVisible();
    await capture('login');
    await page.getByRole('tab', { name: 'Регистрация', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Регистрация', exact: true })).toHaveAttribute('aria-selected', 'true');
    await capture('registration');
    await page.getByRole('tab', { name: 'Вход', exact: true }).click();
    await page.getByLabel('Имя игрока').fill(`ui${width}x${height}-${Date.now().toString(36)}`);
    await page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true }).click();
    const mode = page.getByRole('dialog', { name: 'Куда отправимся?', exact: true });
    await expect(mode).toBeVisible(); await capture('mode');
    await mode.getByRole('radio', { name: /^Одному/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(mode.getByRole('radio', { name: /^С друзьями/ })).toBeChecked();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Ваши языки', exact: true })).toBeVisible();
    await capture('languages');
    await page.keyboard.press('Escape'); await expect(mode).toBeVisible();
    const logout = page.waitForResponse(response => response.url() === `${origin}/api/auth/logout` && response.request().method() === 'POST');
    await page.keyboard.press('Escape');
    const response = await logout;
    if (response.status() !== 204) throw new Error(`Logout returned ${response.status()}`);
    await expect(page.getByLabel('Имя игрока')).toHaveValue('');
    const finalCanvasCount = await page.locator('canvas').count();
    flow.finalCanvasCount = finalCanvasCount; flow.logoutStatus = response.status();
    if (finalCanvasCount !== 0 || flow.websocketCount !== 0 || flow.errors.length) throw new Error('Canvas, WebSocket, or console error detected');
    flow.ok = true;
  } catch (error) { flow.ok = false; flow.failure = String(error); }
  finally { await context.close(); await browser.close(); result.flows.push(flow); await writeFile(join(out, 'real-entry-results.json'), JSON.stringify(result, null, 2) + '\n'); }
  console.log(`${width}x${height}: ${flow.ok ? 'OK' : flow.failure}; captures=${flow.screenshots.length}; consoleErrors=${flow.errors.length}; websockets=${flow.websocketCount}`);
}
if (result.flows.some(flow => !flow.ok)) process.exitCode = 1;
