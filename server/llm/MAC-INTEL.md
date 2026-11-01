# Ручной пробный запуск на Intel Mac

Это инструкция для **компьютера оператора**, не для сервера разработки. Подготовка скачивает npm/Python-пакеты, tokenizer и веса; нужна сеть. Во время игры скачивания нет. Этот путь не проверен на настоящем Intel Mac. Совместимость установленной Ollama с CPU/macOS, RAM, tokenizer/GGUF и текущий30-секундный deadline ещё требуют проверки. Если шаг завершился ошибкой, не продолжать следующие блоки.

Команды выполняются из корня проекта в Terminal (zsh/bash). Используется отдельный `$HOME/kuda-llm`, без изменения пользовательского хранилища Ollama. Каталоги tokenizer и manifests для первого запуска должны быть новыми; инструкция не перезаписывает pin/config.

Для уже подготовленного Mac и согласованной проверки0.8B не повторять установку: использовать отдельную инструкцию [MAC-INTEL-08B.md](MAC-INTEL-08B.md). Она сохраняет2B, выбирает явный Q8_0 tag и не меняет уже выбранный timeout. Согласованный переход с8с на30с и обязательная пересборка клиента — [MAC-30S.md](MAC-30S.md).

## 1. Код и инструменты

Если проект уже клонирован, перейти в его каталог (путь заменить своим), проверить `git status`, затем:

```sh
git fetch origin
git switch npc-llm-clean-start
git pull --ff-only origin npc-llm-clean-start
```

Не сбрасывать локальные изменения ради переключения. Для нового клона:

```sh
git clone --branch npc-llm-clean-start https://github.com/Nisakoo/Kuda-Nazimat-2026.git
cd Kuda-Nazimat-2026
```

Нужны Node 24.15+ в пределах 24.x, Python 3.12 и Ollama с поддержкой данного Intel Mac/macOS. Сначала проверить существующие инструменты:

```sh
sw_vers -productVersion
uname -m
command -v node npm python3.12 ollama
node --version
python3.12 --version
```

**Не начинать с `brew install node@24 python@3.12 ollama` на Intel.** На пользовательском macOS15.7.3 Homebrew сообщил об отсутствии поддержки/bottles, начал длительную сборку и обновление глобальных зависимостей; Ollama formula завершилась ошибкой. Уже установленный Python3.12.8 подошёл без обновления. Если Python3.12 отсутствует, отдельно подготовить совместимый официальный runtime, не запускать цепочку глобальных upgrade вслепую.

Готовые официальные архивы Node24.22.2 x64 и Ollama0.40.13 universal с проверкой SHA-256 (ссылки/хеши закреплены, не latest):

```sh
TOOLS="$HOME/kuda-llm/tools"
mkdir -p "$TOOLS"
curl --fail --location --retry 2 https://nodejs.org/dist/v24.22.2/node-v24.22.2-darwin-x64.tar.gz -o "$TOOLS/node-v24.22.2-darwin-x64.tar.gz" \
&& printf '%s  %s\n' 'd5e336d588c45be0c37dbd52cc29895593009ca4997a77a1fd02815131ed0e52' "$TOOLS/node-v24.22.2-darwin-x64.tar.gz" | shasum -a 256 -c - \
&& tar -xzf "$TOOLS/node-v24.22.2-darwin-x64.tar.gz" -C "$TOOLS" \
&& export PATH="$TOOLS/node-v24.22.2-darwin-x64/bin:$PATH" \
&& node --version
```

```sh
mkdir -p "$TOOLS/ollama-0.40.13"
curl --fail --location --retry 2 https://github.com/ollama/ollama/releases/download/v0.40.13/ollama-darwin.tgz -o "$TOOLS/ollama-darwin-0.40.13.tgz" \
&& printf '%s  %s\n' 'bae29252232b9e1358cf5801a7d65a07442af18fb5467cb68c7fc3711f59c511' "$TOOLS/ollama-darwin-0.40.13.tgz" | shasum -a 256 -c - \
&& tar -xzf "$TOOLS/ollama-darwin-0.40.13.tgz" -C "$TOOLS/ollama-0.40.13" \
&& export PATH="$TOOLS/ollama-0.40.13:$PATH" \
&& file "$TOOLS/ollama-0.40.13/ollama"
```

