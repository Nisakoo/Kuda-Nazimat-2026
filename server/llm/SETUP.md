# Локальная LLM с нуля: инструкция оператору

Эта инструкция выполняется **на компьютере владельца игры**, из корня checkout, в bash/zsh. На сервере разработки с Pi нельзя скачивать веса, запускать Ollama/MLX, inference или настоящий `diagnose.mjs`. Подготовка требует интернета (либо заранее проверенной локальной поставки); **игра работает без runtime-скачиваний**.

Backend выбирает оператор, а не программа. Выбор модели, pins, tokenizer и runtime составляет один профиль. Ошибка не переключает его на другую модель, backend, пользовательский daemon или `scripted`. Явно выбранная заглушка `scripted` не доказывает работу LLM.

На `demo` обычные NPC используют выбранный responder. На `market` дополнительно нужен `language: { "adapter": "local", "options": {} }`: этот мост заимствует ту же модель и очередь. По умолчанию язык рынка — `test`. Создаваемые ниже config выбирают `demo`; для рынка после подготовки изменить только `defaultMap` и `language`. На рынке выбрать изучаемый en/es; HTTP-клиент ждёт 30 секунд независимо от большего `NPC_TIMEOUT`.

## 1. Сначала определить маршрут

**Уже подготовленный Mac:** если есть `server/config.json`, `~/kuda-llm`, venv, веса, tokenizer или `profiles.json`, **не повторять разделы новой установки**. Сначала пройти [UPDATING.md](UPDATING.md): обновление после переписанной истории ветки, резервная копия БД и проверка выбранной карты/языкового адаптера. Не перезаписывать config/catalog, не пересоздавать venv, не делать повторный pull ради обновления кода. Остановить игру, обновить согласованную версию проекта без сброса своих изменений, сохранить прежние файлы. Для новых timeout один раз пересобрать клиент: `npm --prefix client run build`. Далее — разделы 8–10. При необходимости миграции существующих 0.8B/2B — раздел 7 и [PROFILES.md](PROFILES.md).

**Новый компьютер:** разделы 2–6 создают новую Ollama-установку. MLX — отдельный, пока не подтверждённый аппаратно путь в разделе 11. Если подготовка прервалась, остановиться и проверить частичные файлы; create-only отказ — не причина удалять их или запускать всё заново.

### Матрица поддержки и уверенности

| Платформа / backend | Что реализовано / известно | Чего это не доказывает; когда остановиться |
|---|---|---|
| macOS Intel x64 / Ollama | Есть фактический подготовленный путь: Node 24.22.2, Ollama 0.40.13, CPU; SHA архивов и запуск serve подтверждены оператором | Это **не квалифицированный игровой профиль**. Были timeout и ошибки измерения; успешный стабильный диалог, RAM, отмена и изоляция не приняты. При несовместимом macOS/CPU или ошибке guards остановиться |
| macOS Apple Silicon arm64 / Ollama | POSIX supervisor и выбор профиля поддержаны кодом | Нет аппаратной квалификации здесь. Нужна совместимая проверенная поставка runtime; Intel-архив Node ниже не подходит |
| Linux x64/arm64 / Ollama | POSIX supervisor поддержан кодом; ownership использует `/proc` | Нет подтверждённого набора runtime/ОС/ускорителя и реального игрового прогона. Не выдумывать URL бинарника или рабочую версию; оператор готовит свою проверенную поставку |
| macOS Apple Silicon arm64 / MLX | Адаптер ожидает `mlx-lm==0.32.2`, text-only post-trained Qwen3.5-2B, 4-bit/group64 | Конвертация **UNVERIFIED**, не готовый установщик. Без проверенного совместимого snapshot остановиться |
| macOS Intel / MLX; Linux / MLX | Не поддержаны | Не пытаться обойти platform gate |
| Windows / локальная LLM | Supervisor **не реализован** | Общая поддержка игрового сервера Windows не означает поддержку этих LLM; нужен другой поддержанный компьютер |

`numGpu: 0` — исходный CPU-профиль Ollama. GPU/offload выбирается отдельно и требует измерений. Размер весов на диске не равен RAM. Наличие адаптера или `ready` не означает готовность к недоверенной LAN.

## 2. Код, инструменты и внешний каталог

Нужны Git, Make, npm, **Node >=24.15.0 и <25**, **uv и Python 3.12**. Python устанавливает/выбирает uv; Node остаётся под nvm либо существующим менеджером. Проверить существующие инструменты до установки:

```sh
git status --short
uname -s
uname -m
command -v node npm make uv
node --version
npm --version
make --version
uv --version
uv python find --no-python-downloads 3.12
```

