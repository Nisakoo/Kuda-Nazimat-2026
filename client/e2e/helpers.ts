import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function expectCapture(page: Page, captured: boolean) {
  await expect.poll(() => page.evaluate(() => document.pointerLockElement !== null)).toBe(captured);
}

export async function resume(page: Page) {
  if (await page.evaluate(() => !!document.pointerLockElement)) return;
  const recover = page.getByRole('button', { name: 'Вернуть управление', exact: true });
  if (await recover.isVisible()) { await recover.click(); await expectCapture(page, true); return; }
  await expect(page.getByRole('dialog', { name: 'Пауза' })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expectCapture(page, true);
}

export async function finishLoading(page: Page) {
  await expect(page.getByRole('region', { name: 'Загрузка мира' })).toHaveCount(0, { timeout: 30000 });
  await page.bringToFront();
  const restore = page.getByRole('button', { name: 'Вернуть управление', exact: true });
  if (await restore.isVisible()) await restore.click();
  await expectCapture(page, true);
}
export async function createFromHub(page: Page, size = '1') {
  await expect(page.getByRole('heading', { name: 'Личный кабинет' })).toBeVisible();
  const save = page.getByRole('button', { name: 'Сохранить профиль', exact: true });
  if (await save.isEnabled()) await save.click();
  await page.getByRole('button', { name: 'Создать игру', exact: true }).click();
  if (size !== '1') { await page.getByRole('radio', { name: /С друзьями/ }).check(); await page.getByLabel('Число игроков').selectOption(size); }
  await page.getByRole('button', { name: 'Далее →', exact: true }).click();
  await finishLoading(page);
}
export async function joinFromHub(page: Page) {
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page.getByLabel('IP-адрес')).toBeVisible();
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await finishLoading(page);
}

/** Seed/check authoritative hands without the retired inventory UI. */
export async function storedTool(page: Page, tool?: 'bag' | 'jug') {
  const request = await page.waitForRequest(request => new URL(request.url()).pathname === '/api/babylon');
  const authorization = (await request.allHeaders()).authorization;
  if (!authorization) throw new Error('Missing authenticated world request');
  const endpoint = new URL('/api/equipment', request.url()).href;
  const headers = { Authorization: authorization };
  const response = tool ? await page.request.post(endpoint, { headers, data: { tool } }) : await page.request.get(endpoint, { headers });
  expect(response.ok()).toBe(true);
  return await response.json() as { tool: string | null };
}

export async function hudWindow(page: Page, key: string) {
  if (await page.getByRole('dialog').count()) {
    if (key === 'Tab') { await page.keyboard.press('Escape'); await resume(page); }
    else await page.getByRole('dialog').getByRole('button').first().focus();
  }
  if (key === 'Tab' && !await page.evaluate(() => !!document.pointerLockElement)) await resume(page);
  await page.keyboard.press(key);
  await expectCapture(page, false);
}

/** Walk around the fountain, through the northern gate of the relocated pasture. */
export async function pastureRoute(page: Page, walk: (page: Page, axis: 'x'|'z', target: number) => Promise<void>, reverse = false) {
  const points = [[0,-16],[2,-16],[2,-17],[3,-17],[3,-27],[4,-27],[4,-39],[2,-39],[2,-40],[0,-40],[0,-58]] as const;
  for (const [x,z] of reverse ? [...points].reverse() : points) { await walk(page,'x',x); await walk(page,'z',z); }
}