Не переносить только executable: библиотеки/runner должны остаться рядом в исходном layout. Пользователь подтвердил оба SHA, Node24.22.2, наличие x86_64 в Ollama и запуск serve0.40.13 на CPU. Это **не подтверждает** загрузку модели/игровой ответ или RAM qualification. PATH действует только в текущем терминале; в новом терминале выполнить:

```sh
export PATH="$HOME/kuda-llm/tools/node-v24.22.2-darwin-x64/bin:$HOME/kuda-llm/tools/ollama-0.40.13:$PATH"
```

Не выполнять `brew services start ollama`: игровому worker нужен собственный процесс. MLX не является обходом проблем Intel: он требует Apple Silicon.

## 2. Пакеты и сборка игры

```sh
npm --prefix server ci
npm --prefix client ci
npm --prefix client run build
mkdir -p "$HOME/kuda-llm"
python3.12 -m venv "$HOME/kuda-llm/venv"
"$HOME/kuda-llm/venv/bin/python3" -m pip install -r server/llm/requirements-ollama.txt
```

## 3. Веса (2 терминала)

В терминале A запустить только подготовительный daemon:

```sh
mkdir -p "$HOME/kuda-llm/models" "$HOME/kuda-llm/prepare-home"
HOME="$HOME/kuda-llm/prepare-home" \
OLLAMA_MODELS="$HOME/kuda-llm/models" \
OLLAMA_HOST=127.0.0.1:11501 \
OLLAMA_NO_CLOUD=1 \
ollama serve
```

Он занимает терминал — это нормально. Если порт занят, не завершать чужие процессы наугад. Найти и штатно остановить свой предыдущий экземпляр либо изменить порт последовательно во всех командах/config.

В терминале B:

```sh
HOME="$HOME/kuda-llm/prepare-home" OLLAMA_HOST=127.0.0.1:11501 \
"$HOME/kuda-llm/tools/ollama-0.40.13/ollama" pull qwen3.5:2b-q4_K_M \
&& curl --fail --silent --show-error http://127.0.0.1:11501/api/version -o "$HOME/kuda-llm/ollama-version.json"
```

После успешного завершения вернуться в терминал A и нажать **Ctrl+C**. Подготовительный daemon должен остановиться до запуска игры. Не выполнять `ollama run`: для подготовки нужен только pull.

## 4. Tokenizer без вторых весов

В терминале A, из корня проекта, выполнить весь блок. Он скачивает только выбранные root-файлы tokenizer/template/config из закреплённой ревизии, не safetensors/GGUF. Загруженные файлы копируются из HF cache как обычные файлы, без symlinks.

```sh
HF_HOME="$HOME/kuda-llm/hf-cache" HF_HUB_DISABLE_TELEMETRY=1 \
"$HOME/kuda-llm/venv/bin/python3" - <<'PY'
from pathlib import Path
import shutil
from huggingface_hub import list_repo_files, hf_hub_download
repo = 'Qwen/Qwen3.5-2B'
revision = '15852e8c16360a2fea060d615a32b45270f8a8fc'
out = Path.home() / 'kuda-llm' / 'tokenizer'
out.mkdir(exist_ok=False)
allowed = {'config.json', 'tokenizer.json', 'tokenizer_config.json',
           'special_tokens_map.json', 'added_tokens.json', 'vocab.json',
           'merges.txt', 'chat_template.jinja'}
files = [name for name in list_repo_files(repo, revision=revision) if name in allowed]
if not {'tokenizer.json', 'tokenizer_config.json'} <= set(files):
    raise SystemExit('Missing tokenizer files: stop preparation')
for name in files:
    source = hf_hub_download(repo, name, revision=revision)
    shutil.copyfile(source, out / name)
print('Tokenizer files:', out)
PY
```

Проверить локальную загрузку/template, без model inference:

```sh
USE_TORCH=0 USE_TF=0 USE_FLAX=0 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
"$HOME/kuda-llm/venv/bin/python3" - <<'PY'
from pathlib import Path
from transformers import AutoTokenizer
p = str(Path.home() / 'kuda-llm' / 'tokenizer')
t = AutoTokenizer.from_pretrained(p, local_files_only=True, trust_remote_code=False)
s = t.apply_chat_template([{'role':'user','content':'Привет'}], tokenize=False,
                          add_generation_prompt=True, enable_thinking=False)
print('Tokenizer OK, tokens:', len(t.encode(s, add_special_tokens=False)))
PY
node server/llm/manifest.mjs "$HOME/kuda-llm/tokenizer" "$HOME/kuda-llm/tokenizer-sha256.json"
```

