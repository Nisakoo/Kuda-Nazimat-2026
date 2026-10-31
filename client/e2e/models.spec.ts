import { expect, test } from '@playwright/test';
import { expectCapture } from './helpers';

test('optional decoration failure is visible, retry succeeds, and the game remains playable', async ({ page }) => {
  let unavailable = true;
  await page.route('**/config.json', (route) => route.fulfill({ json: { debug: true } }));
  await page.route('**/tablet.glb', (route) => unavailable ? route.fulfill({ status: 503 }) : route.continue());
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить');
  unavailable = false;
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Начать прогулку' }).click();
  await expectCapture(page, true);
  await expect(page.getByLabel('Ресурсы оформления')).toContainText(/Экземпляры: \d+/);
  await page.keyboard.press('Escape');
  await expectCapture(page, false);
});
