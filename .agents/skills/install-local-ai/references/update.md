# Обновление готовой установки

Сначала `server/llm/UPDATING.md`: остановить игру, сохранить согласованный backup SQLite/config/profiles. Новая ветка/worktree не переносит ignored config и БД сама. Рабочие веса, tokenizer, hashes и venv не трогать ради обновления исходников.

Legacy Python-окружение продолжает работать с прямым абсолютным interpreter path. Не запускать uv sync поверх него: exact sync может удалять лишние пакеты. Подготовить новый путь командой `prepare.mjs --environment`; после проверки обновить **только `options.python`** у нужного профиля (или `npc.options.python` прямого config). Если есть profiles.json, он имеет приоритет над npc.options. Старое окружение оставить для отката. Не пересоздавать каталог профилей через importer.

Окружение с `.kuda-uv-environment.json` того же backend допускает повторный `llm-prepare` при остановленной игре. Lock не обновляется командой установки. Путь к интерпретатору uv-managed Python может вести за пределы venv: сохранить сам Python при переносе машины; копирование только venv не является переносимой поставкой.

После новой версии кода пересобрать клиент: `npm --prefix client run build`. Проверить выбранную карту, парольный вход production, статус runtime и реальный ответ. Отказ package/version/hash/model guards исправлять подготовкой правильного артефакта, не fallback на scripted/test. Большой NPC_TIMEOUT не увеличивает 30-секундное ожидание HTTP BABEL-клиента.
