---
id: TASK-030
type: implementation-task
status: in-progress
spec: ../specs/server-llm-runtime.md
requirements: [LLM-001–009, LLM-011–013, LLM-015]
related:
  - spec: ../specs/server-npc-dialogue.md
    requirements: [NPC-002–005, NPC-007]
depends_on: [TASK-025]
scheduling_note: интегрированный v1-срез с явным выбором backend; не завершает PROTO v2, TASK-017 или квалификацию TASK-018
---

# Настраиваемые backend LLM в существующем игровом сервере

## Цель и изменения требований

По запросу владельца подключить локальную LLM непосредственно к игре: оператор выбирает Ollama или MLX, а не получает жёстко выбранный backend/отдельный чат. Добавлен LLM-015: явная конфигурация, диагностика и интеграция v1. MLX технически требует Apple Silicon; несовместимость не приводит к скрытой смене backend. PROTO v1 сохраняется: один ответ в общем дедлайне 8–9 с. Полная потоковая система по-прежнему требует v2.

## Реализация

- [x] Зарегистрировать `ollama` и `mlx`, валидировать доверенные options, обеспечить readiness/отказ без остановки мира.
- [x] Реализовать owned Python worker: bounded IPC, точная токенизация, один ответ, физическая отмена, освобождение процессов, без runtime-загрузок и fallback.
- [x] Ollama: выделенный локальный runner, CPU/GPU-профиль оператора, pin версии/digest, raw prompt, bounded HTTP.
- [x] MLX: Apple Silicon, локальный text-only snapshot, pinned runtime, точный template, bounded generation.
- [x] Проверять budget и memory soft threshold; не выдавать sampled RSS за доказательство hard cap.
- [x] Связать недоступность/восстановление backend с сервисом/health; не повторять неудавшийся вопрос автоматически.
- [x] Общий контрактный набор разрешает подтверждённый loopback, но запрещает внешнюю сеть; интеграционные тесты game/HTTP/config.
- [x] Документировать конфигурацию обоих backend, подготовку до игры, один запуск игрового сервера и реальные границы.

## Приёмка

- [x] Серверные unit/integration, strict types/imports и Python syntax/fixture tests проходят; fake workers не называются модельными тестами.
- [ ] Настоящий запуск через игру, hardware RAM/скорость, network isolation и physical cancel каждого backend проверены на соответствующем пользовательском оборудовании. Без них задача не done.
- [x] При отсутствии пакетов/модели мир доступен, health unavailable, NPC не подменяется scripted.

## Диагностика первого запуска Intel Mac

- Пользователь сообщил: macOS 15.7.3/x86_64, Node24.22.2, Python3.12.8; официальный Ollama0.40.13 запускается на `127.0.0.1:11501`, cloud disabled, CPU, 8GiB total/1.6GiB available. Модель успешно скачана с проверкой digest, tokenizer smoke `Tokenizer OK, tokens: 15` пройден. Это пользовательские наблюдения, не hardware qualification.
- Первый запуск игры оставил мир доступным, но `/api/health` вернул NPC unavailable с общим `model_unavailable`. Точная причина не установлена; нельзя приписывать её памяти или несовпадению tokenizer без диагностики.
- Исправлен покрытый LLM-001/015 дефект: worker передаёт 14 фиксированных стадий startup и категории HTTP/token-count отказов; supervisor и service принимают только общий whitelist `failureCodes.ts`, произвольные поля не логируют. Для HTTPError читается ≤32KiB и распознаётся явный отказ runner по памяти, без выдачи body. После ready startup-stage очищается. Health/клиент остаются с общим unavailable. Защитные лимиты и raw/tokenizer проверки не ослаблены; стадия/категория диагностирует отказ, но не исправляет неизвестную причину автоматически.
- Дополнительные regression: Python — startup stages, cleared stage, HTTP bounded read/no-body exposure, token mismatch; Node — только allowlisted diagnostics, отказ публикации чужой строки/exception. Итоговый прогон patch: `npm --prefix server run check` PASS (48 modules/130 dependencies); `npm --prefix server test` **128 passed, 1 skipped**; Python discovery **25 passed** (18 Ollama/common +7 MLX). Syntax-only проверка всех shell/Python блоков `MAC-INTEL.md`, docs metadata/links/ranges/DAG и `git diff --check` — PASS. Make отсутствует, выполнен npm-эквивалент. Настоящий Ollama на сервере разработки не запускался.
- Инструкция Intel исправлена по наблюдениям пользователя: не запускать глобальный Homebrew upgrade; готовые official Node/Ollama с закреплёнными SHA вне проекта, уже установленный Python, HOME подготовительного daemon и HF cache также вне проекта. Существующий checkout обновляется без повторного clone; config/веса/venv не пересоздаются при диагностике. Повторный модельный запуск игры после patch ещё предстоит пользователю.

