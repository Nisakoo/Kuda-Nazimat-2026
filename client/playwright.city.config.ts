import { join } from 'node:path';
import { testArtifactsRoot } from './playwright.settings';
import { defineConfig } from '@playwright/test';
import base from './playwright.ui.config';
export default defineConfig({...base,testMatch:['city.spec.ts','completion-contracts.spec.ts'],outputDir:join(testArtifactsRoot,'city'),use:{...base.use,trace:'off',screenshot:'off',video:'off'}});
