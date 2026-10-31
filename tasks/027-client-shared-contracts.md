---
id: TASK-027
type: implementation-task
status: done
spec: ../specs/shared-contracts.md
requirements: [SHARED-001–006]
depends_on: []
---

# Перевод клиента на общий контракт

## Цель и изменения требований
По явному уточнению пользователя удалить дубли общего контракта в client. Wire-поведение и серверный contracts.ts не менять. Это разрешённое исключение из границы набора B.

## Реализация
- [x] Импорт протокола и fixtures из shared, общие типы мира и карты, парсеры и проходимость.
- [x] Настроить TypeScript/Vite и проверки границ для чистого shared.

## Приёмка
- [x] SHARED-001–006: единая исполняемая копия, fixtures, проверки типов без DOM/Node.
- [x] make client-test, check, check:imports, build и сценарии карты/сети в браузере.

## Результат
Удалены дубли protocol/types, validate, fixtures; Core/map используют общие типы, HttpMapSource — парсеры, ChunkManager — общую проходимость. В shared изменён только профиль типов ESNext/Bundler. 136 unit-тестов, типы/imports/build и 5 браузерных сценариев проходят; 22 сравнения прежнего парсера с shared совпадают. [Evidence](evidence/backend-platform-data-2026-10-31.md).
