# Ollama

Читать после `tools.md`. Backend выбирается явно; на Apple Silicon допустим Ollama, на Intel MLX не подменяет его. Windows worker отсутствует.

1. `make llm-prepare BACKEND=ollama` готовит Python/tokenizer dependencies через uv. Native Ollama остаётся отдельной программой. Уточнить существующий executable и версию; проверенный исторический Intel layout и архивы — `server/llm/MAC-INTEL.md`, §1. Не устанавливать второй daemon или другой runtime поверх рабочего автоматически.
2. Выполнить **§4 `server/llm/SETUP.md`**: выделенный model store, подготовительный daemon на `127.0.0.1:11501`, явный tag `qwen3.5:2b-q4_K_M`, сохранение API-версии. Только по запросу — `qwen3.5:0.8b-q8_0`. После pull остановить свой подготовительный daemon.
3. **§5 SETUP**: скачать только tokenizer/config/template из закреплённой HF revision, обычными файлами; создать отдельный manifest. 2B: `15852e8c16360a2fea060d615a32b45270f8a8fc`; 0.8B: `2fc06364715b967f1860aea9cf38778875588b17`. Не скачивать вторые HF-веса для Ollama.
4. **§6 SETUP**: создать config проверяемым блоком, который вычисляет полный modelDigest и проверяет blobs/inventory. Не подставлять короткий ID из `ollama list`, не переписывать существующий digest ради прохода.
5. **§7 SETUP**: необязательно создать profiles.json для `BACKEND/MODEL`. `make llm-import` — перенос существующих 2B/0.8B configs, не установка модели.
6. После сборки игры и готового config: `make start NPC_TIMEOUT=30`. С профилем: `make start BACKEND=ollama MODEL=2b NPC_TIMEOUT=30`. Рынок требует `language.adapter: local`; иначе остаётся test.

Во время игры `serve` запускает worker; не запускать `brew services start ollama` или пользовательский сервис на том же порту. При отказе проверить точную startup-категорию, `/api/health`, выбранный профиль, port ownership, Python/pins. Не завершать чужие процессы и не обходить проверки модели. Реальные скорость, RAM и OS-изоляция не следуют из успешной установки.
