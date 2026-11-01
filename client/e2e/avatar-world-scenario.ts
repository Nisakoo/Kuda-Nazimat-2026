import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expectCapture, resume, createFromHub, storedTool } from './helpers';

/** Production UI, authenticated GLBs, live appearance update and persistent hands. No fulfilled responses. */
export async function avatarWorldScenario(page: Page, origin: string, evidence: string): Promise<void> {
  const name = `UI-avatar-world-${randomUUID().slice(0, 8)}`;
  const password = 'UI-world-password-55';
  const errors: string[] = [];
  const modelRequests: string[] = [];
  const pageError = (error: Error) => errors.push(error.message);
  const request = (request: import('@playwright/test').Request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/world/') && /\/avatars\/(?:lukas|nic|dan|ksu)\.glb$/.test(path)) modelRequests.push(path);
  };
  page.on('pageerror', pageError); page.on('request', request);
  try {
    await mkdir(evidence, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(origin);
    await page.getByRole('tab', { name: 'Регистрация', exact: true }).click();
    await page.getByLabel('Имя игрока', { exact: true }).fill(name);
    await page.getByLabel('Пароль', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Зарегистрироваться →', exact: true }).click();
    const avatar = page.getByRole('dialog', { name: 'Выберите свой облик', exact: true });
    await page.getByRole('button', { name: 'Выбрать персонажа', exact: true }).click();
    await expect(avatar).toBeVisible();
    await expect(avatar.getByRole('button', { name: 'Подтвердить →', exact: true })).toBeEnabled({ timeout: 30000 });
    await avatar.locator('.avatar-card').nth(2).click();
    await expect(avatar.getByRole('radio', { name: 'Облик 3', exact: true })).toBeChecked();
    await avatar.getByRole('button', { name: 'Подтвердить →', exact: true }).click();
    await createFromHub(page);
    await expect.poll(() => modelRequests.some(path => path.endsWith('/dan.glb'))).toBe(true);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.screenshot({ path: join(evidence, 'avatar-world-dan-1280.png') });
    await page.keyboard.press('Space');
    // Capture the confirmed airborne pose after the 140 ms blend on the real server.
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(evidence, 'avatar-world-dan-jump-1280.png') });
    await page.waitForTimeout(800);

    expect(await storedTool(page, 'jug')).toEqual({ tool: 'jug' });
    await page.keyboard.press('Escape');
    await expectCapture(page, false);
    await page.getByRole('dialog', { name: 'Пауза', exact: true }).getByRole('button', { name: 'Настройки', exact: true }).click();
    await page.getByRole('button', { name: 'Изменить облик персонажа', exact: true }).click();
    await expect(avatar).toBeVisible();
    await expect(avatar.getByRole('button', { name: 'Подтвердить →', exact: true })).toBeEnabled({ timeout: 30000 });
    await avatar.locator('.avatar-card').nth(3).click();
    await expect(avatar.getByRole('radio', { name: 'Облик 4', exact: true })).toBeChecked();
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/avatar' && response.request().method() === 'POST');
    await avatar.getByRole('button', { name: 'Подтвердить →', exact: true }).click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual({ avatarId: 'ksu' });
    await expect(page.getByRole('dialog', { name: 'Настройки', exact: true })).toBeVisible();
    await expectCapture(page, false);
    await page.getByRole('button', { name: 'Закрыть настройки', exact: true }).click();
    await resume(page);
    await expect.poll(() => modelRequests.some(path => path.endsWith('/ksu.glb')), { timeout: 30000 }).toBe(true);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.screenshot({ path: join(evidence, 'avatar-world-ksu-jug-1280.png') });
    const authorization = (await response.request().allHeaders()).authorization;
    expect(authorization).toMatch(/^Bearer /);
    if (!authorization) throw new Error('The confirmed save has no authenticated session.');
    const headers = { Authorization: authorization };
    const storedAvatar = await page.request.get(`${origin}/api/avatar`, { headers });
    const storedEquipment = await page.request.get(`${origin}/api/equipment`, { headers });
    expect(storedAvatar.ok()).toBe(true); expect(storedEquipment.ok()).toBe(true);
    expect(await storedAvatar.json()).toEqual({ avatarId: 'ksu' });
    expect(await storedEquipment.json()).toEqual({ tool: 'jug' });
    await page.keyboard.press('Escape'); await expectCapture(page, false);
    await page.getByRole('button', { name: 'Выйти из сессии', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Вход', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { page.off('pageerror', pageError); page.off('request', request); }
}