Не считать smoke доказательством эквивалентности HF/GGUF. Runtime дополнительно сверяет counts, но настоящая runner/telemetry qualification не выполнена.

## 5. Создать конфиг без ручных placeholders

Если `server/config.json` уже существует, сначала сохранить свою копию и согласовать объединение. Следующий блок **откажется перезаписывать** его. Он получает SHA-256 из bytes **активного** подготовленного Ollama manifest (canonical v2 приоритетен) и версию из ответа daemon, не из случайной строки CLI. Ранее созданный config с legacy-anchor pin сохраняется: адаптер сам проверяет его криптографическую связь с активным manifest, но не переписывает pin.

```sh
"$HOME/kuda-llm/venv/bin/python3" - <<'PY'
import hashlib, json, re, shutil
from pathlib import Path
base = Path.home() / 'kuda-llm'
exe = shutil.which('ollama')
if not exe:
    raise SystemExit('ollama not found in PATH')
version = json.loads((base / 'ollama-version.json').read_text())['version']
if not re.fullmatch(r'\d+\.\d+\.\d+', version):
    raise SystemExit('Expected stable Ollama x.y.z version')
manifest = base / 'models/manifests-v2/ollama.com/library/qwen3.5/2b-q4_K_M'
if not manifest.exists() and not manifest.is_symlink():
    manifest = base / 'models/manifests/registry.ollama.ai/library/qwen3.5/2b-q4_K_M'
config = json.loads(Path('server/config.ollama.example.json').read_text())
config['npc']['options'].update(
    python=str(base / 'venv/bin/python3'), executable=str(Path(exe).absolute()),
    modelsDir=str(base / 'models'), tokenizerDir=str(base / 'tokenizer'),
    tokenizerManifest=str(base / 'tokenizer-sha256.json'),
    modelDigest=hashlib.sha256(manifest.read_bytes()).hexdigest(), runnerVersion=version)
with Path('server/config.json').open('x') as f:
    json.dump(config, f, ensure_ascii=False, indent=2)
    f.write('\n')
print('Created server/config.json: Ollama, CPU, localhost only')
PY
```

## 6. Игра

```sh
npm --prefix server start
```

Не закрывать терминал. Startup проверки/загрузка/прогрев могут занять до 120 с. После успешного запуска или восстановления в этом же терминале появляется `NPC готов к вопросам {"status":"ready"}`. Строка `Сервер доступен` сама по себе означает только доступность игрового HTTP-сервера, не готовность модели. Затем открыть в браузере:

- **http://localhost:8080/api/health** — нужен `npc: "ready"` для доступного NPC.
- **http://localhost:8080/** — войти по имени, подойти к NPC и задать короткий вопрос.

`npc: unavailable` — реальная модель не стартовала; мир остаётся доступен. Не считать scripted-фразу доказательством LLM. При ошибке сохранить безопасный startup-log и вывод health. Операционный `code` различает стадии: `ollama_tokenizer_integrity` / `ollama_model_integrity` — pin/inventory файлов; `ollama_dependencies` — Python-пакеты; `ollama_tokenizer_load` / `ollama_template` — tokenizer/template; `ollama_port` — проверка привязки порта не прошла; `ollama_spawn` / `ollama_listener` — запуск выделенного процесса; `ollama_version` / `ollama_model_digest` — HTTP pin; `ollama_warmup` / `ollama_calibration` — прогрев/проверка count. Отдельные причины: `ollama_memory_insufficient` — runner прямо сообщил недостаток памяти, `ollama_token_count_mismatch` — count не совпал или отсутствует, `ollama_runner_rejected` — HTTP отказ без публикации body. Код стадии показывает место отказа, но сам по себе не доказывает причину. Не скачивать веса заново и не переписывать manifest вслепую. Если startup был ready, но вопрос сделал NPC unavailable, сохранить новую строку `NpcResponder недоступен во время игры` с фиксированным `code`: runtime/idle причина печатается один раз на период недоступности. Явная отмена/shutdown не выдаётся за inference failure. Отдельная строка `Истёк deadline ответа NPC` с `code: timeout` означает истечение активного запроса, не обязательно отказ всего backend; она не подавляет последующий runtime-log. Если `ready`, но игровые вопросы истекают, CPU может не укладываться в v1 deadline. Текущий согласованный default/max —30с; старый config с8000мс сам не изменяется. Для обновления только timeout и client dist — [MAC-30S.md](MAC-30S.md). Не обходить memory/tokenizer guards ради демонстрации.

