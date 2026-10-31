import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
try {
  const page = await browser.newPage();
  await page.goto(process.env.DEMO_EXPORT_ORIGIN ?? 'http://localhost:5173/e2e/export-scene.html');
  await page.waitForFunction(() => typeof window.exportDemoScene === 'function');
  const bytes = await page.evaluate(() => window.exportDemoScene());
  await writeFile(new URL('../public/assets/models/demo/courtyard.glb', import.meta.url), Buffer.from(bytes));
  console.log(`Exported local courtyard GLB: ${bytes.length} bytes.`);
  for (const kind of ['history', 'science']) {
    const data = await page.evaluate((value) => window.exportDistrict(value), kind);
    await writeFile(new URL(`../public/assets/models/demo/${kind}.glb`, import.meta.url), Buffer.from(data));
    console.log(`Exported ${kind} district GLB: ${data.length} bytes.`);
  }
} finally { await browser.close(); }
