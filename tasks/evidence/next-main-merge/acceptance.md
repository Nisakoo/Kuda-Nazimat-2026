# Слияние NEXT с main — проверка интеграции

Дата: 2026-11-01. Основы: `8726b53` (целевая ветка), `09fd771` (`origin/main`, обновлён через fetch). Слияние выполняется в `/private/tmp/competition-2026-next-merge`, с `git merge --no-commit --no-ff -X theirs origin/main`. Основной рабочий каталог с незавершённым слиянием не изменялся. Чистый main для сравнения находится в отдельном detached worktree.

## Изменения интеграции

- Конфликтующие фрагменты приняты из main; сохранены парольная авторизация, отзыв сессий, наблюдаемость, раздельное появление игроков и NPC streaming. Точки подключения world-life адаптированы к новым конструкторам и логгеру. Сохранены ограниченные транспортные очереди и серверные полномочия world-life.
- Миграция main 003 остаётся без изменений; world-life становится 004. Проверены обновления старых main v2/v3, сохранение пароля/позиции/NPC-истории, а также обновление исходной world-life v3 с сохранением рук, receipts и времён миграций. Обновление выполняется одной startup-транзакцией.
- Задачи ветки перенумерованы в TASK-055/056/057: номера main 040/041/042 сохранены. Восстановлена документация отдельного PROTO-010.
- Браузерные fixtures ждут `app.ready` в обоих потоках процесса. Подготовка 25 чанков в quality-профиле имеет отдельное ожидание до 30 с; сам замер остаётся 60 с, FPS/P95/draw/memory/retained-resource assertions сохранены.
- HTTP flood-тест отправляет 400 запросов одновременно: последовательная отправка на загруженной машине была медленнее refill rate и не проверяла flood. Производственные лимиты main не менялись.

## Среда и команды

[Среда](environment.json): Apple M4, 10 CPU, 16 GiB, macOS arm64; Node 24.15.0 (`/private/tmp/backend-node24/node_modules/node/bin` добавлен в PATH). Chrome 156, ANGLE Metal M4, viewport 1280×800, DPR 1. Зависимости установлены отдельно в каждом worktree из lockfile. Другие пользовательские процессы не останавливались.

- `make client-test`: **292/292**, 34 файла — [лог](client-test-final.log).
- `make server-test`: **225/225**, 24 файла — [лог](server-test-final.log).
- `npm --prefix client run check`: Svelte 0 errors / 0 warnings, strict TS и headless Core — [лог](client-check-final.log).
- `npm --prefix client run check:imports`: 128 модулей / 405 зависимостей, нарушений нет — [лог](client-imports.log).
- `npm --prefix server run check`: strict server/shared TS, 83 модуля / 277 зависимостей, нарушений нет — [лог](server-check.log).
- `npm --prefix client run build`: PASS; штатное предупреждение о JS chunk >500 kB — [лог](client-build-final.log).

## Первичные прогоны и исправления

Первый sandbox-прогон серверных сетевых тестов не мог открыть localhost (`listen EPERM`); он не считается проверкой реализации. Последующие прогоны выполнены с разрешённым localhost. Первый прогон миграций выявил устаревший fixture старой БД, исправленный прямым созданием данных по старой схеме. После добавления проверки legacy world-life проявился описанный выше недетерминированный flood-тест; исправленный отдельный тест и полный suite проходят.

Первый browser run: 34 passed, 3 failed, 1 interrupted, 7 did not run — [лог](browser.log). Причины: ожидание старого текста запуска (BABEL/auth), 5-секундное ожидание готовности market до начала замера. Прогон остановлен перед world-next, чтобы перезагрузить изменённые fixtures. Повторно запускаются все затронутые и непройденные сценарии, а не только отдельные assertions.

Первый demo-профиль: min 59,9 FPS, max P95 18,1 мс, max 259 draw calls; после 5 рестартов 15 геометрий / 13 текстур, retained JS +1 967 448 байт. Внешних запросов и page errors нет — [JSON](client-demo-profile.json).

Первые серверные профили выполнялись одновременно с другими проверками. Merge: P95 4,2 мс, max 34,613 мс, 2443 delta, 240 scene packets, без ошибок — [JSON](server-four-player-profile.json). Main: P95 3,796 мс, max 73,629 мс; 3 предупреждения slow tick — [JSON](server-main-profile.json). Эти прогоны под конкурирующей нагрузкой не являются изолированным сравнением производительности.

## Повторные функциональные проверки

- [Сетевая интеграция](browser-integration.log): 9 passed — BABEL, авторизация, shared scene четырёх клиентов, F pickup/carry/place, restart с тем же held ID, маршрут через пастбище и двор. Один audio-тест выявил неверные условия собственного fixture.
- Audio fixture теперь соблюдает интервал чата 1 с; подходит к NPC внутри радиуса, включая допуск маршрута; использует второе окно для удалённого игрока, чтобы слушатель не уходил в background; после graceful shutdown следует политике main и явно входит снова. Проверки звуков и lifecycle не ослаблены.
- [Финальный native audio](browser-audio-final.log): **PASS**; громкость 0/45%, тишина истории, одна реплика на событие, NPC question/answer, remote jump, пять перезапусков и освобождение AudioContext/buffers/sources — [JSON](audio-browser-probe.json).
- Все 45 исходных browser-сценариев получили PASS в указанных полных/целевых прогонах. Это совокупное покрытие, не утверждение об одном полном зелёном прогоне. После изменения renderer дополнительно проверяются quality и WebGL.

