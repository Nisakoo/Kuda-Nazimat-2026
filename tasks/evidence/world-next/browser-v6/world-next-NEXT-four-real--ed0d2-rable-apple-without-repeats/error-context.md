# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: world-next.spec.ts >> NEXT: four real roles share the scene; physical F carries one durable apple without repeats
- Location: e2e/world-next.spec.ts:204:1

# Error details

```
TimeoutError: page.screenshot: Timeout 30000ms exceeded.
Call log:
  - taking page screenshot
  - waiting for fonts to load...

```

# Test source

```ts
  149 | async function login(page: Page, name: string, size?: string, chunkRadius: number | null = null) {
  150 |   await releaseOtherCaptures(page);
  151 |   await page.route('**/config.json', route => route.fulfill({ json: { session: 'online', serverUrl: origin, mapId: 'market', debug: true, chunkRadius } }));
  152 |   await page.goto(origin); await page.getByLabel('Имя игрока').fill(name);
  153 |   await activate(page.getByRole('button', { name: 'Войти', exact: true }));
  154 |   if (size) {
  155 |     await expect(page.getByRole('dialog', { name: 'Подготовка путешествия' })).toBeVisible();
  156 |     const select = page.getByLabel('Число игроков'); if (await select.isEnabled()) await select.selectOption(size);
  157 |     await activate(page.getByRole('button', { name: 'Далее: языки' }));
  158 |     await page.getByLabel('Изучаемый язык').selectOption('en');
  159 |     await activate(page.getByRole('button', { name: 'Войти в Вавилон' }));
  160 |     await expect(page.getByRole('dialog', { name: 'Добро пожаловать в Вавилон' })).toBeVisible();
  161 |     await activate(page.getByRole('button', { name: 'Закрыть', exact: true }));
  162 |   }
  163 |   await expect(page.getByRole('button', { name: 'Начать прогулку' })).toBeEnabled();
  164 |   await page.bringToFront(); await activate(page.getByRole('button', { name: 'Начать прогулку' }));
  165 |   await expectCapture(page, true);
  166 | }
  167 | async function position(page: Page) {
  168 |   const observed = observedPositions.get(page)?.current;
  169 |   if (observed) return observed;
  170 |   const text = (await page.getByLabel('Положение игрока').textContent())!;
  171 |   const values = text.match(/X (-?[\d.]+) · Z (-?[\d.]+)/)!;
  172 |   return { x: Number(values[1]), z: Number(values[2]) };
  173 | }
  174 | async function walk(page: Page, axis: 'x' | 'z', target: number) {
  175 |   console.log('NEXT walk start', JSON.stringify({ axis, target, position: await position(page) }));
  176 |   for (let n = 0; n < 40; n++) {
  177 |     const here = (await position(page))[axis]; const distance = Math.abs(here - target);
  178 |     if (distance <= .35) { console.log('NEXT walk done', JSON.stringify({ axis, target, position: await position(page) })); return; }
  179 |     const direction = Math.sign(target - here);
  180 |     const key = axis === 'x' ? (direction > 0 ? 'd' : 'a') : (direction > 0 ? 's' : 'w');
  181 |     // Keep the real key down until a real backend delta proves progress. Short pulses
  182 |     // can fall entirely between frames on software WebGL and do not prove movement.
  183 |     try {
  184 |       await page.keyboard.down(key);
  185 |       await expect.poll(async () => direction * ((await position(page))[axis] - here), {
  186 |         intervals: [50, 100], message: `No authoritative ${key} progress from ${JSON.stringify(await position(page))} toward ${axis}=${target}`,
  187 |       }).toBeGreaterThan(distance > 1.5 ? Math.min(2, distance - 1) : .12);
  188 |     } finally { await page.keyboard.up(key).catch(() => {}); }
  189 |     await page.waitForTimeout(400);
  190 |   }
  191 |   throw new Error(`Blocked at ${JSON.stringify(await position(page))}, ${axis}=${target}`);
  192 | }
  193 |
  194 | async function resume(page: Page) {
  195 |   await releaseOtherCaptures(page);
  196 |   await page.bringToFront();
  197 |   if (!await page.evaluate(() => Boolean(document.pointerLockElement))) {
  198 |     await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toBeEnabled();
  199 |     await activate(page.getByRole('button', { name: 'Продолжить', exact: true }));
  200 |   }
  201 |   await expectCapture(page, true);
  202 | }
  203 |
  204 | test('NEXT: four real roles share the scene; physical F carries one durable apple without repeats', async ({ page, context }, testInfo) => {
  205 |   test.setTimeout(600000);
  206 |   const pages = [page, await context.newPage(), await context.newPage(), await context.newPage()];
  207 |   const observed = pages.map(observe);
  208 |   const errors: string[] = []; const external: string[] = [];
  209 |   for (const player of pages) {
  210 |     player.on('pageerror', error => errors.push(error.message));
  211 |     player.on('websocket', socket => { if (new URL(socket.url()).host !== new URL(origin).host) external.push(socket.url()); });
  212 |     player.on('request', request => { const url = new URL(request.url()); if (url.protocol.startsWith('http') && url.origin !== origin) external.push(url.href); });
  213 |   }
  214 |   for (let index = 0; index < pages.length; index++) await login(pages[index]!, `NEXT role ${index + 1}`, '4', index === 1 ? null : 0);
  215 |   for (const data of observed) await expect.poll(() => data.state?.apples.length).toBe(5);
  216 |   const initial = observed.map(data => data.state!);
  217 |   expect(new Set(initial.map(state => state.sceneId)).size).toBe(1);
  218 |   expect(new Set(initial.map(state => state.epochMs)).size).toBe(1);
  219 |   for (const state of initial) {
  220 |     expect(state.definition).toEqual(initial[0]!.definition);
  221 |     expect(state.definition.cats.map(cat => cat.behavior).sort()).toEqual(['sleep', 'walk', 'wash']);
  222 |     expect(state.pots).toHaveLength(4);
  223 |     expect(new Set(state.apples.map(apple => apple.id)).size).toBe(5);
  224 |     expect(state.definition.flock.count).toBeGreaterThanOrEqual(4);
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
> 249 |   await carrier.screenshot({ path: testInfo.outputPath('carry-move.png') });
      |                 ^ TimeoutError: page.screenshot: Timeout 30000ms exceeded.
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
  325 |   const mumbleLoaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/mumble.wav') && response.ok());
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
```