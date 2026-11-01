import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.route('**/config.json', route => route.fulfill({ json: { mapId: 'demo' } })); });

async function usableControls(panel: Locator) {
  const controls = panel.locator('button, input:not([type=hidden]), select');
  for (const control of await controls.all()) {
    await control.scrollIntoViewIfNeeded();
    const geometry = await control.evaluate((element) => {
      const r = element.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        reachable: hit === element || (hit !== null && element.contains(hit)) };
    });
    expect(geometry, await control.getAttribute('aria-label') ?? await control.textContent() ?? '').toEqual({ inside: true, reachable: true });
  }
  expect(await panel.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 600 }, { width: 640, height: 480 }]) {
  test(`controls remain reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.clock.install();
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Начать прогулку' })).toBeEnabled();
    await usableControls(page.locator('.welcome'));
    const bounds = await page.locator('.welcome').boundingBox();
    const footer = await page.locator('footer').boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(footer!.y + 1);
    await page.screenshot({ path: `test-results/layout-${viewport.width}-welcome.png` });
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await page.getByLabel('Режим сессии').selectOption('mock');
    await usableControls(page.getByRole('dialog', { name: 'Настройки' }));
    await page.screenshot({ path: `test-results/layout-${viewport.width}-settings.png` });
    await page.getByRole('button', { name: 'Применить и открыть карту' }).click();
    await page.clock.runFor(200);
    await expect(page.getByLabel('Состояние связи')).toHaveText('Подключён');
    await usableControls(page.locator('header'));
    await usableControls(page.locator('.welcome'));
    await page.getByRole('button', { name: 'Начать прогулку' }).click();
    await page.keyboard.press('Escape');
    const pause = page.getByRole('dialog', { name: 'Пауза' });
    await expect(pause.getByLabel('Радиус загрузки')).toHaveValue('1');
    await pause.getByLabel('Радиус загрузки').selectOption('2');
    await expect(pause.getByLabel('Радиус загрузки')).toHaveValue('2');
    await usableControls(pause);
    await pause.evaluate(e => { e.scrollTop = 0; });
    await page.screenshot({ path: `test-results/layout-${viewport.width}-pause.png` });
    await pause.getByRole('button', { name: 'Общение', exact: true }).click();
    const chat = page.getByRole('dialog', { name: 'Общение' });
    await chat.getByRole('textbox').fill('длинноесообщение'.repeat(30));
    await chat.getByRole('button', { name: 'Отправить', exact: true }).click();
    await page.clock.runFor(600);
    await usableControls(chat);
    await page.screenshot({ path: `test-results/layout-${viewport.width}-chat.png` });
    await page.keyboard.press('Escape');
    await pause.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await page.keyboard.down('w'); await page.clock.runFor(1500); await page.keyboard.up('w');
    await page.keyboard.down('a'); await page.clock.runFor(1200); await page.keyboard.up('a');
    await page.clock.runFor(200);
    // HUD actions must not overlap, including the interaction prompt near an NPC.
    const interaction = await page.locator('.interaction').boundingBox();
    const chatButton = await page.getByRole('navigation', { name: 'Игровые окна', exact: true }).getByRole('button', { name: 'Чат', exact: true }).boundingBox();
    expect(interaction).not.toBeNull();
    const a = interaction!, b = chatButton!;
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    await page.keyboard.press('e'); await page.clock.runFor(200);
    const dialog = page.getByRole('dialog', { name: 'Лея' });
    await usableControls(dialog);
    await dialog.getByRole('textbox').fill('История');
    await dialog.getByRole('button', { name: 'Отправить', exact: true }).click();
    await page.clock.runFor(600);
    await usableControls(dialog);
    await page.screenshot({ path: `test-results/layout-${viewport.width}-npc.png` });
    await page.keyboard.press('Escape');
    await pause.getByRole('button', { name: 'Выйти из сессии' }).click();
    await page.getByRole('button', { name: 'Начать прогулку' }).click();
    await page.keyboard.down('w'); await page.clock.runFor(1500); await page.keyboard.up('w');
    await page.keyboard.down('a'); await page.clock.runFor(1200); await page.keyboard.up('a');
    await page.clock.runFor(200);
    await page.keyboard.press('e'); await page.clock.runFor(200);
    await usableControls(dialog);
    await dialog.getByRole('button', { name: 'Что такое исторический источник?', exact: true }).click();
    await usableControls(dialog);
    await page.screenshot({ path: `test-results/layout-${viewport.width}-local-npc.png` });
  });
}
