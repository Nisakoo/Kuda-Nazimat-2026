---
status: accepted
date: 2026-11-01
decision-makers: команда проекта
---

# Встроенная история метрик и графики в админке вместо Prometheus и Grafana

## Context and Problem Statement

Внешний стек Prometheus/Grafana ([0010](0010-prometheus-grafana-optional-monitoring.md)) требовал интернета для установки и около 300 МБ RAM рядом с бюджетом LLM, а игра должна работать офлайн. Нужно получить историю метрик и графики без внешних компонентов.

## Decision Drivers

* Офлайн: без установки с интернетом ([0001](0001-offline-without-internet.md)).
* Память нужна LLM (бюджет 4 ГБ, [0008](0008-single-local-llm-with-budget.md)).
* Администратор не обязан быть программистом; один экран с состоянием.
* Метрики и логи не содержат данных игроков.

## Considered Options

* Встроенный реестр метрик, история в памяти, графики на странице админки, минутная запись в журнал и отчёт приёмки (выбрано)
* Prometheus/Grafana (отвергнуто, см. [0010](0010-prometheus-grafana-optional-monitoring.md))

## Decision Outcome

Сервер сам держит реестр метрик без зависимостей, делает кадр истории раз в 10 с в кольцевой буфер на 1440 кадров (4 часа), отдаёт его панели администратора (`/api/operator/status`, `/history`, `/metrics`), пишет событие `metrics.minute` раз в минуту в журнал и формирует отчёт приёмки `npm --prefix server run report`. Графики рисуются SVG без внешних библиотек. `GET /metrics` Prometheus и `monitoring.token` удалены. Пороги заданы в одном месте кода и общие для плиток, графиков и отчёта.

### Consequences

* Good: ничего не нужно ставить; нет лишней RAM; офлайн.
* Bad: история хранится 4 часа в памяти и в минутных событиях журнала; отдельной базы временных рядов нет.
* Bad: нет внешних сборщиков и дашбордов (Prometheus, Grafana, Loki, Elasticsearch — вне scope).
* Bad: пороги RTT 150 мс и FPS 30 предварительные, не измерены на целевых ноутбуках.

### Confirmation

`metrics-history.test.ts`, `observability.test.ts`; сценарий: сервер проработал 3 минуты — три события `metrics.minute`; конфигурация с `monitoring.token` отклоняется при запуске.

## Pros and Cons of the Options

### Встроенная история

* Good: без интернета и лишней памяти; один источник данных для панели, отчёта и нагрузочного профиля.
* Bad: нет сравнения запусков и истории старше 4 часов, кроме отчёта по файлам журнала.

### Prometheus/Grafana

* Bad: установка с интернетом и около 300 МБ RAM.

## More Information

[../tech/server.md](../tech/server.md) (раздел про наблюдаемость), [../tech/operations.md](../tech/operations.md). Заменяет [0010](0010-prometheus-grafana-optional-monitoring.md).