## Совместимость активного manifest Ollama 0.40.13

- Повторный пользовательский startup с диагностикой завершился `ollama_model_digest`. Локальные файлы и версия проверку прошли; это отказ до warmup, не подтверждение недостатка памяти.
- Пользовательские метаданные: legacy `manifests/registry.ollama.ai/library/qwen3.5/2b-q4_K_M` — regular Docker manifest с SHA `2fcba4e039b23928e05c8554adc262dbf5652d70bb20a36c947db9272c38c1dc`; он содержит config/model/projector/template/license/params и дополнительную manifest-layer со ссылкой на активный digest `1e2d21a4f03ab9e4a9c1976a4b7e88f21de61d65f2c5485d8fde8942be73f1e7`. Канонический `manifests-v2/ollama.com/library/qwen3.5/2b-q4_K_M` — symlink в `blobs`, content SHA равен второй строке; его config и payload layers совпадают, extra anchor-layer отсутствует.
- По исходнику official Ollama0.40.13 (`manifest/paths.go`, `server/model_list.go`) canonical manifests-v2 приоритетен, `/api/tags` возвращает активный digest. Ошибка адаптера — сравнение API с legacy-anchor SHA, а не проверенным активным объектом.
- Исправление LLM-003/013/015: разрешить строго локальную canonical v2-ссылку только на regular `blobs/sha256-<digest>` без symlink-цепочек/выхода из root, проверить raw SHA и все payload blobs. Сохранить действительный старый pin **только** при проверенной прямой hash/size связи legacy anchor → active manifest и одинаковых config/runner/format/payload layers. В остальных случаях mismatch/fail closed, не автоматический repin и не fallback на legacy вместо существующего v2. Неподдержанные manifest-list/ref форматы требуют отдельной квалификации, не угадываются.
- Новый рекомендуемый pin — SHA активного named manifest (canonical v2 при наличии, иначе legacy). Startup/API использует вычисленный verified active SHA. Пользовательский config с проверенным anchor-pin не надо менять; веса не скачиваются повторно. Защитные RAM/token/deadline/network проверки остаются прежними.
- Реализация: `verify_ollama_model` возвращает проверенный active SHA; named v2 приоритетен, invalid/dangling v2 запрещает legacy fallback. Старый anchor-pin принимается только с **ровно одной** прямой Docker manifest-layer. Active runnable manifest не содержит manifest-ref layers; дополнительные/duplicate/indirect anchors и schemaVersion float/bool отклоняются. Review нашёл первоначально слишком широкое удаление дополнительных anchors; исправлено с regressions до отправки.
- Проверки последнего patch: full `npm --prefix server run check` PASS (48 modules/130 dependencies), `npm --prefix server test` **128 passed, 1 skipped**; существующий временный CPython `-B -m unittest discover -s server/llm -p 'test_*.py'` — **44 passed**. Синтаксис shell/Python блоков инструкции, docs metadata/links/ranges/DAG и `git diff --check` — PASS. Make отсутствует, выполнен npm-эквивалент.
- `server/llm/fixtures/qwen35-2b-active-manifest.json` содержит **только 1088 bytes метаданных**, восстановленных из вывода пользователя; активный SHA и reconstructed1252-byte legacy SHA точно совпали. Regression проверяет metadata binding; реальные payload blobs здесь отсутствуют, для полноценной проверки используются маленькие синтетические blobs. Это не скачивание модели/весов и не модельный smoke.
- Остаточные gates: артефакты остаются доверенными и неизменными при работе daemon; отдельная проверка перед запуском и последующее чтение Ollama не атомарны. Реальный повторный warmup/calibration/игровой ответ и RAM на Mac ещё не проверены; исправлен именно выявленный pre-warmup mismatch, а не объявлена полная работоспособность модели.

## Результат

