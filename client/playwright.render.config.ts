import { defineConfig } from '@playwright/test';
import { renderTestOrigin, renderTestPort } from './playwright.settings';
export default defineConfig({
  testDir: './e2e', testMatch: 'render.spec.ts', workers: 1, outputDir: 'render-test-results',
  use: { baseURL: renderTestOrigin, channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium', launchOptions: { args: ['--enable-unsafe-swiftshader'], ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) }, trace: 'retain-on-failure' },
  webServer: { command: `npm run dev -- --host 127.0.0.1 --port ${renderTestPort} --strictPort`, url: renderTestOrigin, reuseExistingServer: false },
});
