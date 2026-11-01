---
id: TASK-046
type: implementation-task
status: in-progress
spec: ../specs/server-llm-runtime.md
requirements: [LLM-001–015]
related:
  - spec: ../specs/server-npc-dialogue.md
    requirements: [NPC-002–009]
  - spec: ../specs/server-foundation.md
    requirements: [SERVER-003–005, SERVER-009]
  - spec: ../specs/protocol.md
    requirements: [PROTO-006–009]
depends_on: []
---

# Синхронизация LLM-документации и интеграция актуального main

## Основание и границы

Пользователь поручил синхронизировать все LLM-спеки с кодом, написать инструкцию установки на собственном компьютере с нуля, затем интегрировать актуальный main через rebase и проверить результат. Работа только в npc-llm-clean-start; main не изменяется. Настоящий Ollama/MLX/inference/веса на сервере Pi запрещены; доступны mocked workers, локальный scripted game и браузерные fixtures. Непроверенное оборудование не объявляется квалифицированным.

Исходная опубликованная ветка ed7532c (Make timeout), локальное свидетельство302b814. Полученный main398d2fb содержит PROTO v3/MOVE, BABEL, общую GenerationQueue, opt-in NPC partial/cancel, окружения, парольный AUTH и OBS. Резервная ветка backup/npc-llm-before-main-sync-20261101 сохраняет состояние до rebase. История нашей ветки переписывается; публикация только с explicit force-with-lease на прежний remote tip, не force и не push main.

Существовавший TASK-030 LLM переименован в TASK-045: main уже использует TASK-030 для world-next-stage. Исторические commit IDs и доказательства не переписываются как новые результаты.

## План и приёмка

- [x] Сверить runtime/backend/model/pins/token limits/очередь/deadline/diagnostics с кодом; отделить планы квалификации и клиентские handoffs от реализованного. Все ссылки и ID однозначны.
- [x] Написать server/llm/SETUP.md для чистой установки, с matrix ОС/backend и явными непроверенными путями. Разделить online preparation/runtime offline, fresh config/существующая установка, Make profile/timeout и импортер старых конфигов.
- [x] Сохранить main AUTH/env/OBS/MOVE/BABEL/PROTO3 и server stream API. Сохранить LLM prepared profiles, guarded owned runtime, fail-closed memory, cancellation/quarantine и runtime-unavailable/recovery без повтора вопроса.
- [x] Одна GenerationQueue для NPC и BABEL; монотонный deadline не восстанавливается после rollback, pending слот не освобождается до окончания физического cleanup. HTTP metadata и клиентский timeout остаются согласованы, ordinary pending10с.
- [x] main environment CLI/Make и LLM flags работают вместе; examples/defaults/guides согласованы. Production name-only UI не объявляется готовым: TASK-044 остаётся открытым. Client NPC streaming TASK-041 также не входит в этот срез.
- [x] После semantic merge выполнить server/shared tests, client tests, Python fixtures, strict types/imports/build, relevant browser/integration/CLI checks и проверку docs. Фиксировать конкретные ошибки/недоступные проверки, не скрывать их как PASS.
- [ ] Проверить diff against origin/main: изменения main не потеряны, версия wire3 не откатилась, main ref не менялся. Проверить чистоту worktree и безопасно опубликовать нашу ветку.

## Проверки и review

