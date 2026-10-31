---
id: TASK-011
type: implementation-task
status: in-progress
spec: ../specs/server-persistence.md
requirements: [STORE-001–005, STORE-011]
depends_on: [TASK-010]
scheduling_note: часть B (платформа и данные)
---

# Сервер: SQLite

## Цель и изменения требований
Реализовать хранилище v1. Изменены STORE-001–005 (схема, миграции, интервал сохранения, DatabaseSync без worker, backup); добавлен STORE-011 (история NPC v1). STORE-006–010 перенесены на этап v2.

## Реализация
- [x] node:sqlite на Node 24.15.0: WAL, foreign_keys и FTS5 проверены.
- [x] Нумерованная SQL-миграция v1; AccountStore/SessionStore/PlayerStore/DialogueStore поверх одного соединения, in-memory порты тестов.
- [x] Очистка сессий при старте/раз в час, история 50/6, backup/restore и CLI в README.

## Приёмка
- [x] STORE-001–003, 011 / S1: восстановление идентичности, позиции и истории через порты после restart.
- [x] STORE-002, 004 / S2: rollback первого account+player, пакетной позиции и отказ dialogue, ошибка возвращается вызывающему.
- [x] STORE-003, 005: SIGKILL после commit и отдельный VACUUM INTO, integrity_check=ok, копия читается.
- [ ] STORE-003 / S3: окно потери при игровом saveInterval и отсутствие IO внутри tick проверяются с A; тест writer не заменяет этот сценарий.
- [x] STORE-011 / S7: лимит 50 и ошибка записи → unavailable без ответа.
- [x] make server-test, check:platform проходят.
- [ ] Полный npm run check: ошибки A из main.

## Результат
Реализованы persistence, миграция, CLI backup и документация восстановления. STORE-006–010 не реализованы. Периодический save/grace реализует A через PlayerStore; B не вводит второй таймер игрового сохранения. [Evidence](evidence/backend-platform-data-2026-10-31.md).
