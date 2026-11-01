---
id: TASK-068
type: implementation-task
status: done
spec: ../specs/server-observability.md
requirements: [OBS-013, OBS-014]
related:
  - spec: ../specs/server-admin.md
    requirements: [ADMIN-005, ADMIN-006]
depends_on: [TASK-043]
scheduling_note: третья из четырёх частей админки (CONTENT → AUTH-017–020 → OBS-013/014 → ADMIN)
---

# Сервер: каталог метрик и FPS клиентов

## Цель и изменения требований
Добавить «новые» метрики каталога OBS-013 и хранить последний отчёт производительности каждого игрока (OBS-014) для панелей.

## Реализация
- [x] `log_events_total`, `invariant_violations_total`, `obs_incident_dumps_total`.
- [x] `game_aoi_entities`, `realtime_rtt_ms`, `client_fps`, `client_frame_ms`, `client_draw_calls`, `client_reports_total`.
- [x] `npc_responder_ready`, `language_ready`, `auth_sessions_active`, `disk_free_bytes`.
- [x] Последний `perf` по игроку (старше 30 с — нет данных) в данных присутствия и на экране ведущего.

## Приёмка
- [x] OBS S10 покрыт тестами (~60%).
- [x] `npm --prefix server test` и `npm --prefix server run check` проходят.

## Результат
- Файлы: `server/src/obs/clientPerf.ts` (последний `perf` по игроку, 30 с); метрики в `obs/index.ts` (события warn/error/fatal и инварианты считаются по самим записям журнала, без вызовов в модулях), `obs/recorder.ts`, `game/GameService.ts`, `realtime/gateway.ts`, `http/telemetry.ts`, `app/application.ts`; `PlayerPresence.perf`; колонка FPS на `/operator`.
- Метки метрик не содержат идентификаторов игроков: значения по игрокам — только в JSON экрана (проверено тестом).
- Проверки (Windows 11, Node 24.15.0, 2026-11-01): `test/observability.test.ts` — OBS S10 и счётчики событий, инвариантов, дампов; весь `npm --prefix server test` — 27 файлов, 263 теста; `npm --prefix server run check` без ошибок.
- Осталось в ADMIN: `admin_actions_total`.
