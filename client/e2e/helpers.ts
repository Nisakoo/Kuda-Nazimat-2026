import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function expectCapture(page: Page, captured: boolean) {
  await expect.poll(() => page.evaluate(() => document.pointerLockElement !== null)).toBe(captured);
}

export async function resume(page: Page) {
  await expect(page.getByRole('dialog', { name: 'Пауза' })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expectCapture(page, true);
}
