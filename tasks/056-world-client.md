---
id: TASK-056
type: implementation-task
status: in-progress
spec: ../specs/world-next-stage.md
requirements: [NEXT-006, NEXT-010, NEXT-011, NEXT-013, NEXT-014, NEXT-015]
depends_on: [TASK-055]
---

# Клиент живого мира и переноски

## Границы

Только согласованный блок TASK-030; другие NEXT, редизайн, новая локация, TLS и LLM не входят. Основа: origin/main 87124f4. Ветка: impl/next-006-010-011-015. Модель сессии проверена: openai/gpt-6.1-sol, thinkingLevel high; делегирование требует той же конфигурации.

## Реализация

- [x] Применить единый контракт в OnlineSession, адаптерах и явном mockbackend без fallback.
- [x] Добавить физическую F по фронту, сброс управления, подсказку, ожидание и отказ только по backend.
- [ ] Разместить данные заготовок, три кошки, общие стаи и ветер; четыре горшка не входят в запечённые декор/коллизии.
- [ ] Показать поднятие/переноску/опускание своего и удалённых игроков при MOVE и выгрузке чанков.
- [ ] Проверить S7/S11/S12, регрессии, границы модулей, браузер/визуальные сценарии и четыре клиента.

## Приёмка

- [ ] Применимые unit, type, build, import, browser и visual проверки проходят; evidence содержит команды и фактический результат.
- [ ] Применимые S7/S11/S12/S15 подтверждены; непроверенные пункты не считаются выполненными.

## Открытые вопросы и оборудование

- Физические LAN на двух ноутбуках, Wi-Fi off, целевое оборудование и фактическое прослушивание пока недоступны в контейнере; остаются unverified. Это не заменяется LocalSession или mockbackend.
- Продуктовые решения согласованного блока определены NEXT; технические параметры фиксируются в контракте и evidence до замеров.

## Результат

Реализация и проверки выполняются. Отметок о завершённой приёмке нет.

### Transport/session/input/UI — world-client

Реализованы физическая KeyF по фронту и сброс через существующий lifecycle Pointer Lock; меню, текстовый ввод, модификаторы, blur и dispose не запускают новое действие. MOVE не блокируется переноской. Отдельный авторизованный канал `world-life` v1 использует общие runtime-парсеры в SocketIOAdapter и явном MockNetworkAdapter; поля игрового `game` v3 не изменены.

OnlineSession хранит один ожидающий HandRequest, устойчиво уникальные идентификаторы запросов, timeout 10 с, корреляцию receipt и текущий SceneStateMessage. Исторический receipt не изменяет текущее владение: руки/UI и рендер получают только scene-state. Старые revision отбрасываются; новый sceneId допускает сброс revision. Reconnect не повторяет намерение. В GameApp передаётся `RenderAdapter.setSceneState`, а UI показывает подтверждённые руки, подсказку, ожидание и отказ. Локальная прогулка не подменяет серверную переноску. MockWorldLife — явно тестовый backend с ограниченными receipts, одним слотом и общей формой ошибок; его синтетическая геометрия и отсутствие SQLite не доказывают серверную приёмку.

GameApp интегрирует принадлежащий TASK-057 WorldAudio с общим WorldBudget: unlock по жесту, подтверждённое движение/начало прыжка, silent snapshot/history, освобождение отсутствующих персонажей через retainEntities, новые видимые реплики и dispose до смены бюджета. Чат BABEL использует составной ключ authorId/id; translating не становится baseline, silent события одной polling-пачки предшествуют live. Один регулятор 0–100% передаёт 0–1 в аудиомодуль, сохраняющий значение. Debug-вывод звука обновляется с прежней секундной metrics cadence, а не каждый кадр, и обнуляется при освобождении сцены.

Доступные имена для browser acceptance: `Руки` (Руки свободны / В руках: яблоко), `Действие с предметом` (кнопка F, disabled при ожидании), `Громкость` (range 0–100, step 1), `Звук` (Источники / Буферы / Загрузки / Память в байтах).

Проверенная среда: Linux-контейнер, Node v24.22.2, npm 11.19.1, HEAD 87124f4 с незакоммиченными изменениями всей команды; конфигурация openai/gpt-6.1-sol / high подтверждена главным агентом по read-only runtime metadata. В этом отчёте unit-транспорт — explicit mockbackend, не настоящий backend/LLM.

