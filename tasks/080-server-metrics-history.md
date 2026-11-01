---
id: TASK-080
type: implementation-task
status: todo
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
scheduling_note: замена стека Prometheus/Grafana; клиентская часть FPS — TASK-081, сервер не ждёт её и показывает «нет данных»
---

# Сервер: история метрик, графики в админке и отчёт приёмки

## Цель и изменения требований
Вместо внешнего Prometheus/Grafana сервер сам хранит историю метрик, рисует графики на `/operator`, пишет метрики в журнал раз в минуту и выдаёт отчёт приёмки. Изменения требований (2026-11-01):
- сняты: OBS-009 (стек Prometheus/Grafana), OBS-016 (отдельный итог при остановке — поглощён OBS-017);
- добавлены: OBS-013 (история), OBS-014 (данные для разделов админки «Обзор», «Сервер», «Клиенты»), OBS-015 (минутная запись), OBS-017 (отчёт);
- изменены: OBS-004 (история в дампе), OBS-007 (гистограммы RTT, FPS и интервала кадра, `npc_first_partial_ms`, `log_records_total{level}`), OBS-008 (`/metrics` и `monitoring.token` сняты, добавлен `/api/operator/history`), OBS-010 (окна по истории, FPS, кадр, draw calls и давность отчёта у игрока, пороги RTT/FPS, ключевые info-события), OBS-011 (`perf` с полем `visible`, желательными `frameMs`/`drawCalls` и отдельным лимитом), OBS-012 (бюджет включает историю).

## Реализация
- [ ] Пороги — один модуль в `src/obs/`, общий для состояния, графиков, отчёта и профиля.
- [ ] Метрики OBS-007: гистограммы RTT (сэмплы heartbeat), FPS и `frameMs` клиентов, `npc_first_partial_ms`, `log_records_total{level}`. Границы корзин содержат пороги: шаг 5/20 мс, рассылка 120 мс, RTT 150 мс, FPS 30.
- [ ] `src/obs/history.ts`: кадр раз в 10 с (gauge, приращения счётчиков и корзин, показатели игроков), буфер 1440 кадров, окна 5/60 мин и час, чистая функция сводки по кадрам; `CounterWindow` заменяется историей, `evaluateHealth` получает окна из неё.
- [ ] `metrics.minute` раз в минуту (OBS-015); дамп OBS-004 содержит последние 10 минут истории.
- [ ] OBS-011: поле `visible`, лимит `perf` 12/мин отдельно от ошибок, `client.perf` на уровне debug, последний отчёт — в показателях игрока до отключения.
- [ ] OBS-010: FPS, `frameMs`, `drawCalls` и давность отчёта у игрока, причины «медленная сеть у …» и «тормозит картинка», последние 20 событий с ключевыми info.
- [ ] OBS-014: группы значений в `/api/operator/status` и ряды `/api/operator/history` (включая ряды ping/FPS по игрокам). Вёрстка разделов — по задаче на ADMIN (admin-panel-ui.md), не здесь.
- [ ] `src/cli/report.ts` и скрипт `report` в `package.json`: последний запуск, `--file`, `--since`/`--last`, markdown-таблица; печать той же таблицы в консоль при штатной остановке.
- [ ] `test/load-profile.ts` считает итог той же функцией и печатает таблицу отчёта.
- [ ] Снять OBS-009 и `/metrics`: удалить `ops/monitoring/`, маршрут `/metrics`, `MetricsRegistry.prometheus()`, `monitoring.token` из конфигурации; поправить их тесты (`test/config.test.ts`, `test/observability.test.ts`).
- [ ] Документация: `server/README.md` (графики, `metrics.minute` и пример CSV через `jq`, `npm run report`), корневой README.

## Приёмка
- [ ] OBS S6: `/api/operator/metrics` и `/api/operator/history` — 200 с loopback, 404 из сети; `/metrics` — 404; конфигурация с `monitoring.token` отклоняется.
- [ ] OBS S8, S10: раздельные лимиты отчётов; FPS у игроков, «нет данных», `visible: false` не влияет на пороги.
- [ ] OBS S11: окна истории на искусственных часах (5/60 мин), буфер 4 часа с показателями игроков, память ≤ 1 МБ, `null` без данных.
- [ ] OBS S13: все группы и ряды OBS-014 в ответах API, ряды по игрокам, ответ истории ≤ 256 КиБ.
- [ ] OBS S14, S16: `metrics.minute`; отчёт по последнему запуску и по `--last`, «нет данных» вместо «в норме», та же таблица при остановке и в профиле.
- [ ] OBS S2, S5: история в дампе; приватность распространяется на историю, `metrics.minute` и отчёт.
- [ ] OBS S9: профиль 60 с — прирост p95 шага ≤ 0,5 мс к базе, `log.dropped` нет.
- [ ] `make server-test` и `npm --prefix server run check` проходят.

## Результат
- Не начато.
