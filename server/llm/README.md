# Локальная LLM внутри игры: Ollama или MLX

Это реализация **адаптеров существующего игрового сервера**, не отдельный чат и не установщик. Выбор делает оператор в `server/config.json`: `npc.adapter: "ollama"` либо `"mlx"`. `scripted` остаётся явно выбранной заглушкой по умолчанию. Автоматического выбора по компьютеру и fallback нет.

**Готовность к интеграции не равна квалификации модели.** Код подключён к реестру/сервису/SQLite/health. Реальные модели на этой машине не запускались; Ollama запускать на сервере разработки запрещено владельцем. Проверки здесь используют fixtures. Реальный ответ, пик RAM, скорость, физическая отмена и OS-изоляция проверяются на компьютере оператора. Непроверенный профиль не надо выставлять недоверенным LAN-игрокам.

Пошаговые команды для пробного запуска на Intel Mac: [MAC-INTEL.md](MAC-INTEL.md). Это ручная процедура подготовки пакетов/весов/tokenizer и pins/config без перезаписи существующего файла. На одном Intel Mac подтверждён startup Ollama, но игровые ответы пока истекали по deadline: успешный диалог/скорость/RAM не квалифицированы. Уже подготовленные файлы повторно скачивать или пересоздавать для обновления кода не нужно.

## Выбор backend

| Выбор | Требования | Кто выбирает |
|---|---|---|
| `ollama` | Подготовленные Ollama, Python/tokenizer, локальные веса; supervisor реализован для macOS/Linux POSIX | Оператор. `numGpu: 0` — CPU, положительное значение — явный профиль offload, который надо отдельно измерить |
| `mlx` | Только macOS Apple Silicon, Python с `mlx-lm==0.32.2`, локальный text-only Qwen3.5-2B 4-bit/group64 | Оператор. На Intel вернётся unavailable, а не переключение на Ollama |
| `scripted` | Модель не требуется | Явная заглушка; не доказательство LLM |

Windows supervisor в этом срезе отсутствует; Windows из общей LLM-спеки остаётся unverified/not implemented. Сам выбор `ollama` не доказывает совместимость установленного runner/CPU/ОС. Для Intel Mac первая измеряемая конфигурация — CPU, но оператор может выбирать любой **совместимый** backend. Нельзя заставить MLX работать на Intel одной настройкой.

## Один путь запуска игры

1. **До игры** подготовить выбранный runtime и модель по разделам ниже. Интернет допустим только на этом этапе, не во время gameplay. Ничего автоматически не скачивается.
2. Скопировать подходящий пример: `server/config.ollama.example.json` или `server/config.mlx.example.json` → **`server/config.json`**. Заменить все `/absolute/...` и `REPLACE_...` на реальные значения. Неполный профиль отклоняется, не подменяется заглушкой. `config.json` исключён из git.
3. Подготовить зависимости Node 24 и клиент: `npm --prefix server ci`, `npm --prefix client ci`, `npm --prefix client run build`.
4. Запустить **`make server`** либо **`npm --prefix server start`**. Вход в игру — **http://localhost:8080/**. `make demo` также использует этот config, но при необходимости устанавливает npm-зависимости/собирает клиент, поэтому выполняется до offline-демонстрации.
5. Дождаться `NPC готов к вопросам {"status":"ready"}` в серверном терминале и проверить **http://localhost:8080/api/health**: `npc: "ready"` означает, что выбранный worker прошёл startup, но не доказывает скорость ответа. Затем войти по имени, подойти к персонажу и задать вопрос. Вопрос и ответ сохраняются сервером, не worker.

Примеры привязаны к `127.0.0.1`, чтобы случайно не открыть непроверенный профиль в LAN. `host: "0.0.0.0"` оператор включает отдельно после нужных проверок. Native Ollama port не является игровым адресом.

## Подготовка Ollama

- Установить выбранную **закреплённую** версию Ollama на поддержанную ОС. Сохранить полный layout runner/библиотек, не копировать только случайный executable. `executable` — абсолютный путь к нему; `runnerVersion` — фактический `x.y.z` установленной версии.
- Подготовить **отдельный** каталог `modelsDir` с `qwen3.5:2b-q4_K_M`. Модель должна быть полностью скачана до игры. Не направлять worker на порт/каталог одновременно работающего пользовательского daemon. Worker сам запускает `ollama serve`, но никогда `pull/create`.
- В отдельном Python venv установить `server/llm/requirements-ollama.txt`: Transformers 4.57.6 и Jinja2 3.1.6. Установка выполняется оператором заранее; при наличии подготовленного wheelhouse можно использовать `pip install --no-index --find-links /wheelhouse -r server/llm/requirements-ollama.txt`. Транзитивные пакеты поставки нужно закрепить отдельно; этот файл не является полным wheel lock.
- Подготовить обычные локальные файлы tokenizer/config/chat template от **того же post-trained Qwen/Qwen3.5-2B**, не Base. Не нужны вторые веса Hugging Face для Ollama. Каталог должен поддерживать `AutoTokenizer.from_pretrained(...local_files_only=True, trust_remote_code=False)`.
- Зафиксировать snapshot tokenizer без symlinks командой (она не запускает модель):

  ```sh
  node server/llm/manifest.mjs /absolute/tokenizer /absolute/tokenizer-sha256.json
  ```

