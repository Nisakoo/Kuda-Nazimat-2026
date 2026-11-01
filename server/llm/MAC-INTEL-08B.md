# Проверка Qwen3.5‑0.8B на уже подготовленном Intel Mac

Этот профиль выбран оператором после неуспешных игровых8с-прогонов2B. **Модели и веса запускаются/скачиваются только на Mac оператора, не на сервере с Pi.** Ничего переустанавливать, повторно клонировать или скачивать2B не нужно. Старые веса и tokenizer2B сохраняются.

Точный tag — **`qwen3.5:0.8b-q8_0`**, Q8_0. Не использовать общий `0.8b`: его опубликованный пакет включает отдельный MTP/draft. Тега `0.8b-q4_K_M` нет. Metadata explicit Q8-пакета: model811843520байт + projector207346304байта, около1.02GB суммарно; это не измерение RAM. Адаптер отвергает отдельные draft layers и задаёт `draft_num_predict: 0`. Возможные embedded tensors/загрузка projector и реальная память остаются непроверенными.

После последующего явного согласования игровой default/max deadline —30с, клиент ждёт NPC32с (остальные запросы10с); модель сама не переключается. Существующий config8с не обновляется автоматически: [MAC-30S.md](MAC-30S.md) описывает отдельную смену timeout с backup и пересборку клиента. Скорость и качество0.8B пока не квалифицированы. Пример полного профиля — [config.ollama-08b.example.json](../config.ollama-08b.example.json), но им **не надо затирать** уже рабочие настройки.

Если обе модели уже подготовлены, повторять блоки скачивания/переключения config ниже не надо: [PROFILES.md](PROFILES.md) переносит существующие2B/0.8B и позволяет `make server BACKEND=ollama MODEL=0.8b`. После переноса выбор хранится во внешней коллекции, не в старых npc.adapter/options.

## 1. Скачать только новый пакет (2 терминала)

Сначала остановить игру/диагностику через Ctrl+C и дождаться shell prompt. Не запускать несколько daemon. Команды используют уже установленный Ollama0.40.13 и существующий внешний store.

В терминале A:

```sh
env HOME="$HOME/kuda-llm/prepare-home" \
  OLLAMA_MODELS="$HOME/kuda-llm/models" \
  OLLAMA_HOST=127.0.0.1:11501 OLLAMA_NO_CLOUD=1 \
  "$HOME/kuda-llm/tools/ollama-0.40.13/ollama" serve
```

Убедиться, что терминал A остаётся занят и сообщает, что **этот** daemon слушает `127.0.0.1:11501`. Если процесс завершился, вернул shell prompt или сообщил о занятом порте, **не выполнять pull в терминале B**: иначе запрос может попасть к чужому daemon. Не завершать чужие процессы наугад.

В терминале B:

```sh
env HOME="$HOME/kuda-llm/prepare-home" OLLAMA_HOST=127.0.0.1:11501 \
  "$HOME/kuda-llm/tools/ollama-0.40.13/ollama" pull qwen3.5:0.8b-q8_0
```

После `success` остановить подготовительный daemon через **Ctrl+C в терминале A**. Ни `ollama run`, ни второй игровой сервер не нужны.

## 2. Отдельный pinned tokenizer, без вторых весов

Из корня существующего checkout на Mac. Следующий блок скачивает только6перечисленных tokenizer/config файлов из закреплённой ревизии, **не** safetensors/GGUF. Он создаёт новый каталог и отказывает, если такой уже существует: после прерванной подготовки не удалять прежние файлы вслепую.

```sh
env HF_HOME="$HOME/kuda-llm/hf-cache" HF_HUB_DISABLE_TELEMETRY=1 \
  "$HOME/kuda-llm/venv/bin/python3" - <<'PY'
from pathlib import Path
import shutil
from huggingface_hub import hf_hub_download
repo = 'Qwen/Qwen3.5-0.8B'
revision = '2fc06364715b967f1860aea9cf38778875588b17'
out = Path.home() / 'kuda-llm' / 'tokenizer-qwen35-08b'
out.mkdir(exist_ok=False)
for name in ('config.json', 'tokenizer.json', 'tokenizer_config.json',
             'vocab.json', 'merges.txt', 'chat_template.jinja'):
    source = hf_hub_download(repo, name, revision=revision)
    shutil.copyfile(source, out / name)
print('Prepared tokenizer only: Qwen3.5-0.8B', revision)
PY
```

Закрепить hash inventory локальных файлов (без inference):

```sh
"$HOME/kuda-llm/tools/node-v24.22.2-darwin-x64/bin/node" \
  server/llm/manifest.mjs \
  "$HOME/kuda-llm/tokenizer-qwen35-08b" \
  "$HOME/kuda-llm/tokenizer-qwen35-08b-sha256.json"
```

Совпадение template/tokenizer_config с2B не доказывает эквивалентность tokenizer data. Поэтому отдельный source snapshot и manifest обязательны. Runtime сохраняет проверку HF count против фактического runner.

## 3. Явно выбрать0.8B с резервной копией2B

Обновить ветку `npc-llm-clean-start` до версии с этим профилем. Игра и подготовительный daemon должны быть остановлены; параллельно не редактировать config.

