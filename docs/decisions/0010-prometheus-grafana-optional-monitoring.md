---
status: "superseded by 0011"
date: 2026-11-01
decision-makers: команда проекта
---

# Мониторинг: необязательный внешний стек Prometheus и Grafana

## Context and Problem Statement

Разработчику и администратору нужны история метрик и графики состояния сервера (игроки, шаг, ping, память). Первая редакция наблюдаемости предусматривала экспорт метрик в формате Prometheus и необязательный стек Grafana.

## Decision Drivers

* История метрик и графики во время и после игры.
* Метрики не должны содержать данных игроков.

## Considered Options

* Необязательный стек Prometheus/Grafana (`ops/monitoring/`), доступ к `GET /metrics` по `monitoring.token` (выбрано в первой редакции)
* Встроенная история в сервере (позже выбрана, см. [0011](0011-builtin-metrics-history.md))

## Decision Outcome

Принят необязательный внешний стек: `GET /metrics` в формате Prometheus с секретом доступа. Решение позднее заменено — см. [0011](0011-builtin-metrics-history.md). Ключ `monitoring.token` и `/metrics` удалены; конфигурация с `monitoring.token` отклоняется как неизвестная.

### Consequences

* Bad: стек требовал установки с интернетом и около 300 МБ RAM рядом с бюджетом LLM (причина замены).

### Confirmation

Не применимо: решение заменено.

## Pros and Cons of the Options

### Prometheus/Grafana

* Good: готовые средства графиков.
* Bad: установка требует интернета; около 300 МБ RAM рядом с бюджетом LLM 4 ГБ.

## More Information

Заменено: [0011](0011-builtin-metrics-history.md). Дата установлена по истории git (наблюдаемость реализована 2026-11-01); точное время решения в источниках не указано.
