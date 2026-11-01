# Мониторинг сервера (необязательно, для разработчика)

[OBS-009](../../specs/server-observability.md): Prometheus собирает `/metrics` сервера, Grafana показывает готовый дашборд «Вавилон — сервер». Для игры и экрана ведущего `/operator` стек не нужен. Ставится заранее, пока есть интернет. Цена на сервере — около 300 МБ RAM: учитывайте её рядом с бюджетом LLM.

## Установка (с интернетом)

Скачайте standalone-архивы для своей ОС: [Prometheus](https://prometheus.io/download/) и [Grafana OSS](https://grafana.com/grafana/download?edition=oss). Docker не требуется.

## Запуск

Из этого каталога (`ops/monitoring`):

```sh
prometheus --config.file=prometheus.yml --storage.tsdb.retention.time=7d
```

Grafana: в `grafana/provisioning/dashboards/babylon.yml` замените `path` на абсолютный путь к `ops/monitoring/grafana/dashboards`, затем запустите Grafana с этим каталогом provisioning:

```sh
GF_PATHS_PROVISIONING=<абсолютный путь>/ops/monitoring/grafana/provisioning grafana server --homepath <каталог Grafana>
```

В Windows (PowerShell): `$env:GF_PATHS_PROVISIONING='<путь>'; .\bin\grafana.exe server`.

Откройте `http://localhost:3000` (по умолчанию admin/admin) → дашборд «Вавилон — сервер».

## С другого ноутбука

1. В `server/config.json` задайте `monitoring.token` — строку от 32 символов.
2. В `prometheus.yml` укажите LAN-адрес сервера в `targets` и раскомментируйте `authorization` с этим токеном.

Без токена `/metrics` из сети отвечает 404; токен даёт доступ только к `/metrics`.

## Логи

Стек логи не собирает. Они лежат в `server/data/logs/`: `server-*.jsonl` — журнал, `incident-*.jsonl` — отчёты бортового самописца. Пример разбора: `jq 'select(.level=="error")' server/data/logs/server-*.jsonl`.

Конфигурация проверена только на синтаксис: на машине разработки Prometheus и Grafana не запускались.
