---
id: TASK-013
type: implementation-task
status: done
spec: ../specs/server-world.md
requirements: [SERVER-WORLD-001–008]
depends_on: [TASK-024]
scheduling_note: часть A (мир и сеть); сессии/позиции — через server/src/contracts.ts, без ожидания части B
---

# Сервер: статический мир

## Цель и изменения требований
Загрузить и проверить мир при старте, выдать bootstrap, защищённо раздавать файлы и предоставить коллизии. Изменены SERVER-WORLD-001–006 (раскладка, проверки, правила доступа, 404 вместо 403); добавлены 007–008 (коллизии, NPC-контент).

## Реализация
- [x] Адаптер `world/loader`: чтение worldDir/contentDir, проверки SERVER-WORLD-002 и 008, allowlist файлов, коллизии в памяти.
- [x] Домен `world`: модель карты, bootstrap, проходимость (через shared), правило доступа к файлу по позиции игрока (порт `PlayerLocator`).
- [x] HTTP-маршрут `/world/*` по SERVER-WORLD-005–006; добавить контент `server/content/npcs.json` для demo.

## Приёмка
- [x] SERVER-WORLD-001–003 / S1: bootstrap demo совпадает с клиентским `DEMO_WORLD`; испорченный файл не даёт запуститься.
- [x] SERVER-WORLD-004 / S2: независимый пересчёт `worldBytes`.
- [x] SERVER-WORLD-005 / S3: обход пути и неизвестные пути — 404.
- [x] SERVER-WORLD-006 / S4: область по `staticChunkRadius`, 401 без токена (с портом-заглушкой позиции; с реальной позицией — в TASK-014).
- [x] SERVER-WORLD-007–008 / S5: проходимость и проверки NPC-контента.
- [x] `make server-test` и `npm run check` проходят.

## Результат
- Файлы: server/src/world/{GameMap,access,loader,npcContent}.ts, server/content/npcs.json (рынок: 4 NPC без renderable; demo: Лея, Марк); тесты server/test/a-world.test.ts, a-real-world.test.ts.
- Проверки: `npm --prefix server test` — 4 файла, 26 тестов, все прошли; `npm --prefix server run check` — tsc server + shared без ошибок, dependency-cruiser без нарушений; `node -e "import('./src/game/index.ts')"` в Node 24.15.0 — модуль грузится без сборки. Среда: Windows 11, Node 24.15.0, npm 11.12.1. Настоящие миры market/demo/science из client/public (после `node client/scripts/generate-demo-world.mjs`) загружаются с серверным npcs.json; bootstrap market и demo совпадают с MARKET_WORLD/DEMO_WORLD клиента; spawn рынка проходим. Доступ к файлам по staticChunkRadius, 404 для неизвестного пути и чужого аккаунта — в a-realtime.test.ts.
- Отклонения и остаток (история): отказ при испорченном файле и независимый пересчёт worldBytes не были покрыты — закрыто 2026-11-01 ниже.

### Закрытие приёмки 2026-11-01
- S1: `test/world-checks.test.ts` — чанк, изменённый на 1 байт, останавливает загрузку с именем файла; bootstrap market/demo совпадает с клиентским (`a-real-world.test.ts`).
- S2: независимый пересчёт уникальных файлов с диска равен worldBytes для тестового мира, для мира с общим collision-файлом (учтён один раз, `uses.cells` у обеих клеток) и для сгенерированных market/demo/science; неверный worldBytes отклоняется.
- S3: с действующим токеном и вошедшим игроком `/world/../server/config.json`, `/world/maps%2F..%2F..`, неизвестный файл, завершающий `/`, `%2e%2e` и `\` — 404, сервер продолжает отвечать. Исправлено расхождение со SERVER-WORLD-005: исчезнувший разрешённый файл теперь 500 без пути на диске (было 404), `src/http/server.ts`.
- S4: область `staticChunkRadius` и 401 без токена — `a-realtime.test.ts`, `integration.test.ts` (ближний чанк 200, дальний 404), `offline.test.ts` (401 по LAN-адресу).
- S5: duplicate id, неизвестная карта, позиция вне чанков и лишнее поле NPC останавливают загрузку; spawn demo проходим, клетка коллизии и точка вне карты — нет (`a-shared-protocol.test.ts`, тот же shared-модуль, что импортирует клиентский ChunkManager).
- Проверки: `npm --prefix server test` — 19 файлов, 170 тестов, все прошли; `npm --prefix server run check` без ошибок. Windows 11, Node 24.15.0.