**Следующий блок изменит `server/config.json`:** сохранит исходные bytes в новом файле `~/kuda-llm/config-before-08b.json`, затем атомарно заменит только параметры модели/tokenizer/digest. Backup не перезаписывается. Другие настройки сохраняются; веса2B не удаляются. Digest берётся из локального активного manifest, после чего выполняется полная проверка выбранных blobs/anchor/symlinks тем же worker-кодом. Это проверка подготовленных файлов, не запуск модели.

```sh
"$HOME/kuda-llm/venv/bin/python3" - <<'PY'
import hashlib, json, os, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path('server/llm').resolve()))
from ollama_worker import verify_ollama_model
from local_common import verify_manifest

base = Path.home() / 'kuda-llm'
target = Path('server/config.json')
if target.is_symlink() or not target.is_file():
    raise SystemExit('Expected an existing regular server/config.json')
raw = target.read_bytes()
config = json.loads(raw)
npc = config['npc']
if (npc['adapter'] != 'ollama' or npc.get('timeoutMs', 30000) not in (8000, 30000)
        or npc['options']['model'] != 'qwen3.5:2b-q4_K_M'):
    raise SystemExit('Expected an Ollama 2B profile with an approved 8s or 30s deadline; stop and review')
o = npc['options']
model, tag = 'qwen3.5:0.8b-q8_0', '0.8b-q8_0'
tokenizer = base / 'tokenizer-qwen35-08b'
inventory = base / 'tokenizer-qwen35-08b-sha256.json'
verify_manifest(tokenizer, inventory)
models = Path(o['modelsDir']).resolve(strict=True)
manifest = models / 'manifests-v2/ollama.com/library/qwen3.5' / tag
if not manifest.exists() and not manifest.is_symlink():
    manifest = models / 'manifests/registry.ollama.ai/library/qwen3.5' / tag
resolved = manifest.resolve(strict=True)
if not resolved.is_relative_to(models) or not resolved.is_file():
    raise SystemExit('Selected manifest must stay inside the prepared model store')
with resolved.open('rb') as source:
    data = source.read(65537)
if len(data) > 65536:
    raise SystemExit('Selected manifest is too large')
digest = hashlib.sha256(data).hexdigest()
if verify_ollama_model(models, digest, model) != digest:
    raise SystemExit('Expected verified active manifest digest')

o.update(model=model, modelDigest=digest, tokenizerDir=str(tokenizer), tokenizerManifest=str(inventory))
backup = base / 'config-before-08b.json'
fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'wb') as saved:
    saved.write(raw)
    saved.flush()
    os.fsync(saved.fileno())
temporary = None
try:
    with tempfile.NamedTemporaryFile('w', encoding='utf8', dir=target.parent,
                                     prefix='.config-08b-', suffix='.tmp', delete=False) as out:
        temporary = Path(out.name)
        json.dump(config, out, ensure_ascii=False, indent=2)
        out.write('\n')
        out.flush()
        os.fsync(out.fileno())
    if target.is_symlink() or target.read_bytes() != raw:
        raise SystemExit('Config changed during preparation; backup retained, active config not replaced')
    os.replace(temporary, target)
finally:
    if temporary is not None and temporary.exists():
        temporary.unlink()
print('Selected', model, 'digest', digest)
print('Original 2B config preserved; game deadline:', npc.get('timeoutMs', 30000), 'ms')
PY
```

Если блок отказал, не редактировать pin вручную и не удалять backup, чтобы «пройти дальше». Сохранить сообщение и проверить подготовку. Для ручного возврата после остановки игры можно восстановить сохранённый `config-before-08b.json` в `server/config.json`; это вновь заменит активный config, но не требует скачивания2B.

## 4. Проверить, затем играть

Сначала один отдельный диагностический прогон с уже выбранным0.8B:

```sh
"$HOME/kuda-llm/tools/node-v24.22.2-darwin-x64/bin/node" server/llm/diagnose.mjs
```

Он имеет собственный30с предел только для измерения и сохраняет RAM/cancel guards. Ответ за30с сам по себе не квалифицирует текущий игровой лимит30с/целевую скорость8с: в игре иная нагрузка, а очередь входит в общий deadline. Дождаться `cleanup_confirmed`; при quarantine не запускать второй runtime. Сохранить `response`/`failure` и `final` — это проверка скорости и первого фактического текста, не учебного качества.

Затем обычный игровой запуск:

```sh
export PATH="$HOME/kuda-llm/tools/node-v24.22.2-darwin-x64/bin:$HOME/kuda-llm/tools/ollama-0.40.13:$PATH"
npm --prefix server start
```

После `NPC готов к вопросам` проверить ответ в игре, затем несколько коротких вопросов по теме NPC и честное признание незнания. Качество/язык/ложные факты/задержки фиксировать отдельно. Меньшее число параметров и один удачный ответ не доказывают стабильную скорость или достаточное качество.

## Источники metadata

- [Явный Q8_0 tag](https://ollama.com/library/qwen3.5:0.8b-q8_0), [manifest](https://registry.ollama.ai/v2/library/qwen3.5/manifests/0.8b-q8_0), [официальный каталог](https://ollama.com/library/qwen3.5/tags).
- [Закреплённый HF source](https://huggingface.co/Qwen/Qwen3.5-0.8B/tree/2fc06364715b967f1860aea9cf38778875588b17).
- [Ollama0.40.13 draft handling](https://github.com/ollama/ollama/blob/v0.40.13/llm/llama_server.go): отключение speculative args не является доказательством отсутствия embedded tensors/RAM-затрат. Поэтому отдельные draft layers запрещены, а hardware qualification остаётся открытой.
