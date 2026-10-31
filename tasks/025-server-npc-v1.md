---
id: TASK-025
type: implementation-task
status: todo
spec: ../specs/server-npc-dialogue.md
requirements: [NPC-001–007]
related:
  - spec: ../specs/server-persistence.md
    requirements: [STORE-011]
  - spec: ../specs/server-realtime.md
    requirements: [REALTIME-009]
depends_on: [TASK-011, TASK-014]
---

# Сервер: NPC v1 через порт NpcResponder

## Цель и изменения требований
Реализовать ответы NPC для PROTO v1 через порт с заглушкой `scripted`. Добавлены NPC-001–007. Адаптер модели не входит в задачу: его реализует разработчик LLM-части по NPC-005 и контрактному тесту NPC-007.

## Реализация
- [ ] NpcDialogueService: допуск, атомарная квота, FIFO-планировщик с `maxConcurrent`, дедлайн, отмена, нормализация, запись истории до ответа.
- [ ] Порт `NpcResponder`, реестр адаптеров, адаптер `scripted`, контрактный набор тестов.
- [ ] Подключение к realtime (REALTIME-009), отмена при разрыве/перехвате/истечении сессии/остановке, статус NPC в `/api/health`.

## Приёмка
- [ ] NPC-001, 003, 006 / S1; NPC-001–002 / S2; NPC-004 / S3; NPC-003, 005 / S4; NPC-007 / S5 — интеграционные и unit-тесты.
- [ ] STORE-011 через полный путь вопроса.
- [ ] Шаг мира под нагрузкой S2 не задерживается (сравнение с REALTIME S7).
- [ ] `make server-test` и `npm run check` проходят. Заглушка не засчитывается как приёмка AI/LLM.

## Результат
- Файлы: —
- Проверки: не выполнялись; реализация не начата.
- Отклонения: —