- Файлы: `server/src/npc/adapters/localLlm.ts` и регистрация обоих backend; `NpcResponder` optional status/lastFailure; service lifecycle/health recovery; config restriction concurrency1; Python workers/common, отдельные requirements; `server/llm/manifest.mjs`; 2 config examples; документация игры/архитектуры. Общий `contracts.ts`, game/realtime, shared и клиент не менялись. npm-зависимости не добавлялись. Это не восстановление старого standalone-установщика.
- Supervisor fixtures реализованы настоящими Node subprocess без inference: bounded IPC/UTF-8, один слот, exact deadline/монотонные часы, memory failures, startup/cancel/stop, cleanup quarantine, stale PID guard и Unicode-history trimming. Оба backend подключены к общему responderContract с real timers. Реальная память измеряется best-effort RSS Node+потомков/owned-group, soft3.5e9; это не hardcap/unified memory gate.
- Два положительных game integration scenarios используют новый supervisor с Node worker fixture и настоящие HTTP/Socket.IO/GameRuntime/SQLite: ответ доставлен после записи, следующие вопросы получают историю, другой игрок её не видит. Это интеграция порта, **не настоящий Ollama/MLX ответ**. Два дополнительных сценария используют реальные зарегистрированные factory с отсутствующими пакетами: мир/чат продолжают работать, NPC health unavailable, scripted fallback и фиктивной истории нет.
- Python mocks проверяют настоящий общий compiler, non-callable MLX TokenizerWrapper API, broken startup template, manifests/blobs, bounded HTTP/NDJSON, отказ thinking, calibration/count telemetry. MLX API изучен по официальному исходнику0.32.2, не проверен на Apple Silicon. Ollama требует совпадения count в3пробах и вкаждом ответе. **Остаточный gate:** эти пробы не доказывают универсальную HF/GGUF эквивалентность; фактический prompt_eval_count приходит после generation, значит точный admission до вычисления (LLM-004) для Ollama всё ещё unverified. Отказ по telemetry не считается доказательством, что лишние токены не обрабатывались. Prompt cache semantics также требуют настоящего runner.
- Read-only review закрыл блокирование startup мира при бесконечном cleanup (startup rejects, owned runtime остаётся quarantined) и отсутствие проверки template при MLX readiness. Разрушительные сигналы не посылаются после выхода лидера группы; незавершённый answer остаётся pending до подтверждения освобождения. Stuck runtime не вызывает бесконечный restart/replay.
- Последний полный прогон: `npm --prefix server run check` — PASS (server+shared TypeScript и import boundaries: 47 modules/128 dependencies). `npm --prefix server test` — **124 passed, 1 skipped** (11 test files passed); из них supervisor43, game integration8, lifecycle/network7, manifest4. Пропущенный `a-real-world.test.ts` требует собранного реального map fixture; отсутствие конфигурации не засчитывается за pass. `make` в среде отсутствует: выполнен прямой npm эквивалент `make server-test`.
- `/tmp/tokenizer-check.q9QYYJ/runtime/python/bin/python3 -B -m unittest discover -s server/llm -p 'test_*.py'` — **23 passed** (MLX7 + Ollama/common16), без моделей. Это mock/API контракт, не подтверждение установленных MLX или Ollama.
- Одноразовый `/tmp/check-local-npc-specs.cjs` (YAML parser среды Pi Pocket) — PASS: 24 specs, 29 tasks, 238 unique requirements; metadata/ranges/links/DAG и README dependencies. Checker дополнен поддержкой диапазона README `010–012`; исходный ложный mismatch TASK-026 был ошибкой checker, не зависимостей проекта. `git diff --check` — PASS. Клиент и shared не менялись; клиентские тесты/браузерный real-model smoke в этом срезе не запускались.
- **Unverified:** действительные пользовательские пакеты/weights, Apple Silicon/Intel/Windows qualification, фактический model response в игре, hard4GB peak/unified RAM, physicalstop всех потомков, endpoint OS isolation, полный offline network trace, p95/burst/quality/grounding. Windows supervisor не реализован. Полный AI/PROTOv2 не реализован. Реальная приёмка остаётся unchecked; TASK-030/017/018 не получают done.
- По запросу владельца перед отправкой добавлена `server/llm/MAC-INTEL.md`: команды подготовки отдельного Ollama-каталога, закреплённого tokenizer без вторых весов, local-only smoke и автоматического заполнения примера config (create-only). Подготовительные команды написаны для целевого Mac, здесь не исполнялись и не объявлены проверенным installer. Source Python-блоков прошёл syntax-only compile, Markdown-ссылки и `git diff --check` проверены.
- **Ограничение владельца соблюдено:** Ollama на сервере разработки не запускался, веса не скачивались, пакеты MLX/Ollama не устанавливались. Тесты Python выполнялись существующим временным CPython, не системной установкой. Команды README предназначены оператору целевой машины; фактом выполнения здесь не являются.
