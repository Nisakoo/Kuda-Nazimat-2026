---
id: TASK-040
type: implementation-task
status: done
spec: ../specs/server-npc-dialogue.md
requirements: [NPC-002, NPC-004–009]
related:
  - spec: ../specs/protocol.md
    requirements: [PROTO-007]
  - spec: ../specs/server-realtime.md
    requirements: [REALTIME-009]
  - spec: ../specs/shared-contracts.md
    requirements: [SHARED-003–004]
depends_on: [TASK-014, TASK-025, TASK-032]
scheduling_note: серверная сторона и общий контракт; поддержка потока в клиенте — отдельная клиентская задача, реальный адаптер модели — TASK-017
---

# Сервер: потоковый ответ NPC и модельные порты

## Цель и изменения требований
Дать будущему адаптеру локальной модели полный и проверяемый набор портов и предложить клиенту потоковый ответ NPC, не ломая текущий клиент. В клиенте потокового контракта не было, а черновик v2 `npc.dialogue.*` был привязан к памяти и настройкам ИИ — его заменил совместимый подконтракт v3.

- Изменены: PROTO-007 (вместо черновика v2 — `npc-question.stream`, `npc-partial`, `npc-cancel`/`npc-cancelled`), NPC-002 (`streamTimeoutMs`), NPC-004 (отмена с клиента), NPC-005 (`onPartial` у NpcResponder), NPC-006 (заглушка стримит), NPC-007 (нет partial после завершения), REALTIME-009, SERVER-003/004/007.
- Добавлены: NPC-008 (поток и отмена), NPC-009 (LanguagePort: жизненный цикл, реестр, конфиг `language`).

## Реализация
- [x] `shared/protocol`: типы, строгие парсеры и fixtures (валидные/невалидные) для новых сообщений; старые формы без изменений.
- [x] `NpcResponder.answer(request, signal, onPartial?)`; заглушка `scripted` выдаёт три растущих префикса; контрактный тест проверяет отсутствие partial после завершения и abort.
- [x] GenerationQueue: таймаут на задачу и `cancel(connectionId, requestId)`; NpcDialogueService нормализует и глушит снимки после abort/дедлайна; `NpcQuestions.ask(question, onPartial?)` и `cancel` в `contracts.ts`.
- [x] Realtime: `PartialThrottle` (≤10/с, новейший текст, без повторов, ничего после stop), volatile-отправка, `npc-cancel` → `npc-cancelled`, снимки прекращаются на терминальном сообщении и при разрыве.
- [x] `LanguagePort.start/stop`, реестр `src/babylon/adapters.ts` (`test`), конфиг `language: {adapter, options}`, `unavailableLanguagePort` при отказе старта, остановка вместе с сервером.

## Приёмка
- [x] PROTO S3 / NPC S6: настоящий сокет — снимки с растущим seq, каждый текст — начало финального, затем `npc-answer`, после него снимков нет; без `stream` снимков нет; `npc-cancel` → `npc-cancelled`, по вопросу больше ничего, история не записана, следующий вопрос принят (`integration.test.ts`).
- [x] NPC-008: нормализация и отбрасывание пустых снимков, тишина после отмены, отмена только своего вопроса, 30 с для потока и 8 с для обычного (`npc-stream.test.ts`); троттлинг (`npc-stream.test.ts`).
- [x] NPC-007: контрактный набор для `scripted` с новой проверкой.
- [x] NPC S7 / NPC-009: отказ `LanguagePort.start()` — подсказка UNAVAILABLE, словарь работает, `stop()` вызван; неизвестный `language.adapter` останавливает запуск; конфиг проверяется (`integration.test.ts`, `application.test.ts`, `platform.test.ts`).
- [x] Совместимость: `npm --prefix client test` (190) и `npm --prefix client run check` проходят с изменённым shared; клиент не менялся и потоковых сообщений не получает, пока сам не отправит `stream: true`.
- [x] `npm --prefix server test` — 19 файлов, 170 тестов, все прошли; `npm --prefix server run check` без ошибок (Windows 11, Node 24.15.0, 2026-11-01).

## Результат
Сервер готов к потоку и к подключению модели: реализовать `NpcResponder` (с `onPartial`, если модель стримит) и `LanguagePort`, зарегистрировать их в `src/npc/adapters/index.ts` и `src/babylon/adapters.ts`, выбрать в `config.json` и прогнать контрактный набор. Не входит и не проверено: использование потока в клиенте, реальная модель, стриминг ответов BABEL по HTTP.
