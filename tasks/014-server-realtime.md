---
id: TASK-014
type: implementation-task
status: todo
spec: ../specs/server-realtime.md
requirements: [REALTIME-001–009]
related:
  - spec: ../specs/server-auth.md
    requirements: [AUTH-005]
  - spec: ../specs/server-foundation.md
    requirements: [SERVER-006]
  - spec: ../specs/protocol.md
    requirements: [PROTO-008]
depends_on: [TASK-012, TASK-013]
---

# Сервер: мультиплеер PROTO v1

## Цель и изменения требований
Реализовать серверную сторону PROTO v1 для готового клиента: join, движение, AOI/delta, resync, взаимодействие, чат, присутствие, слоты и перехват. Изменены REALTIME-001–006, добавлены REALTIME-007–009. NPC-вопросы до TASK-025 получают `error UNAVAILABLE`.

## Реализация
- [ ] Домен `game`: мир, шаг, движение со скольжением и preparedChunks, AOI, расчёт delta по соединению, слоты и управляющее соединение, grace.
- [ ] GameService: join/input/interact/chat/resync/присутствие; периодическое сохранение через `PlayerStore`; `PlayerLocator` для world.
- [ ] Адаптер `realtime`: handshake (из TASK-012), разбор shared-парсером, лимиты input/chat, отклонение повторного requestId, отправка с проверкой размера, перехват по AUTH-005.
- [ ] Интеграционные тесты с несколькими `socket.io-client` и shared/protocol; нагрузочный сценарий S7.

## Приёмка
- [ ] REALTIME-001–009 / S1–S7 проверены интеграционными тестами; все исходящие пакеты проходят `parseServerMessage`.
- [ ] AUTH-005 / AUTH S4 и SERVER-006 / SERVER S4: перехват и пятый игрок.
- [ ] PROTO-008 / PROTO S4: все уточнения v1.
- [ ] Ручная проверка с клиентом `feat-base-client` (online, сессия передана вручную) — выполнить, если клиентская сборка доступна, иначе отметить непроверенной.
- [ ] `make server-test` и `npm run check` проходят.

## Результат
- Файлы: —
- Проверки: не выполнялись; реализация не начата.
- Отклонения: —
