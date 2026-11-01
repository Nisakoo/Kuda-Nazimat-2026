---
id: TASK-043
type: implementation-task
status: done
spec: ../specs/server-observability.md
requirements: [OBS-001–012]
related:
  - spec: ../specs/offline-multiplayer.md
    requirements: [OFFLINE-010, OFFLINE-016]
depends_on: [TASK-016]
scheduling_note: OBS-009 снято 2026-11-01; удаление ops/monitoring и monitoring.token, история и графики — TASK-080
---

# Сервер: логи, самописец, метрики и экран ведущего

## Цель и изменения требований
Ловить в том числе скрытые и плавающие ошибки по журналу и метрикам, дать ведущему понятное состояние сервера. Реализуются OBS-001–012; OFFLINE-010 расширен OBS-010.

## Реализация
- [x] Порт логгера с `event`/`msg`, уровнями, контекстом и сериализацией ошибок; консоль и JSONL-файл с ротацией, лимитом объёма и сроком хранения (`src/common/logger.ts`, `src/obs/sinks.ts`).
- [x] Бортовой самописец и дампы `incident-*.jsonl` (`src/obs/recorder.ts`); перехват необработанных ошибок, предупреждений Node, задержек event loop, памяти (`src/obs/index.ts`).
- [x] События каталога OBS-003 во всех модулях; проверки инвариантов в мире, очереди NPC, AOI и исходящих пакетах.
- [x] Реестр метрик без зависимостей, `/metrics` (Prometheus, loopback или `monitoring.token`), `/api/operator/metrics` (`src/common/metrics.ts`, `src/http/operatorRoutes.ts`).
- [x] Экран ведущего: состояние с причинами, RTT по heartbeat Engine.IO, переподключения, предупреждения, действия (`src/obs/health.ts`, `src/http/operatorPage.ts`).
- [x] Телеметрия клиента `POST /api/telemetry/client` (`src/http/telemetry.ts`).
- [x] `ops/monitoring/`: Prometheus, Grafana provisioning и дашборд, инструкция.
- [x] ~~Живой запуск Prometheus и Grafana с этим дашбордом.~~ Снято вместе с OBS-009 (2026-11-01).

## Приёмка
- [x] S1: события каталога в сквозном сценарии; S2–S3: самописец и файлы; S4: `test/invariants.test.ts`; S5–S8: `test/observability.test.ts` (настоящий сервер: нет пароля, токена, хешей и текстов ни в журнале, ни в дампе, ни в метриках, ни на экране; `/metrics` из сети — 404 без токена и 200 с токеном; состояние «жёлтое» с причинами; RTT появляется; отчёты клиента ограничены 10 в минуту). Падение процесса — дочерний процесс с неперехваченной ошибкой: fatal со стеком, дамп, код 1.
- [x] S9: [профиль 60 с](evidence/server-load-obs-2026-11-01.json) — p95 шага 1,97 мс против 1,64 мс у базовой версии в тех же условиях (+0,33 мс, бюджет 0,5 мс), p95 рассылки 113 мс, ошибок сервера нет. Единичные шаги 25–100 мс выглядят как шум машины: изолированный `World.step` базовой и новой версии даёт одинаковые p50/p99/p99.9 и пики того же размера в обеих.
- [x] `npm --prefix server test` — 22 файла, 195 тестов; `npm --prefix server run check` без ошибок. Windows 11, Node 24.15.0, 2026-11-01.
- [x] ~~OBS-009 с настоящими Prometheus и Grafana.~~ Снято 2026-11-01: требование OBS-009 снято, замена — OBS-013–017 ([TASK-080](080-server-metrics-history.md)).

## Результат
- Плавающее падение тестов «Worker exited unexpectedly»: Vitest-процесс в режиме `forks` на Windows иногда исчезал без события exit, без отчёта Node и без записи в журнале Windows; воспроизводилось в 3 из 4 запусков на тесте с 400 HTTP-запросами. Тот же сценарий под обычным `node` проходит стабильно, в режиме `threads` — 0 из 6, весь набор — стабильно. Пул переключён на `threads` (`server/vitest.config.ts`); первопричина в Vitest/Windows не доказана.
- Не проверено: пороги OBS-010 на целевых ноутбуках — это замеры OFFLINE-017 в TASK-016.
- OBS-009 снято; `/metrics` в формате Prometheus также снят (OBS-008 изменён). `ops/monitoring/`, `/metrics`, `prometheus()` и `monitoring.token` ещё в коде, удаляются в TASK-080.
