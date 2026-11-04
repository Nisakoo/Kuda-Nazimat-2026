import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const [origin, destination, marks = 'legacy'] = process.argv.slice(2);
if (!origin || !destination) throw new Error('Usage: node scripts/inventory-render.mjs URL DIRECTORY');
if (!['legacy', 'instanced'].includes(marks)) throw new Error('marks must be legacy or instanced');
const output = resolve(destination); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const quality of ['low', 'balanced', 'high']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/e2e/measurement-harness.html?quality=${quality}&marks=${marks}`);
    await page.waitForFunction(() => !!window.measurementHarness);
    await page.evaluate(() => window.measurementHarness.open(false)); await page.waitForTimeout(5000);
    await page.evaluate(() => window.measurementHarness.start(false)); await page.waitForTimeout(10000);
    await page.evaluate(() => window.measurementHarness.stop());
    for (const [view, at] of [['marks', 0], ['courtyard', 18], ['pasture', 40]]) {
      await page.evaluate(at => window.measurementHarness.at(at), at); await page.waitForTimeout(1000);
      const inventory = await page.evaluate(() => window.measurementHarness.inventory());
      const counted = inventory.groups.reduce((sum, group) => sum + group.calls, 0);
      await writeFile(resolve(output, `${quality}-${view}.json`), JSON.stringify({ quality, view, at, counted, inventory, errors }, null, 2));
      if (inventory.overflow || counted !== inventory.render.drawCalls || errors.length || inventory.render.errors.length || inventory.chunks.errors.length) throw new Error(`Invalid inventory ${quality}/${view}: ${counted} != ${inventory.render.drawCalls}`);
      await page.screenshot({ path: resolve(output, `${quality}-${view}.png`) });
      console.log(JSON.stringify({ quality, view, calls: counted, main: inventory.groups.filter(g => g.pass === 'main').reduce((n, g) => n + g.calls, 0), shadow: inventory.groups.filter(g => g.pass === 'shadow').reduce((n, g) => n + g.calls, 0), markCalls: inventory.groups.filter(g => ['pellet-mark', 'pellet-batch'].includes(g.path.at(-1))).reduce((n, g) => n + g.calls, 0), liveMarks: inventory.resources.pelletMarks }));
    }
    await page.evaluate(() => window.measurementHarness.close()); await context.close();
  }
} finally { await browser.close(); }
