import { expect, type Page, type Response, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Real-server registration/appearance flow. The only fulfilled response is an explicit save failure. */
export async function authAvatarScenario(page: Page, origin: string, evidence: string): Promise<void> {
  const name = `UI-registration-${randomUUID().slice(0, 8)}`;
  const password = 'UI-registration-password-44';
  const serverOrigin = new URL(origin).origin;
  const errors: string[] = [];
  const attempts: string[] = [];
  let clearedPasswordSubmissions = 0;
  const avatar = page.getByRole('dialog', { name: 'Выберите свой облик', exact: true });
  const mode = page.getByRole('dialog', { name: 'Куда отправимся?', exact: true });
  const passwordInput = page.getByLabel('Пароль', { exact: true });
  const onPageError = (error: Error) => errors.push(error.message);
  const onRequest = (request: import('@playwright/test').Request) => {
    const url = new URL(request.url());
    if (url.origin === serverOrigin && request.method() === 'POST' && /^\/api\/auth\/(guest|login|register)$/.test(url.pathname)) attempts.push(url.pathname);
  };
  const responseFor = (path: string, method = 'POST') => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === serverOrigin && url.pathname === path && response.request().method() === method;
  });

  // Pass every password request to the real server, but first verify the cleared DOM field.
  // This avoids a race where a fast successful response removes the entire login form.
  const passwordPattern = /\/api\/auth\/(?:login|register)$/;
  const passwordPassThrough = async (route: Route) => {
    if (route.request().method() !== 'POST' || new URL(route.request().url()).origin !== serverOrigin) {
      await route.continue(); return;
    }
    try {
      await expect(passwordInput).toHaveValue('');
      clearedPasswordSubmissions++;
    } finally { await route.continue(); }
  };
  async function credentials(action: 'login' | 'register', secret = password): Promise<Response> {
    await page.getByRole('tab', { name: action === 'login' ? 'Вход' : 'Регистрация', exact: true }).click();
    await page.getByLabel('Имя игрока', { exact: true }).fill(name);
    await passwordInput.fill(secret);
    const [response] = await Promise.all([
      responseFor(`/api/auth/${action}`),
      page.getByRole('button', { name: action === 'login' ? 'Начать путешествие →' : 'Зарегистрироваться →', exact: true }).click(),
    ]);
    return response;
  }
  async function previewReady(): Promise<void> {
    await expect(avatar).toBeVisible();
    await expect(mode).toBeHidden();
    await expect(avatar.locator('.avatar-preview canvas')).toHaveCount(1);
    await expect(avatar.locator('.avatar-card img')).toHaveCount(4, { timeout: 30000 });
    await expect.poll(() => avatar.locator('.avatar-card img').evaluateAll(images => images.every(node => {
      const image = node as HTMLImageElement;
      return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
    })), { timeout: 30000 }).toBe(true);
    await expect(avatar.getByRole('button', { name: 'Продолжить →', exact: true })).toBeEnabled({ timeout: 30000 });
  }
  async function withinViewport(): Promise<void> {
    const overflow = await page.evaluate(() => [...document.querySelectorAll('dialog[open], .hud-dock')].flatMap(node => {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(node).visibility === 'hidden') return [];
      return rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1
        ? [{ element: node.className, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }]
        : [];
    }));
    expect(overflow).toEqual([]);
  }
  async function logout(action: () => Promise<void>): Promise<void> {
    const [response] = await Promise.all([responseFor('/api/auth/logout'), action()]);
    expect(response.ok()).toBe(true);
    await expect(page.getByRole('tab', { name: 'Вход', exact: true })).toBeVisible();
    await expect(page.getByLabel('Имя игрока', { exact: true })).toHaveValue('');
    await expect(passwordInput).toHaveValue('');
    await expect(avatar).toBeHidden();
    await expect(mode).toBeHidden();
    const authorization = (await response.request().allHeaders()).authorization;
    if (!authorization) throw new Error('Logout did not send its authenticated session.');
    // Verify actual revocation, not only a local UI transition.
    const revoked = await page.request.get(`${origin}/api/auth/state`, { headers: { Authorization: authorization }, maxRedirects: 0 });
    expect(revoked.status()).toBe(401);
  }

  page.on('pageerror', onPageError);
  page.on('request', onRequest);
  await page.route(passwordPattern, passwordPassThrough);
  try {
    await mkdir(evidence, { recursive: true });
    await page.setViewportSize({ width: 1622, height: 970 });
    await page.goto(origin);
    expect((await credentials('register')).ok()).toBe(true);
    await previewReady(); // First registration must show appearance, not mode selection.
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await avatar.locator('.avatar-card').nth(2).click();
    await expect(avatar.getByRole('radio', { name: 'Облик 3', exact: true })).toBeChecked();

    const rotation = avatar.getByRole('slider', { name: 'Вращение персонажа', exact: true });
    const beforeKeyboard = await rotation.getAttribute('aria-valuenow');
    await rotation.focus();
    await page.keyboard.press('ArrowRight');
    await expect(rotation).not.toHaveAttribute('aria-valuenow', beforeKeyboard ?? '');
    const beforeDrag = await rotation.getAttribute('aria-valuenow');
    const box = await rotation.boundingBox();
    if (!box) throw new Error('The avatar rotation surface has no visible bounds.');
    await page.mouse.move(box.x + box.width * .35, box.y + box.height * .45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .65, box.y + box.height * .45, { steps: 8 });
    await page.mouse.up();
    await expect(rotation).not.toHaveAttribute('aria-valuenow', beforeDrag ?? '');

    for (const [width, height] of [[1622, 970], [1280, 800], [390, 844], [640, 480]] as const) {
      await page.setViewportSize({ width, height });
      await avatar.evaluate(node => { node.scrollTop = 0; });
      await withinViewport();
      if (width >= 1280) {
        await expect(avatar.getByRole('button', { name: 'Продолжить →', exact: true })).toBeInViewport({ ratio: 1 });
        await expect(avatar.getByRole('button', { name: '← Назад', exact: true })).toBeInViewport({ ratio: 1 });
      }
      await page.screenshot({ path: join(evidence, `avatar-${width}.png`) });
      if (width === 390 || height === 480) {
        await avatar.getByRole('button', { name: 'Продолжить →', exact: true }).scrollIntoViewIfNeeded();
        await withinViewport();
        await expect(avatar.getByRole('button', { name: 'Продолжить →', exact: true })).toBeInViewport({ ratio: 1 });
        await expect(avatar.getByRole('button', { name: '← Назад', exact: true })).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: join(evidence, `avatar-controls-${width}.png`) });
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    const failureMessage = 'Проверка отказа: облик не сохранён. Повторите запрос.';
    let failures = 0;
    const avatarEndpoint = `${origin}/api/avatar`;
    const failSave = async (route: Route) => {
      if (route.request().method() === 'POST' && failures === 0) {
        failures++;
        await route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: failureMessage } } });
      } else await route.continue();
    };
    await page.route(avatarEndpoint, failSave);
    try {
      const [failedSave] = await Promise.all([
        responseFor('/api/avatar'),
        avatar.getByRole('button', { name: 'Продолжить →', exact: true }).click(),
      ]);
      expect(failedSave.status()).toBe(503);
      expect(failures).toBe(1);
      await expect(avatar.getByRole('alert')).toHaveText(failureMessage);
      await expect(avatar).toBeVisible();
      await expect(mode).toBeHidden();
      await expect(avatar.getByRole('button', { name: 'Продолжить →', exact: true })).toBeEnabled();
      const authorization = (await failedSave.request().allHeaders()).authorization;
      if (!authorization) throw new Error('The avatar save did not send an authenticated session.');
      const unchanged = await page.request.get(avatarEndpoint, { headers: { Authorization: authorization }, maxRedirects: 0 });
      expect(unchanged.ok()).toBe(true);
      expect(await unchanged.json()).toEqual({ avatarId: null });
      await page.screenshot({ path: join(evidence, 'avatar-save-error-1280.png') });
    } finally { await page.unroute(avatarEndpoint, failSave); }

    await logout(() => page.keyboard.press('Escape'));
    expect((await credentials('login')).ok()).toBe(true);
    await previewReady(); // Escape must not bypass the mandatory appearance step.
    await logout(() => avatar.getByRole('button', { name: '← Назад', exact: true }).click());
    expect((await credentials('login')).ok()).toBe(true);
    await previewReady(); // The Back button must also preserve the mandatory step.
    await avatar.locator('.avatar-card').nth(2).click();
    await expect(avatar.getByRole('radio', { name: 'Облик 3', exact: true })).toBeChecked();
    const [saved] = await Promise.all([
      responseFor('/api/avatar'),
      avatar.getByRole('button', { name: 'Продолжить →', exact: true }).click(),
    ]);
    expect(saved.ok()).toBe(true);
    expect(await saved.json()).toEqual({ avatarId: 'dan' });
    await expect(mode).toBeVisible();
    await expect(avatar).toBeHidden();
    await withinViewport();
    await logout(() => mode.getByRole('button', { name: '← Назад', exact: true }).click());

    expect((await credentials('login', 'wrong-password-44')).status()).toBe(401);
    await expect(page.getByRole('alert')).toHaveText('Неверное имя или пароль.');
    await expect(passwordInput).toHaveValue('');
    await expect(avatar).toBeHidden();
    await expect(mode).toBeHidden();
    await page.getByLabel('Имя игрока', { exact: true }).fill(name);
    const [guest] = await Promise.all([
      responseFor('/api/auth/guest'),
      page.getByRole('button', { name: 'Демонстрационный вход по имени', exact: true }).click(),
    ]);
    expect(guest.status()).toBe(401);
    await expect(page.getByRole('alert')).toHaveText('Неверное имя или пароль');
    await expect(avatar).toBeHidden();
    await expect(mode).toBeHidden();
    expect((await credentials('register')).status()).toBe(409);
    await expect(page.getByRole('alert')).toHaveText('Имя уже занято. Аккаунт мог быть создан. Попробуйте войти по имени и паролю, а не регистрироваться повторно.');
    await expect(passwordInput).toHaveValue('');
    await expect(avatar).toBeHidden();
    await expect(mode).toBeHidden();

    expect((await credentials('login')).ok()).toBe(true);
    await expect(mode).toBeVisible(); // A confirmed existing account skips appearance.
    await expect(avatar).toBeHidden();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await withinViewport();
    await logout(() => mode.getByRole('button', { name: '← Назад', exact: true }).click());
    expect(attempts).toHaveLength(7);
    expect(attempts.length).toBeLessThanOrEqual(20);
    expect(clearedPasswordSubmissions).toBe(6);
    expect(errors).toEqual([]);
  } finally {
    await page.unroute(passwordPattern, passwordPassThrough);
    page.off('pageerror', onPageError);
    page.off('request', onRequest);
  }
}
