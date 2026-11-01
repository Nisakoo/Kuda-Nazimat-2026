---
id: TASK-066
type: implementation-task
status: done
spec: ../specs/server-npc-content.md
requirements: [CONTENT-001–011]
related:
  - spec: ../specs/server-world.md
    requirements: [SERVER-WORLD-008]
  - spec: ../specs/server-observability.md
    requirements: []
depends_on: [TASK-013, TASK-043]
scheduling_note: первая из четырёх частей админки (CONTENT → AUTH-017–020 → OBS-013/014 → ADMIN); HTTP-доступ к каталогу — в задаче ADMIN
---

# Сервер: каталог NPC, изменяемый на лету

## Цель и изменения требований
Модуль `server/src/content/`: NPC в SQLite с начальными данными из `npcs.json`, правка поведения, перемещение, выключение и удаление без перезапуска, запреты, журнал. Изменён SERVER-WORLD-008 (файл — начальные данные), добавлены CONTENT-001–011.

## Реализация
- [x] Миграция `005.sql`: каталог NPC и журнал изменений; хранилище SQLite.
- [x] `NpcCatalog`: загрузка и начальные данные, правка, перемещение, выключение, удаление, revision, запреты, журнал и события.
- [x] `World` читает NPC из каталога; BABEL берёт профиль, позицию и радиус NPC из каталога вместо копии в `babylon/content.ts`.
- [x] Конфигурация `content.mapFiguresFromServer`; метрики `content_npc_changes_total`, `game_npcs`.

## Приёмка
- [x] CONTENT S1–S7 покрыты `test/content.test.ts` (основные пути, цель покрытия ~60%); S8 (BABEL берёт радиус и персону из каталога) реализован, но отдельным тестом не проверен — проверено, что существующие тесты BABEL проходят с NPC из каталога.
- [x] `npm --prefix server test` и `npm --prefix server run check` проходят.

## Результат
- Файлы: `server/src/content/{ports,NpcCatalog}.ts`, `server/src/persistence/{npcContent.ts,migrations/005.sql}`; `World` читает NPC через `NpcSource`; BABEL — через `npc(id)` и `babylonNpc`, копия `NPCS` из `babylon/content.ts` удалена (оставлен `BABEL_NPC_IDS`); `GameDeps.npcSource`, конфиг `content.mapFiguresFromServer`; метрики `content_npc_changes_total`, `game_npcs`; события `content.npc.changed`/`rejected`.
- Проверки (Windows 11, Node 24.15.0, 2026-11-01): `npm --prefix server test` — 25 файлов, 231 тест, все прошли; `npm --prefix server run check` без ошибок. Позиции и радиусы NPC рынка в `npcs.json` совпадают с удалённой копией BABEL, поведение задания не изменилось.
- Попутно: после последнего слияния `main` тест AUTH S10 слал 400 одновременных запросов и на Windows получал ECONNREFUSED (короткая очередь входящих соединений) — тест переведён на волны по 50, лимит по-прежнему срабатывает. Мир перегенерирован клиентским генератором (`world:generate`), код клиента не менялся.
- HTTP-доступ к каталогу — в задаче ADMIN.