### Ответ не укладывается в выбранный deadline

Игровой промпт просит1–2 коротких предложения (до20слов), для приветствия — короткое приветствие и вопрос. Это мягкая инструкция, не гарантированная длина и не обрезка уже полученного ответа. Модель/профиль/параметры sampling не заменены; потолок128токенов сохранён, а deadline по отдельному решению оператора увеличен до30с (клиент NPC32с). Это не улучшает автоматически скорость/качество. Старый прогрев на3одиночных токенах не доказывает скорость полноценного диалога.

При timeout или успешном ответе Ollama печатается `Этапы ответа NPC` с фиксированным `reason` и безопасным snapshot:

- `stage: preparing` — запрос передан worker, подготовка ещё не подтверждена; сюда может входить задержка IPC.
- `stage: prefill` — prompt подготовлен, первый непустой текст ещё не наблюдался. Это включает ожидание HTTP/runner, а не доказанный чистый prefill.
- `stage: decoding` — хотя бы один непустой фрагмент уже получен, полный ответ ещё не принят.
- `stage: complete` — адаптер принял полный валидный ответ.
- `elapsedMs` — время с начала текущего вызова адаптера, не время очереди; `promptTokens` — точный локальный count; `firstTokenMs` — время наблюдения первого непустого текстового фрагмента, не внутренний TTFT модели; `outputChunks` — счётчик фрагментов на последнем ограниченном обновлении, **не** число токенов. До завершения обновления редкие, поэтому snapshot может отставать от фактического счётчика.

Прогресс ограничен по числу сообщений/байтам и не передаёт текст в лог или клиент. Клиент по-прежнему получает только полный проверенный ответ; ни partial output, ни поздний ответ не считаются успехом. Если даже короткая реплика не укладывается, профиль остаётся неквалифицированным: менять модель или игровые deadlines можно только отдельным согласованным решением, не автоматическим fallback.

### Отдельный30с диагностический прогон (только Intel Mac оператора)

Сначала остановить игровой сервер через **Ctrl+C** и дождаться возврата приглашения терминала. Затем в том же checkout на **Mac**, не на сервере с Pi:

```sh
node server/llm/diagnose.mjs
```

Нужен Node24 в PATH. CLI не принимает аргументы: использует существующий `server/config.json` с `npc.adapter: ollama` и профиль fabric-seller из configured content. Он отказывает при занятых игровом/native портах, не запускает HTTP игры, не обращается к SQLite и не меняет конфиг, модель, pins или зависимости. Реальный запуск ограничен Darwin/x64; импорт CLI и тесты с fake factory модель не запускают. Port preflight не резервирует порт, после spawn сохраняется проверка владельца listener.

Startup/проверка файлов/прогрев могут занимать до120с. После `event: ready` выполняется ровно один вопрос `Привет!`, без истории, с отдельным пределом30с. Выводит JSON-lines `progress`, затем `response` либо `failure`, `final` и при подтверждённой остановке `cleanup_confirmed`. `response.text` — реальный ответ; длинный вывод ограничен2048Unicode code points с явным `truncated: 1` (проверки полного ответа выполняются до ограничения отображения). `elapsedMs` до готовности — время всего запуска, в диагностике ответа — время вызова adapter; `firstTextElapsedMs` дополнительно включает startup. Фрагменты не являются токенами.

CLI сам **не меняет** игровой timeout: registry/game config теперь допускают default/max30с по отдельному согласованному решению оператора. Его30с ceiling совпадает с максимальным игровым; это всё ещё отдельный isolated tool, не выбранный через `npc.options` адаптер. Socket wait также использует оставшийся request budget до30с, а абсолютный deadline контролирует supervisor. RSS/byte/token/owned-process/physical-stop guards сохранены.

