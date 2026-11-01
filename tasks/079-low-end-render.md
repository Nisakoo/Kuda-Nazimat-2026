---
id: TASK-079
type: implementation-task
status: done
spec: ../specs/client-render.md
requirements: [RENDER-002, RENDER-004, RENDER-005, RENDER-007, RENDER-009]
related:
  - spec: ../specs/client-quality.md
    requirements: [QUALITY-001, QUALITY-003, QUALITY-005, QUALITY-006]
depends_on: []
---

# Снизить стоимость рендера на слабых ноутбуках

## Цель и изменения требований
По поручению пользователя реализовать пять направлений аудита main 2d12d12 в отдельном worktree. Добавить RENDER-009 (профили качества), уточнить QUALITY-005 (отправленные кадры и пропуски). При интеграции свежего main задача перенумерована из TASK-068 в TASK-079: номера 067–078 заняты входящими задачами.

## Реализация
- [x] Обычный профиль: DPR ≤1, тени 1024; облегчённый: DPR ≤1, без теней/MSAA; высокий: прежние DPR ≤2 и тени 2048. Выбор сохраняется локально и применяется через существующий перезапуск настроек.
- [x] Ограничить shadow casters обычного профиля крупными поверхностями и персонажами.
- [x] Убрать принудительный пересчёт статичных transform и повторный обход мировых матриц ветром; консервативные границы instancing, редкий дальний ветер.
- [x] Отсекать препятствия камеры по границам до точного raycast, сохраняя анимации и скрытые поверхности.
- [x] Ограничить очередь клонирования временным бюджетом между заданиями с гарантией прогресса и отмены.
- [x] Считать отправленные кадры отдельно от rAF и пропусков GPU; не выполнять дорогую презентацию при занятом GPU, сохраняя загрузку и жизненный цикл.

## Приёмка
- [x] RENDER-002/009: настройки качества, resize, камера/анимации/появление чанков проверены в браузере.
- [x] RENDER-004/005/007: очередь, отмена, статичные/динамические матрицы, bounds и освобождение ресурсов проверены регрессиями.
- [x] QUALITY-005/006: измерения до/после с одинаковой сценой и отдельными submitted/skipped; ограничения профиля записаны.
- [x] QUALITY-001/003: make client-test, check, check:imports, build и релевантные browser checks; результат записан.

## Основание
ThreeRenderer всегда включал MSAA, тени рынка 2048 и DPR до 2. GltfLibrary включала castShadow у всех Mesh и клонировала до 8 моделей независимо от длительности. WindInstances обходила мировые матрицы и пересчитывала сферы каждый кадр, затем renderer вызывал updateMatrixWorld(true). Камера обходила все чанки пять раз. FrameMetrics учитывала rAF даже при отказе FrameFence отправить кадр. Это наблюдения кода, не измеренные доли CPU/GPU на слабом ноутбуке.


## Результат
Реализованы все пять направлений и корректная диагностика отправок. Основные изменения: ThreeRenderer/GraphicsQuality, GltfLibrary/modelPresentation, VisualChunks/VisualWind/WindInstances, CameraObstruction/CameraRaycast, FrameMetrics/GameApp и настройки. Изменений server/shared, физических коллизий, протокола, лимита 25 чанков или WorldBudget нет. Высокий профиль сохраняет MSAA/DPR 2/2048 и всех прежних shadow casters; обычный сохраняет силуэты персонажей и крупных объектов, убирает тени мелкого/ветрового декора. Границы instancing охватывают вращения вокруг отдельных pivots, а не весь радиус от начала модели.

### Проверки финального кода
- `NODE_OPTIONS=--no-experimental-webstorage make client-test`: **434/434**, 52 файла ([лог](evidence/low-end-render/unit.log)). Установленный Node сообщает v25.6.0, включая путь node@24. Без флага прежний тест аудио обращается к Node localStorage без removeItem; флаг отключает эту экспериментальную реализацию и позволяет happy-dom предоставить браузерное хранилище. Ошибка исходного запуска не считается PASS.
- `npm --prefix client run check`: Svelte/TS/Core проходят, 0 ошибок и предупреждений ([лог](evidence/low-end-render/check.log)).
- `npm --prefix client run check:imports`: 188 модулей, нарушений нет ([лог](evidence/low-end-render/imports.log)).
- `npm --prefix client run build`: проходит; штатное предупреждение о JS bundle >500 kB остаётся ([лог](evidence/low-end-render/build.log)).
- Из `client/`: `PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_PORT=4199 npx playwright test e2e/graphics.spec.ts e2e/models.spec.ts`: **4/4** ([лог](evidence/low-end-render/graphics-browser.log)). DPR 2, три профиля/resize/reload, освобождение старых контекстов, искусственная задержка GPU с продолжением загрузки и управления; покупка у NPC, пастбище, двор, лестница и возврат; отказ/retry модели.
- `PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_RENDER_PORT=5201 npm --prefix client run test:render`: **14/14** ([лог](evidence/low-end-render/render-browser.log)). Общие GPU-ресурсы и последний владелец, отмена, glTF, каталог/ветер, животные, четыре персонажа и переноска на 30/60 Hz. Частота сценария анимации не выдаётся за самостоятельный GPU benchmark.
- Проверки широких/точных границ камеры включают material side, группы, drawRange, indexed/non-indexed, скрытые Mesh, редактирование вершин и движущихся родителей. Тест дальнего кластера ветра проверяет компактность сферы, а все вершины — попадание в неё при вращении.
- `git diff --check` проходит. Серверные тесты не запускались: server/shared не менялись.

