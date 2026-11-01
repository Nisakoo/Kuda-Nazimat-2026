---
id: TASK-082
type: implementation-task
status: done
spec: ../specs/server-llm-runtime.md
requirements: [LLM-003, LLM-014, LLM-015, LLM-022]
depends_on: []
---

# Подготовка локального ИИ через uv и установочный скилл

## Цель и изменения требований

По запросу пользователя перевести Python-подготовку MLX/Ollama на uv в отдельном worktree и добавить проектный установочный скилл. Добавить LLM-022: раздельные зафиксированные зависимости, повторяемая подготовка через uv, сохранение прежних установок и прямой offline-запуск Python. Node/npm, модели и игровой протокол не меняются.

## Реализация

- [x] Раздельные pyproject.toml/uv.lock для Ollama и MLX, Python 3.12.
- [x] Команда подготовки нового/собственного окружения с отказом изменять чужое или legacy-окружение; offline-подготовка только из кеша.
- [x] Команды проверок Python через uv, сохранение прямого interpreter path в runtime.
- [x] Установочный скилл и сценарии инструментов, MLX, Ollama, обновления и диагностики.
- [x] Актуализировать действующие инструкции; исторические результаты оставить историческими.
- [x] Исправить обнаруженные при приёмке macOS-fixtures (канонический temp path, настоящий lsof) и loopback preflight диагностики LLM-014, не ослабляя ownership/hash guards.

## Приёмка

- [x] LLM-022 / S7: подготовка и повторный запуск в отдельном временном каталоге, защита существующих файлов, ошибка неправильного backend/платформы и offline-промаха.
- [x] LLM-003: игровой runtime не вызывает uv и не синхронизирует пакеты.
- [x] Lock-файлы согласованы; фактическая установка закреплённых Python-пакетов проверена отдельно от модели.
- [x] make server-test, server/shared type/import checks и Python fixtures.
- [x] Скилл проходит quick_validate; его ссылки и команды согласованы с репозиторием.

## Результат

Worktree `/private/tmp/competition-2026-uv-local-ai`, ветка `build/uv-local-ai`, база main `6938f9d`. Клиентские tracked-файлы не изменены. Python-пакеты установлены только во временные тестовые окружения; пользовательские config/profiles/БД/веса не изменялись.

- Раздельные uv-проекты `server/llm/envs/{mlx,ollama}` заменяют requirements-файлы. Подготовка — `prepare.mjs`/`make llm-prepare`; проверки — `make llm-test`, `make llm-lock-check`. Runtime по-прежнему запускает Python напрямую.
- Скилл `.agents/skills/install-local-ai` содержит сценарии инструментов/nvm/uv, MLX, Ollama, переноса legacy-установки и скрипт с отдельными download/convert/check. Модель и source revision закреплены прежним решением; новый выбор модели не введён.
- Устаревшее описание отсутствующего BABEL local bridge исправлено; сохранён текущий 30-секундный HTTP timeout рынка. Проверка документации теперь проверяет существующий local-мост.
- macOS-приёмка выявила дефекты прежних fixtures: `/var` alias в допустимой absolute-link fixture и перехват lsof через общий mocked Popen. Исправлены только fixtures, реальные guards сохранены. Диагностический preflight дополнен loopback binds: macOS допускает wildcard bind рядом с конкретным listener.

### Проверки 2026-11-01

Среда: macOS arm64, Node 24.22.2 из nvm, uv 0.8.13, uv-selected CPython 3.12.11. Установлены зависимости server/client по неизменным npm lock-файлам; для server world tests выполнен `npm --prefix client run world:generate` (tracked client diff пуст).

- `UV_CACHE_DIR=/private/tmp/competition-2026-uv-cache uv lock --project server/llm/envs/{backend}` — locks разрешены из PyPI. `make llm-lock-check` — PASS для обоих backend.
- Реальные `prepare.mjs ollama --environment /private/tmp/competition-2026-uv-ollama` и `prepare.mjs mlx --environment /private/tmp/competition-2026-uv-mlx` — PASS. Повтор обоих с `--offline` — PASS; новый MLX env целиком из кеша — PASS. Пустой кеш с `--offline` — ожидаемый exit 1 с явной ошибкой недоступного пакета, без success.
- Фактические пакеты: Ollama Transformers 4.57.6/Jinja2 3.1.6; MLX-LM 0.32.2, MLX/Metal 0.32.4, Transformers 5.22.1/Jinja2 3.1.6. Проверен `Runtime._check_api` на установленных MLX API без весов/inference — PASS.
- `VITEST_MAX_WORKERS=2 KUDA_TEST_PYTHON=<uv python find 3.12> make server-test` — **687 passed / 46 files**, без skips; [лог](evidence/uv-setup/server-tests.txt).
- `make llm-test` — **97 passed, 1 skipped** (98 scenarios): skip относится к Linux-only bound-port semantics, на macOS не считается проверенным; [лог](evidence/uv-setup/python-tests.txt). Новые 5 skill fixtures проходят без пакетов модели/сети/весов.
- `npm --prefix server run check` — PASS: TypeScript server/shared, 96 modules / 331 dependencies без нарушений.
- `skill-creator/scripts/quick_validate.py .agents/skills/install-local-ai` — PASS с Python временного Ollama env (PyYAML из lock). Проверены локальные markdown-ссылки, `node --check` обоих mjs и `git diff --check`.

Первый sandbox-прогон не принят: macOS блокировал loopback bind и системный API uv. Повтор разрешённых fixture-проверок вне sandbox прошёл. Первоначально server suite обнаружил отсутствующий generated world и указанные ошибки; после подготовки/исправлений выполнен полный успешный повтор.

Загрузка весов, конвертация, реальный MLX/Ollama inference, качество/скорость/RAM и физическая offline/LAN-приёмка не входят в эту миграцию и **не проверены**. Установка и API-проверка библиотек не квалифицируют модель. Общая implementation-метка LLM-спеки остаётся partial.
