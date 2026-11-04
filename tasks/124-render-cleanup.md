---
id: TASK-124
type: implementation-task
status: done
spec: ../specs/client-render.md
requirements: [RENDER-009]
related:
  - spec: ../specs/client-render-optimization.md
    requirements: [ROPT-003]
  - spec: ../specs/client-render-measurement.md
    requirements: [RPERF-001]
depends_on: [TASK-114, TASK-118]
---

# Высокий профиль без просадки и очистка стендов ROPT

## Цель и изменения требований

TASK-114 показал, что high упирается в GPU из-за DPR 2 + MSAA + теней 2048, а DPR 1 возвращает около 60 FPS. Серия ROPT при этом оставила в репозитории стенды и скрипты для отклонённых экспериментов. Изменено **RENDER-009**: высокий профиль ограничивает DPR до 1,5 (было ≤2), тени 2048 и MSAA сохраняются. Спека RPERF переведена в `retired`, потому что её стенд удалён.

## Реализация

- [x] `GRAPHICS_PROFILES.high.pixelRatio` 2 → 1,5; low/balanced без изменений.
- [x] Удалены опциональные измерения из `ThreeRenderer` (`RenderMeasurement`, `GpuTimer`, `DrawInventory`, перехват shadow pass, `measurementResources`) вместе с их unit-тестами.
- [x] Удалены стенды `e2e/measurement-harness.*`, `e2e/shadow-harness.*`, `e2e/*-experiments.ts`, `e2e/shadow-cache-audit.ts`, скрипты `scripts/inspect-*`, `measure-*`, `compare-render`, `render-summary`, `trace-frame`, `inventory-render` и три WebGL-сценария, которые от них зависели.
- [x] В игре остались `PelletMarks`, общий `CameraRaycast`, график FPS и счётчики `renderer.info` с учётом теневого прохода.

## Приёмка

- [x] RENDER-009: drawing buffer high при CSS 1280 и DPR 2 равен 1920 (`graphics.spec.ts` «quality profiles»).
- [x] Обычная игра high стала заметно плавнее (ниже).
- [x] Обязательные проверки клиента.

## Результат

macOS 26.3, Apple M4 / 16 GB, Node 24.22.2, установленный Chrome (видимое окно). Быстрая A/B проверка: production preview, market, high, CSS 1440×932, DPR 2, 6 с прогрева, медиана 15 секундных показаний FPS из диагностики:

- DPR 2 (прежний код): buffer 2880, медиана 49,5 и 49,7 FPS (min 41,3).
- DPR 1,5: buffer 2160, медиана 58,9 FPS (min 54,1, max 59,4).

Это короткий скрининг на одной машине (один из прогонов DPR 1,5 оборвался по таймауту поиска панели диагностики и не учитывается), не серия RPERF; слабый ноутбук не проверялся.

Проверки из корня: `NODE_OPTIONS=--no-experimental-webstorage make client-test` — **479/479**, 58 файлов (485 − 6 тестов удалённых модулей); `npm --prefix client run check` — exit 0; `check:imports` — без нарушений (211 модулей); `build` — PASS. Из `client/`: `PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_RENDER_PORT=4198 npm run test:render` — **14/14**; `PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_PORT=4199 npx playwright test e2e/graphics.spec.ts e2e/shotgun.spec.ts -g 'quality profiles|GPU backpressure|FPS chart|V switches'` — **4/4**. Server/shared не менялись.
