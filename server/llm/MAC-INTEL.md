# Ручной пробный запуск на Intel Mac

Это инструкция для **компьютера оператора**, не для сервера разработки. Подготовка скачивает npm/Python-пакеты, tokenizer и веса; нужна сеть. Во время игры скачивания нет. Этот путь не проверен на настоящем Intel Mac. Совместимость установленной Ollama с CPU/macOS, RAM, tokenizer/GGUF и 8-секундный deadline ещё требуют проверки. Если шаг завершился ошибкой, не продолжать следующие блоки.

Команды выполняются из корня проекта в Terminal (zsh/bash). Используется отдельный `$HOME/kuda-llm`, без изменения пользовательского хранилища Ollama. Каталоги tokenizer и manifests для первого запуска должны быть новыми; инструкция не перезаписывает pin/config.

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

Нужны Node 24.15+ в пределах 24.x, Python 3.12 и Ollama с поддержкой данного Intel Mac/macOS. Если Homebrew уже установлен, кандидат установки:

```sh
brew install node@24 python@3.12 ollama
export PATH="$(brew --prefix node@24)/bin:$PATH"
node --version
python3.12 --version
command -v ollama
```

Homebrew/текущая формула Ollama могут не поддерживать конкретную версию Intel macOS. Ошибка установки не обходится выбором MLX: MLX требует Apple Silicon. Использовать совместимый официальный runtime; этот документ не утверждает, что он проверен. Не выполнять `brew services start ollama`: игровому worker нужен собственный процесс.

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
mkdir -p "$HOME/kuda-llm/models"
OLLAMA_MODELS="$HOME/kuda-llm/models" \
OLLAMA_HOST=127.0.0.1:11501 \
OLLAMA_NO_CLOUD=1 \
ollama serve
```

Он занимает терминал — это нормально. Если порт занят, не завершать чужие процессы наугад. Найти и штатно остановить свой предыдущий экземпляр либо изменить порт последовательно во всех командах/config.

В терминале B:

```sh
OLLAMA_HOST=127.0.0.1:11501 ollama pull qwen3.5:2b-q4_K_M
curl --fail --silent --show-error http://127.0.0.1:11501/api/version > "$HOME/kuda-llm/ollama-version.json"
```

После успешного завершения вернуться в терминал A и нажать **Ctrl+C**. Подготовительный daemon должен остановиться до запуска игры. Не выполнять `ollama run`: для подготовки нужен только pull.

## 4. Tokenizer без вторых весов

В терминале A, из корня проекта, выполнить весь блок. Он скачивает только выбранные root-файлы tokenizer/template/config из закреплённой ревизии, не safetensors/GGUF. Загруженные файлы копируются из HF cache как обычные файлы, без symlinks.

```sh
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

Если `server/config.json` уже существует, сначала сохранить свою копию и согласовать объединение. Следующий блок **откажется перезаписывать** его. Он получает SHA-256 из bytes подготовленного Ollama manifest и версию из ответа daemon, не из случайной строки CLI.

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

Не закрывать терминал. Startup проверки/загрузка/прогрев могут занять до 120 с. Затем открыть в браузере:

- **http://localhost:8080/api/health** — нужен `npc: "ready"` для доступного NPC.
- **http://localhost:8080/** — войти по имени, подойти к NPC и задать короткий вопрос.

`npc: unavailable` — реальная модель не стартовала; мир остаётся доступен. Не считать scripted-фразу доказательством LLM. При ошибке сохранить безопасный startup-log и вывод health. Если `ready`, но игровые вопросы истекают, CPU может не укладываться в v1 deadline. Не увеличивать deadline сверх 9 с и не обходить memory/tokenizer guards ради демонстрации.

Повторный запуск после успешной подготовки: перейти в корень проекта, активировать Node 24 в PATH при необходимости и выполнить `npm --prefix server start`. Веса/venv/tokenizer/config сохраняются. Offline запуск проверяется отдельно после первого успешного online-подготовленного старта.