- `make client-test` — PASS, 270 тестов / 32 файла; `evidence/world-next/client-unit.log`. Включает новые тесты F/reset, one pending/no optimistic success, отказ опускания, stale receipt/revision, timeout/reconnect без replay, runtime-shape моков, MOVE, audio hooks/volume/dispose, authorId/id, translating→delivered, silent-before-live и очистку entity slots.
- `npm --prefix client run check` — PASS: svelte-check 0 ошибок / 0 предупреждений, tsc и check:core; `evidence/world-next/client-check.log`. Предыдущие промежуточные ошибки внешних renderer/server/shared файлов устранены их владельцами перед итоговым прогоном.
- `npm --prefix client run check:imports` — PASS, 123 модуля / 392 зависимости, нарушений нет; `evidence/world-next/client-imports.log`.
- `npm --prefix client run build` — PASS; 205 модулей, JS 961,74 kB (gzip 264,04 kB), CSS 11,40 kB. Предупреждение Vite о чанке >500 kB сохранено; `evidence/world-next/client-build.log`.
- Дополнение NEXT-015 после review: для одного нового показанного BABEL NPC reply формируются 2 отдельные live-идентичности `babel-npc:<replyId>:question` и `babel-npc:<replyId>:answer`; history/reconnect получает обе как silent baseline. Обычный OnlineSession отдельно озвучивает новый показанный player question и коррелированный NPC answer; локальное демо формирует отдельные question/answer IDs одной пары. Пустой ввод, ожидание, дубли ответа и reconnect новых live-событий не создают. Целевой ожидаемый browser-счётчик после одного нового BABEL reply — +2 mumble; WorldAudio затем удалил временной cooldown и сохраняет обе свежие заявки при cold/warm load в пределах общего source cap; 52 module-теста подтверждают это. Нативная интегрированная проверка пары остаётся отдельной от этих событий/моков.
- `cd client && ./node_modules/.bin/vitest run src/app/GameApp.test.ts src/app/audioPresentation.test.ts` — PASS, 31 тест / 2 файла; `evidence/world-next/client-utterance-unit.log`. После дополнения также PASS `cd client && ./node_modules/.bin/tsc --noEmit`; полный итоговый client/server/browser прогон выполняет главный агент.
- Приоритет пользовательского жеста: `requestPlay()` сначала синхронно вызывает native Pointer Lock через InputController, затем optional audio.unlock в том же обработчике. Это убирает новую синхронную аудиозависимость перед захватом, но не доказывает исправление наблюдавшегося browser-сбоя. `cd client && ./node_modules/.bin/vitest run src/app/GameApp.test.ts src/input/InputController.test.ts` — PASS, 45 тестов / 2 файла, включая строгий порядок capture→audio и наличие обоих вызовов; `evidence/world-next/client-capture-order-unit.log`. `cd client && ./node_modules/.bin/tsc --noEmit` — PASS. Ассеты этим дополнительным прогоном не генерировались.
- Дополнение panel-audio: текущий `openBabylonPanel()` не содержит события при открытии. Интеграционный тест подтверждает тишину при открытии/повторном открытии старой BABEL-истории и goat controls, а затем ровно 2 distinct live events нового question/answer. Безусловный `market-dialog` найден в локальном `openMarketPanel()` и ограничен `MARKET_PEOPLE`, где MarketPanel действительно показывает подготовленную реплику; goat controls молчат. Core LocalSession greeting не изменён. `cd client && ./node_modules/.bin/vitest run src/app/GameApp.test.ts src/app/audioPresentation.test.ts` — PASS, 34 теста / 2 файла; `evidence/world-next/client-panel-audio-unit.log`. `cd client && ./node_modules/.bin/tsc --noEmit` — PASS. Ассеты не генерировались; browser rebuilt acceptance выполняет главный агент.
- `git diff --check` — PASS на момент проверки.

Координатор после всех production-исправлений: **284 passed /33 файла** в полном `make client-test`, Svelte/strict/Core/import/build PASS; [итоговые логи](evidence/world-next/acceptance.md), `final-client-*-v3.log`. Последующие изменения только browser harness прошли отдельный strict TypeScript. Реальный browser-v5 выполнил F pickup/repeat/menu reset, одинаковое владение на 4 ролях, restart с предметом и place; затем route не уложился в harness deadline. Это частичные наблюдения, не PASS всего S12. Скриншоты `browser-v5/` просмотрены: яблоко видно в ладони после restore и на земле после place; полного MOVE/carry 30/60 clip они не заменяют.

Browser/visual/S7/S11/S12/S15, четыре настоящие роли, SQLite/restart, профиль, пятицикловая интегральная память и прослушивание этим исполнителем не подтверждены; главный агент выполнил отдельные прогоны, результаты приведены в acceptance.md. Общая приёмка остаётся открытой. Физические LAN/Wi-Fi off и целевое оборудование остаются unverified. Коммитов и push этим исполнителем нет.

Итог координатора: последний NEXT browser — **2 failed** (screenshot30 s и mumble response30 s), полный render — **6 passed /8 failed**. Все MOVE/carry clips частичные, `completed:false`,1,57–2,01 FPS; их PNG names не подтверждают фазу sprint/jump. После удаления мешавшего тестового avatar только из catalogue harness: strict TS PASS и отдельный catalogue case **1 passed**, новый PNG просмотрен. Production renderer не менялся после полного unit/type/build набора. Подробности/логи/оставшиеся проверки — [acceptance.md](evidence/world-next/acceptance.md).
