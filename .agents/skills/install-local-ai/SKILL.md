---
name: install-local-ai
description: Install, update or troubleshoot this game's local MLX/Ollama setup with uv, prepared model artifacts and server profiles. Use for game installation and local AI setup; not for generic Python projects or NPC behavior changes.
---

# Установка игры и локального ИИ

Работать из корня выбранного checkout/worktree. Источники требований: `specs/server-llm-runtime.md`, `server/llm/SETUP.md`; зависимости: `server/llm/envs/{mlx,ollama}/pyproject.toml` и `uv.lock`. Скилл хранится в репозитории и не требует глобальной установки.

## Определить маршрут

1. Проверить `git status`, ОС/архитектуру, Node, uv, существующие `server/config.json`, `~/kuda-llm/profiles.json` и пути выбранного профиля. В новом worktree ignored config и БД не появляются автоматически. Не копировать живую SQLite как один файл: использовать существующий backup CLI.
2. Учитывать явно выбранный пользователем backend. MLX — macOS arm64; Ollama worker — macOS/Linux arm64/x64. Если выбор отсутствует, уточнить его; не считать архитектуру согласием на другой backend. Windows supervisor отсутствует.
3. Готовую установку сохранять: сначала [обновление](references/update.md). Для новой читать [инструменты](references/tools.md), затем только [MLX](references/mlx.md) либо [Ollama](references/ollama.md).
4. Для вопроса «как установить» дать команды с реальными путями. Для просьбы выполнить установку исполнить выбранный маршрут и проверить результат. Наличие этого скилла само по себе не разрешает скачивать другую модель, публиковать файлы или менять пользовательские shell-настройки.

## Зафиксированный выбор

- Node >=24.15,<25; предпочитать существующий nvm, который является shell-функцией и может отсутствовать в неинтерактивной оболочке. Не начинать с Homebrew или новой standalone-установки Node.
- Python 3.12 через uv. Подготовка: `make llm-prepare BACKEND=mlx|ollama`; эта команда устанавливает только зависимости. Отдельный Python остаётся необходимым для workers.
- MLX-LM **0.32.2**, Qwen3.5-2B post-trained, **text-only 4-bit/group64**. Исходник `Qwen/Qwen3.5-2B`, revision `15852e8c16360a2fea060d615a32b45270f8a8fc`. Не искать новую модель вместо этой без запроса пользователя.
- Ollama: `qwen3.5:2b-q4_K_M`; только при явном выборе — `qwen3.5:0.8b-q8_0`. Версия native runner и digest принадлежат подготовленному профилю. Веса Ollama и HF tokenizer отдельны.

## Граница подготовки и игры

`uv sync --locked` работает до игры. Runtime запускает абсолютный `npc.options.python` напрямую: не заменять его на uv, shell-строку или путь к `uv run`. Игра не скачивает Python, зависимости или веса. Одна модель, одна очередь; не запускать дополнительный `mlx_lm.server` или ручной `ollama serve` во время игры.

На рынке нужны `defaultMap: market` и `language: {adapter: local, options: {}}`; без второго поля остаётся test. Сохранять остальные поля config и учитывать приоритет `profiles.json`. В игре выбирать изучаемый en/es. HTTP BABEL-клиент ждёт 30 с независимо от большего `NPC_TIMEOUT`; обычный socket NPC получает срок сервера +2 с.

## Проверка результата

После пакетов проверить версии, после весов — структуру/manifest, затем реальный startup и ответ. `npc: ready` в `/api/health` означает startup, не квалификацию качества/RAM. Различать установленное окружение, подготовленную модель и проверенный игровой ответ. При ошибке не объявлять успех, не ослаблять hash/platform/version guards и не подменять backend на test.

Скрипт [scripts/mlx_model.py](scripts/mlx_model.py) выполняет раздельные шаги download/convert/check. Он не создаёт config, не меняет профили и не доказывает аппаратную приёмку. Команды настройки и запуска находятся в backend references. Тесты миграции uv не скачивают веса и не считаются настоящим MLX/Ollama-прогоном.
