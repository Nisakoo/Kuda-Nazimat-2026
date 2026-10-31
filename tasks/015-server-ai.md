---
id: TASK-015
type: implementation-task
status: todo
spec: ../specs/server-ai.md
requirements: [AI-001–011]
related:
  - spec: ../specs/server-llm-runtime.md
    requirements: [LLM-001–014]
  - spec: ../specs/server-persistence.md
    requirements: [STORE-006–010]
  - spec: ../specs/protocol.md
    requirements: [PROTO-007]
depends_on: [TASK-011, TASK-014, TASK-017, TASK-022]
scheduling_note: требует утверждённого PROTO v2 и изменения клиента; до этого модель подключается адаптером NpcResponder v1
---

# Сервер: локальные NPC

## Цель и изменения требований
Реализовать AI-001–011 в `server/` поверх NPC v1 (TASK-022): адаптер модели реализует `NpcResponder`, а потоковый контракт, preferences, ledger и память добавляются с PROTO v2. Уточнены AI-001–006: выбран LLM-подход и границы двух backend; добавлены AI-007–011: языки, grounding, prompt, детерминированная память и durable lifecycle. Уточнены AI-007–011 и связанные PROTO-007, STORE-006–010, LLM-008–011: настройки авторитетны и фиксируются при admission, `partial` накопительны, отмена не нарушает атомарность. Модель не выводит произвольные сохраняемые preferences. Не заменять квалификацию модели mock-ответами.

## Реализация
- [ ] До функциональной приёмки подготовить утверждённые минимальные источники/aliases и fixtures для обоих NPC и ru/en/es, включая D01–D24 в функциональном объёме. Реализовать KnowledgeSource на SQLite FTS5 без embedding-модели. В TASK-018 корпус версионируется и применяется в полном повторяемом сравнительном/нагрузочном прогоне; базовые материалы не откладываются до квалификации.
- [ ] Реализовать NpcDialogueService, PromptBuilder, MemoryService и интеграцию с LlmPort из TASK-017; связать очередь, проверку доступа, streaming и отмену с PROTO-007.
- [ ] Реализовать транзакционный финал, восстановление по requestId, reset epoch и исключение старой истории/кешей. Проверить контрольные диалоги, авторитетные явные preferences и снимок при admission, ограниченный backpressure без ACK и replay фрагментов, ошибку БД и отмену вычислителя; для cancel/reset/access loss проверить оба порядка гонки с финальным commit. При disconnect отменять активную generation, после reconnect возвращать durable результат/статус; не освобождать квоту до физической остановки.
- [ ] Обновить документацию по фактическому результату.

## Приёмка
- [ ] Требования AI-001–011, сценарии S1–S5 проверены с реальным backend и SQLite; проверены снимки preferences, отсутствие вывода произвольных preferences моделью, cumulative partial, disconnect/reconnect и гонки commit/cancel/reset; функциональные доказательства записаны ниже. Полная языковая/скоростная/RAM-квалификация обоих backend выполняется в TASK-018; до неё AI не считается complete.
- [ ] Релевантные тесты, типизация и сборка проходят; для изменений клиента выполнен `make client-test`.
- [ ] Неисполненные проверки явно отмечены и не выданы за успешные.

## Результат
- Файлы: —
- Проверки: не выполнялись; реализация не начата.
- Отклонения: —
