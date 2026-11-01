# Инструменты и Python-окружения

Команды ниже — из корня worktree. Проверить существующие инструменты до установки: `uname -s`, `uname -m`, `node --version`, `command -v uv`, `uv --version`. `type nvm` запускать в пользовательской оболочке; если функция не загружена, проверить `$NVM_DIR/nvm.sh`, `~/.nvm/nvm.sh`, пользовательские shell-настройки. Не заключать по одному `command -v`, что nvm не установлен.

## Node и JS

Для существующего nvm:

```sh
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
. "$NVM_DIR/nvm.sh"
nvm install 24
nvm use 24
node --version
```

Если nvm отсутствует, использовать [официальный install](https://github.com/nvm-sh/nvm#installing-and-updating), учитывая выбранный пользователем менеджер. Не менять default другой машины автоматически; по явному запросу: `nvm alias default 24`. Нужен именно >=24.15,<25, а не только путь с названием `node@24`.

```sh
make prepare
```

Эта команда устанавливает npm-зависимости и собирает клиент/мир; веса и Python не устанавливает. Выполнять до отключения сети. `make start` после подготовки пересобирает клиент и запускает production с парольным входом; `make server` запускает development без сборки.

## uv и Python

Если uv отсутствует, скачать официальный installer, просмотреть его и выполнить на этапе подготовки:

```sh
curl -LsSf https://astral.sh/uv/install.sh -o /tmp/kuda-uv-install.sh
less /tmp/kuda-uv-install.sh
sh /tmp/kuda-uv-install.sh
export PATH="$HOME/.local/bin:$PATH"
```

Установщик и платформы: [Astral](https://docs.astral.sh/uv/getting-started/installation/). Существующий uv не переустанавливать. Минимальная проверенная версия команд/lock — 0.8.13.

```sh
uv --version
uv python install 3.12
uv python find --no-python-downloads 3.12
```

Затем только выбранный backend:

```sh
make llm-prepare BACKEND=mlx
# либо make llm-prepare BACKEND=ollama
```

MLX: `~/kuda-llm/mlx-venv/bin/python3`; Ollama: `~/kuda-llm/venv/bin/python3`. Активация не обязательна. `prepare.mjs` создаёт marker принадлежности, синхронизирует lock и допускает повтор после частичной ошибки. Если каталог уже существует без marker этого backend, он отказывает до изменения файлов. Никогда не добавлять marker вручную к чужому окружению.

Иной каталог:

```sh
node server/llm/prepare.mjs mlx --environment "/absolute/new/mlx-venv"
```

Выбранный путь затем использовать во всех Python-командах/config. Разные backend не должны разделять окружение. Для повторной синхронизации остановить игру, чтобы не обновлять загруженные библиотеки.

## Offline и проверки без модели

```sh
node server/llm/prepare.mjs mlx --offline
make llm-lock-check
make llm-test
```

Offline-подготовка требует уже установленный Python и полный uv cache; lock не содержит wheel-файлы. Промах кеша — ошибка, не повод включать сеть во время игры. `make llm-test` запускает stdlib fixtures через локальный Python 3.12 без пакетов модели и без downloads.

Для server/shared acceptance подготовить Python явно, чтобы guide tests не были пропущены:

```sh
export KUDA_TEST_PYTHON="$(uv python find --no-python-downloads 3.12)"
make server-test
npm --prefix server run check
```

Разрешённое обновление зависимостей: менять `pyproject.toml`, выполнять `uv lock --project server/llm/envs/<backend>`, просматривать diff lock, затем тесты/новую квалификацию. Обычная установка не запускает `uv lock --upgrade`.
