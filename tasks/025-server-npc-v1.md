---
id: TASK-025
type: implementation-task
status: in-progress
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
- [ ] Подключение к реальному realtime и проверка управляющего соединения при доставке — A.

## Приёмка
- [x] NPC-002–007: FIFO/квоты/deadline, queued/running abort, задержанное освобождение, unavailable, нормализация, private history; scripted проходит контрактный набор.
- [x] STORE-011: реальный SQLite + сервис сохраняют ответ до результата, restart сохраняет память; ошибка store не выдаёт npc-answer.
- [ ] NPC S1–S4 через Socket.IO: NPC-001 (карта/расстояние/управление) и доставка/отмена A после merge.
- [ ] Сравнение tick под очередью с REALTIME S7 — после A.
- [x] make server-test, check:platform проходят.
- [ ] Полный npm run check: ошибки A из main.

## Результат
Реализованы npc, scripted и контрактные тесты. Тексты строятся из профиля и истории; реальная LLM, PROTO v2 и AI не реализованы и не засчитаны. [Evidence](evidence/backend-platform-data-2026-10-31.md).
