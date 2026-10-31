---
id: TASK-024
type: implementation-task
status: todo
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
- [ ] Перенести из `origin/feat-base-client` protocol (types, validate, fixtures), типы сущностей, парсеры manifest/чанка и формулу коллизий; привести к стираемому синтаксису без изменения wire-поведения.
- [ ] Добавить fixtures уточнений PROTO-008 (`requestId: "server"`, чат другого игрока).
- [ ] `shared/tsconfig.json` (ES2022, без DOM/Node, `erasableSyntaxOnly`), тесты fixtures и проходимости; запуск — из команд `server/` (TASK-010).
- [ ] Тест совместимости с `client/src/shared/protocol/fixtures.json`, если файл есть в рабочем дереве (SHARED-006).

## Приёмка
- [ ] SHARED-001–002 / S1: `tsc -p shared` проходит, Node 24 импортирует модули без сборки, запрещённых импортов и синтаксиса нет.
- [ ] SHARED-003–004, 006 / S2: все fixtures дают ожидаемый результат; сравнение с клиентскими fixtures выполнено либо явно записано как непроверенное.
- [ ] SHARED-005 / S3: проходимость на demo-данных совпадает с клиентским guard в контрольных точках.

## Результат
- Файлы: —
- Проверки: не выполнялись; реализация не начата.
- Отклонения: —
