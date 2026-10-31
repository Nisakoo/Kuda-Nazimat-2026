---
id: TASK-014
type: implementation-task
status: in-progress
spec: ../specs/server-realtime.md
requirements: [REALTIME-001–009]
related:
  - spec: ../specs/server-auth.md
    requirements: [AUTH-005]
  - spec: ../specs/server-foundation.md
    requirements: [SERVER-006]
  - spec: ../specs/protocol.md
    requirements: [PROTO-008]
depends_on: [TASK-013, TASK-024]
scheduling_note: часть A (мир и сеть); SessionVerifier/PlayerStore/NpcQuestions из contracts.ts заменяются тестовыми реализациями
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
- Файлы: server/src/game/{World,AoiStream,GameService,index,ports}.ts, server/src/realtime/{gateway,TokenBucket}.ts; тесты server/test/a-realtime.test.ts (реальный socket.io-client), a-world.test.ts.
- Проверки: `npm --prefix server test` — 4 файла, 26 тестов, все прошли; `npm --prefix server run check` — tsc server + shared без ошибок, dependency-cruiser без нарушений; `node -e "import('./src/game/index.ts')"` в Node 24.15.0 — модуль грузится без сборки. Среда: Windows 11, Node 24.15.0, npm 11.12.1. Проверено: handshake UNAUTHORIZED/VERSION/UNAVAILABLE; join с валидным snapshot и bootstrap; delta второму игроку с revision+1 и без пустых пакетов; стена, скольжение, preparedChunks, сброс намерения через 250 ms, старый sequence; interact/npc-question (FORBIDDEN вдали, ответ через NpcQuestions с персоной и trim); чат обоим с requestId отправителя, HTML как текст, управляющие символы → INVALID; NOT_READY до join, повтор requestId и лишнее поле → INVALID, resync → snapshot; перехват второй вкладкой (error server UNAUTHORIZED, тот же playerId, отмена NPC первой вкладки); освобождение слота и сохранение позиции после grace. Все входящие пакеты тестов проходят parseServerMessage.
- Отклонения и остаток: Не проверены: истечение сессии по таймеру (AUTH S3), переподключение внутри grace без remove у наблюдателя (S5, первая часть), remove при выходе из aoiRadius (S4, вторая часть), лимиты input 30/с и чата 1/с, отключение после 10 неверных пакетов, нагрузка 4 игроков с замером шага (S7). Ручная проверка с браузерным клиентом не выполнялась — нужен вызов mock-входа в клиенте и сборка части B. Статус in-progress, пока непроверенные пункты приёмки не закрыты.
