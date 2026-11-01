---
id: TASK-072
type: implementation-task
status: done
spec: ../specs/server-npc-dialogue.md
requirements: [NPC-009]
related:
  - spec: ../specs/npc-character-behavior.md
    requirements: [NPC-AI-005–006, NPC-AI-010, NPC-AI-012, NPC-AI-015–017]
  - spec: ../specs/server-llm-runtime.md
    requirements: [LLM-001–004, LLM-006–008, LLM-010–012]
  - spec: ../specs/game-babylon.md
    requirements: [BABEL-016]
depends_on: [TASK-070, TASK-071]
---

# Реальный LanguagePort BABEL поверх общего локального runtime

## Цель и границы

Пользователь поручил продолжать выполнение. Подключить явный `language.adapter: local` к уже созданному локальному responder, не создавать вторую модель, worker, очередь или владельца lifecycle. Прежний явно выбранный `test` остаётся тестовым адаптером, не автоматическим fallback.

Это функциональный мост: качество перевода/en/es A2, историчность и аппаратная квалификация отдельно не доказаны. Текущий 2048/1792/128 сохраняется; 4096/256 не включается. Новые архивные квоты, сжатие, отношение и приветствия здесь не выбираются. Public BABEL v2 остаётся прежним; его текущие ограничения ввода не объявляются полным целевым интерфейсом 800 символов.

## Проект интеграции

- Composition root сохраняет единственный экземпляр responder и передаёт его NPC-сервису и тонкому borrowed LanguagePort. Start/recovery/stop модели принадлежат NPC runtime, не borrowed-адаптеру.
- В responder добавляется явная необязательная capability перевода: отдельный typed request с text/source/target/requestKey/deadline, без фиктивного NPC, persona или истории.
- BABEL передаёт проверенную AUTH/player/request область и исходный бюджет внутри сервера, не в клиентском payload и не в system prompt. NPC-история уже отфильтрована по scope/роли; выбранный learning language фиксируется при приёме. Локальный NPC принимает только en/es, перевод допускает существующие языки BABEL.
- Сервис использует одну существующую reservation на всю операцию BABEL. Каждый последовательный перевод потребляет тот же монотонный бюджет; новые вызовы не восстанавливают срок. Нельзя вызывать `NpcDialogueService.ask()` из уже занятого BABEL-слота.
- Borrowed readiness отражает фактическое состояние runtime и его восстановление. Сбой через BABEL должен уведомлять существующий механизм recovery, без повторной генерации вопроса. Недоступность обычного NPC не должна отключать независимо выбранный test LanguagePort.

## Приёмка

- [x] Один responder/worker/start/stop и общая очередь в composition; неподходящий scripted responder при явном local не заменяется test.
- [x] Отдельная translation IPC-операция, строгая проекция/проверка, без persona/history, без усечения в успех и без hidden retry.
- [x] Последовательные target languages сохраняют общий deadline при задержке авторизации и rollback wall clock; квоты ≤1/player и ≤4 суммарно, физическая остановка и quarantine сохранены.
- [x] AUTH/control/range/role проверяются перед вызовами и доставкой; cross-session snapshot/replay остаются изолированы.
- [x] Fake workers, HTTP/Socket.IO fixtures, server/shared tests, type/import checks и релевантные Python проверки проходят. Настоящая модель здесь не запускается.
- [x] Документация различает функциональный local-мост, текущий legacy demo-путь и ещё не выполненную реальную квалификацию/полный NPC-AI.

## Результат

Минимальный мост реализован. После просьбы пользователя сократить объём архив, компактная память, отношения и приветствия не добавлялись.

`application.ts` создаёт один responder и заимствует его через `LocalLanguagePort`; borrowed-порт не имеет start/stop модели. Server-only context передаёт scope/player/request и исходный бюджет. Перед каждой генерацией выполняется авторизация, deadline вычисляется после await/последней проверки. Перевод — отдельная IPC-операция без persona/истории, с нормальным завершением и без усечения в успех. Оба worker используют уже загруженный runtime. Local NPC использует en/es, старый ordinary NPC остаётся ru; source/target перевода поддерживают ru/en/es. Readiness и отказ возвращаются в существующий механизм recovery без replay. Scripted без нужной capability отклоняется в composition после launcher overrides, не до применения BACKEND/MODEL. Test остаётся независимым явным режимом, не fallback.

### Проверки

- Runtime-фокус: **68 Python fixtures**, **20 TS translation cases**; остальные 121 TS случая не входили в фильтр. Проверены один worker для последовательных answer/translate, строгая IPC-проекция, bounds, normal finish, cancel/quarantine и rollback deadline.
- Bridge-фокус: **36 tests / 5 files** (`local-language-bridge`, `local-language-application`, `babylon-deadline`, `babylon`, `babylon-http-delivery`). Composition-тест использует настоящий HTTP/SQLite и fake responder: один factory/start/stop, BABEL NPC/словарь и ordinary NPC вызывают общий экземпляр, readiness отражает отказ; test работает независимо.
- После исправления раннего config-guard: **12 tests / 2 files** и type/import checks PASS. Полный suite не подменяется этим частичным прогоном.
- Основной агент: Python `-B -m unittest discover -s server/llm -p 'test_*.py'` — **93 passed**, лог `/tmp/npc-local-bridge-python.log`. Итоговый `VITEST_MAX_WORKERS=2 KUDA_TEST_PYTHON=/tmp/tokenizer-check.q9QYYJ/runtime/python/bin/python3 make server-test` — **622 passed / 42 files**, без пропусков; `npm --prefix server run check` — PASS. Helper: 33 specs / 49 tasks / 424 requirements, PASS; diff check — PASS. Лог: `/tmp/npc-local-bridge-final.log`. Клиент после этого среза не менялся: последний полный прогон 227 passed и check/import/build PASS записан в TASK-070; весь browser-набор остаётся незакрытым по TASK-044.
- Серверные TypeScript/import checks автора — PASS: 86 modules / 280 dependencies, без нарушений.

Нет результатов настоящего перевода, A2 или аппаратного benchmark; профиль квалификации не добавлен. Public BABEL v2, выбранные модели, timeout/RAM guards и private single-final поведение сохранены. Инструкция включения — server/README.md; менять нужно существующий config, не заменять подготовленные модели/пути.
