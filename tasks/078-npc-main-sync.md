---
id: TASK-078
type: implementation-task
status: in-progress
spec: ../specs/server-npc-dialogue.md
requirements: [NPC-001–005, NPC-009]
related:
  - spec: ../specs/server-auth.md
    requirements: [AUTH-002, AUTH-005, AUTH-009]
  - spec: ../specs/server-persistence.md
    requirements: [STORE-006–008, STORE-011–012]
  - spec: ../specs/npc-character-behavior.md
    requirements: [NPC-AI-010, NPC-AI-012, NPC-AI-015]
depends_on: [TASK-070, TASK-071, TASK-072]
---

# Синхронизация локального NPC runtime с актуальным main

## Основание и границы

Пользователь прямо разрешил rebase из main и синхронизацию ветки. Исходная ветка `npc-llm-clean-start`: `a01c15ade457d73cefce16b5a6f6333aed23c0be`; актуальный main при начале: `2d12d12b1dc2b66eb8d3dbd490d4c9da173c6339`. Старое состояние сохранено в `backup/npc-before-main-rebase-a01c15a`. Локальный main `02eb786dd5bf9f839532919a7c4be350a60c57b9` не изменяется.

Сохранить новые UI/HUD, регистрацию/облик, сохранённые игры, живой мир и серверные контракты main вместе с AUTH-изоляцией NPC, выбранной общей локальной моделью и одной очередью. Архив, отношения и приветствия не добавляются. Модели, Python/runtime и подготовленные локальные конфиги пользователя не переустанавливаются. Настоящие Ollama/MLX, inference, downloads и diagnose здесь не запускаются.

## Реализация и приёмка

- [x] Rebase завершён, main является предком итогового HEAD; main не изменён.
- [x] Конфликты клиентского entry/auth/HUD и NPC metadata решены без потери main-функций и stale-context/logout guards.
- [x] Миграции сохраняют обе истории БД: старую NPC-ветку и main; legacy не назначается новой AUTH-сессии.
- [x] BABEL сохраняет новую замену игры/профиль и изоляцию истории, guards перед моделью/commit/delivery, исходный бюджет и одну модель/очередь.
- [x] Пересечения ID задач устранены с сохранением контекстных ссылок; документы отличают текущую реализацию от неквалифицированного полного NPC-AI.
- [ ] Полностью зелёный повтор объединённых suites остаётся отдельной приёмкой: первоначальные ошибки и целевые повторные проверки перечислены ниже. Пользователь сократил объём: длинные browser-прогоны и визуальные доработки отложены, не объявлены PASS.
- [x] Для публикации обновляется только feature-ветка с явным lease на проверенный прежний remote SHA `a01c15ade457d73cefce16b5a6f6333aed23c0be`; main не меняется. После отправки проверяется чистый рабочий каталог.

## Результат

Rebase всех 20 коммитов завершён поверх `2d12d12`. Main-содержимое UI, auth/avatar/saved-game/world-life сохранено вместе с единственным локальным NPC/BABEL runtime. Auth-консолидация: PasswordAuth обслуживает сессию, Auth — discovery режима, без двух независимых реализаций входа. NPC migration теперь 009; main 003–008 сохранены, действительная схема старой branch-v4 проверяется перед повторным ALTER. Проверены свежая база и upgrades обеих историй; legacy не получает вымышленный sessionId.

Номера задач согласованы: branch 045/046 → 067/068, NPC 058–061 → 069–072, прежние дублирующие client 040–044 → 073–077. Server 040–044 и main 045–066 сохранены. Helper: **38 specs / 77 tasks / 529 requirements — PASS**, включая контекстные ссылки и DAG. Старые PAUSE-ссылки в main-задачах приведены к действующей спеке без выдуманных требований.

### Фактические проверки после rebase

- `npm --prefix client ci` по новому main lockfile — PASS; npm сообщает **2 low vulnerabilities**, отдельный audit/fix не входил в срез.
- Полный `VITEST_MAX_WORKERS=2 KUDA_TEST_PYTHON=... make server-test`: **678 passed / 3 failed, 45 files**. Все 3 отказа оказались старыми миграционными fixtures, не учитывавшими новую AUTH-изоляцию/историю номера 3. Исправлены без удаления проверок сохранности и приватности.
- После исправлений полный целевой набор `world-life`, `npc-session`, `migrations`, `babylon-deadline`, `babylon-http-delivery`: **64 passed / 5 files**. Server/shared type/import checks — PASS, 96 modules / 331 dependencies. Также исправлены 3 типизации enrolled fixtures с nullable groupId из main. Логи: `/tmp/npc-rebase-server-final.log`, `/tmp/npc-rebase-server-recheck.log`. Этот целевой повтор не выдаётся за новый полный suite.
- Полный `VITEST_MAX_WORKERS=2 make client-test`: **406 passed / 2 failed**, ещё один suite не загрузился из-за повреждённого при разрешении конфликта `GameApp.test.ts`. Файл восстановлен целиком; отдельный GameApp-прогон — **46/46 passed**. Client Svelte/TypeScript/import/build — PASS; Vite сообщает large-chunk warning.
- Два тяжёлых avatar-теста превысили 30 секунд при параллельной нагрузке. Framing прошёл отдельно за 10,8 секунды; его timeout повышен до 90 секунд без удаления assertions/семплов. Второй тест (gait) также прошёл изолированно: 1 passed, 11 вне выбранного фильтра, `/tmp/npc-rebase-avatar-gait.log`. Полный клиентский suite после исправления не повторён и не объявлен зелёным. Источник rendering не менялся относительно main, кроме тестового timeout.
- Полный Python fixture-прогон после rebase: **93 passed**, 19,8 секунды, `/tmp/npc-rebase-server-recheck.log`; без настоящей модели.
- Production browser fixture адаптирован к актуальному UI/avatar/cabinet, но не запускался. Полная browser/визуальная приёмка отложена по просьбе пользователя ускорить поставку.
- Автогенерация меняла `pasture.glb`; сохранена отдельная копия и восстановлена committed main-версия, без побочных изменений сцены.

Прошлая приёмка 622 server / 227 client / 93 Python относилась к состоянию до этого rebase и не подменяет результаты выше. Новых запусков настоящей модели, downloads, установки модели или аппаратной квалификации не было. Эта задача остаётся in-progress для полной приёмки; сам rebase и кодовая синхронизация закончены.
