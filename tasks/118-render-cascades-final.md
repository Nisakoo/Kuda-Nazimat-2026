---
id: TASK-118
type: implementation-task
status: done
spec: ../specs/client-render-cascades.md
requirements: [RCSM-001, RCSM-002, RCSM-003, RCSM-004, RCSM-005, RCSM-006, RCSM-007]
related:
  - spec: ../specs/client-render-optimization.md
    requirements: [ROPT-001, ROPT-002, ROPT-003, ROPT-004, ROPT-005, ROPT-006, ROPT-007]
depends_on: [TASK-117]
---

# Каскадные тени и итог серии

## Цель

Седьмой этап после проверенного отказа ROCC. Условная оценка CSM как улучшения качества; прежние профили/defaults сохраняются. При принятии пользовательской настройки обновить RENDER/SET в этой задаче до production UI.

## Метрики и ограничения до кода

- Baseline: одна PCF2048 карта ±24. Проверить существенность ближней ступенчатости и потери дальних теней; не объявлять дефектом намеренную стилизацию. Если качества кандидат не улучшает, отказ допустим без performance adoption.
- Test-only high: локальный Three CSM, два1024 каскада, practical split, maxFar64 m, lightMargin40 m, lightNear1/lightFar120; направление/цвет/intensity прежнего солнца2.7, bias−.0001/normalBias.035, fade. Размеры frustums при FOV/aspect обновляются. Не более128 материалов,256 KiB metadata из WorldBudget. GPU:≤2 targets, оценка RGBA+depth32≈16 MiB плюс отдельно записанные реальные форматы. Старую карту при переключении освободить, не держать третий target.
- До принятия нужны улучшение дефекта на сопоставимых market/courtyard/stairs/pasture/first-person кадрах/видео, поздние материалы/casters за камерой/context lifecycle. Свет не делает сцену ярче. Whole GPU median дополнительная цена≤2 ms, P95≤+5%, ≥3×60 s пар; shadow/main отдельно. Если уже quality gate не пройден, CSM не внедряется.
- После решения сравнить исходный RPERF с final на low/balanced/high по3×60 s, одинаковые сцены/ресурсы/маршрут, ≥5 s warm. Отдельно повторить offline/UI/gameplay/две камеры/выстрелы/реальный сервер4 auth Chrome players/5 cycles/context restore. Нет обещаний слабого ноутбука/физической LAN/полного LLM.

## Приёмка

- [x] RCSM S1: качество baseline и кандидата, решение с evidence и полной ценой при принятии.
- [x] RCSM S2–S3: late materials/camera/budget/context/fallback либо отказ и изоляция прототипа.
- [x] RCSM S4: исходный/предыдущий/final baseline, три профиля,4 игрока, gameplay и ресурсы.
- [x] Все проверки, README/architecture/spec metadata и итоговый отчёт соответствуют фактам.

## Результат

CSM с двумя1024 оценён и отклонён: первый cascade даёт2.90–3.67 cm/texel против2.34 cm исходной карты, ближние тени ухудшились. Прототип e2e ограничен/очищается; production сохраняет одну карту.

Финал:18 минутных записей original/final,3 профиля; P95 не ухудшился. Low/balanced saturated calls326→231/476→381, high544→544. CPU первого выстрела8.2→3.1/7.6→2.7/7.7→2.2 ms. FPS high59.51→59.17: ускорение среднего FPS не доказано. Пять циклов каждого профиля: все ресурсы0, heap growth<.54 MB. Previous-stage и final production идентичны.

Проверки: make client-test485/485, check0 errors/0 warnings, imports/buildPASS; test:render19/19; browser5/5 после исправления test route через существующие проходы; реальный app/server4 auth Chrome players,3×60 s, errors/warnings0; offline actual GameApp214 локальных requests/external0/errors0, движение/две камеры доступны. Краткие результаты сохранены здесь; сырые записи и подробный отчёт удалены по запросу пользователя.

Физическая LAN/отключение Wi-Fi, слабый ноутбук и полный LLM не квалифицированы; это приёмка M4/Chrome и loopback4 tabs с тестовым LLM. Сервер/shared не менялись. FrameFence/physics/FPS scheduling сохраняются.

Артефакты проверок удалены по запросу пользователя; исторические результаты и команды выше сохранены. Новые материалы проверок хранятся вне checkout (TASK-119).

Команды итоговых проверок: `NODE_OPTIONS=--no-experimental-webstorage make client-test`; `npm --prefix client run check`; `npm --prefix client run check:imports`; `npm --prefix client run build`; из client `PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_RENDER_PORT=4198 npm run test:render`; `PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_PORT=4199 npx playwright test e2e/graphics.spec.ts e2e/shotgun.spec.ts -g 'quality profiles|GPU backpressure|FPS chart|optimized scenery|V switches'`. Измерения: Apple M4 Air16 GB, Chrome156.0.8078.80/ANGLE Metal,1280×800/DPR2, market radius2; основной профиль high сохраняет buffer2560×1600. Серверный прогон: `node --experimental-transform-types scripts/measure-online.mjs` (временный каталог по умолчанию),4 auth loopback clients с тестовым LLM; client P95 33.7–35.7 ms, server tick P95 2.148–3.265/max96.920 ms.
