---
id: TASK-011
type: implementation-task
status: todo
spec: ../specs/server-persistence.md
requirements: [STORE-001–005, STORE-011]
depends_on: [TASK-010]
scheduling_note: часть B (платформа и данные)
---

# Сервер: SQLite

## Цель и изменения требований
Реализовать хранилище v1. Изменены STORE-001–005 (схема, миграции, интервал сохранения, DatabaseSync без worker, backup); добавлен STORE-011 (история NPC v1). STORE-006–010 перенесены на этап v2.

## Реализация
- [ ] Проверить `node:sqlite` на закреплённой версии Node (WAL, foreign keys, наличие FTS5 — записать для AI-008).
- [ ] Соединение `DatabaseSync`, миграция v1; реализации `AccountStore`, `SessionStore`, `PlayerStore`, `DialogueStore` и их in-memory версии для тестов сервисов.
- [ ] Очистка старых сессий; описание backup/restore в README сервера.

## Приёмка
- [ ] STORE-001–003, 011 / S1: перезапуск восстанавливает игрока и историю без дубликатов (проверка через Store-порты; полный путь через join — в TASK-014).
- [ ] STORE-002, 004 / S2: сбой посреди транзакции возвращает ошибку без частичной записи; шаг мира не обращается к БД.
- [ ] STORE-003, 005 / S3: kill процесса и восстановление из `VACUUM INTO` проверены, `integrity_check` = ok.
- [ ] STORE-011 / S7: лимит 50 записей и ошибка записи.
- [ ] `make server-test` и `npm run check` проходят.

## Результат
- Файлы: —
- Проверки: не выполнялись; реализация не начата.
- Отклонения: —
