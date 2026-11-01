---
id: TASK-100
type: implementation-task
status: done
spec: ../specs/server-admin-content.md
requirements: [ADMIN-SRV-001–012]
related:
  - spec: ../specs/admin-panel-ui.md
    requirements: [ADMIN-017–028]
  - spec: ../specs/server-world.md
    requirements: [SERVER-WORLD-008]
  - spec: ../specs/server-persistence.md
    requirements: [STORE-014]
  - spec: ../specs/server-auth.md
    requirements: [AUTH-010]
  - spec: ../specs/server-observability.md
    requirements: [OBS-003]
depends_on: [TASK-043]
scheduling_note: серверная часть разделов «NPC», «Журнал», «Аккаунты» и живого мира админки; вёрстка страницы — TASK-083, клиентское подтверждение контракта — TASK-101
---

# Сервер: правка NPC на ходу, живой мир, журнал и аккаунты для админки

## Цель и изменения требований
Дать экрану администратора серверную основу для «редактирования вселенной» и управления поведением NPC в пределах того, что возможно без клиента. Добавлены ADMIN-SRV-001–012 и STORE-014; изменены SERVER-WORLD-008 (файл NPC — исходник под слоем правок), AUTH-010 (действия журналируются), OBS-003 (события `admin.change`, `admin.npc.orphaned`), ADMIN-019–021, 022, 026 и добавлен ADMIN-028 (блок мира). Протокол v3 и BABEL v2 не меняются.

## Реализация
- [x] Миграция 010: `npc_overrides`, `admin_journal` (`src/persistence/migrations/010.sql`), адаптер `src/persistence/adminContent.ts` (журнал с поиском без учёта регистра в кириллице, лимит 100 000, карточка аккаунта из `accounts`/`sessions`).
- [x] Чистый каталог `src/content/NpcCatalog.ts`: слой правок поверх `npcs.json`, проверки SERVER-WORLD-008, запрет перемещения и облика у «вшитых» NPC, закрытый список обликов, создание до 64 NPC, мягкое удаление, сброс, diff для журнала.
- [x] Сервис `src/content/ContentAdmin.ts`: запуск (сироты → `admin.npc.orphaned`, `npc.seed` один раз), применение на ходу через `GameRuntime.content.setNpcs`, отмена вопросов к ушедшему NPC, сброс сцены, журнал, аккаунты, живой профиль для BABEL.
- [x] Мир: изменяемый набор NPC в `World`, `GameService.sceneView/resetScene`, `WorldLife.view/resetPots`, `WorldLifeStore.resetApples` одной транзакцией.
- [x] Отмена: `NpcDialogueService.cancelNpc` по учёту незавершённых вопросов; шлюз отвечает `error UNAVAILABLE`, если NPC ушёл, пока игрок ждал ответа (без изменения поведения при обычном уходе игрока).
- [x] BABEL: живой профиль, `FORBIDDEN` у выключенного NPC задания, позиции задания сохранены, созданный NPC на рынке отвечает; NPC, которого нет в мире, работает по контенту задания.
- [x] AUTH: хук `audit` (экран и CLI), `operator.lockedUntil`; формулировки «ведущий» → «администратор» в сообщениях игроку, журнале, CLI и блоке подключения.
- [x] Маршруты `src/http/adminContentRoutes.ts` за loopback и защитой AUTH-010; подключение одной строкой в `operatorRoutes.ts`; CSV с BOM и защитой от формул.
- [x] Спеки: `server-admin-content.md`, `admin-panel-ui.md`, `server-world.md`, `server-persistence.md`, `server-auth.md`, `server-observability.md`; `architecture.md`, `docs/npc-authoring.md`, `server/README.md`.

## Приёмка
- [x] ADMIN-SRV S1, S2, S7 — `test/admin-content.test.ts`: правка темы и приветствия видна в `delta` и в ответе NPC, переживает перезапуск, сбрасывается; «вшитому» NPC отказано в позиции, облике и карте; `npc.seed` ровно по одному на NPC после перезапуска.
- [x] ADMIN-SRV S3, S4, S9 — там же: выключение во время генерации даёт `error UNAVAILABLE` без `npc-answer`, `remove` в `delta`, `FORBIDDEN` на `interact`, возврат после включения; удаление/восстановление и порядок журнала; созданный NPC с `avatar-dan` появляется у игрока, 409 на занятый id, 400 на облик не из списка и лишние поля; 403 без `X-Operator` и с чужим `Origin`; сервер теста слушает только 127.0.0.1 (LAN-запрос не соединяется), 404 с не-loopback проверяет общий путь `/api/operator/*` OFFLINE-018.
- [x] ADMIN-SRV S5 — там же: BABEL берёт живой профиль, отказывает выключенному NPC задания в разговоре и покупке, созданный NPC рынка отвечает, покупка у него — `INVALID`.
- [x] ADMIN-SRV S6, S8 — там же: сброс сцены возвращает яблоко из рук на исходное место и повышает revision; карточка, журнал и CSV содержат `account.reset-password`, `account.revoke` и входы, но не временный пароль, токен и хеши; CSV начинается с BOM и фильтруется.
- [x] ADMIN-SRV-008 — горшок, на исходном месте которого стоит игрок, пропускается; остальные возвращаются.
- [x] `npm --prefix server run check` — tsc (src и тесты), shared tsc, dependency-cruiser: без ошибок (101 модуль, 362 зависимости).
- [x] `make server-test` — 46 файлов: 680 тестов прошло, 4 пропущено, 3 упало. Эти 3 падают и на базовом коммите 566d873 в том же окружении и к изменению не относятся: `building-height` требует сгенерированный мир `client/public/maps/market` (его в checkout нет), два теста `llm-diagnostic` ожидают отказ занятого порта, который на macOS при занятом 127.0.0.1 не воспроизводится. macOS (Darwin 25.6), Node 24, 2026-11-01.

## Результат
- Файлы: `server/src/content/{NpcCatalog,ContentAdmin,ports}.ts`, `server/src/persistence/{adminContent.ts,migrations/010.sql,worldLife.ts}`, `server/src/http/{adminContentRoutes,operatorRoutes,server}.ts`, `server/src/game/{World,WorldLife,GameService,index,worldLifePorts}.ts`, `server/src/npc/NpcDialogueService.ts`, `server/src/realtime/gateway.ts`, `server/src/babylon/BabylonService.ts`, `server/src/auth/AuthService.ts`, `server/src/app/application.ts`, `server/src/cli/auth.ts`, `server/src/common/network.ts`, `server/src/contracts.ts`, `server/src/world/npcContent.ts`; тесты `server/test/admin-content.test.ts`, правки `auth.test.ts`, `migrations.test.ts`.
- Отклонения: разговор BABEL к выключенному NPC отклоняется при доставке, генерация BABEL не прерывается (ADMIN-SRV-005 так и записан). Сам экран (`operatorPage.ts`) не менялся — TASK-083. Строки «ведущий» в `operatorRoutes.ts` (сообщения журнала) и `operatorPage.ts` оставлены агенту метрик и странице, чтобы не конфликтовать.
- Не проверено: браузерный сценарий панели (страницы ещё нет), реальные LLM-ответчики с изменённым характером (проверен scripted-ответчик и путь профиля в local/BABEL-адаптер).
