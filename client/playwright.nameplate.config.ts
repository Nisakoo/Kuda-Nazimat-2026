import { defineConfig } from '@playwright/test';
import base from './playwright.render.config';
export default defineConfig({ ...base, testMatch: 'nameplate-depth.spec.ts', outputDir: 'test-results/nameplate-depth', use: { ...base.use, trace: 'off', screenshot: 'off', video: 'off' } });
