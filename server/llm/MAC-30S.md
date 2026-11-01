# Согласованный игровой deadline30с на уже подготовленном Mac

Оператор явно согласовал **30 секунд на полный NPC-ответ** вместо прежних8с. Это общий серверный срок **вместе с очередью**, не30с после старта каждого ожидавшего вопроса. Server default/max30000мс, supervisor ceiling30с и более ранний request.deadlineAt, клиентский NPC pending32с. Прогресс не продлевает срок. Другие клиентские запросы/login/connect, очередь≤4/1на игрока, memory/token/output guards и physical-stop/quarantine не меняются. Wire shapes PROTOv1 те же, streaming не добавлен.

Изменение ожидания не исправляет ошибки/вымыслы модели и не доказывает целевой p95≤8с. Реальный30с игровой ответ ещё требует проверки. Не менять модель или tokenizer, не скачивать веса и не переустанавливать зависимости. Ничего запускать на сервере с Pi не нужно.

Для уже подготовленных2B/0.8B можно вместо ручной миграции ниже использовать [разовый импорт профилей](PROFILES.md). Он также выполняет8000→30000 с backup, если это ещё не сделано, и возвращает сохранённый выбор2B. Не выполнять обе миграции вслепую: при уже30000 ни один инструмент не должен возвращать8с.

## Обновление существующей установки

Остановить игру/диагностику через Ctrl+C, дождаться shell prompt. Подготовительный Ollama daemon также должен быть остановлен. Существующий config не редактировать параллельно.

Из корня существующего checkout на **Mac оператора**:

```sh
git switch npc-llm-clean-start &&
git pull --ff-only origin npc-llm-clean-start
```

Если команда отказала, остановиться и сохранить вывод. При успехе обновить только timeout.

**Следующий блок заменит `server/config.json`, сохранив исходные bytes в новом0600backup `~/kuda-llm/config-before-30s.json`.** Он не меняет модель, tokenizer, digest, runtime или другие настройки. Backup не перезаписывается. Проверка source bytes перед replace не является atomic compare-and-swap, поэтому параллельное редактирование запрещено.

```sh
"$HOME/kuda-llm/venv/bin/python3" - <<'PY'
import json, os, tempfile
from pathlib import Path
p = Path('server/config.json')
if p.is_symlink() or not p.is_file():
    raise SystemExit('Expected regular server/config.json')
raw = p.read_bytes()
c = json.loads(raw)
if c['npc'].get('timeoutMs', 30000) != 8000:
    raise SystemExit('Expected existing 8000 ms config; stop and review')
c['npc']['timeoutMs'] = 30000
backup = Path.home() / 'kuda-llm' / 'config-before-30s.json'
fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'wb') as saved:
    saved.write(raw)
    saved.flush()
    os.fsync(saved.fileno())
tmp = None
try:
    with tempfile.NamedTemporaryFile('w', encoding='utf8', dir=p.parent,
                                     prefix='.config-30s-', delete=False) as out:
        tmp = Path(out.name)
        json.dump(c, out, ensure_ascii=False, indent=2)
        out.write('\n')
        out.flush()
        os.fsync(out.fileno())
    if p.is_symlink() or p.read_bytes() != raw:
        raise SystemExit('Config changed; replacement cancelled, backup retained')
    os.replace(tmp, p)
finally:
    if tmp is not None and tmp.exists():
        tmp.unlink()
print('NPC timeout: 30000 ms; model/pins unchanged; backup:', backup)
PY
```

При отказе не повторять блок и не удалять backup вслепую: сначала проверить сообщение. Если config уже содержит30000мс, этот create-only migration сознательно останавливается без изменений. Восстановление backup вернёт прежний8000мс срок, не потребует новых весов.

## Пересобрать именно обслуживаемый клиент

В том же checkout/терминале:

```sh
export PATH="$HOME/kuda-llm/tools/node-v24.22.2-darwin-x64/bin:$HOME/kuda-llm/tools/ollama-0.40.13:$PATH"
npm --prefix client run build
```

Это обязательно: старый `client/dist` обрывает pending через10с, даже если сервер уже ждёт30с. При ошибке сборки не запускать сервер с прежним dist как «обновлённый». Новый install/clone/model pull не нужен, используются уже подготовленные зависимости. Если настроен нестандартный `clientDir`, раздаваемый каталог должен содержать именно новую сборку; default — `client/dist`.

После успешной сборки:

```sh
npm --prefix server start
```

Отдельный `ollama serve` не запускать: owned worker управляет своим runtime. Дождаться `NPC готов к вопросам`, открыть `http://localhost:8080/` и **перезагрузить страницу**, чтобы получить новый JS. Не оставлять старую вкладку со старым client10с.

Отправить торговке тканями один вопрос «Привет!». Сохранить полный ответ UI и строку `Этапы ответа NPC` либо error из терминала. На30с timeout ответ отклоняется целиком, partial не сохраняется; поздний ответ не становится успешным. Остановка/освобождение процесса контролируются отдельно, логический timeout не означает моментальную физическую выгрузку. При неподтверждённом cleanup не запускать второй экземпляр.

Следующие проверки качества/серии запросов/RAM/burst остаются отдельной приёмкой. Один доставленный ответ не закрывает TASK-030/017/018.
