# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: world-next.spec.ts >> NEXT audio: real WebAudio unlock, volume persistence, no repeated jump, and five lifecycle restarts
- Location: e2e/world-next.spec.ts:282:1

# Error details

```
TimeoutError: page.waitForResponse: Timeout 30000ms exceeded while waiting for event "response"
```

# Test source

```ts
  225 |     expect(state.definition.flock.count).toBeLessThanOrEqual(6);
  226 |     expect(state.definition.flock.schedule.periodMs).toBeGreaterThanOrEqual(90000);
  227 |     expect(state.definition.flock.schedule.periodMs).toBeLessThanOrEqual(150000);
  228 |   }
  229 |   const carrier = pages[1]!; const data = observed[1]!;
  230 |   await resume(carrier);
  231 |   await expect(carrier.getByLabel('Кеш мира')).toContainText('Чанки: 25 · Ожидание: 0 · Отложено: 0');
  232 |   const apple = data.state!.apples.find(item => item.state === 'world' && item.position.z > 5 && item.position.z < 15 && Math.abs(item.position.x) < 8);
  233 |   if (!apple || apple.state !== 'world') throw new Error('No reachable market route apple');
  234 |   // Role2 starts within 2m and has an unobstructed pickup sweep in the production map.
  235 |   expect(Math.hypot((await position(carrier)).x - apple.position.x, (await position(carrier)).z - apple.position.z)).toBeLessThanOrEqual(2);
  236 |   const before = data.sent.filter(packet => packet.type === 'hand').length;
  237 |   await carrier.keyboard.down('f'); await carrier.waitForTimeout(400);
  238 |   await carrier.keyboard.down('f'); await carrier.waitForTimeout(600);
  239 |   await expect(carrier.getByLabel('Руки')).toContainText('В руках: яблоко');
  240 |   expect(data.sent.filter(packet => packet.type === 'hand')).toHaveLength(before + 1);
  241 |   await carrier.keyboard.up('f');
  242 |   const held = data.state!.apples.find(item => item.state === 'held');
  243 |   if (!held || held.state !== 'held') throw new Error('No backend-confirmed held apple');
  244 |   expect(held.id).toBe(apple.id);
  245 |   for (const other of observed) await expect.poll(() => other.state!.apples.find(item => item.id === held.id)).toEqual(held);
  246 |   await carrier.keyboard.down('s'); await carrier.waitForTimeout(350); await carrier.keyboard.up('s');
  247 |   await carrier.keyboard.down('ShiftLeft'); await carrier.keyboard.down('s'); await carrier.waitForTimeout(400);
  248 |   await carrier.keyboard.press('Space'); await carrier.waitForTimeout(300); await carrier.keyboard.up('s'); await carrier.keyboard.up('ShiftLeft');
  249 |   await carrier.screenshot({ path: testInfo.outputPath('carry-move.png') });
  250 |   await carrier.waitForTimeout(1000);
  251 |   await carrier.keyboard.press('Escape'); await expectCapture(carrier, false);
  252 |   await carrier.keyboard.down('f'); await carrier.keyboard.up('f');
  253 |   expect(data.sent.filter(packet => packet.type === 'hand')).toHaveLength(before + 1);
  254 |   await resume(carrier); await carrier.waitForTimeout(250);
  255 |   expect(data.sent.filter(packet => packet.type === 'hand')).toHaveLength(before + 1);
  256 |   // Restart while held. The database must preserve the unique apple and its owner.
  257 |   await stop(); await start(); await login(carrier, 'NEXT role 2');
  258 |   await expect(carrier.getByLabel('Руки')).toContainText('В руках: яблоко');
  259 |   await expect.poll(() => data.state?.apples.find(item => item.id === held.id)).toEqual(held);
  260 |   expect(data.state!.apples).toHaveLength(5);
  261 |   await carrier.screenshot({ path: testInfo.outputPath('restored-hand.png') });
  262 |   await carrier.keyboard.press('f');
  263 |   await expect(carrier.getByLabel('Руки')).toContainText('Руки свободны');
  264 |   await expect.poll(() => data.state!.apples.find(item => item.id === held.id)?.state).toBe('world');
  265 |   await carrier.screenshot({ path: testInfo.outputPath('placed-apple.png') });
  266 |   await walk(carrier, 'x', 0); await walk(carrier, 'z', -25);
  267 |   await expect(carrier.getByRole('heading', { name: 'Пастбище у рынка', exact: true })).toBeVisible();
  268 |   await carrier.screenshot({ path: testInfo.outputPath('pasture-live-scene.png') });
  269 |   await walk(carrier, 'z', 9); await walk(carrier, 'x', -32);
  270 |   await expect(carrier.getByRole('heading', { name: 'Двор Вавилонской башни', exact: true })).toBeVisible();
  271 |   await carrier.screenshot({ path: testInfo.outputPath('courtyard-live-scene.png') });
  272 |   await walk(carrier, 'x', 0);
  273 |   await expect(carrier.getByRole('heading', { name: 'Рынок Вавилона', exact: true })).toBeVisible();
  274 |   await expect(carrier.getByLabel('Кеш мира')).toContainText('Чанки: 25 · Ожидание: 0 · Отложено: 0');
  275 |   await expect(carrier.getByLabel('Состояние связи')).toContainText('Подключён');
  276 |   const scenePath = testInfo.outputPath('scene-contract.json'); await writeFile(scenePath, JSON.stringify({ initial, restored: data.state }));
  277 |   await testInfo.attach('scene-contract', { path: scenePath, contentType: 'application/json' });
  278 |   expect(errors).toEqual([]); expect(external).toEqual([]);
  279 |   for (const player of pages.slice(1)) await player.close();
  280 | });
  281 |
  282 | test('NEXT audio: real WebAudio unlock, volume persistence, no repeated jump, and five lifecycle restarts', async ({ page, context }, testInfo) => {
  283 |   test.setTimeout(600000);
  284 |   const observed = observe(page);
  285 |   await page.addInitScript(() => {
  286 |     const probe = window.worldAudioProbe = { contexts: 0, closed: 0, active: 0, peak: 0, starts: [] as { duration: number; time: number }[] };
  287 |     const Base = window.AudioContext;
  288 |     window.AudioContext = class extends Base {
  289 |       constructor(options?: AudioContextOptions) { super(options); probe.contexts++; }
  290 |       override createBufferSource() {
  291 |         const source = super.createBufferSource(); const start = source.start.bind(source);
  292 |         source.start = (when = 0, offset = 0, duration?: number) => {
  293 |           probe.starts.push({ duration: source.buffer?.duration ?? 0, time: performance.now() });
  294 |           probe.active++; probe.peak = Math.max(probe.peak, probe.active);
  295 |           source.addEventListener('ended', () => { probe.active--; }, { once: true });
  296 |           if (duration === undefined) start(when, offset); else start(when, offset, duration);
  297 |         };
  298 |         return source;
  299 |       }
  300 |       override async close() { await super.close(); probe.closed++; }
  301 |     };
  302 |   });
  303 |   const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  304 |   await login(page, 'NEXT audio', '1');
  305 |   await page.keyboard.press('Escape');
  306 |   await activate(page.getByRole('dialog', { name: 'Пауза' }).getByRole('button', { name: 'Настройки', exact: true }));
  307 |   const volume = page.getByRole('slider', { name: 'Громкость', exact: true });
  308 |   await expect(volume).toHaveValue('30');
  309 |   await volume.focus(); await page.keyboard.press('Home');
  310 |   await expect(volume).toHaveValue('0');
  311 |   await page.reload(); await page.getByLabel('Имя игрока').fill('NEXT audio');
  312 |   await activate(page.getByRole('button', { name: 'Войти', exact: true }));
  313 |   await activate(page.getByRole('button', { name: 'Начать прогулку' })); await expectCapture(page, true);
  314 |   await page.keyboard.press('Space'); await page.waitForTimeout(1400);
  315 |   expect(await page.evaluate(() => window.worldAudioProbe.starts)).toEqual([]);
  316 |   console.log('NEXT audio: muted jump is silent; opening settings');
  317 |   await page.keyboard.press('Escape'); await activate(page.getByRole('dialog', { name: 'Пауза' }).getByRole('button', { name: 'Настройки', exact: true }));
  318 |   await expect(volume).toHaveValue('0');
  319 |   await volume.evaluate(element => { const slider = element as HTMLInputElement; slider.value = '45'; slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true })); });
  320 |   await expect(volume).toHaveValue('45');
  321 |   console.log('NEXT audio: volume45; close settings and resume');
  322 |   await activate(page.getByRole('button', { name: 'Закрыть настройки', exact: true })); await resume(page);
  323 |   await page.keyboard.press('Escape'); await activate(page.getByRole('dialog', { name: 'Пауза' }).getByRole('button', { name: 'Общение', exact: true }));
  324 |   const countMumbles = () => page.evaluate(() => window.worldAudioProbe.starts.filter(item => Math.abs(item.duration - .57) < .005).length);
> 325 |   const mumbleLoaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/mumble.wav') && response.ok());
      |                             ^ TimeoutError: page.waitForResponse: Timeout 30000ms exceeded while waiting for event "response"
  326 |   await page.getByLabel('Сообщение группе').fill('Прогрев');
  327 |   await activate(page.getByRole('button', { name: 'Отправить', exact: true }));
  328 |   await (await mumbleLoaded).finished();
  329 |   await page.waitForTimeout(400);
  330 |   const oldMumbles = await countMumbles();
  331 |   await page.getByLabel('Сообщение группе').fill('Привет');
  332 |   await activate(page.getByRole('button', { name: 'Отправить', exact: true }));
  333 |   await expect.poll(countMumbles).toBe(oldMumbles + 1);
  334 |   await page.waitForTimeout(2200); expect(await countMumbles()).toBe(oldMumbles + 1);
  335 |   await activate(page.getByRole('button', { name: 'Закрыть', exact: true })); await resume(page);
  336 |   await page.keyboard.press('Escape'); await activate(page.getByRole('dialog', { name: 'Пауза' }).getByRole('button', { name: 'Общение', exact: true }));
  337 |   await page.waitForTimeout(1300); expect(await countMumbles()).toBe(oldMumbles + 1);
  338 |   await activate(page.getByRole('button', { name: 'Закрыть', exact: true })); await resume(page);
  339 |   // Warm the local jump clip, then hold the next press through a complete jump.
  340 |   await page.keyboard.press('Space'); await page.waitForTimeout(1400);
  341 |   const countJumps = () => page.evaluate(() => window.worldAudioProbe.starts.filter(item => Math.abs(item.duration - .28) < .005).length);
  342 |   const before = await countJumps(); const beforeAck = observed.motion!.jumpAck;
  343 |   await page.keyboard.down('Space');
  344 |   await expect.poll(() => observed.motion?.jumpAck ?? 0).toBeGreaterThan(beforeAck);
  345 |   await expect.poll(() => observed.motion?.grounded).toBe(true);
  346 |   // Repeated keydown after authoritative landing must not become a new press.
  347 |   await page.keyboard.down('Space'); await page.waitForTimeout(1400); await page.keyboard.up('Space');
  348 |   expect(await countJumps()).toBe(before + 1);
  349 |   const steps = await page.evaluate(() => window.worldAudioProbe.starts.filter(item => item.duration < .2).length);
  350 |   await page.waitForTimeout(500);
  351 |   expect(await page.evaluate(() => window.worldAudioProbe.starts.filter(item => item.duration < .2).length)).toBe(steps);
  352 |   const audioMemory = async () => {
  353 |     const text = (await page.getByLabel('Звук', { exact: true }).textContent())!;
  354 |     const values = text.match(/Источники: (\d+) · Буферы: (\d+) · Загрузки: (\d+) · Память: (\d+)/)!;
  355 |     return { sources: Number(values[1]), buffers: Number(values[2]), pending: Number(values[3]), bytes: Number(values[4]) };
  356 |   };
  357 |   // A new shown question/answer pair and a remote jump produce distinct causal sources.
  358 |   await walk(page, 'z', .5); await walk(page, 'x', -2);
  359 |   await page.keyboard.press('e');
  360 |   await expect(page.getByRole('dialog', { name: 'Торговец фруктами', exact: true })).toBeVisible();
  361 |   await page.waitForTimeout(400); const beforeReply = await countMumbles();
  362 |   await page.getByLabel('Вопрос NPC').fill('Расскажи о финиках');
  363 |   await activate(page.getByRole('button', { name: 'Спросить', exact: true }));
  364 |   await expect(page.locator('.dialog-history')).toContainText('test merchant reply');
  365 |   await expect.poll(countMumbles).toBe(beforeReply + 2);
  366 |   await activate(page.getByRole('button', { name: 'Закрыть', exact: true })); await resume(page);
  367 |   const remote = await context.newPage(); await login(remote, 'NEXT audio remote', '1', 0);
  368 |   await page.waitForTimeout(1000); const beforeRemote = await countJumps();
  369 |   await remote.keyboard.press('Space');
  370 |   await expect.poll(countJumps).toBe(beforeRemote + 1);
  371 |   await remote.close(); await resume(page);
  372 |   // A real backend restart must restore history silently through automatic reconnect.
  373 |   const beforeReconnect = await countMumbles(); await stop(); await start();
  374 |   await expect(page.getByLabel('Состояние связи')).toContainText('Подключён', { timeout: 30000 });
  375 |   await page.waitForTimeout(1400); expect(await countMumbles()).toBe(beforeReconnect);
  376 |   await expect(page.getByRole('button', { name: 'Начать прогулку' })).toBeEnabled();
  377 |   await activate(page.getByRole('button', { name: 'Начать прогулку' })); await expectCapture(page, true);
  378 |   const audioCycles: (Awaited<ReturnType<typeof audioMemory>> & { worldBytesWithoutAudio: number })[] = [];
  379 |   for (let cycle = 0; cycle < 5; cycle++) {
  380 |     await page.keyboard.press('Escape'); await activate(page.getByRole('button', { name: 'Перезапустить сцену', exact: true }));
  381 |     await expect(page.getByRole('button', { name: 'Начать прогулку' })).toBeEnabled();
  382 |     await activate(page.getByRole('button', { name: 'Начать прогулку' })); await expectCapture(page, true);
  383 |     await expect(page.getByLabel('Звук', { exact: true })).toContainText('Буферы: 0');
  384 |     const warmAck = observed.motion!.jumpAck;
  385 |     await page.keyboard.press('Space');
  386 |     await expect.poll(() => observed.motion?.jumpAck ?? 0).toBeGreaterThan(warmAck);
  387 |     await expect.poll(() => observed.motion?.grounded).toBe(true);
  388 |     await expect.poll(async () => (await audioMemory()).pending).toBe(0);
  389 |     // Cold playback may expire after 250ms. The second jump uses the prepared buffer.
  390 |     const prior = await countJumps(); const ack = observed.motion!.jumpAck;
  391 |     await page.keyboard.press('Space');
  392 |     await expect.poll(() => observed.motion?.jumpAck ?? 0).toBeGreaterThan(ack);
  393 |     await expect.poll(() => observed.motion?.grounded).toBe(true);
  394 |     await expect.poll(countJumps).toBe(prior + 1);
  395 |     await expect.poll(() => page.evaluate(() => window.worldAudioProbe.active)).toBe(0);
  396 |     await expect.poll(audioMemory).toMatchObject({ sources: 0, pending: 0 });
  397 |     await expect(page.getByLabel('Кеш мира')).toContainText('Чанки: 25 · Ожидание: 0 · Отложено: 0');
  398 |     await page.waitForTimeout(300);
  399 |     const memory = await audioMemory(); expect(memory.buffers).toBeGreaterThanOrEqual(1); expect(memory.buffers).toBeLessThanOrEqual(7);
  400 |     expect(memory.bytes).toBeGreaterThan(0);
  401 |     const cache = (await page.getByLabel('Кеш мира').textContent())!.match(/^(\d+) \/ (\d+)/)!;
  402 |     expect(Number(cache[1])).toBeLessThanOrEqual(Number(cache[2]));
  403 |     expect(Number(cache[2])).toBe(64 * 1024 * 1024);
  404 |     audioCycles.push({ ...memory, worldBytesWithoutAudio: Number(cache[1]) - memory.bytes });
  405 |   }
  406 |   expect(new Set(audioCycles.map(cycle => cycle.worldBytesWithoutAudio)).size).toBe(1);
  407 |   const probe = await page.evaluate(() => window.worldAudioProbe);
  408 |   expect(probe.contexts - probe.closed).toBe(1); expect(probe.peak).toBeLessThanOrEqual(8);
  409 |   await page.keyboard.press('Escape'); await activate(page.getByRole('dialog', { name: 'Пауза' }).getByRole('button', { name: 'Настройки', exact: true }));
  410 |   await expect(volume).toHaveValue('45');
  411 |   await page.screenshot({ path: testInfo.outputPath('volume-persisted.png') });
  412 |   await page.reload(); await page.getByLabel('Имя игрока').fill('NEXT audio');
  413 |   await activate(page.getByRole('button', { name: 'Войти', exact: true }));
  414 |   await activate(page.getByRole('button', { name: 'Начать прогулку' })); await expectCapture(page, true);
  415 |   await page.keyboard.press('Escape'); await activate(page.getByRole('dialog', { name: 'Пауза' }).getByRole('button', { name: 'Настройки', exact: true }));
  416 |   await expect(volume).toHaveValue('45');
  417 |   const audioPath = testInfo.outputPath('audio-browser-probe.json'); await writeFile(audioPath, JSON.stringify({ probe, audioCycles }));
  418 |   await testInfo.attach('audio-browser-probe', { path: audioPath, contentType: 'application/json' });
  419 |   expect(errors).toEqual([]);
  420 | });
  421 |
```