import { defineConfig } from '@playwright/test';
import base from './playwright.ui.config';
export default defineConfig({ ...base, testMatch: ['hub.spec.ts', 'ui-hud.spec.ts', 'server-auth.spec.ts', 'babylon.spec.ts'], outputDir: 'test-results/hub' });
