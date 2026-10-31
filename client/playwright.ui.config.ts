import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// This suite starts an isolated real server. It does not need Vite's preview port.
export default defineConfig({
  ...base,
  testMatch: 'ui-hud.spec.ts',
  webServer: undefined,
  outputDir: 'test-results/ui-hud',
});
