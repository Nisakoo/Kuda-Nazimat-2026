---
id: shared-contracts
type: module-design
status: ready
implementation: partial
parent: architecture
summary: Общий исполняемый TypeScript-контракт клиента и сервера — протокол, сущности, формат карты и проходимость.
related:
  - protocol.md
  - client-world-streaming.md
  - server-world.md
  - server-realtime.md
---

# SHARED — Общие контракты клиента и сервера

## Цель

Одна исполняемая копия всего, что клиент и сервер обязаны понимать одинаково: типы и runtime-валидация PROTO v1, формы сущностей, формат manifest/чанков и правило проходимости. Сервер использует её с первого коммита; клиент переходит на неё отдельной клиентской задачей.

## Требования

- **SHARED-001:** Каталог `shared/` в корне репозитория. Состав:
  - `shared/protocol/` — `types.ts`, `validate.ts`, `fixtures.json` (PROTO v1);
  - `shared/world/` — `Entity`, компоненты, `WorldSnapshot`, `Vector3`, `Direction`, `EntityId`;
  - `shared/map/` — типы manifest/чанка/bootstrap, парсер manifest и чанка, правило проходимости.

  Игровые правила сервера, Socket.IO, HTTP, SQLite, рендер и UI сюда не входят.
- **SHARED-002:** Код — TypeScript strict для ES2022 без npm-зависимостей, без DOM- и Node-типов и глобалов (`window`, `process`, `Buffer` и т. п.). Импорты только внутри `shared/`, относительные, с явным расширением `.ts`. Только стираемый синтаксис: без `enum`, `namespace` и parameter properties. Так сервер запускается встроенным удалением типов Node, а клиент собирается Vite. Импорты ацикличны. Отдельный `shared/tsconfig.json` проверяет это профилем `lib: ["ES2022"]`, `types: []`, `erasableSyntaxOnly`.
- **SHARED-003:** Исходная версия переносится из клиентской ветки `feat-base-client` без изменения wire-поведения: `client/src/shared/protocol/*`, типы данных из `client/src/core/types.ts` (без `GameCommand`/`WorldEvent` клиента), `parseManifest` и разбор чанка из `client/src/map/HttpMapSource.ts`, формула коллизий из `client/src/map/ChunkManager.ts`. Поля, лимиты (`LIMITS`), коды и тексты ошибок совпадают. Допустимы только изменения, нужные SHARED-002 (например, `ProtocolError` без parameter property). Любое изменение wire-контракта — это изменение [PROTO](protocol.md) и версии протокола.
- **SHARED-004:** `fixtures.json` — общий набор валидных и невалидных пакетов для обеих сторон: `{direction: client|server, valid, packet, code?}`. Каждый fixture проверяется тестом. Серверные уточнения PROTO v1 (сообщение `error` с `requestId: "server"`, чат другого игрока с requestId отправителя, delta без изменений не отправляется) получают fixtures.
- **SHARED-005:** Функция проходимости по manifest, collision-bitmap чанка и позиции XZ возвращает «проходимо/нет» по тем же правилам, что movement guard клиента:
  - четыре пробы со смещениями ±0.25 м по X и Z;
  - индекс чанка `floor((p − origin) / chunkSize)`;
  - ячейка `floor((p − origin − index·chunkSize) / chunkSize · collisionResolution)`;
  - ненулевой байт — препятствие; отсутствующий в manifest или незагруженный чанк — непроходимо.

  Сервер использует её для авторитетного движения, клиент после перехода — для guard.
- **SHARED-006:** Пока клиент содержит собственную копию контракта, тест сервера прогоняет клиентский `client/src/shared/protocol/fixtures.json` (если файл есть в рабочем дереве) через shared-парсеры и требует совпадения valid/invalid и кода ошибки. Отсутствие файла фиксируется в результате как непроверенная совместимость, а не как успех. После перехода клиента на `shared/` клиентская копия удаляется. Переход выполняет клиентская задача; серверные задачи `client/` не меняют.

## Сценарии

- **S1 · SHARED-001–002:** Given `shared/`; When выполняется `tsc -p shared` в профиле без DOM/Node и проверка импортов/синтаксиса; Then нарушений нет, Node 24 импортирует модули без сборки.
- **S2 · SHARED-003–004, 006:** Given fixtures клиента и shared; When они разбираются обеими реализациями; Then результаты (valid/invalid, код ошибки) совпадают, включая новые серверные fixtures.
- **S3 · SHARED-005:** Given demo-manifest и его коллизии; When проверяются точки у стены, в проходе, на границе чанков и за краем карты; Then результат совпадает с клиентским guard на тех же данных.

## Ограничения и вне scope

- npm-пакет, workspaces и монорепозиторный инструментарий не создаются; клиент и сервер импортируют исходники относительным путём.
- Типы `shared/` не заменяют runtime-валидацию: входящие данные всегда проходят через парсеры.

## Открытые вопросы

- Переход клиента на `shared/` требует от клиентской сборки разрешить импорт вне `client/` (Vite `server.fs.allow`, `allowImportingTsExtensions`) и обновить dependency-cruiser. Решение и срок — за клиентской задачей.
