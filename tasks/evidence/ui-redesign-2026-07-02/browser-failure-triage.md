# TASK-048: browser failure triage (frozen source)

- Scope: read-only triage of the frozen-source browser runs. No browser, GPU, dev server, check, generator, or source edit was started for this file.
- Source under test: production base `4587fa1` (working tree also holds in-progress corrections; see "Corrections in progress").
- Raw logs: not modified. This file is the only new file.
- This is not acceptance evidence and it does not close any requirement or task.

## 1. Counts (from the frozen logs)

| Run | Log | Total | Pass | Fail |
| --- | --- | --- | --- | --- |
| `npm run test:browser` (47 tests, 1 worker, 27.8 m) | `browser-suite-final.log` | 47 | 15 | 32 |
| `npm run test:render` (8 tests, 2.9 m) | `browser-render-final.log` | 8 | 4 | 4 |
| **Total** | | **55** | **19** | **36** |

`final-status.log`: `client-tests=0`, `client-check=0`, `client-imports=0`, `client-build=0`, `browser-suite=1`, `browser-render=1`, start `2026-11-01T00:37:18Z`, end `2026-11-01T01:09:45Z`.

The 15 passes include real WebGL-unavailable handling (`foundation.spec.ts:53`), guest runtime config (`:68`), missing/invalid config (`:82`, `:89`), a model load failure with retry (`models.spec.ts:6`), science-map movement (`movement.spec.ts:15`), four of six HUD layout viewports (`movement.spec.ts:36` at 1024/640), login-error text and a real 401 (`server-auth.spec.ts:100`, `:119`), and two entry/registration UI flows (`ui-hud.spec.ts:63`, `:89`).

## 2. Evidence used

- Raw logs: `browser-suite-final.log`, `browser-render-final.log`, `final-status.log`, `browser-render-before-freeze.log`, `browser-ui-final.log`, `ui-browser-run1.log`, `browser-trace-off-diagnostic.log`, `browser-system-chromium-diagnostic.log`, `browser-diagnostic-local.log`, `hang-trace-summary.log`, `diagnose-hang.log`, `compare-*.log`, `manual-browser-check.md`.
- Per-test Playwright artefacts (`client/test-results/<test>/`, `client/render-test-results/<test>/`): `error-context.md` (error text + ARIA page snapshot) and `trace.zip`. Traces were read selectively: console messages, `pageError` events, HTTP status of `/api/*` and `/maps/*` requests, action timing. Screenshots inside traces were not extracted; the `render-test-results/*/sprint.png` file was viewed.
- Read-only source reads: `client/e2e/*.spec.ts`, `client/e2e/helpers.ts`, `client/e2e/avatar-world-scenario.ts`, `client/e2e/render-harness.ts`, `client/src/ui/App.svelte` (frozen `4587fa1` and current), `client/src/app/GameApp.ts`, `client/src/input/InputController.ts`.
- Redaction: no cookie, token, password, or `Authorization` value from any trace is reproduced here. Request headers were not copied.

No `error-context.md` page snapshot exists for 8 of the 32 suite failures, because the page or context was already closed when Playwright took the snapshot (they hold error text only). They are marked "no snapshot" below; their failure point comes from the log.

## 3. Confirmed defects and confirmed observed conditions

### 3.1 Confirmed test defect (source-level, cause proven)

**F1 - `babylon.spec.ts:44` (test 1, `babylon.spec.ts:79`)**: nested relative locator.
`mode.locator('.entry-choice').filter({ has: friends })`, where `friends = mode.getByRole(...)`, nests the dialog inside itself, so the locator can never match. Failure: `locator.click` waited 120 s ("waiting for getByRole('dialog', …).locator('.entry-choice').filter({ has: … })"), test timeout. Cause: proven at source level. Status: already corrected in the working tree to `filter({ has: page.getByRole('radio', …) })`; retest pending. Not a product defect.

### 3.2 Confirmed product-visible conditions (state proven, cause not proven)

