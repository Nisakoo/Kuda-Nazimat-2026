import { join } from 'node:path';
import { testArtifactsRoot } from './playwright.settings';
import { defineConfig } from '@playwright/test';
import base from './playwright.render.config';
export default defineConfig({ ...base, testMatch: 'nameplate-depth.spec.ts', outputDir: join(testArtifactsRoot, 'nameplate-depth'), use: { ...base.use, trace: 'off', screenshot: 'off', video: 'off' } });
