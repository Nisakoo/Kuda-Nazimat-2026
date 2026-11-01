---
id: TASK-080
type: implementation-task
status: in-progress
spec: ../specs/server-observability.md
requirements: [OBS-004, OBS-007, OBS-008, OBS-009, OBS-010, OBS-011, OBS-012, OBS-013–017]
related:
  - spec: ../specs/admin-panel-ui.md
    requirements: [ADMIN-008–016]
  - spec: ../specs/offline-multiplayer.md
    requirements: [OFFLINE-010, OFFLINE-017, OFFLINE-019]
  - spec: ../specs/server-foundation.md
    requirements: [SERVER-004]
depends_on: [TASK-043]
scheduling_note: серверная часть реализована 2026-11-01; остаются ручная проверка графиков в браузере (делает задача страницы ADMIN) и прогон на Node 24; клиентская часть FPS — TASK-081
---

# Сервер: история метрик, графики в админке и отчёт приёмки

## Цель и изменения требований
Вместо внешнего Prometheus/Grafana сервер сам хранит историю метрик, рисует графики на `/operator`, пишет метрики в журнал раз в минуту и выдаёт отчёт приёмки. Изменения требований (2026-11-01):
- сняты: OBS-009 (стек Prometheus/Grafana), OBS-016 (отдельный итог при остановке — поглощён OBS-017);
- добавлены: OBS-013 (история), OBS-014 (данные для разделов админки «Обзор», «Сервер», «Клиенты»), OBS-015 (минутная запись), OBS-017 (отчёт);
- изменены: OBS-004 (история в дампе), OBS-007 (гистограммы RTT, FPS и интервала кадра, `npc_first_partial_ms`, `log_records_total{level}`), OBS-008 (`/metrics` и `monitoring.token` сняты, добавлен `/api/operator/history`), OBS-010 (окна по истории, FPS, кадр, draw calls и давность отчёта у игрока, пороги RTT/FPS, ключевые info-события), OBS-011 (`perf` с полем `visible`, желательными `frameMs`/`drawCalls` и отдельным лимитом), OBS-012 (бюджет включает историю).

## Реализация
- [x] Пороги — один модуль `src/obs/thresholds.ts` (состояние, ряды, отчёт, профиль).
- [x] Метрики OBS-007: `game_rtt_ms` (heartbeat, `realtime/gateway.ts`), `client_fps` и `client_frame_ms` (`http/telemetry.ts`), `log_records_total{level}` (`obs/index.ts`), `disk_free_bytes`, `game_npcs`; `npc_first_partial_ms` уже был. Границы корзин с порогами: шаг 5/20 мс (`FAST_MS_BUCKETS`), рассылка 120 мс (`BROADCAST_MS_BUCKETS`), RTT 150 мс, FPS 30.
- [x] `src/obs/history.ts`: кадр раз в 10 с, буфер 1440 кадров в колоночном хранении (Float32Array + времена), окна по приращениям корзин, `summarize()`; `CounterWindow` удалён, `evaluateHealth` получает окна из истории, добавлены причины RTT > 150 и FPS < 30 (медиана FPS за минуту).
- [x] `metrics.minute` раз в минуту (`src/obs/overview.ts`); дамп OBS-004 содержит последние 10 минут истории (`state.history`).
- [x] OBS-011: `visible` обязателен для `perf`, диапазоны полей, лимиты 10/мин (ошибки) и 12/мин (`perf`) раздельно, `client.perf` на debug, последний видимый отчёт и время приёма — в показателях игрока (`src/obs/clientPerf.ts`); `playerId` добавлен в `PlayerPresence`.
- [x] OBS-010: у игрока `fps`, `frameMs`, `drawCalls`, `visible`, `reportAgeSeconds`; последние 20 событий включают ключевые info (`obs/recorder.ts`).
- [x] OBS-014: группы `server`, `overview`, `tick`, `memory`, `npcStats`, `errors`, `thresholds` в `/api/operator/status`; `GET /api/operator/history` (`src/http/operatorMetricsRoutes.ts`) с рядами по игрокам. Вёрстка — не здесь.
- [x] `src/cli/report.ts`, скрипт `report`: последний запуск, `--file`, `--since`/`--last`, markdown-таблица; та же таблица при штатной остановке (`app/main.ts`).
- [x] `test/load-profile.ts` печатает таблицу через `app.report()` (та же `summarize` и пороги).
- [x] Сняты OBS-009 и `/metrics`: удалены `ops/monitoring/`, маршрут `/metrics`, `MetricsRegistry.prometheus()`, `monitoring.token`; тесты обновлены.
- [x] Документация: `server/README.md` (история, `metrics.minute` и CSV через `jq`, `npm run report`), корневой README.