**P1 - Readiness gate keeps "Начать прогулку" disabled.** Frozen `client/src/ui/App.svelte:79/94`: `disabled={capture === 'requesting' || !worldReady || visualLoading}`, with `visualLoading = diagnostics.pending > 0` (`GameApp.ts:619`) and `worldReady = world.isPrepared(position)` (`GameApp.ts:624`).
- `demo.spec.ts:76`: snapshot shows "Загружаем оформление…", "Готовим окрестности точки появления…" and `<button "Начать прогулку" [disabled]>` after "Перезапустить сцену"; the later click timed out.
- `network.spec.ts:45`: same two loading lines and disabled button after "Применить и открыть карту".
- `server-auth.spec.ts:62/80`, `ui-hud.spec.ts:94`: 8 polls over 5 s, button still `disabled` (snapshot `- button "Начать прогрулку" [disabled]`).
- `pointer-lock.spec.ts:44` trace: the click action stayed "element is not enabled" from 1239.5 s to about 1250.9 s of trace time and only then ran "click action done".
Proven: the gate is in the shipped source and the disabled state is real in these runs. Unproven: why `pending`/`worldReady` do not settle in 5-12 s (see U1).

**P2 - Measured frame cost in the same pages.** Product diagnostics printed inside the failing tests: FPS 1.2 · frame 828.3 ms · P95 1311.2 ms (`quality.spec.ts:7` market), FPS 1.2 · 807.2 ms (`main-building.spec.ts:54`), FPS 3.1 · 318.4 ms (`market.spec.ts:20`), FPS 3.7 · 269.3 ms, FPS 4.7 · 214.9 ms (`pointer-lock.spec.ts:6`), FPS 14.6 · 68.7 ms, FPS 15.4 · 64.9 ms (`world.spec.ts:6`). Draw calls 116-358.
Proven: these numbers are in the page's own debug output at failure time. Unproven: the rasterization backend. No `UNMASKED_RENDERER_WEBGL` string was captured in this run (the `quality.spec.ts` environment probe is read after the failing poll). The only GPU-side signals are 4 `GL Driver Message (OpenGL, Performance, …): GPU stall due to ReadPixels` warnings and 1 `THREE.WebGLShadowMap: PCFSoftShadowMap has been removed` warning. SwiftShader is stated for a different, manual run (`manual-browser-check.md`), not measured here.

**P3 - Chunk-window expectations not met inside the 5 s poll, with work still queued.** `Ожидание` (pending) 1-2 in every snapshot: `babylon.spec.ts:149` "Чанки: 12 · Ожидание: 2" vs expected "Чанки: 25 · Ожидание: 0"; `market.spec.ts:20` 22 / 2; `quality.spec.ts:7` market 13 / 2. `market.spec.ts:20` trace: 42 `/maps/.../chunks/` requests, 40 answered HTTP 200, 2 with no response recorded when the trace ended.
Proven: counts, the pending counters, and the 2 unanswered requests. Unproven: whether the 2 requests are stalled (server or client queue) or only slower than the window.

**P4 - Buy status missing while one request is in flight.** `babylon.spec.ts:128`: `getByRole('status')` filtered on "Предмет добавлен" is not found (`Received: undefined`). Trace: 24 `POST /api/babylon` answered 200 and the last one has no recorded response at trace end.
Proven: no status element in that 5 s window and one purchase request in flight. Unproven: server latency vs client state update.

**P5 - Second `i` leaves Inventory open, Pause absent.** `ui-hud.spec.ts:58` (`avatar-world-scenario.ts:53`): snapshot at failure shows `dialog "Инвентарь"`, `button "Кувшин" [pressed]`, "В руках: Кувшин", status "Просмотр приостановлен", and no "Пауза" dialog. The earlier steps of that scenario (registration, avatar `dan` model request, live appearance, jug ACK) had already completed, which matches the earlier record that this test now gets past them.
Proven: this exact state. Unproven: why the key did not reach the dock toggle; an independent reviewer is checking focus/keyboard routing.

**P6 - Capture-error path produced no alert.** `pointer-lock.spec.ts:44` (injected `NotAllowedError`) and `:64` (`requestPointerLock` undefined): after a click that did run (trace: resolved enabled, "click action done"), `getByRole('alert')` is "element(s) not found" for 5 s. Frozen source would render `role="alert"` from `captureError` (`App.svelte:72`), and `InputController` reports failures through `captureFailed` (`InputController.ts:59-80`, `:155`).
Proven: click dispatched, no alert element. Unproven: whether `requestPlay` returned early, or `captureFailure` did not run.

