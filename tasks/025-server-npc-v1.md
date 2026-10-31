---
id: TASK-025
type: implementation-task
status: done
spec: ../specs/server-npc-dialogue.md
requirements: [NPC-002–007]
related:
  - spec: ../specs/server-persistence.md
    requirements: [STORE-011]
  - spec: ../specs/server-realtime.md
    requirements: [REALTIME-009]
depends_on: [TASK-011]
scheduling_note: часть B (платформа и данные); реализует NpcQuestions из contracts.ts, доставку делает часть A
---

# Сервер: NPC v1 через порт NpcResponder

## Цель и изменения требований
Реализовать ответы NPC для PROTO v1 через порт с заглушкой `scripted`. Добавлены NPC-001–007. Адаптер модели не входит в задачу: его реализует разработчик LLM-части по NPC-005 и контрактному тесту NPC-007.

## Реализация
- [x] NpcQuestions: квоты, FIFO, общий deadline, AbortSignal, удержание зависшего слота, нормализация, запись до ответа.
- [x] NpcResponder, реестр, scripted с темами/памятью, общий контрактный набор тестов.
- [x] Отмена через cancelConnection/stop и статус health; граница frozen contracts.ts.
- [x] Подключены реальный realtime A и проверка управляющего соединения; takeover отменяет ответ до записи.

## Приёмка
- [x] NPC-002–007: FIFO/квоты/deadline, queued/running abort, задержанное освобождение, unavailable, нормализация, private history; scripted проходит контрактный набор.
- [x] STORE-011: реальный SQLite + сервис сохраняют ответ до результата, restart сохраняет память; ошибка store не выдаёт npc-answer.
- [x] NPC S1–S4 через настоящий Socket.IO: a-realtime/integration и браузерный NPC-сценарий; карта/расстояние, доставка и отмена проверены.
- [x] REALTIME S7: 61 с, 4 игрока, NPC delay 5 с; p95 шага 0,977 мс, p95 рассылки 101,2 мс. SQLite и очередь не останавливают мир.
- [x] make server-test, check:platform проходят.
- [x] Полный npm run check проходит после объединения A.

## Результат
Реализованы npc, scripted и контрактные тесты. Тексты строятся из профиля и истории; реальная LLM, PROTO v2 и AI не реализованы и не засчитаны. [Evidence](evidence/backend-platform-data-2026-10-31.md).

Дополнительная проверка после merge A: [evidence интеграции](evidence/backend-integration-2026-10-31.md).