### Измерения
Chrome 156, ANGLE Metal Apple M4, CSS viewport 1280×800, DPR устройства 2, local market, радиус 2 (25 чанков). По 5 с прогрева, затем 5 с движения назад и 5 с вперёд, последовательно без параллельных тестов. [Скрипт](../client/scripts/profile-render.mjs) считает отправки по настоящим WebGL fenceSync и draw calls по GL, независимо от старого HUD. Это короткий сравнительный маршрут, не полный 60-секундный профиль QUALITY с пятью рестартами и не квалификация слабого ноутбука. Первичный замер около 35 FPS шёл при параллельной проверке; для таблицы baseline повторён без неё.

Воспроизведение из client: `node scripts/profile-render.mjs http://127.0.0.1:4200 balanced ../tasks/evidence/low-end-render/balanced-dpr2.json`. Сначала раздать нужную production-сборку на указанном loopback-порту; исходная сборка построена до изменений из 2d12d12 и раздавалась на 4198. Для других профилей заменить balanced на high/low. Скрипт использует установленный локальный Chrome; интернет игре не нужен.

| Сборка / профиль | 3D-буфер | Отправок/с | P95 между отправками, мс | Максимум draw calls |
|---|---|---:|---:|---:|
| [Исходный main](evidence/low-end-render/baseline-dpr2-final.json) | 2560×1600 | 57.4 | 18.9 | 542 |
| [Обычный](evidence/low-end-render/balanced-dpr2.json) | 1280×800 | 59.9 | 17.8 | 430 |
| [Высокий](evidence/low-end-render/high-dpr2.json) | 2560×1600 | 56.9 | 30.0 | 543 |
| [Облегчённый](evidence/low-end-render/low-dpr2.json) | 1280×800 | 59.9 | 18.1 | 330 |

Обычный профиль уменьшил максимум draw calls на 20,7%, облегчённый — на 39,1%; оба рисуют вчетверо меньше пикселей при DPR устройства 2. HTML остаётся в исходном разрешении. Высокий профиль не показал ускорения FPS в этом коротком прогоне; разница P95 чувствительна к пропускам при 60 Hz и требует более длинных серий для выводов. Во всех четырёх прогонах ошибок страницы нет (`errors: []`). Скриншоты рядом с JSON сохраняют фактическое изображение. Показ отправленного кадра дисплеем отдельно не измерялся.

### Ограничения старых сценариев
Начальный более широкий запуск `graphics + market + world + main-building` дал 3 PASS / 5 FAIL ([лог](evidence/low-end-render/legacy-browser.log)). Старые сценарии ищут удалённые элементы «Текущая область», кнопку «Сады науки», прежнее меню камня/словаря и старый путь возобновления. В сценарии покупки также есть пограничная точка около радиуса NPC. Исходная неизменённая сборка отдельно воспроизвела сбой селектора области и сбой возобновления покупки ([лог](evidence/low-end-render/legacy-baseline.log)); это не полный повтор всех пяти ошибок. Эти проверки не объявлены зелёными и не переписаны скрытым ослаблением assertions. Актуальные сценарии graphics.spec.ts отдельно проходят тот же переход, покупку, лестницу и управление. Полное обновление старых UI-e2e и аппаратный прогон на слабом ноутбуке остаются вне этой задачи.


### Интеграция со свежим main
По поручению пользователя коммит сначала отправлен в perf/low-end-render, затем перенесён через rebase на origin/main `36d4c64`. Текстовых конфликтов нет. Входящие изменения auth/NPC сохранены; server/shared совпадают с этим main. Номер 068 уже занят LLM-задачей, поэтому задача рендера перенумерована в 079, ссылки README/architecture исправлены.

После rebase повторены `NODE_OPTIONS=--no-experimental-webstorage make client-test` — **462/462**, 54 файла ([лог](evidence/low-end-render/rebase-unit.log)); `npm --prefix client run check` — 0 ошибок/предупреждений ([лог](evidence/low-end-render/rebase-check.log)); `check:imports` — 193 модуля, нарушений нет ([лог](evidence/low-end-render/rebase-imports.log)); production build — PASS со штатным предупреждением о размере bundle ([лог](evidence/low-end-render/rebase-build.log)). Реализация render, FrameMetrics и Settings после rebase совпадает с уже проверенным вариантом; в render пришло только увеличение timeout существующего avatar-теста из main. Предыдущие 14 WebGL-проверок и сравнительные замеры не выдаются за новый запуск после rebase.

Браузерный повтор после rebase: из `client/`, `PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_PORT=4199 npx playwright test e2e/graphics.spec.ts e2e/models.spec.ts e2e/foundation.spec.ts -g 'quality profiles|GPU backpressure|optimized scenery|optional decoration|runtime config selects'` — **5/5 PASS** ([лог](evidence/low-end-render/rebase-browser.log)). Проверены три профиля, сохранение/resize/reload, задержка GPU, покупка/маршрут/лестница, retry модели и discovery способов входа из нового main до открытия online-каналов. Нового запуска старых UI-e2e и server suite не было; известные ограничения выше остаются явными.

Перед отправкой main продвинулся до `3cc3e57`: добавлены только документы/макеты админ-панели и задачи 080/081. Повторный rebase прошёл без конфликтов. `git diff --exit-code 4f2e06a HEAD -- client shared server/src server/test server/package.json server/package-lock.json Makefile` подтвердил неизменность проверенного кода; повтор тестов не требовался. Новая передача TASK-081 (серверные perf-отчёты каждые 10 с) остаётся самостоятельной незавершённой задачей.
