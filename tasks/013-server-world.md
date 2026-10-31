---
id: TASK-013
type: implementation-task
status: todo
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
- Файлы: —
- Проверки: не выполнялись; реализация не начата.
- Отклонения: —
