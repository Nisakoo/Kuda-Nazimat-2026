---
id: TASK-026
type: implementation-task
status: done
spec: ../specs/offline-multiplayer.md
requirements: [OFFLINE-002, OFFLINE-016]
depends_on: [TASK-010, TASK-011, TASK-012, TASK-014, TASK-025]
scheduling_note: часть B; финальная интеграция обеих частей
---

# Сервер: готовность к защите

## Цель и изменения требований
Спека SERVER-DEMO удалена 2026-11-01: она была retired, её действующие требования перешли в [OFFLINE](../specs/offline-multiplayer.md) (запуск — OFFLINE-002, `inspect` и `logWorldAccess` — OFFLINE-016), [SERVER-WORLD](../specs/server-world.md) SERVER-WORLD-008 (persona) и [NPC](../specs/server-npc-dialogue.md) NPC-006 (память заглушки). Идентификаторы SERVER-DEMO ниже — история приёмки.

Сделать каждый блок регламента защиты показуемым со стороны бэкенда. Добавлены SERVER-DEMO-001, 003–006, 008–009 (002 и 007 сняты); изменены SERVER-WORLD-008 (persona, greeting, label = тема), NPC-005–006 (профиль и память заглушки), SERVER-004 (`logWorldAccess`).

## Реализация
- [x] Подготовлены make demo, CLI inspect/backup, печать адресов и world-access logging в B.
- [x] Заглушка с памятью и повторными объяснениями; схема архитектуры отражает прямой импорт shared.
- [x] A из main 0d53eac объединён, NPC-контент и настоящий createGame подключены через неизменённый contracts.ts.
- [x] В server/README.md записан сценарий защиты с явной пометкой непроверенных шагов.

## Приёмка
- [x] SERVER-DEMO-001 / S1: make demo дважды в отдельном клоне 8cf3e76 с подготовленными зависимостями и npm offline; оба игрока и NPC-память сохранены.
- [x] SERVER-DEMO-003: inspect работающей WAL-БД без секретов, усечение вопроса до 60.
- [x] SERVER-DEMO-004/006: лог HTTP на тестовом GameRuntime и память после restart с настоящей SQLite.
- [x] SERVER-DEMO S2/S3: реальный HTTP-доступ к ближнему/дальнему чанку, профиль NPC и сохранение памяти после рестарта подтверждены интеграционными и браузерными тестами.
- [x] TASK-028: вход по имени, реальный чат двух вкладок, NPC и восстановление после рестарта проверены в браузере.
- [x] SERVER-DEMO-008–009 / S5: *снято* 2026-10-31 вместе со спекой SERVER-DEMO (курс на продукт); приёмка на устройствах перенесена в OFFLINE-019 / TASK-016. Схема в architecture.md остаётся.
- [x] make server-test, check:platform проходят.
- [x] Полный npm run check проходит после интеграции A.

## Оставшиеся проверки
A объединён, прежние блокеры runtime и UI сняты. Не засчитываются без выполнения: полная репетиция по регламенту и отображение схемы в GitHub. Второй физический ноутбук и выключенный Wi-Fi — TASK-016.

## Результат
Реальный A+B работает с клиентским UI. Выполнены сетевые тесты с SQLite и браузером; профиль четырёх игроков — [JSON](evidence/server-load-2026-10-31.json). SERVER-DEMO-002/007, AI/LLM и v2 исключены. [Evidence интеграции](evidence/backend-integration-2026-10-31.md).