- Клиент: 211 unit tests/24files, typecheck/import/build PASS (предупреждение о большом bundle). Scoped Chromium NPC timeout: PASS, HTTP metadata и текущий OnlineSession получили60000мс.
- Расширенный serial Chromium запуск npc-timeout + server-auth: **3/6PASS**. Вход/отмена/малый экран и401/session expiry PASS. Takeover и chat/NPC-memory ждут ready второй страницы; BABEL market истёк при закрытии welcome. Причина пока не установлена; расширенный UI suite не считается PASS. Worker только scripted, HOME/config изолированы, новый main startup marker.
- Независимый read-only review обнаружил несовпадение deadline решений: BABEL мог commit после monotonic expiry до внешней проверки очереди. Исправлено optional внутренним budget (не wire) и проверкой после async authorize перед transaction. 6 regressions + прежний BABEL suite:16PASS; удержание физического слота сохранено.
- Fresh-install guide проверяется только на inert temp fixtures:17 targeted tests PASS; tokenizer preparation AST-only, MLX metadata-only, никаких весов/инференса.
- Первый нескоординированный общий server run остановлен tool timeout120с, с ошибкой AUTH S10 rate-limit. Отдельный полный прогон без browser/build воспроизвёл точно1ошибку при529PASS: `expected Array(400) to include429`. Тест последовательно посылал400HTTP requests дольше2с, за которые реальные50tokens/s пополняли burst300; это не одномоментный flood. Исправлен только тест: инъецируемый systemClock фиксируется на время400реальных HTTP запросов, проверяются ровно300success/100rate-limit, затем clock+100ms и следующий200. Runtime limiter, AUTH и watchdog не менялись. Полный повторный прогон ниже.
- YAML/ID/links/dependency checker:31specs/45tasks/383requirements PASS. Номера main TASK-030/041/044 сохранены; LLM task переименован в045.
- Worker/supervisor/diagnose code побайтово не изменён относительно backup302b814. Остановленная telemetry не реализована. Общая application composition остаётся main398d2fb; contracts и protocol validators не изменены.

### Итоговая приёмка 2026-11-01

На semantic integration tree7ec3683 выполнено последовательно, без параллельного browser/build:

```sh
export KUDA_TEST_PYTHON=/tmp/tokenizer-check.q9QYYJ/runtime/python/bin/python3
npm --prefix server run check
make server-test
"$KUDA_TEST_PYTHON" -B -m unittest discover -s server/llm -p 'test_*.py'
make client-test
npm --prefix client run check
npm --prefix client run check:imports
npm --prefix client run build
node --check server/llm/diagnose.mjs
node /tmp/check-local-npc-specs.cjs
git diff --check
```

- Server/shared: **530PASS/36files**, без skipped; включает17guide fixtures и6BABEL deadline regressions. Types/imports PASS:85modules/276dependencies.
- Python mocked/structural fixtures: **83PASS**,18с; реальная модель/daemon/inference/diagnose CLI не запускались.
- Client: **211PASS/24files**; Svelte0errors/0warnings, строгие types/core/imports PASS:100modules/298dependencies; build PASS,922.79kB JS/251.29kB gzip и предупреждение chunk>500kB (это не FPS/memory qualification).
- После тестов main продвинулся398d2fb→**09fd7710c802dcda6b134dd1c988714ac79b9c8d** только на4документа/макет TALK. Выполнен дополнительный rebase;2README conflicts объединены вручную с сохранением новой TALK-ссылки и текущего PROTO3/streaming описания. Runtime/tests/config/dependencies дерева после rebase совпадают с проверенным7ec3683; diff содержит только5docs/image файлов. Затем добавлено пояснение о целевом draft TALK, без изменения требований.
- Финальный docs checker после нового main: **32specs/45tasks/397requirements PASS**. Links/YAML/IDs/dependency DAG и diffcheck PASS.
- Browser итог остаётся **3/6**, а не общий PASS: scoped timeout PASS; три расширенных сценария не дошли до целевых assertions. Сохранённые traces не содержат recorded console/page/HTTP errors; причина задержек не установлена, регрессия или software rendering не доказаны. Расширенный UI retest остаётся отдельной незавершённой проверкой, не скрыт fixture/юнитами.
- Независимый reviewer повторно подтвердил ограниченный BABEL fix и детерминированный AUTH fixture: новых static blockers не найдено.

Публикация ещё не выполнена. `refs/heads/main` локально остаётся02eb786; worker/watchdog код не менялся. TASK017/018/045 остаются in-progress. TASK041/044 не закрывались.

## Ограничения результата

Последний Mac прислал применение Ollama2B/CPU2threads/timeout120000 и transient memory_sample_ps_timeout с последующим ready. Отдельные12ps samples34–44мс не устанавливают причину. Пользователь сообщил, что локально заработало, но финального текста/timing нет. Предложенная расширенная watchdog telemetry остановлена пользователем до реализации и не добавляется при синхронизации. Политическая тема вопроса не доказана причиной технического сбоя. TASK017/018/045 не становятся done от документации, rebase или fixture tests.