- Полный `modelDigest` — SHA-256 **bytes активного локального manifest**, не сокращённый ID из списка. У Ollama0.40.13 приоритетен `modelsDir/manifests-v2/ollama.com/library/qwen3.5/2b-q4_K_M`; при его отсутствии — старый `modelsDir/manifests/registry.ollama.ai/library/qwen3.5/2b-q4_K_M`:

  ```sh
  shasum -a 256 /absolute/dedicated-ollama-models/manifests-v2/ollama.com/library/qwen3.5/2b-q4_K_M
  # Только если canonical v2 отсутствует:
  shasum -a 256 /absolute/dedicated-ollama-models/manifests/registry.ollama.ai/library/qwen3.5/2b-q4_K_M
  ```

  Canonical v2 может быть ссылкой на blob. Worker допускает **только** конечную ссылку на regular-файл в том же `modelsDir/blobs/sha256-<digest>`, проверяет hash имени/bytes и отвергает цепочки/выход за root/symlink-родителей. Это не ослабляет запрет symlinks для HF tokenizer/MLX snapshot. Если конфиг создан старой инструкцией и pin указывает на legacy downgrade-anchor, он принимается лишь при ровно одной прямой проверенной hash+size связи anchor → active manifest и совпадении config/runner/format/payload layers. Другие manifest-ссылки и вложенные графы в этом срезе отклоняются. Старый pin не переписывается автоматически. Другой active manifest и неподдержанные manifest-list/ref формы дают unavailable, а не fallback.

Worker проверяет активный manifest и хеш/размер каждого model/config/projector/template blob до запуска runner, затем версии и **проверенный active digest** HTTP API. Legacy-anchor и active digest не обязаны совпадать; без проверенной криптографической связи это отказ. До ready выполняет 3 коротких raw-пробы с русским/ASCII/emoji и сравнивает HF count с `prompt_eval_count` Ollama. Для каждого игрового ответа count также должен совпасть и быть ≤1792; отсутствующая/другая метрика отклоняет ответ. Реальная семантика `prompt_eval_count` при кешировании и полная tokenizer/GGUF-эквивалентность **не проверены**, поэтому эти проверки могут безопасно отказать даже на совместимом артефакте. Архивы и фактическое соответствие tokenizer/GGUF нужно проверить при подготовке; совпадение хешей и несколько проб не доказывают происхождение модели, универсальную эквивалентность или корректность её ответов.

Порт `11501` должен быть свободен. CPU/GPU: `numGpu` по умолчанию 0; `threads` по умолчанию 2. Положительный `numGpu` — отдельный измеряемый профиль, не гарантия доступности ускорителя. Vision/projector в пакете Ollama не считается бесплатным для RAM; фактическую загрузку надо измерить.

## Подготовка MLX

- На Apple Silicon создать отдельный Python venv и заранее установить `server/llm/requirements-mlx.txt` (`mlx-lm==0.32.2`, Jinja2 3.1.6). Установленная версия должна совпадать с `runnerVersion`.
- Подготовить локальный text-only Qwen3.5-2B post-trained, 4-bit/group64. Обычный VLM snapshot не принимается. Кандидат конвертации закреплённой исходной модели **до игры**:

  ```sh
  /absolute/mlx-venv/bin/python3 -m mlx_lm.convert \
    --hf-path /absolute/local/source \
    --mlx-path /absolute/qwen35-2b-text-4bit \
    -q --q-bits 4 --q-group-size 64
  ```

  Это изученный по API, **не выполненный здесь** путь. Конвертация может требовать больше 4 GB и выполняться на более мощной машине. Проверить результат: `model_type=qwen3_5`, quantization 4/group64, отсутствие vision/audio config и tensors. Не маскировать VLM удалением полей config. Удалить скопированные исходные `.py`, сохранить tokenizer/template/license/provenance. Самостоятельная правка весов не предлагается.
- Создать manifest уже подготовленного snapshot:

  ```sh
  node server/llm/manifest.mjs /absolute/qwen35-2b-text-4bit /absolute/model-sha256.json
  ```