Если uv ещё отсутствует, установить его по [официальной инструкции](https://docs.astral.sh/uv/getting-started/installation/); существующий uv повторно не устанавливать. До offline-работы выполнить `uv python install 3.12`. Подробные команды инструментов и выбор nvm — [установочный скилл](../../.agents/skills/install-local-ai/SKILL.md). Проверенный минимум uv — 0.8.13.

Checkout должен содержать `server/llm/PROFILES.md`, `TIMEOUT.md`, `server/src/app/llmProfiles.ts` и соответствующий Make-переключатель. Получить согласованный командой release/commit из `https://github.com/Nisakoo/Kuda-Nazimat-2026.git`; не переключать ветку с локальными изменениями вслепую. Имя исторической ветки в старых Mac-инструкциях не является гарантией актуальной поставки.

Если checkout ещё нет, сначала получить у сопровождающего точный release/commit с LLM/profile/timeout-поддержкой и сохранить его в `KUDA_GAME_REVISION`. Затем в родительском каталоге для **нового**, ещё не существующего клона:

```sh
test -n "$KUDA_GAME_REVISION" && \
  git clone --no-checkout https://github.com/Nisakoo/Kuda-Nazimat-2026.git Kuda-Nazimat-2026 && \
  cd Kuda-Nazimat-2026 && git checkout --detach "$KUDA_GAME_REVISION"
```

До следующего раздела проверить успешный checkout и перечисленные файлы. Если revision не предоставлена или выбранный checkout не содержит переключатель, остановиться; не предполагать, что произвольный `main` уже содержит эту работу.

Для **совершенно новой** установки создать корень один раз. Следующий блок откажется, если каталог уже есть:

```sh
uv run --no-project --no-config --python 3.12 --no-python-downloads --offline python - <<'PY'
from pathlib import Path
base = Path.home() / 'kuda-llm'
base.mkdir(mode=0o700, exist_ok=False)
for name in ('tools', 'models', 'prepare-home', 'hf-cache'):
    (base / name).mkdir(mode=0o700)
print('Created', base)
PY
```

План размещения (не переносить веса в git):

```text
~/kuda-llm/
  tools/                       # полная поставка Ollama и при необходимости Node
  venv/                        # Python для Ollama/tokenizer
  models/                      # отдельный Ollama store, не ~/.ollama/models
  prepare-home/                # HOME только подготовительного daemon
  hf-cache/                    # кеш только этапа подготовки
  tokenizer/                   # 2B: обычные файлы, не symlink
  tokenizer-sha256.json
  tokenizer-qwen35-08b/         # только если оператор выбрал/подготовил 0.8B
  tokenizer-qwen35-08b-sha256.json
  ollama-version.json           # версия ответа подготовительного daemon
  profiles.json                # необязательно; подготовленные профили для Make
server/config.json             # настройки игры, отдельно от весов
```

Для Intel Mac есть подтверждённые URL/SHA **Node 24.22.2 darwin-x64** и **Ollama 0.40.13 universal** в [MAC-INTEL.md, раздел 1](MAC-INTEL.md#1-код-и-инструменты). На новой установке выполнить оттуда только подходящие блоки получения и проверки архивов в новом `tools/`. Нужны SHA-256 до распаковки, `file` для архитектуры и сохранение всего layout: executable, библиотеки и runner рядом. Не копировать один бинарник. Не повторять команды поверх существующего `tools/`.

На Intel не начинать с общей цепочки `brew install/upgrade`: на наблюдавшемся macOS 15.7.3 формула Ollama не установилась, а сборка затронула глобальные зависимости. Подготовленный Python 3.12.8 обновления не требовал. При отсутствии Python/Node выбрать официальную совместимую поставку отдельно.

Для Linux/Apple Silicon Ollama оператор должен предоставить **проверенный release/source, контрольные суммы, совместимую архитектуру и абсолютный путь executable**. Эта инструкция не утверждает рабочую версию/asset для непроверенной платформы. Если происхождение или совместимость не установлены — остановиться, а не использовать `latest`.

В каждом новом терминале подготовить Node 24 в `PATH`. Для описанного Intel layout:

```sh
export PATH="$HOME/kuda-llm/tools/node-v24.22.2-darwin-x64/bin:$PATH"
export KUDA_OLLAMA_EXE="$HOME/kuda-llm/tools/ollama-0.40.13/ollama"
```

На другой платформе `KUDA_OLLAMA_EXE` должен содержать настоящий абсолютный путь из проверенной поставки оператора, а не этот Intel-пример. Проверить файл и права, не запускать случайный daemon:

```sh
test -x "$KUDA_OLLAMA_EXE" && file "$KUDA_OLLAMA_EXE"
```

## 3. Зависимости и первая сборка (только новая установка)

Выполнять блоки последовательно; после ошибки не переходить дальше.

```sh
npm --prefix server ci && npm --prefix client ci && npm --prefix client run build
```

Сборка создаёт клиент и подготовленный мир. Это **подготовка**, не ежедневный запуск.

Подготовить Ollama Python-окружение с полным lock-файлом:

```sh
make llm-prepare BACKEND=ollama
```

Команда использует `uv sync --locked --no-dev` и создаёт `~/kuda-llm/venv`. Прямые pins — Transformers 4.57.6 и Jinja2 3.1.6; транзитивные версии/хеши находятся в `envs/ollama/uv.lock`. MLX имеет отдельный lock, поскольку ему нужен другой набор Transformers. Повторный запуск синхронизирует только окружение с marker этого backend. Legacy/чужой каталог не изменяется: для миграции см. [UPDATING](UPDATING.md#переход-python-окружения-на-uv).

Сеть разрешена только на подготовке. Для полного локального кеша и доступного Python: `node server/llm/prepare.mjs ollama --offline`. При отсутствии пакета команда завершается ошибкой. uv cache переносится отдельно от окружения; lock-файл сам по себе не содержит пакеты. В runtime используется готовый `venv/bin/python3`, а не `uv run` или `uv sync`.

## 4. Подготовить ровно выбранные веса Ollama

Allowlist содержит только:

- `qwen3.5:2b-q4_K_M` — основной 2B Q4_K_M;
- `qwen3.5:0.8b-q8_0` — отдельный кандидат 0.8B Q8_0.

Не использовать `latest`, общий `0.8b` с MTP/draft, несуществующий `0.8b-q4_K_M` или произвольные aliases. Адаптер отвергает отдельные draft layers и для 0.8B задаёт `draft_num_predict: 0`; это не доказывает отсутствия embedded tensors/projector или низкой RAM.

В терминале B выбрать **одну** модель, сохранить этот выбор до конца раздела 6:

```sh
export KUDA_MODEL=2b
# Либо, только по явному решению оператора:
# export KUDA_MODEL=0.8b
```

Остановить игру/диагностику. Порт **127.0.0.1:11501** должен быть свободен. Не использовать порт 11434 пользовательского сервиса, не запускать `brew services start ollama`, `ollama run` или второй daemon. Чужие PID не завершать. Если остался свой процесс, штатно остановить его и подтвердить cleanup; при неизвестном владельце остановиться.

**Терминал A** (с тем же абсолютным `KUDA_OLLAMA_EXE`):

```sh
env HOME="$HOME/kuda-llm/prepare-home" \
  OLLAMA_MODELS="$HOME/kuda-llm/models" \
  OLLAMA_HOST=127.0.0.1:11501 OLLAMA_NO_CLOUD=1 \
  "$KUDA_OLLAMA_EXE" serve
```

Этот единственный подготовительный daemon занимает терминал. Прежде чем выполнять pull, убедиться, что **именно он** остаётся жив и сообщает listener `127.0.0.1:11501`. Если вернулось приглашение shell/порт занят — **не выполнять pull**: запрос может попасть к чужому процессу.

**Терминал B**:

```sh
case "$KUDA_MODEL" in
  2b) TAG='qwen3.5:2b-q4_K_M' ;;
  0.8b) TAG='qwen3.5:0.8b-q8_0' ;;
  *) printf '%s\n' 'Stop: invalid KUDA_MODEL'; exit 1 ;;
esac
env HOME="$HOME/kuda-llm/prepare-home" OLLAMA_HOST=127.0.0.1:11501 \
  "$KUDA_OLLAMA_EXE" pull "$TAG"
```

Только после `success`, пока свой daemon ещё работает, сохранить реальную API-версию **без перезаписи файла**:

```sh
"$HOME/kuda-llm/venv/bin/python3" - <<'PY'
import json, os, re, urllib.request
from pathlib import Path
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
with opener.open('http://127.0.0.1:11501/api/version', timeout=10) as r:
    value = json.loads(r.read(65537))
if not re.fullmatch(r'\d+\.\d+\.\d+', value.get('version', '')):
    raise SystemExit('Stop: expected stable x.y.z version')
p = Path.home() / 'kuda-llm/ollama-version.json'
fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as out:
    json.dump({'version': value['version']}, out)
    out.write('\n')
print('Recorded daemon version:', value['version'])
PY
```

Сопоставить её с проверенной поставкой; не просто закреплять неожиданную версию. Затем **Ctrl+C в терминале A**, дождаться shell prompt и освобождения listener. Во время игры `serve` запускает и останавливает **сам worker**, с собственным private HOME и выделенным store. Второй ручной daemon не нужен.

## 5. Отдельный pinned tokenizer, без вторых HF-весов

Продолжать в терминале B с тем же `KUDA_MODEL`. Ниже скачиваются только root tokenizer/config/template файлы, **не** safetensors/GGUF. Источники post-trained, не Base:

| Выбор | Репозиторий | Закреплённая source revision |
|---|---|---|
| 2B | `Qwen/Qwen3.5-2B` | `15852e8c16360a2fea060d615a32b45270f8a8fc` |
| 0.8B | `Qwen/Qwen3.5-0.8B` | `2fc06364715b967f1860aea9cf38778875588b17` |

```sh
env HF_HOME="$HOME/kuda-llm/hf-cache" HF_HUB_DISABLE_TELEMETRY=1 \
  "$HOME/kuda-llm/venv/bin/python3" - <<'PY'
import os, shutil
from pathlib import Path
from huggingface_hub import list_repo_files, hf_hub_download
choices = {
    '2b': ('Qwen/Qwen3.5-2B', '15852e8c16360a2fea060d615a32b45270f8a8fc', 'tokenizer'),
    '0.8b': ('Qwen/Qwen3.5-0.8B', '2fc06364715b967f1860aea9cf38778875588b17', 'tokenizer-qwen35-08b'),
}
if os.environ.get('KUDA_MODEL') not in choices:
    raise SystemExit('Stop: choose KUDA_MODEL first')
repo, revision, directory = choices[os.environ['KUDA_MODEL']]
allowed = {'config.json', 'tokenizer.json', 'tokenizer_config.json',
           'special_tokens_map.json', 'added_tokens.json', 'vocab.json',
           'merges.txt', 'chat_template.jinja'}
files = sorted(set(list_repo_files(repo, revision=revision)) & allowed)
if not {'tokenizer.json', 'tokenizer_config.json'} <= set(files):
    raise SystemExit('Stop: missing tokenizer files')
out = Path.home() / 'kuda-llm' / directory
out.mkdir(exist_ok=False)
for name in files:
    source = hf_hub_download(repo, name, revision=revision)
    with Path(source).open('rb') as src, (out / name).open('xb') as dst:
        shutil.copyfileobj(src, dst)
print('Prepared tokenizer only:', repo, revision, out)
PY
```

Скопированные файлы обычные, без symlink. Зафиксировать inventory выбранного tokenizer; команда create-only и не запускает inference:

```sh
case "$KUDA_MODEL" in
  2b) TOKENIZER="$HOME/kuda-llm/tokenizer"; INVENTORY="$HOME/kuda-llm/tokenizer-sha256.json" ;;
  0.8b) TOKENIZER="$HOME/kuda-llm/tokenizer-qwen35-08b"; INVENTORY="$HOME/kuda-llm/tokenizer-qwen35-08b-sha256.json" ;;
  *) printf '%s\n' 'Stop: invalid KUDA_MODEL'; exit 1 ;;
esac
node server/llm/manifest.mjs "$TOKENIZER" "$INVENTORY"
```

Локальная проверка загрузки/template, **без модели**:

```sh
env USE_TORCH=0 USE_TF=0 USE_FLAX=0 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  "$HOME/kuda-llm/venv/bin/python3" - <<'PY'
import os
from pathlib import Path
from transformers import AutoTokenizer
names = {'2b': 'tokenizer', '0.8b': 'tokenizer-qwen35-08b'}
p = Path.home() / 'kuda-llm' / names[os.environ['KUDA_MODEL']]
t = AutoTokenizer.from_pretrained(str(p), local_files_only=True, trust_remote_code=False)
s = t.apply_chat_template([{'role': 'user', 'content': 'Привет'}], tokenize=False,
                          add_generation_prompt=True, enable_thinking=False)
print('Tokenizer OK, tokens:', len(t.encode(s, add_special_tokens=False)))
PY
```

Revision/hash фиксируют выбранные bytes, но **не гарантируют происхождение, издателя, лицензию, безопасность или соответствие HF tokenizer и Ollama GGUF**. До принятия модели оператор проверяет источник, model card, лицензии модели/конвертации/runner/зависимостей и сохраняет provenance. Manifest не является подписью. Runtime дополнительно проверяет count, но несколько проб не доказывают универсальную эквивалентность и качество.

## 6. Создать полный config без placeholders (новая Ollama-установка)

Игра и daemon остановлены. Этот блок **создаёт только новый** `server/config.json` с правами 0600. Он не объединяет и не заменяет существующий config. Версия берётся из сохранённого ответа daemon, digest — из bytes **активного manifest** выбранного tag, tokenizer pin — из предыдущего раздела. Выполняется проверка локальных hashes/blobs, без запуска runtime или inference.

```sh
"$HOME/kuda-llm/venv/bin/python3" -B - <<'PY'
import hashlib, json, os, re, sys
from pathlib import Path
sys.path.insert(0, str(Path('server/llm').resolve()))
from local_common import verify_manifest
from ollama_worker import verify_ollama_model
base = Path.home() / 'kuda-llm'
target = Path('server/config.json')
if os.path.lexists(target) or os.path.lexists(base / 'profiles.json'):
    raise SystemExit('Stop: existing config/catalog; use the prepared-install route')
choices = {
    '2b': ('qwen3.5:2b-q4_K_M', 'tokenizer', 'tokenizer-sha256.json'),
    '0.8b': ('qwen3.5:0.8b-q8_0', 'tokenizer-qwen35-08b', 'tokenizer-qwen35-08b-sha256.json'),
}
if os.environ.get('KUDA_MODEL') not in choices:
    raise SystemExit('Stop: choose KUDA_MODEL first')
model, tokenizer, inventory = choices[os.environ['KUDA_MODEL']]
exe = Path(os.environ['KUDA_OLLAMA_EXE'])
if not exe.is_absolute() or not exe.is_file() or not os.access(exe, os.X_OK):
    raise SystemExit('Stop: executable must be an absolute executable file')
version = json.loads((base / 'ollama-version.json').read_text())['version']
if not isinstance(version, str) or not re.fullmatch(r'\d+\.\d+\.\d+', version):
    raise SystemExit('Stop: expected stable daemon version')
models = (base / 'models').resolve(strict=True)
tag = model.split(':')[1]
manifest = models / 'manifests-v2/ollama.com/library/qwen3.5' / tag
if not os.path.lexists(manifest):
    manifest = models / 'manifests/registry.ollama.ai/library/qwen3.5' / tag
resolved = manifest.resolve(strict=True)
if not resolved.is_relative_to(models) or not resolved.is_file():
    raise SystemExit('Stop: manifest must remain inside the dedicated model store')
with resolved.open('rb') as source:
    data = source.read(65537)
if len(data) > 65536:
    raise SystemExit('Stop: manifest exceeds 64 KiB')
digest = hashlib.sha256(data).hexdigest()
if verify_ollama_model(models, digest, model) != digest:
    raise SystemExit('Stop: expected verified active manifest digest')
verify_manifest(base / tokenizer, base / inventory)
config = json.loads(Path('server/config.ollama.example.json').read_text())
config.update(host='127.0.0.1', port=8080, defaultMap='demo')
config['npc'].update(adapter='ollama', maxConcurrent=1, maxUnfinished=4, timeoutMs=30000)
config['npc']['options'].update(
    python=str(base / 'venv/bin/python3'), executable=str(exe),
    modelsDir=str(models), tokenizerDir=str(base / tokenizer),
    tokenizerManifest=str(base / inventory), model=model,
    modelDigest=digest, runnerVersion=version,
    port=11501, threads=2, numGpu=0, startupTimeoutMs=120000)
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as out:
    json.dump(config, out, ensure_ascii=False, indent=2)
    out.write('\n')
print('Created loopback-only server/config.json:', model)
PY
```

Canonical `manifests-v2/ollama.com/...` приоритетен; legacy `manifests/registry.ollama.ai/...` используется только при его отсутствии. Разрешена лишь проверенная конечная v2-ссылка на blob того же store; tokenizer/MLX snapshot symlink не разрешены. Старый legacy-anchor pin может приниматься только при проверенной прямой криптографической связи с active manifest — **его не надо автоматически переписывать**. Короткий ID из `ollama list` не заменяет полный SHA-256.

Теперь можно запускать **без профилей**: `make server NPC_TIMEOUT=60`. Если нет `~/kuda-llm/profiles.json` и нет селекторов, прямой `npc.adapter/options` работает как legacy single-backend config. Это нормальная свежая установка; `make llm-import` ей не требуется.

## 7. Необязательные профили для явного BACKEND/MODEL

### Новый каталог из уже созданного свежего config

Для команд `make server BACKEND=ollama MODEL=2b` нужен каталог с такой парой. Следующий metadata-only блок копирует **полные проверенные options** текущего config в новый каталог. Он не загружает модели, не меняет config/timeout и не перезаписывает каталог:

```sh
node --input-type=module - <<'JS'
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseConfig } from './server/src/app/config.ts';
import { parseLlmProfiles, validatePreparedLlmProfile } from './server/src/app/llmProfiles.ts';
const path = resolve('server/config.json');
const config = parseConfig(JSON.parse(await readFile(path, 'utf8')), path);
const backend = config.npc.adapter;
const model = backend === 'mlx' ? '2b'
  : config.npc.options.model === 'qwen3.5:2b-q4_K_M' ? '2b'
  : config.npc.options.model === 'qwen3.5:0.8b-q8_0' ? '0.8b' : undefined;
if (!['ollama', 'mlx'].includes(backend) || !model || config.npc.maxConcurrent !== 1)
  throw new Error('Stop: expected one prepared real backend');
const profile = { backend, model, options: config.npc.options };
const catalog = parseLlmProfiles({ version: 1, selected: { backend, model }, profiles: [profile] });
await validatePreparedLlmProfile(catalog.profiles[0]);
await writeFile(join(homedir(), 'kuda-llm', 'profiles.json'), JSON.stringify(catalog, null, 2) + '\n',
  { flag: 'wx', mode: 0o600 });
console.log('Created catalog for:', backend, model);
JS
```

Это каталог **одной** подготовленной модели: команда с другой парой правильно откажет. Подготовка второй модели — отдельное решение, с отдельными tokenizer/digest, не правка одного имени. Не дописывать example placeholders. Общая схема допускает только `ollama/2b`, `ollama/0.8b`, `mlx/2b`; неизвестные ключи и дубли отклоняются.

### Миграция существующего Intel Mac

`make llm-import` — **не универсальный установщик**. Здесь его применяют только по [PROFILES.md](PROFILES.md): существующий активный 0.8B `server/config.json` плюс сохранённый 2B `~/kuda-llm/config-before-08b.json`, с доступными файлами обеих моделей. Он создаёт `~/kuda-llm/profiles.json`, выбирает Ollama/2B; если legacy timeout равен 8000 мс, сохраняет create-only `config-before-profiles.json` и меняет только timeout на 30000 мс. Иной допустимый срок, например 60000, сохраняется. Runtime/weights/pins/venv не переустанавливаются.

При существующем каталоге importer повторно не запускать. Изменение timeout и публикация каталога — 2 операции: после ошибки каталог может отсутствовать, а timeout уже измениться; backup сохраняется. Не удалять backup/catalog вслепую. Для нового single-backend config использовать предыдущий блок либо запуск без селекторов, а не миграцию.

## 8. Ежедневный запуск: без install и второго serve

Остановить подготовительный daemon/диагностику, подтвердить cleanup. Перейти в тот же checkout, включить Node 24 в `PATH`, проверить, что не остались случайные `KUDA_LLM_*`, `KUDA_NPC_TIMEOUT`, `HOST`, `PORT`, `APP_ENV` overrides от другого запуска.

Для локальной пробы после интеграции окружений безопасно явно выбрать **development и loopback**:

```sh
HOST=127.0.0.1 make server ENV=development NPC_TIMEOUT=60
```

При подготовленном каталоге можно выбрать пару на один запуск (показывать только существующие записи):

```sh
HOST=127.0.0.1 make server ENV=development BACKEND=ollama MODEL=2b NPC_TIMEOUT=60
# Только если отдельно подготовлен соответствующий профиль:
# HOST=127.0.0.1 make server ENV=development BACKEND=ollama MODEL=0.8b NPC_TIMEOUT=60
# HOST=127.0.0.1 make server ENV=development BACKEND=mlx MODEL=2b NPC_TIMEOUT=60
```

`make server` **не устанавливает, не собирает, не скачивает**. Подготовленные зависимости, client dist, мир и выбранные модельные файлы уже должны быть на диске. `make demo`/`make start` — не замена этому минимальному ежедневному пути: в соответствующей поставке они могут готовить dependencies/build и выбирать production; смотреть текущий [server/README.md](../README.md).

Без селекторов используется сохранённая пара из `~/kuda-llm/profiles.json`; если каталога нет — прямой config. Каталог имеет приоритет над прямыми model options. `BACKEND` и `MODEL` задаются **вместе** и действуют только на запуск. При другом пути: `make server BACKEND=ollama MODEL=2b LLM_PROFILES="$HOME/kuda-llm/profiles.json" NPC_TIMEOUT=60`. Missing/повреждённый/неподготовленный профиль — отказ до startup, не fallback. Для изменения выбора остановить сервер; hot swap не реализован.

### Timeout: секунды Make, миллисекунды JSON

- `NPC_TIMEOUT=60` — **60 секунд на весь вопрос, включая очередь**; только целые **1–300**, без суффиксов, дробей, 0/Infinity. Это не startup timeout.
- Приоритет: CLI `--npc-timeout 60` → Make/env `KUDA_NPC_TIMEOUT` → `npc.timeoutMs` config → default 30000 мс. В JSON оба поля `npc.timeoutMs` и `npc.streamTimeoutMs` принимают **1–300000 мс**; не путать `60` с `60000`.
- Launch override задаёт **оба** поля — `npc.timeoutMs` и `npc.streamTimeoutMs` — в памяти на этот запуск. Без override явно заданный `streamTimeoutMs` сохраняется независимо от обычного timeout. Текущий клиент использует **непотоковый** NPC-запрос; отдельный streaming-протокол не означает streaming в его UI.
- Пример без Make: `APP_ENV=development HOST=127.0.0.1 npm --prefix server start -- --npc-timeout 60`.
- Override не сохраняется в config/catalog. Смена модели не сбрасывает срок; следующий запуск без override возвращается к config/default.
- **Один раз после обновления timeout-кода:** `npm --prefix client run build`, затем перезагрузить страницу. Новый клиент получает effective timeout при connect/reconnect и ждёт плюс 2 с (при 60 с — 62 с). После этого смена срока не требует сборки.
- Deadline включает FIFO, подготовку и generation; progress и перевод часов назад его не продлевают. RAM/ownership/token/output/cancel guards не изменяются. Длинный срок не гарантирует качество/скорость и увеличивает ожидание других игроков.

Подробнее — [TIMEOUT.md](TIMEOUT.md). Не копировать старые утверждения о фиксированном 32-секундном клиенте или старом максимуме 8/30 с как текущий контракт.

## 9. Проверить игру и вход

Не закрывать серверный терминал. Startup/проверка hashes/прогрев могут занять до 120 с. Нужна строка `NPC готов к вопросам` со `status: ready`; одна строка доступности HTTP не доказывает готовность LLM.

1. Открыть **http://localhost:8080/api/health**: нужен `npc: "ready"`. Не фиксировать номер protocol из старой инструкции — после интеграции main протокол изменился.
2. Открыть **http://localhost:8080/** в актуально собранном клиенте. Для development предусмотрен вход без пароля (`guest`/`dev`); использовать новое пробное имя, если у прежнего имени уже есть пароль.
3. Проверить карту **`demo` («Площадь открытий»)**. На уже подготовленном Mac со старым `defaultMap: "market"` после входа открыть «Настройки», оставить режим **«Локальный сервер»**, прежний адрес сервера, радиус и диагностику; изменить только поле «Карта» на `demo` и нажать «Применить и открыть карту». При том же адресе сохраняется серверная сессия. Это не требует правки существующего config или удаления/сброса БД, аккаунта, истории либо BABEL-профиля. Не выбирать локальную прогулку или mock.
4. Подойти к **Лее или Марку на `demo`**, нажать E и задать короткий вопрос. Нужен полный ответ от реального `NpcResponder`, принятый до deadline и показанный в игре; прогрев, scripted-фраза, BABEL/test-ответ торговца на `market` или progress не считаются успехом.
5. Проверить несколько вопросов, язык, факты, признание незнания, задержку, восстановление после штатного перезапуска. Зафиксировать модель/runner/выбор CPU-GPU, timeout, безопасные коды отказа. Один успех не квалифицирует 4 игроков, peak RAM или учебное качество.
6. Только после подготовки отдельно проверить запуск с выключенным Wi-Fi/без интернета. Не устранять ошибку runtime скачиванием на лету.

### Вход после интеграции main: не считать guest универсальным

В Make окружение выбирается **`ENV=development`** (default для `make server`); Make явно экспортирует `APP_ENV` из `ENV`, поэтому задавать только внешний `APP_ENV` перед Make недостаточно. При прямом запуске Node/npm используются `--env` или `APP_ENV`. Пресеты меняют auth, debug и БД: обычно `data/dev.sqlite`, `data/game.sqlite`, `data/test.sqlite` относительно server config, если явный `dbPath` не переопределён. Не принять другую БД окружения за потерю данных. `HOST` и `PORT` могут переопределить JSON; поэтому выше loopback задан явно.

Production принимает **пароль**, а `auth.passwordless: true` в production запрещён. Сервер предоставляет `GET /api/auth/mode`, `POST /api/auth/register` с `{name,password}` и `POST /api/auth/login` с `{name,password}`. Регистрация не является ручной вставкой в SQLite. Guest/dev работают только при разрешённом passwordless; имя с установленным паролем требует password login даже в development. Не публиковать session token и не вставлять пароль в общие логи/команды истории shell.

Если текущий клиент показывает только имя и кнопку входа, **production с ним не считать совместимым**: нужен клиентский password-auth handoff [TASK-044](../../tasks/044-client-auth-observability-handoff.md) и регистрация/вход через поддержанный UI. Для локальной LLM-пробы использовать development на `127.0.0.1`, а не отключать production auth ради демонстрации. Актуальные детали — [server/README.md](../README.md) и фактическая форма входа.

Даже пароль не делает HTTP LAN шифрованным. Offline, loopback, cloud-off, dedicated store и ownership не являются квалифицированным OS-барьером от другого локального процесса/браузера/DNS rebinding. До LAN нужны отдельные проверки auth/client, сети, изоляции и аппаратного профиля; не менять `host` на `0.0.0.0` только ради обхода ошибки.

## 10. Если не работает: остановиться на причине, не отключать guards

| Признак / code | Что означает и что делать |
|---|---|
| `llm_profiles_unavailable`, `llm_profile_not_found`, `llm_profile_unprepared`, invalid config | Проверить каталог, выбранную пару, абсолютные пути и права. Без каталога убрать явные селекторы только если осознанно используется подготовленный single-backend config. Не заменять профиль заглушкой |
| `ollama_dependencies`, tokenizer load/template | Сверить venv, версии и локальные tokenizer/template файлы. Исправление зависимостей — отдельная подготовка до игры; не скачивать runtime |
| `ollama_tokenizer_integrity`, `ollama_model_integrity`, `ollama_model_digest`, `ollama_version` | Сохранить код; проверить поставку, pins, active manifest/blobs и фактическую версию. Не переписывать SHA/manifest ради ready и не делать автоматический repin |
| `ollama_port`, `ollama_listener`, `ollama_spawn` | Проверить, что остановлен свой подготовительный daemon, порт 11501 свободен и полный layout executable сохранён. Не подключаться к чужому daemon и не убивать произвольные PID |
| `memory_sample_ps_timeout` | `/bin/ps -axo pid=,ppid=,pgid=,rss=,stat=` не завершил измерение в лимите **1500 мс на macOS / 500 мс на Linux**, и запрошена остановка команды. Это **не цензура текста и не доказанное превышение RAM**; физическая остановка точно в этот срок не гарантируется. Бюджет macOS увеличен в TASK-085 как ограниченный кандидат против задержки ОС; пик RAM не квалифицирован. Cleanup-пробы сохраняют 500 мс. Сохранить безопасный лог/нагрузку ОС, остановить пробу; не отключать watchdog |
| `memory_sample_deadline`, `memory_unavailable`, другие `memory_sample_*` | Нет надёжной метрики (окно наблюдателя 1600 мс на macOS / 600 мс на Linux, parse/буфер/строка процесса и т. п.). Более поздний успешный `ps` не отменяет отказ под нагрузкой. Не отключать guards и не увеличивать RAM-лимиты ради ready |
| `resource_limit` | Сработал soft RSS threshold **3 500 000 000 байт** для Node и учитываемых потомков. Это не hard cap и не измерение всего GPU/unified peak |
| `ollama_memory_insufficient` | Runner явно отказал из-за нехватки системной памяти; это отличается от ошибки измерения. Не принимать размер файла за RAM |
| `ollama_token_count_mismatch` | Локальный HF count и фактическая метрика runner не совпали/отсутствуют. Проверить совместимость; не отключать сверку |
| `timeout`, `Истёк deadline ответа NPC` | Весь вопрос не уложился; частичный/поздний ответ не становится успехом и не сохраняется. `Этапы ответа NPC` различает preparing/prefill/decoding, но это не измерение чистого prefill/внутреннего TTFT. Изменять срок только явным решением оператора |
| `NPC не завершился после abort`, `Cleanup is not confirmed`, quarantine | Нет подтверждения физической остановки. Не запускать второй runtime/daemon, не повторять вопросы и не считать timeout выгрузкой. Сохранить последующие строки того же терминала; разрешить ownership/cleanup проблему прежде нового старта |

В игре один runtime/одна модель, `maxConcurrent: 1`, ≤4 unfinished и ≤1 на игрока. Общая цель RAM ≤4 000 000 000 байт требует аппаратной приёмки; RSS watchdog сам её не доказывает. Не повышать concurrency, RAM/token/output limits и не отключать ownership/cancel/tokenizer checks.

`npc: unavailable` оставляет мир доступным, но LLM не работает. После подтверждённого cleanup возможна ограниченная попытка восстановления; старый вопрос автоматически не повторяется. При повторяющейся ошибке остановить пробу и передать коды/версии/условия разработчику, без секретов и полных диалогов.

Отдельный `node server/llm/diagnose.mjs` разрешён только оператору на Intel Mac с уже подготовленным Ollama и **остановленной игрой**; это реальный inference, не шаг установки. У него собственный 30-секундный бюджет вопроса, он не наследует `NPC_TIMEOUT=60` и не доказывает игровой end-to-end результат. Порядок/cleanup — [MAC-INTEL.md](MAC-INTEL.md). На машине Pi его не выполнять.

## 11. MLX: только подготовленный text-only snapshot, не turnkey-конвертация

Этот альтернативный backend выбирает оператор **только на Apple Silicon**. Не устанавливать MLX в Ollama venv и не использовать его как fallback для Intel.

Подготовить отдельное MLX-окружение:

```sh
make llm-prepare BACKEND=mlx
```

Путь по умолчанию — `~/kuda-llm/mlx-venv`, lock — `envs/mlx/uv.lock`. Существующее legacy-окружение сохраняется; другой путь задаётся `node server/llm/prepare.mjs mlx --environment /absolute/new/mlx-venv` и затем явно переносится в `npc.options.python`/выбранный профиль.

Подготовка пакетов выполняется до игры на машине оператора. Ожидается `mlx-lm==0.32.2`, Jinja2 3.1.6. Требуется заранее проверенный **post-trained Qwen3.5-2B**, `model_type=qwen3_5`, text-only, quantization **4-bit/group64**, локальные tokenizer/template, лицензия/provenance. Для исходника использовать закреплённую revision 2B из раздела 5, а не Base/latest; эта revision сама по себе не превращает исходную multimodal-поставку в допустимый MLX-артефакт.

В [MLX-сценарии скилла](../../.agents/skills/install-local-ai/references/mlx.md) и [README.md](README.md#подготовка-mlx) приведён кандидат `mlx_lm.convert` с `--q-bits 4 --q-group-size 64`. **Он не выполнен и UNVERIFIED.** Здесь нет подтверждённой команды скачивания готовых подходящих MLX-весов и нет обещания рабочей конвертации с нуля. Она может требовать больше 4 GB на машине подготовки. Без полученного и проверенного snapshot остановиться; выбрать Ollama можно только отдельно и явно.

Отвергать VLM: отсутствие `vision_config`/`audio_config`, отсутствие vision/visual/audio tensors во всех safetensors, корректные quantization metadata и реальная загрузка обязательны. Нельзя маскировать VLM удалением полей JSON. Исходные `.py`, которые копирует converter, не включать в окончательную исполняемую поставку; подготовленный snapshot должен сохранить tokenizer/template/license/provenance. Изменения артефакта завершить **до** закрепления manifest.

Оператор указывает реальный абсолютный каталог, например через `KUDA_MLX_MODEL_DIR` (значение не дано намеренно: работающая поставка не подтверждена). Создать inventory **уже проверенного** snapshot:

```sh
node server/llm/manifest.mjs "$KUDA_MLX_MODEL_DIR" "$HOME/kuda-llm/model-sha256.json"
```

Следующий metadata-only блок создаёт новый config, не запускает MLX. Он требует существующий доверенный артефакт; структурная проверка не доказывает происхождение/успех конвертации:

```sh
"$HOME/kuda-llm/mlx-venv/bin/python3" -B - <<'PY'
import importlib.metadata, json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path('server/llm').resolve()))
from local_common import verify_manifest
from mlx_worker import Runtime
base = Path.home() / 'kuda-llm'
if os.path.lexists('server/config.json') or os.path.lexists(base / 'profiles.json'):
    raise SystemExit('Stop: existing config/catalog; do not replace a prepared installation')
model = Path(os.environ['KUDA_MLX_MODEL_DIR'])
if not model.is_absolute() or not model.is_dir():
    raise SystemExit('Stop: provide an absolute prepared model directory')
version = importlib.metadata.version('mlx-lm')
if version != '0.32.2':
    raise SystemExit('Stop: incompatible mlx-lm version')
inventory = base / 'model-sha256.json'
verify_manifest(model, inventory)
Runtime._check_artifact(model)
config = json.loads(Path('server/config.mlx.example.json').read_text())
config.update(host='127.0.0.1', port=8080, defaultMap='demo')
config['npc']['options'].update(python=str(base / 'mlx-venv/bin/python3'),
    modelDir=str(model), modelManifest=str(inventory), runnerVersion=version)
fd = os.open('server/config.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as out:
    json.dump(config, out, ensure_ascii=False, indent=2)
    out.write('\n')
print('Created MLX config; actual loading/offline/RAM/quality remain unverified')
PY
```

Затем применимы создание нового каталога из раздела 7 и ежедневный запуск из раздела 8; явная пара — `BACKEND=mlx MODEL=2b`. MLX/0.8B этим срезом не поддерживается. Проверка worker-ом файлов/API/прогрева обязательна и не заменяется create-only config.

## Что остаётся проверить на реальном компьютере

Проверки документа, TS/Python fixtures и fake responders не доказывают загрузку модели, скорость, качество, peak RAM ≤4 GB, остановку всего native process tree, физическую LAN или OS-изоляцию. Отдельно принять выбранные runtime/артефакт/tokenizer, полноценный ответ в игре, отмену/cleanup/recovery, нагрузку до 4 игроков и действительно offline-старт. Пока нет этих наблюдений, профиль остаётся **неквалифицированным**, даже если инструкция и startup прошли без ошибок.