## Приёмка
- [x] OBS S6: `test/observability.test.ts` — `/api/operator/status`, `/metrics`, `/history` с loopback 200, `/metrics` 404; с LAN-адреса все четыре — 404 даже с `Authorization`; `test/config.test.ts` — `monitoring.token` отклоняется.
- [x] OBS S8, S10: раздельные лимиты 10/12, обязательные `fps`+`visible`; у игроков FPS, «нет данных» без отчёта, `visible: false` снимает FPS и причину «тормозит картинка».
- [x] OBS S11: `test/metrics-history.test.ts` — окно 5 мин после часа медленных шагов показывает быстрые (1 мс против 50 мс накопленного p95), 1440 кадров с 4 игроками, оценка памяти ≤ 1 МБ (633 600 байт; замер `node --expose-gc` с 4 игроками — тот же порядок), `null` без данных.
- [ ] OBS S13: группы и ряды в API проверены тестами (ответ полного буфера с 4 игроками ≤ 256 КиБ, 480 точек по 30 с); ручная проверка графиков в браузере — не выполнена, её делает задача страницы ADMIN.
- [x] OBS S14, S16: `metrics.minute` раз в 6 кадров, ≤ 2 КиБ, без имён; отчёт по запуску, по периоду и через CLI (`--file`, ошибка аргумента → код 1), «нет данных» вместо «в норме»; профиль печатает ту же таблицу.
- [x] OBS S2, S5: история в дампе (`state.history`); секреты и тексты не найдены в журнале, дампе, статусе, истории и снимке метрик.
- [x] OBS S9: профиль 60 с с 4 игроками на одной машине — p95 шага 1,28 мс против 1,25 мс базы (6938f9d) в тех же условиях (+0,03 мс, бюджет 0,5), `log.dropped` нет; [новая версия](evidence/metrics-history/load-profile-new.txt), [база](evidence/metrics-history/load-profile-base.txt). Node 22.22.2, а не 24 — на машине нет Node 24.
- [ ] `make server-test` и `npm --prefix server run check`: check проходит; в тестах 681 пройдено, 3 падения — те же на исходном коде и не связаны с задачей (см. «Результат»).

## Результат
- Файлы: `server/src/obs/{history,overview,thresholds,clientPerf,health,recorder,index}.ts`, `server/src/http/{telemetry,operatorRoutes,operatorMetricsRoutes,server}.ts`, `server/src/cli/report.ts`, `server/src/common/metrics.ts`, `server/src/app/{application,main,config}.ts`, `server/src/realtime/gateway.ts`, `server/src/game/{index,GameService}.ts`, `server/src/contracts.ts`; тесты `server/test/{metrics-history,observability,config,platform}.test.ts`, `server/test/load-profile.ts`; удалён `ops/monitoring/`.
- Проверки (2026-11-01, macOS, Node 22.22.2): `npm --prefix server run check` — без ошибок; `npm --prefix server test` — 46 файлов, 681 пройдено, 4 пропущено, 3 упало: `building-height.test.ts` (в worktree нет сгенерированного мира `client/public/maps/market`) и два теста `llm-diagnostic.test.ts` про занятый порт (на исходном `config.ts` падают так же). Профиль `node server/test/load-profile.ts` завершается «Profile incomplete» из-за проверки `timeouts < 1`: при текущем таймауте NPC вопрос с задержкой 5 с не истекает — проверка профиля устарела до этой задачи; таблица печатается до неё.
- Не проверено: графики в браузере (страница ADMIN); прогон на Node 24.15; замеры на целевых ноутбуках (OFFLINE-017).
- Отклонения: перцентили окна — верхние границы корзин (как в OBS-007), поэтому p95 рассылки в таблице 110 мс при точных 101 мс; «последнее значение» шага в статусе — точный p95 последней минуты `game.tick.stats`; бесконечный максимум (только корзина переполнения) отдаётся в JSON строкой `"inf"`. Ряды истории длиннее 480 точек объединяются (шаг 30 с для 4 часов), чтобы ответ уложился в 256 КиБ. Подпись «внимание/ошибка» у info-событий на текущей странице `/operator` неточна — страницу переделывает задача ADMIN.

