---
id: TASK-026
type: implementation-task
status: blocked
spec: ../specs/server-demo.md
requirements: [SERVER-DEMO-001, SERVER-DEMO-003–006, SERVER-DEMO-008–009]
depends_on: [TASK-010, TASK-011, TASK-012, TASK-014, TASK-025]
scheduling_note: часть B; финальная интеграция обеих частей
---

# Сервер: готовность к защите

## Цель и изменения требований
Сделать каждый блок регламента защиты показуемым со стороны бэкенда. Добавлены SERVER-DEMO-001, 003–006, 008–009 (002 и 007 сняты); изменены SERVER-WORLD-008 (persona, greeting, label = тема), NPC-005–006 (профиль и память заглушки), SERVER-004 (`logWorldAccess`).

## Реализация
- [x] Подготовлены make demo, CLI inspect/backup, печать адресов и world-access logging в B.
- [x] Заглушка с памятью и повторными объяснениями; схема архитектуры отражает прямой импорт shared.
- [ ] Контент NPC набора A и финальная сборка после его слияния.
- [x] В server/README.md записан сценарий защиты с явной пометкой непроверенных шагов.

## Приёмка
- [ ] SERVER-DEMO-001 / S1: make demo на чистом клоне и повторный запуск без потери данных.
- [x] SERVER-DEMO-003: inspect работающей WAL-БД без секретов, усечение вопроса до 60.
- [x] SERVER-DEMO-004/006: лог HTTP на тестовом GameRuntime и память после restart с настоящей SQLite.
- [ ] SERVER-DEMO S2/S3: доступ к чанкам по настоящей позиции и профиль NPC из контента A.
- [ ] SERVER-DEMO-008–009 / S5: полная репетиция в браузере и отображение схемы GitHub; нужен TASK-028.
- [x] make server-test, check:platform проходят.
- [ ] Полный npm run check: ошибки A из main.

## Блокер
В main отсутствует server/src/game/index.ts с createGame, realtime и контент A; game/world не проходят строгую типизацию. Финальная интеграция по указанию пользователя начинается только после слияния готового A. Для браузерной репетиции дополнительно нужен клиентский mock-вход TASK-028. Нужны merge A, исправленные проверки и клиентская форма входа; затем повторить полные сценарии.

## Результат
Подготовлена часть B, интеграция не заявляется завершённой. SERVER-DEMO-002/007, AI/LLM и v2 исключены. [Evidence](evidence/backend-platform-data-2026-10-31.md).
