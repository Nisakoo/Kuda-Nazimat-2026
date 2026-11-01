# Подготовленные модели: один выбор и запуск через Make

## Команды

Из корня существующего checkout с Node24 в PATH:

```sh
make server BACKEND=ollama MODEL=2b
make server BACKEND=ollama MODEL=0.8b
make server BACKEND=mlx MODEL=2b
```

Timeout задаётся отдельно **числом секунд**: `make server BACKEND=ollama MODEL=2b NPC_TIMEOUT=60` (целые1–300, очередь включена). Без него используется config/default30с. Override не сохраняется; после однократной новой client-сборки повторная сборка для смены срока не нужна — [TIMEOUT.md](TIMEOUT.md).

Это **выбор на один запуск**, не переписывание игрового config или сохранённой пары. `BACKEND` и `MODEL` задаются вместе. Поддержаны ровно3пары, не произвольные registry tags. MLX работает только на macOS/Apple Silicon; Intel не переключается автоматически на Ollama.

Без аргументов:

```sh
make server
```

Он читает сохранённый выбор из **`~/kuda-llm/profiles.json`**. Разовый импорт ниже выбирает **Ollama +2B**. Модельные пути, версия runtime, digest и tokenizer manifest берутся целиком из выбранного профиля: нельзя случайно заменить только имя весов, сохранив чужой tokenizer.

Сборка клиента и тот же запуск:

```sh
make demo BACKEND=ollama MODEL=2b
```

`make demo` — прежняя подготовительная команда: может установить отсутствующие npm dependencies и пересобрать client/world, поэтому её выполняют до offline-демонстрации. `make server` ничего не устанавливает, не собирает и не скачивает, а запускает сервер уже подготовленной игры. Node24 и dependencies должны быть доступны заранее. `NODE=/absolute/path/to/node` переопределяет Node для server/import; для npm/client build Node24 должен быть в PATH.

Путь каталога можно указать явно (в том числе с пробелами):

```sh
make server BACKEND=ollama MODEL=2b LLM_PROFILES="$HOME/kuda-llm/profiles.json"
```

Make передаёт селекторы как environment data `KUDA_LLM_BACKEND`, `KUDA_LLM_MODEL`, `KUDA_LLM_PROFILES`, не подставляет их в shell-аргументы. Это доверенные операторские настройки, не поля game packet. Эквивалент без Make:

```sh
npm --prefix server start -- --backend ollama --model 2b
```

Также доступны `--config /absolute/game.json` и `--profiles /absolute/profiles.json`. CLI-пара backend/model имеет приоритет над env-парой, но неполный CLI-выбор не дополняется environment. Аргументы не позволяют runtime downloads или обход validation.

## Перенести уже подготовленный Mac, вернуть2B и оставить30с

**Только на Mac оператора. На сервере с Pi реальные модели/веса не запускаются и не скачиваются.**

1. Остановить игру/диагностику/подготовительный Ollama через Ctrl+C и дождаться shell prompt. Не менять конфиги параллельно.
2. Обновить `npc-llm-clean-start`, без повторного clone/install/model pull.
3. Указать существующий внешний Node24, затем выполнить **один раз**:

```sh
export PATH="$HOME/kuda-llm/tools/node-v24.22.2-darwin-x64/bin:$HOME/kuda-llm/tools/ollama-0.40.13:$PATH"
make llm-import
```

**Этот importer создаёт новый `~/kuda-llm/profiles.json` (0600), выбирает Ollama/2B и при необходимости меняет только `npc.timeoutMs: 8000 → 30000` в активном `server/config.json`.** Перед изменением config сохраняет исходные bytes в create-only0600 `~/kuda-llm/config-before-profiles.json`. Если timeout уже30000 или другой допустимый (например60000), config не переписывается; legacy8000→30000 — единственное явно описанное исключение. Никакие другие поля server config, весовые файлы, tokenizer, digest/pins не изменяются. Не восстанавливается целиком старый2Bconfig с8с deadline.

