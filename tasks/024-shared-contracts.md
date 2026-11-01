---
id: TASK-024
type: implementation-task
status: done
spec: ../specs/shared-contracts.md
requirements: [SHARED-001–006]
related:
  - spec: ../specs/protocol.md
    requirements: [PROTO-001, PROTO-008]
depends_on: []
scheduling_note: часть A (мир и сеть); контракт server/src/contracts.ts
---

# Общий каталог shared/

## Цель и изменения требований
Создать `shared/` с исполняемым контрактом PROTO v1, типами сущностей, форматом карты и правилом проходимости. Добавлены SHARED-001–006, PROTO-008; изменён PROTO-001 (источник — `shared/`).

## Реализация
- [x] Перенести из `origin/feat-base-client` protocol (types, validate, fixtures), типы сущностей, парсеры manifest/чанка и формулу коллизий; привести к стираемому синтаксису без изменения wire-поведения.
- [x] Добавить fixtures уточнений PROTO-008 (`requestId: "server"`, чат другого игрока).
- [x] `shared/tsconfig.json` (ES2022, без DOM/Node, `erasableSyntaxOnly`), тесты fixtures и проходимости; запуск — из команд `server/` (TASK-010).
- [x] Тест совместимости с `client/src/shared/protocol/fixtures.json`, если файл есть в рабочем дереве (SHARED-006).

## Приёмка
- [x] SHARED-001–002 / S1: `tsc -p shared` проходит, Node 24 импортирует модули без сборки, запрещённых импортов и синтаксиса нет.
- [x] SHARED-003–004, 006 / S2: все fixtures дают ожидаемый результат; сравнение с клиентскими fixtures выполнено либо явно записано как непроверенное.
- [x] SHARED-005 / S3: проходимость на demo-данных совпадает с клиентским guard в контрольных точках.

## Результат
- Файлы: shared/{protocol,world,map}/*.ts, shared/package.json, shared/tsconfig.json, shared/protocol/fixtures.json; тест server/test/a-shared-protocol.test.ts.
- Проверки: `npm --prefix server test` — 4 файла, 26 тестов, все прошли; `npm --prefix server run check` — tsc server + shared без ошибок, dependency-cruiser без нарушений; `node -e "import('./src/game/index.ts')"` в Node 24.15.0 — модуль грузится без сборки. Среда: Windows 11, Node 24.15.0, npm 11.12.1. Все fixtures (клиентские + 6 серверных PROTO-008) дают ожидаемый результат; клиентские fixtures из client/src/shared/protocol совпадают по valid/invalid. Проходимость: стена, скольжение и граница чанка проверены на синтетическом мире (a-world.test.ts).
- Отклонения и остаток: Тест shared перенесён в server/test: у shared/ нет своих зависимостей (vitest). Побайтное сравнение проходимости с клиентским ChunkManager не делалось — формула перенесена дословно, проверены контрольные точки. Клиент на shared/ ещё не переведён (клиентская задача). Статус in-progress, пока непроверенные пункты приёмки не закрыты.

После TASK-027 клиент импортирует общий исходник напрямую; отдельные копии protocol/types/fixtures удалены. Проверка A обновлена: при отсутствии копии проверяет прямой импорт, а не молча пропускает сценарий. Общий headless-профиль и полный check проходят. Ранее непроверенная клиентская миграция закрыта TASK-027; исходные результаты A сохранены выше как история.

### Закрытие приёмки 2026-11-01
- SHARED S3: клиентский ChunkManager импортирует `shared/map/walkability.ts`, копии в клиенте нет; контрольные точки demo (spawn проходим, клетка коллизии и точка вне карты — нет) — `a-shared-protocol.test.ts`. Побайтное сравнение двух реализаций больше не нужно: реализация одна.
- Fixtures дополнены потоковым NPC PROTO-007 (`npc-question.stream`, `npc-partial`, `npc-cancel`, `npc-cancelled`), валидные и невалидные; клиентские `npm --prefix client test` (190) и `npm --prefix client run check` проходят с изменённым shared без изменений клиента.
