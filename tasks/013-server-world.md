---
id: TASK-013
type: implementation-task
status: in-progress
spec: ../specs/server-world.md
requirements: [SERVER-WORLD-001–008]
depends_on: [TASK-024]
scheduling_note: часть A (мир и сеть); сессии/позиции — через server/src/contracts.ts, без ожидания части B
---

# Сервер: статический мир

## Цель и изменения требований
Загрузить и проверить мир при старте, выдать bootstrap, защищённо раздавать файлы и предоставить коллизии. Изменены SERVER-WORLD-001–006 (раскладка, проверки, правила доступа, 404 вместо 403); добавлены 007–008 (коллизии, NPC-контент).

## Реализация
- [ ] Адаптер `world/loader`: чтение worldDir/contentDir, проверки SERVER-WORLD-002 и 008, allowlist файлов, коллизии в памяти.
- [ ] Домен `world`: модель карты, bootstrap, проходимость (через shared), правило доступа к файлу по позиции игрока (порт `PlayerLocator`).
- [ ] HTTP-маршрут `/world/*` по SERVER-WORLD-005–006; добавить контент `server/content/npcs.json` для demo.

## Приёмка
- [ ] SERVER-WORLD-001–003 / S1: bootstrap demo совпадает с клиентским `DEMO_WORLD`; испорченный файл не даёт запуститься.
- [ ] SERVER-WORLD-004 / S2: независимый пересчёт `worldBytes`.
- [ ] SERVER-WORLD-005 / S3: обход пути и неизвестные пути — 404.
- [ ] SERVER-WORLD-006 / S4: область по `staticChunkRadius`, 401 без токена (с портом-заглушкой позиции; с реальной позицией — в TASK-014).
- [ ] SERVER-WORLD-007–008 / S5: проходимость и проверки NPC-контента.
- [ ] `make server-test` и `npm run check` проходят.

## Результат
- Файлы: server/src/world/{GameMap,access,loader,npcContent}.ts, server/content/npcs.json (рынок: 4 NPC без renderable; demo: Лея, Марк); тесты server/test/a-world.test.ts, a-real-world.test.ts.
- Проверки: `npm --prefix server test` — 4 файла, 26 тестов, все прошли; `npm --prefix server run check` — tsc server + shared без ошибок, dependency-cruiser без нарушений; `node -e "import('./src/game/index.ts')"` в Node 24.15.0 — модуль грузится без сборки. Среда: Windows 11, Node 24.15.0, npm 11.12.1. Настоящие миры market/demo/science из client/public (после `node client/scripts/generate-demo-world.mjs`) загружаются с серверным npcs.json; bootstrap market и demo совпадают с MARKET_WORLD/DEMO_WORLD клиента; spawn рынка проходим. Доступ к файлам по staticChunkRadius, 404 для неизвестного пути и чужого аккаунта — в a-realtime.test.ts.
- Отклонения и остаток: Не проверены отдельными тестами: отказ запуска при испорченном файле (S1, вторая часть), независимый пересчёт worldBytes (S2). HTTP-маршрут /world/* и статусы 401/404 — часть B (TASK-010/012). Статус in-progress, пока непроверенные пункты приёмки не закрыты.