Источники — существующий `server/config.json` и сохранённый ранее `~/kuda-llm/config-before-08b.json`. Выбранный2Bпрофиль должен быть среди подготовленных источников. Подготовленный0.8B остаётся доступен вторым профилем, если присутствует в activeconfig. Это перенос уже доверенных локальных настроек, не проверка происхождения модели и не repin. Проверяются структура/пары/options и статическая доступность локальных файлов; полные hash/version/tokenizer/ownership/RAM проверки по-прежнему выполняет worker при запуске.

Importer ничего не загружает из сети, не выполняет Python/Ollama/MLX или inference. Существующий каталог не перезаписывается; если он уже есть, команда отказывает. При ошибке сохранить вывод, **не удалять backup/catalog вслепую**. Публикация файла каталога атомарна и не перезаписывает конкурирующий файл. Изменение base timeout и публикация внешнего каталога —2отдельных файловых операции: если финальная публикация не удалась после миграции, config может уже содержать30с, но модель не переключена и backup сохранён. Такой случай не считается успешным импортом.

Для явно заданных подготовленных источников доступен CLI:

```sh
node server/src/cli/importLlmProfiles.ts \
  --config /absolute/server-config.json \
  --backup-2b /absolute/saved-2b-config.json \
  --profiles /absolute/new-profiles.json
```

После успешного импорта и ранее выполненной30с client-сборки:

```sh
make server
```

Лог `Выбран профиль NPC` покажет backend/model/CPU или GPU-параметры/timeout30000 без вывода путей, digest или секретов. Затем дождаться `NPC готов к вопросам`. Отдельный `ollama serve` не нужен. Открыть/перезагрузить страницу игры, отправить один вопрос и сохранить operational timing/UIответ. Прежний клиент с фиксированным32с pending недостаточен для минутного срока. После этого обновления один раз выполнить `npm --prefix client run build` и перезагрузить страницу; новая сборка узнаёт timeout от сервера и ждёт плюс2с. Дальше изменение NPC_TIMEOUT не требует сборки — [TIMEOUT](TIMEOUT.md).

## Формат внешнего каталога

Схема (options ниже — обозначение, **не готовая конфигурация для копирования**):

```json
{
  "version": 1,
  "selected": { "backend": "ollama", "model": "2b" },
  "profiles": [
    { "backend": "ollama", "model": "2b", "options": {} },
    { "backend": "ollama", "model": "0.8b", "options": {} }
  ]
}
```

Каждый options должен содержать весь реальный набор соответствующего backend из [примеров](../config.ollama.example.json). Для Ollama2B точный `options.model` — `qwen3.5:2b-q4_K_M`, для0.8B — `qwen3.5:0.8b-q8_0`; alias не превращается в произвольный tag. Для MLX2B используются существующие `modelDir/modelManifest`, text-only4bit/group64; MLX0.8B не поддержан этим срезом. Нельзя подставлять example placeholders вместо подготовленных pins/путей.

Сохранённый выбор можно изменить в `selected` **при остановленной игре**, сохранив пару, присутствующую в profiles. Командные overrides не меняют этот файл. Горячая смена модели не реализована: остановить сервер, выбрать профиль и запустить снова. Остальные записи могут относиться к другой платформе; полная статическая проверка файлов/платформы выполняется для выбранной записи. Схема всех записей проверяется, недопустимый options не игнорируется.

## Совместимость и границы

- Нет каталога и нет явного выбора — прежний прямой `npc.adapter/options` работает как раньше. Это совместимость, не fallback после ошибки профиля.
- Явный missing профиль/файл, повреждённый JSON, unknownkeys, дубли пар, неполный выбор или несовместимая платформа — ошибка **до игрового startup**, без второго runtime и без переключения на legacy/scripted.
- Профиль заменяет только `npc.adapter/options`. Общие map/DB/queue/auth/timeout настройки не копируются из другого config; concurrency2 для реальной модели не принимается. Разовый migration30с — явно объявленное исключение переноса старой установки.
- Diagnostic `node server/llm/diagnose.mjs` читает тот же сохранённый профиль. Он всё ещё только Intel Mac/operator-only, не запускает игру и не квалифицирует end-to-end время. Если сохранён MLX, он не переключится на Ollama.
- Возврат2B и лимит30с не устраняют ошибки/вымыслы модели и не означают прохождение speed/RAM/quality/OS-isolation acceptance. После переноса реальный игровой ответ проверяется на Mac, не на сервере разработки.
