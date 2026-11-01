import { defineConfig } from '@playwright/test';
import base from './playwright.ui.config';
export default defineConfig({...base,testMatch:['city.spec.ts','completion-contracts.spec.ts'],outputDir:'test-results/city',use:{...base.use,trace:'off',screenshot:'off',video:'off'}});