**P7 - Header controls never become usable after mock connect.** `layout.spec.ts:22` at 1280x800, 1024x600, 640x480 all fail at `usableControls(page.locator('header'))` (line 39), after `mock` + "Применить и открыть карту" + `runFor(200)`, with "Подключён" reached. Two logs say "element is not stable"; one says `locator.evaluate` timed out. Earlier `usableControls(page.locator('.welcome'))` in the same test passed.
Proven: the header step is a systematic failure at all three viewports with the same page state. Unproven: continuous re-render/instability vs faked-clock frame stall.

**P8 - Pose capture cannot finish in the harness budget.** `render.spec.ts:70` (`MOVE poses`, 4 tests): `page.evaluate(window.renderHarness.movement(fps, yaw))` did not settle within the 30 s test timeout. The harness needs 4 simulated seconds, i.e. 120 rAF iterations at 30 FPS and 240 at 60 FPS (`render-harness.ts:56-93`). `sprint.png` taken 1750 ms after the call still shows the four players undisplaced (movement only starts after 0.7 simulated seconds), and the two first players' name plates are clipped ("Игрок 2" wider than its card, "Игрок 4" cut at the canvas edge). No page errors, no request failures, only `[vite] connected`.
Proven: the run reached only a small fraction of the required frames in 1.75 s and did not reach 4 simulated seconds in about 28 s. Unproven by execution: the later assertions (`actualFps > 0.8 × fps`, `simulatedFrames >= fps × 4`) were never evaluated.

**P9 - Screenshot and step timeouts after the world is running.** `foundation.spec.ts:6`: `page.screenshot` timed out after "waiting for fonts to load… / fonts loaded". `main-building.spec.ts:21`, `market.spec.ts:57`, `movement.spec.ts:15` (market), `network.spec.ts:72`, `main-building.spec.ts:54`, `pointer-lock.spec.ts:6`, `market.spec.ts:92`, `server-auth.spec.ts:130`: a single step (`keyboard.up`, `mouse.move`, `textContent`, `locator.click`) consumed the whole test timeout and then reported "Target page, context or browser has been closed".
Proven: the step is where the budget ended. Unproven: root cause per test. Note: a screenshot timeout alone is not evidence of a geometry/assertion failure, and none of these steps is a geometry assertion.

## 4. Failure matrix (suite, 32 failures)

Snapshot = ARIA snapshot of `error-context.md` at failure time. "No snapshot" = browser already closed.

