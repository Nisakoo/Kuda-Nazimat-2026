# MLX на Apple Silicon

Читать после `tools.md`. Нужны macOS arm64, Python-окружение `make llm-prepare BACKEND=mlx` и свободное место для исходных и квантованных весов. Подготовка может потреблять больше игрового лимита 4 GB. **Конвертация и настоящий игровой MLX-профиль пока не прошли аппаратную приёмку**; скрипт делает путь повторяемым, но не превращает fixture-проверки в inference acceptance.

## Получение и конвертация закреплённой модели

Выполнять последовательно, при ошибке следующий этап не запускать:

```sh
"$HOME/kuda-llm/mlx-venv/bin/python3" -B \
  .agents/skills/install-local-ai/scripts/mlx_model.py download

"$HOME/kuda-llm/mlx-venv/bin/python3" -B \
  .agents/skills/install-local-ai/scripts/mlx_model.py convert

"$HOME/kuda-llm/mlx-venv/bin/python3" -B \
  .agents/skills/install-local-ai/scripts/mlx_model.py check
```

`download` получает только закреплённый Qwen/Qwen3.5-2B snapshot; каталог source связан с revision marker, незнакомый существующий каталог не принимается. `--offline` разрешает только кеш. `convert` использует локальный исходник, `mlx_lm.convert -q --q-bits 4 --q-group-size 64`, без remote code и сети; существующий output не перезаписывается. `check` использует тот же структурный guard, что игровой worker. Не редактировать vision_config вручную для обхода отказа. Исходник включает vision; text-only результат получает converter, а не удаление поля JSON.

Все шаги принимают `--root /absolute/new/kuda-llm`; по умолчанию `~/kuda-llm`. Скрипт сохраняет источник/ревизию, README и доступные LICENSE исходника в выходной артефакт. Если конвертация прервалась, сохранить output для диагностики и выбрать новый каталог; не объявлять частичный результат готовым.

Для уже подготовленного совместимого snapshot можно сразу проверить его существующим `Runtime._check_artifact` по SETUP §11; скачивание повторно не нужно.

## Manifest и config

После успешного check:

```sh
export KUDA_MLX_MODEL_DIR="$HOME/kuda-llm/qwen35-2b-text-4bit"
node server/llm/manifest.mjs "$KUDA_MLX_MODEL_DIR" "$HOME/kuda-llm/model-sha256.json"
```

Manifest create-only; дальнейшее изменение snapshot потребует нового принятого manifest, а не отключения проверки. Создать config проверяемым Python-блоком **§11 `server/llm/SETUP.md`**: он проверяет package version, структуру и manifest, отказывает поверх существующих config/catalog. Не копировать example placeholders. Поля: `npc.adapter: mlx`, `python: ~/kuda-llm/mlx-venv/bin/python3` (абсолютно), `modelDir`, `modelManifest`, `runnerVersion: 0.32.2`.

Для рынка изменить только `defaultMap: market`, `language: {adapter: local, options: {}}`. Для селекторов `BACKEND=mlx MODEL=2b` создать каталог по §7 SETUP. Без него прямой config запускается без BACKEND/MODEL.

## Первый запуск

После `make prepare` и создания config:

```sh
make start NPC_TIMEOUT=30
```

С созданным профилем: `make start BACKEND=mlx MODEL=2b NPC_TIMEOUT=30`. Не запускать отдельный `mlx_lm.server`: worker сам владеет моделью. Проверить `/api/health` (`npc: ready`), затем вопрос в игре; в market изучаемый en/es. Проверить повторный запуск без внешней сети, отмену, память и время отдельно. В отчёте разделять структурную проверку, startup и качество.