- Заполнить `modelDir`, `modelManifest`, путь Python в MLX config. Worker сверяет все файлы, проверяет metadata и API, загружает модель один раз и делает короткий прогрев. Генерация получает IDs точного rendered prompt, без второго template.

Manifest — инструмент закрепления **доверенного подготовленного** артефакта, не подпись издателя. Он не перезаписывает существующий файл. При смене модели сначала согласовать новый профиль/manifest, а не автоматически переписать pin при старте.

## Поведение во время игры

- Общий `NpcResponder` не заменён. Реестр: `server/src/npc/adapters/index.ts`; реализация supervisor: `localLlm.ts`; workers: `server/llm/ollama_worker.py`, `mlx_worker.py`; сервис и БД остаются существующими.
- Один owned Python worker и одна модель, `maxConcurrent: 1`, ≤4 unfinished, ≤1 на игрока. Попытка включить `maxConcurrent: 2` для этих backend отвергается до запуска: профиль 2 не квалифицирован.
- `start` включает проверку файлов/версий и прогрев (по умолчанию до 120 с). HTTP игры открывается после завершения startup либо его контролируемого отказа. Ошибка отсутствующего пакета/модели оставляет мир работающим с NPC unavailable. Невалидная конфигурация, наоборот, отклоняется до запуска мира.
- Токенизация локальна; template с `enable_thinking=False`, вход ≤1792, контекст 2048, выход ≤128. Старые пары истории удаляются первыми, профиль и текущий вопрос не удаляются. На wire IPC ≤64 KiB, итоговый текст ≤16 KiB; сервис выдаёт ≤4000 символов.
- Промпт задаёт мягкую цель1–2коротких предложения/до20слов, не обрезая ответ по словам. Private Ollama IPC progress содержит только bounded stage/counters, не текст; локальный `Этапы ответа NPC` помогает различить подготовку, ожидание первого текста и продолжение generation. Это не streaming клиенту и не доказательство скорости. Подробные поля и ограничения — в [MAC-INTEL.md](MAC-INTEL.md).
- **Общий deadline v1 — 8 с (максимум 9), вместе с очередью; клиент — 10 с.** Он не увеличен. Четыре медленных CPU-вопроса не обязаны успеть; это не полноценные burst-цели v2. Timeout не сохраняет частичный ответ.
- Отмена закрывает owned вычисление, а не только HTTP. PROMISE answer завершается после подтверждения остановки owned group. Неподтверждённая остановка удерживает слот и запрещает новый runtime. Старые/чужие PID не должны получать destructive signals. Реальный process tree каждого runner ещё проверяется отдельно.
- Живой status участвует в `/api/health`. После runtime failure сервис отклоняет queued-вопросы без записи, сохраняет работоспособность мира и после освобождения слота делает одну попытку восстановления через 2 с. Неудачная попытка не запускает бесконечный цикл; новый вопрос в unavailable возвращает ошибку и может инициировать следующую попытку. Старый вопрос **никогда автоматически не повторяется**. Для scripted политика не меняется.
- RAM watchdog считает Node и потомков, включая доступные reparented group members, с soft threshold 3 500 000 000 байт; ошибка метрики — отказ. **Это не hard cap/PSS/доказательство пика ≤4 GB**, особенно для unified GPU memory и detached-потомков. Нельзя принимать модель по одному размеру файла.
- Ollama использует отдельный loopback listener, проверку владения PID, cloud-off, raw prompt и закреплённые файлы. **Это не квалифицированный OS-барьер** от другого локального браузера/процесса/DNS rebinding; не выдавать loopback за авторизацию. Для production/LAN qualification нужен LLM-005 gate.

## Границы содержания и версии

Этот v1-срез использует серверный профиль NPC и историю пользователя. Он **не реализует** FTS5 grounding, утверждённый учебный корпус, память/preferences/reset/ledger, языки en/es или streaming. System prompt не обеспечивает достоверность фактов. Сейчас в игре торговцы/пастух и Лея/Марк; Эйнштейн/Геродот из AI-корпуса требуют отдельной подготовки.

Полная реализация LLM/AI/PROTO v2 и аппаратная квалификация — отдельные задачи. Этот срез нельзя обозначать как завершённый TASK-017/018.

## Проверки без моделей

```sh
npm --prefix server test
npm --prefix server run check
python3 -B -m unittest discover -s server/llm -p 'test_*.py'
```

Node subprocess fixtures и Python mocks не скачивают и не запускают Ollama/MLX. Общий контракт проверяет отсутствие внешних Node-соединений и допускает явно заданный loopback; он не наблюдает сеть дочернего Python и не заменяет OS/offline-тест. Фактические результаты и unverified gates — [TASK-030](../../tasks/030-configurable-game-llm.md).