| # | Test (spec:line) | Time | Failure point | Actual snapshot condition | Confirmed / unproven |
| --- | --- | --- | --- | --- | --- |
| 1 | `babylon.spec.ts:79` | 2.0 m | `login()` `locator.click` on `.entry-choice` | no snapshot | Confirmed test defect F1 (fixed, retest pending) |
| 2 | `babylon.spec.ts:128` | 2.6 m | `status` "Предмет добавлен" not visible (5 s) | no snapshot; trace: last `POST /api/babylon` unanswered | P4: observation confirmed, cause unproven |
| 3 | `babylon.spec.ts:149` | 41.0 s | "Кеш мира" text: 25/0 expected, "Чанки: 12 · Ожидание: 2" | no snapshot (values from call log) | P3: confirmed values, cause unproven |
| 4 | `demo.spec.ts:14` | 18.9 s | `expectCapture(true)` at line 28 | welcome region still shown, "Начать прогулку" `[active]`, no alert | capture absent confirmed; cause unproven |
| 5 | `demo.spec.ts:76` | 31.4 s | click "Начать прогулку" after "Перезапустить сцену"; button disabled | "Загружаем оформление…" + "Готовим окрестности…" + disabled button | P1: state confirmed, cause unproven |
| 6 | `foundation.spec.ts:6` | 32.6 s | `page.screenshot` (390x844) | welcome region, enabled button, status "Сцена открыта" | P9: confirmed step stall, cause unproven |
| 7 | `layout.spec.ts:22` 1280x800 | 30.6 s | `usableControls(header)` - `scrollIntoViewIfNeeded` | welcome, mock "Подключён", no dialog | P7: confirmed, cause unproven |
| 8 | `layout.spec.ts:22` 1024x600 | 31.3 s | `usableControls(header)` - `locator.evaluate` | same as #7 | P7: confirmed, cause unproven |
| 9 | `layout.spec.ts:22` 640x480 | 31.7 s | `usableControls(header)` - "waiting for element to be stable" | same as #7 | P7: confirmed, cause unproven |
| 10 | `main-building.spec.ts:21` | 2.1 m | `keyboard.up` in `walk()`, browser closed | "Двор Вавилонской башни" region, HUD present | step timeout confirmed, cause unproven |
| 11 | `main-building.spec.ts:54` | 31.8 s | `mouse.move` (pointer-lock look) | Рынок, Чанки 12/2, FPS 1.2 · 807 ms | P2/P9 confirmed values, cause unproven |
| 12 | `market.spec.ts:20` | 28.4 s | poll "Чанки: 25 · Ожидание: 0", got 22/2 | Рынок, FPS 3.1 · 318 ms, 2 unanswered chunk requests | P3: confirmed, cause unproven |
| 13 | `market.spec.ts:57` | 2.0 m | `keyboard.up` in `walk()`, browser closed | Z -8.4, "Чанки: 1 · Ожидание: 0", FPS 14.6 | step timeout confirmed; "Чанки: 1" after walking is an unexplained observation |
| 14 | `market.spec.ts:92` | 31.8 s | click "Камень" (dock button) | welcome region for market, no pause dialog, `[active]` on start | world not entered on this attempt; cause unproven |
| 15 | `movement.spec.ts:15` demo | 14.0 s | `expectCapture(true)` in `start()` | welcome, "Начать прогулку" `[active]` | capture absent confirmed, cause unproven |
| 16 | `movement.spec.ts:15` market | 32.3 s | `getByLabel('Положение игрока').textContent()` browser closed | Рынок, Чанки 24/1, FPS 3.7 · 269 ms | P9 confirmed, cause unproven |
| 17 | `movement.spec.ts:36` 1280 100% | 14.1 s | `expectCapture(true)` in `start()` | welcome, `[active]` start button | capture absent confirmed (5 of 6 viewports pass, 1 fails) |
| 18 | `network.spec.ts:6` | 21.1 s | `expectCapture(true)` after start | HUD is rendered ("Меню Esc", dock, "Площадь открытий") with `pointerLockElement === null` | P6-adjacent: confirmed inconsistent state, cause unproven |
| 19 | `network.spec.ts:45` | 31.2 s | click "Начать прогулку", disabled | both loading lines, disabled button | P1: confirmed, cause unproven |
| 20 | `network.spec.ts:72` | 31.9 s | `keyboard.up('w')`, browser closed | HUD, "Площадь открытий", "Подключён" | step timeout confirmed |
| 21 | `pointer-lock.spec.ts:6` | 31.6 s | `mouse.move` loop (20 moves) | HUD, Z 6.0, Чанки 9/0, FPS 4.7 · 215 ms; capture had succeeded | P9 confirmed; pointer lock itself worked here |
| 22 | `pointer-lock.spec.ts:44` | 19.9 s | `getByRole('alert')` "Не удалось захватить мышь" not found | no snapshot; trace shows click ran | P6: confirmed, cause unproven |
| 23 | `pointer-lock.spec.ts:64` | 17.6 s | `getByRole('alert')` "не поддерживает захват мыши" not found | no snapshot | P6: confirmed, cause unproven |
| 24 | `quality.spec.ts:7` demo | 20.8 s | `expectCapture(true)` | welcome, `[active]` start button | capture absent confirmed, cause unproven |
| 25 | `quality.spec.ts:7` market | 39.4 s | poll chunks `toBe(25)`, got 13 | Рынок, Чанки 15/2, FPS 1.2 · 828 ms | P3: confirmed, cause unproven |
| 26 | `server-auth.spec.ts:62` | 17.4 s | `toBeEnabled` "Начать прогулку" (5 s) | `- button "Начать прогулку" [disabled]` | P1: confirmed, cause unproven |
| 27 | `server-auth.spec.ts:80` | 8.1 s | `toBeEnabled` "Начать прогулку" (5 s) | disabled button | P1: confirmed, cause unproven |
| 28 | `server-auth.spec.ts:130` | 32.5 s | click "Применить и открыть карту" in Settings | no snapshot; button resolved `<button type="submit">` | step timeout confirmed, cause unproven |
| 29 | `ui-hud.spec.ts:58` | 1.6 m | `resume()`: dialog "Пауза" not visible | Инвентарь open, Кувшин pressed, "Просмотр приостановлен" | P5: confirmed, cause under independent review |
| 30 | `ui-hud.spec.ts:94` | 11.5 s | `toBeEnabled` "Начать прогулку" after enroll (5 s) | disabled button | P1: confirmed, cause unproven |
| 31 | `world.spec.ts:6` | 31.9 s | text "Соседний участок ещё загружается." not visible | Z 12.9, Чанки 1/0, FPS 15.4 · 64.9 ms, no wait message | observed state confirmed; boundary state not reached, cause unproven |
| 32 | `world.spec.ts:39` | 20.2 s | `expectCapture(true)` after retry click | welcome, `[active]` start button | capture absent confirmed, cause unproven |