## Устранение превышения draw-call бюджета

Первый завершённый market-профиль: **603 draw calls**, нарушен бюджет 500 — [JSON](client-market-before-instancing.json), [лог](browser-final.log). После instancing повторяющихся непрозрачных wind-поверхностей: **468 draw calls**, min FPS 58, P95 17,5 мс — [JSON](client-market-profile.json), [лог](browser-optimized.log). Геометрия/материалы/тени и матрицы анимации сохранены; camera raycast проверяет исходные поверхности. Матричные буферы ограничены 64 KiB на модель внутри прежнего консервативного резерва, cap 64 MiB не менялся.

После пяти рестартов: 140 геометрий / 6 текстур, retained JS +1 634 672 байт (бюджет 8 MiB). Внешних запросов и page errors нет. Максимум draw calls относится к 12 выборкам измеряемого маршрута; неподвижный стартовый кадр в отчёте — 537. FPS и P95 берутся из всех указанных выборок, а не из одного удачного кадра.

## Последовательное сравнение с main и WebGL

Браузерные main/merge прогоны выполнены последовательно с одинаковым quality-harness и одинаковыми браузером, viewport и DPR. Main: [demo](client-main-demo-profile.json), [market](client-main-market-profile.json), [лог](browser-main-quality.log).

| Market, 12 выборок | main 09fd771 | merge до instancing | итоговый merge |
|---|---:|---:|---:|
| Средний FPS | 60,000 | 59,942 | 59,833 |
| Минимум FPS | 60,0 | 59,3 | 58,0 |
| Максимум P95 кадра, мс | 17,6 | 17,5 | 17,5 |
| Средний CPU render, мс | 1,308 | 1,717 | 1,750 |
| Максимум sampled draw calls | 418 | 603 (FAIL) | 468 (PASS) |
| Максимум полезных данных, байт | 59 598 624 | 60 375 904 | 60 375 904 |

Бюджеты итогового маршрута соблюдены. Абсолютная нагрузка не тождественна main: ветка добавляет ветер/сцену/аудио, средний CPU render выше на ~0,44 мс. До оптимизации клиентский runtime совпадал с исходной целевой веткой; instancing устраняет превышение draw-call бюджета без снижения геометрической детализации. Эти замеры не доказывают равенства всех метрик или производительности другого оборудования.

WebGL: **14/14 PASS** — [лог](render.log), [8 профилей анимации](render-cadence.json). Реальные cadences около 29,9 и 59,5–59,8 FPS, все циклы закончены. Проверены reference counting GPU, выгрузка/отмена, независимый каталог, кошки/птицы, четыре персонажа и pickup/carry/place. Дополнительные screenshots/traces/videos сохранены в `/private/tmp/competition-next-browser-artifacts/`, краткие доказательства включены в этот каталог.

Последовательные серверные профили: **оба PASS**, по 4 реальных Socket.IO игрока и 61 с, временная SQLite, браузерные тесты уже завершены — [exit codes](server-comparison-exit.json). Main: P50 0.412 мс, P95 1.935 мс, max 2.807 мс; merge: P50 0.405 мс, P95 1.236 мс, max 4.443 мс. Ошибок нет; merge передал 2439 delta и 244 scene-state, все 4 клиента видят одинаковые sceneId и 3 кошки / 4 горшка / 5 яблок. [main JSON](server-main-isolated.json), [merge JSON](server-merged-isolated.json).

Команды: `PROFILE_OUTPUT=<absolute-json-path> node server/test/world-next-profile.ts`; для main использован [тот же harness без world-life](server-main-profile-harness.ts), скопированный в `server/test/merge-baseline-profile.ts`. WebGL: `PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_RENDER_PORT=4383 npx playwright test --config playwright.render.config.ts`. Quality: `PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_PORT=4381 npx playwright test e2e/quality.spec.ts` (для main порт 4382). Имена отдельных test-output каталогов и точные выборки видны в логах/описании прогонов.

Итог ограниченной задачи слияния: **PASS** по перечисленным тестам, типизации, сборке и заданным бюджетам. Это не утверждение о нулевом изменении каждой метрики: абсолютные draw calls, геометрии и CPU нового живого мира выше main, но обнаруженное превышение принятого draw-call бюджета устранено. Готовность всей функциональности NEXT не объявляется.

Общая аппаратная/слуховая приёмка NEXT и реальный LAN на двух устройствах не подменяются этими проверками. Ранее открытые критерии TASK-055/056/057 остаются открытыми, если для них нет отдельного доказательства. Квалификация LLM не выполнялась.
