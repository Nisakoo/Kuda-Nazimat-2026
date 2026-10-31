---
id: TASK-001
type: implementation-task
status: done
spec: ../specs/client-foundation.md
requirements: [CLIENT-010]
depends_on: []
---

# Команды клиента в Makefile

## Цель и изменения требований
Добавить CLIENT-010: единые команды запуска и тестов без преждевременного выбора стека. Реализация самого клиента вне задачи.

## Реализация
- [x] Добавить Makefile с целями help, client, client-test.
- [x] Синхронизировать AGENTS.md и README.md.

## Приёмка
- [x] CLIENT-010 / S8: ненастроенные команды объясняют причину ошибки; настроенные выполняются и не скрывают сбои.
- [x] AGENTS.md требует `make client-test` для изменений клиентского кода; README описывает текущие ограничения.

## Результат
- Файлы: Makefile, AGENTS.md, README.md, specs/client-foundation.md, эта задача.
- Проверки: `make` — справка, код 0; `make client` и `make client-test` — объяснение отсутствующей конфигурации, код 2. Переопределения `CLIENT_RUN_CMD='printf run-ok'` и `CLIENT_TEST_CMD='printf test-ok'` выполнились с кодом 0; подстановка `false` в обе команды дала код 2. `git diff --check` прошёл.
- Ограничение: проверена обвязка Makefile. Настоящие клиентские тесты не запускались, поскольку клиент и его стек ещё отсутствуют.