## 5. Failure matrix (render suite, 4 failures)

| # | Test | Time | Failure point | Actual condition | Confirmed / unproven |
| --- | --- | --- | --- | --- | --- |
| 33 | `render.spec.ts:68` 30 FPS front | 31.3 s | `page.evaluate(movement(30, 0))` did not settle | `sprint.png` at 1.75 s: 4 players undisplaced, clipped name plates | P8: pacing confirmed, `actualFps` assertion not reached |
| 34 | `render.spec.ts:68` 30 FPS side | 31.6 s | same | same (no page errors) | P8 |
| 35 | `render.spec.ts:68` 60 FPS front | 31.0 s | same | same | P8 |
| 36 | `render.spec.ts:68` 60 FPS side | 31.7 s | same | same | P8 |

`render.spec.ts:6/33/43/54` passed (resource sharing, external-buffer glTF, failed-load retry, abort while HTTP pending), so the render harness and model loading work; only the timed movement capture fails.

## 6. Unknowns (do not assume a cause)

- **U1** Why `visualLoading` / `worldReady` stay pending for 5-12 s (or never settle after restart). Candidates: slow GPU-side visual preparation; chunk preparation waiting on a frame budget; a genuinely stuck load. No isolated measurement exists in this run.
- **U2** Rendering backend of the bundled Chromium in this run. Not measured; `SwiftShader` is not proven for these logs and must not be used as a blanket cause.
- **U3** Why 2 chunk requests stay unanswered while 40 answer 200.
- **U4** Which side stalled the last `POST /api/babylon` (server latency vs client commit/skip).
- **U5** Why keyboard `i` did not close Инвентарь in `ui-hud.spec.ts:58` (focus/keyboard routing).
- **U6** Why the capture-error path (`pointer-lock.spec.ts:44/64`) sets no `captureError`, while real capture works in `pointer-lock.spec.ts:6`.
- **U7** Why header controls stay unstable after mock connect (`layout.spec.ts:22`), while `.welcome` controls in the same test pass.
- **U8** Why capture is absent while the HUD is already rendered (`network.spec.ts:6`).
- **U9** Whether the in-progress source corrections change any of these results (nothing was run).

## 7. Corrections in progress (context only, not evidence)

Working-tree changes exist for `client/src/ui/App.svelte`, `Login.svelte`, `EntrySetup.svelte`, `AvatarSelection.svelte`, `modal.ts`, three CSS files, `client/e2e/babylon.spec.ts`, `client/e2e/ui-hud.spec.ts`, and the avatar-model scripts. Two of them touch failure causes above: the `babylon.spec.ts` locator (F1) and `ui-hud.spec.ts` focus assertions. Earlier runs (`browser-ui-final.log`, `ui-browser-run1.log`, `browser-trace-off-diagnostic.log`) show capture/readiness failures before the freeze too, so these failures are not new in the frozen run.

## 8. Prioritised reading

1. Test defect: F1 (proven, fixed, retest pending).
2. Product conditions that block the most tests: P1 readiness gate (7 tests), capture-absent family (P5/P6, 8 tests), then P7 header instability (3), P3 chunks (3), P8 render pacing (4).
3. Unproven but expensive if wrong: U1, U2, U3, U6, U8 - each needs one isolated, minimal measurement before any claim.