После успеха/ошибки/Ctrl+C/SIGTERM/SIGHUP или ошибки вывода CLI останавливает только свой runtime. Повреждённый канал вывода больше не используется; ошибки вывода не должны обрывать cleanup. SIGKILL, авария ОС или отключение питания не дают такой гарантии. `Cleanup is not confirmed` означает quarantine: не закрывать этот терминал и не запускать другой экземпляр; повторный Ctrl+C не отправляет сигналы чужим PID. Не выдавать окончание логического timeout за подтверждённую выгрузку. CLI сам не запускает игру/браузер; он не доказывает отсутствие нагрузки от уже открытых вкладок и других программ. Такой прогон помогает измерить runner, но **не квалифицирует** игровую задержку, RAM или качество. На сервере с Pi настоящий CLI не запускать.

### `ollama_port` после отмены

После закрытия TCP-соединения ОС может временно сохранять `TIME_WAIT`, хотя listener уже остановлен. Probe использует `SO_REUSEADDR`, чтобы не считать этот случай занятым listener; `SO_REUSEPORT` не включается. Реальный слушающий процесс по-прежнему должен блокировать probe, и после запуска обязательна проверка владельца listener.

Успешный probe — проверка возможности bind, не резервирование порта и не доказательство отсутствия чужого bound-only socket. Между probe и запуском остаётся race; чужой daemon не завершается и не используется как fallback. Linux socket fixtures не заменяют проверку поведения на конкретной macOS. `ollama_port` из старого лога сам по себе не доказывает TIME_WAIT. Исправление probe не ускоряет первый ответ модели.

### Задержка остановки после timeout

`NPC не завершился после abort` означает отсутствие подтверждения физической остановки спустя2с, а не доказательство вечного зависания. Не запускать второй экземпляр модели и не повторять вопросы, пока backend недоступен. Сохранить последующие строки того же серверного терминала: после завершения cleanup может отдельно отказать восстановление.

Ollama-worker обрабатывает SIGTERM так, чтобы прервать блокирующий HTTP-read и войти в cleanup собственного daemon. При медленном завершении прямого дочернего процесса Python остаётся жив для существующего500мс group escalation. После выхода лидера supervisor по-прежнему не сигналит stalePGID и удерживает quarantine при неизвестном результате. Это не доказательство остановки всех native descendants на macOS за2с; такая квалификация требует отдельного прогона. Исправление отмены не ускоряет генерацию и не увеличивает игровой deadline.

### Отказ измерения памяти

`memory_unavailable` означает отсутствие достоверной метрики, **не** доказанное превышение лимита памяти. Для уточнения операционный лог различает фиксированные причины:

| Code | Значение |
|---|---|
| `memory_sample_ps_timeout` | По лимиту 500 мс запрошено завершение команды `/bin/ps`; код не доказывает её физическую остановку ровно в500мс |
| `memory_sample_ps_failed` | Команда измерения завершилась ошибкой |
| `memory_sample_ps_limit` | Вывод команды превысил ограничение буфера |
| `memory_sample_parse` | Таблица процессов не прошла строгий разбор |
| `memory_sample_missing` | В таблице нет обязательной строки игрового Node-процесса |
| `memory_sample_invalid` | Значение метрики нулевое, некорректное или не является безопасным целым |
| `memory_sample_deadline` | Измерение не завершилось в окне наблюдателя 600 мс |

Неизвестное исключение по-прежнему становится `memory_unavailable`; произвольный текст команды/таблицы/исключения не публикуется. `resource_limit` отдельно означает срабатывание soft threshold 3 500 000 000 байт, а `ollama_memory_insufficient` — явный отказ самого runner из-за нехватки системной памяти. Ни один из этих кодов сам по себе не доказывает квалификацию пика ≤4 GB. Под нагрузкой возможен отказ измерения даже при успешном отдельном `ps` позднее. Не отключать watchdog и не увеличивать лимиты ради `ready`.

Повторный запуск после успешной подготовки: перейти в корень проекта, активировать Node 24 в PATH при необходимости и выполнить `npm --prefix server start`. Веса/venv/tokenizer/config сохраняются. Offline запуск проверяется отдельно после первого успешного online-подготовленного старта.
