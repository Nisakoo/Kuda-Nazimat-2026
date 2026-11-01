import { defineConfig } from '@playwright/test';
import { browserTestOrigin, browserTestPort } from './playwright.settings';

export default defineConfig({
  testDir: './e2e',
  testIgnore: 'render.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  use: {
    baseURL: browserTestOrigin,
    viewport: { width: 1280, height: 800 },
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium',
    launchOptions: { args: ['--enable-unsafe-swiftshader'], ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${browserTestPort} --strictPort`,
    url: browserTestOrigin,
    reuseExistingServer: false,
  },
});
