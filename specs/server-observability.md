---
id: server-observability
type: module-design
status: ready
implementation: partial
parent: architecture
summary: Логи, бортовой самописец, проверки инвариантов, метрики, экран ведущего и необязательный стек Prometheus/Grafana — чтобы ловить в том числе скрытые и плавающие ошибки без интернета и без данных игроков.
related:
  - server-foundation.md
  - offline-multiplayer.md
  - server-auth.md
  - server-realtime.md
  - server-npc-dialogue.md
  - server-persistence.md
  - server-admin.md
  - server-npc-content.md
---

# OBS — Наблюдаемость сервера

## Цель

По логам и метрикам после урока разработчик восстанавливает, что произошло, включая ошибки, которые не воспроизводятся. Ведущий во время урока видит, всё ли в порядке, и понимает причину, если нет. Всё работает офлайн, на ноутбуке ведущего, без внешних сервисов и без утечки данных школьников. Нагрузка наблюдаемости не мешает игровому шагу.

Реализовано на сервере ([TASK-043](../tasks/043-server-observability.md)); стек OBS-009 подготовлен, но с настоящими Prometheus и Grafana не запускался — поэтому implementation: partial.

## Требования

### Логи

- **OBS-001 (формат):** каждое событие — JSON-объект в одну строку:
  - `ts` (ISO 8601 с мс), `seq` (монотонный номер в процессе), `runId` (случайный ID запуска процесса), `level` (`debug`, `info`, `warn`, `error`, `fatal`), `module`, `event` (стабильный машинный идентификатор вида `auth.login.failed`), `msg` (короткий текст по-русски);
  - контекст, когда он есть: `playerId`, `accountId`, `sessionId` (AUTH-002), `connectionId`, `requestId`, `mapId`, `ip`, `durationMs`;
  - ошибка — `error: {name, message, stack, code}`; stack только для ошибок сервера, не для ошибок ввода игрока.

  Имена `event` перечислены в каталоге OBS-003 и не переименовываются без правки спеки: по ним строятся фильтры и дашборды.
- **OBS-002 (куда пишутся):**
  - **файл** `data/logs/server-<дата>-<runId>.jsonl` — всё от уровня `logs.fileLevel` (по умолчанию `debug`, кроме событий высокой частоты OBS-012). Новый файл — при старте и по достижении 20 МБ. Общий объём каталога ≤ `logs.maxTotalMb` (200 МБ) и срок ≤ `logs.retentionDays` (14): при превышении удаляются самые старые файлы. Запись асинхронная через ограниченный буфер (1 МБ); при переполнении события отбрасываются, считаются, и раз в 10 с пишется `log.dropped` с числом потерь. При `error`, `fatal` и штатной остановке буфер сбрасывается на диск до продолжения;
  - **консоль** — человекочитаемая строка от `logs.consoleLevel` (по умолчанию `info`) для ведущего; формат консоли не является интерфейсом.

  Ошибка записи файла (нет места, нет прав) не останавливает игру: событие `log.sink.failed` уходит в консоль, файловый вывод повторяется раз в минуту.
- **OBS-003 (каталог обязательных событий):** перечень — минимум; новые подсистемы добавляют свои события в каталог этой спеки.

  | Область | События (уровень) |
  |---|---|
  | Процесс | `app.start` (info: окружение, версия сервера, git-коммит если доступен, Node, ОС, итоговая конфигурация без секретов), `app.start.failed` (error/fatal), `app.ready`, `app.signal`, `app.stop`, `app.stop.phase` (info: фаза и длительность), `app.stop.done`, `app.stop.failed`, `app.stop.timeout`, `auth.passwordless.enabled` (warn), `process.uncaught` и `process.unhandled_rejection` (fatal, со стеком и дампом OBS-004), `process.warning` (warn), `process.event_loop_lag` (warn: p99 задержки > 50 мс за минуту), `process.memory` (debug раз в минуту: rss, heapUsed, external) |
  | Конфигурация и мир | `config.invalid` (fatal), `world.loaded` (info на карту: чанки, worldBytes, время), ошибка мира — `app.start.failed`, `world.file.read_failed` (error), `world.access` (info при `logWorldAccess`) |
  | HTTP | `http.request` (debug для `/world/*` и state BABEL, info для остальных API: метод, шаблон пути без параметров, статус, длительность, байты, ip, sessionId), `http.failed` (error: необработанная ошибка обработчика), `http.rate_limited` (warn, агрегировано OBS-012) |
  | Вход | `auth.guest`, `auth.register`, `auth.login` (info: accountId, имя, ip, sessionId), `auth.login.failed` (warn: ключ имени, ip, причина `credentials` / `not_set` / `required` / `locked`), `auth.locked` (warn), `auth.password.changed`, `auth.logout`, `auth.session.revoked` (info: причина, число), `auth.operator.action` (info: действие, имя аккаунта), `auth.operator.rejected` (warn: действие без защиты CSRF) |
  | Realtime | `realtime.handshake.rejected` (info: код, причина, ip), `realtime.handshake.failed` (error), `realtime.connect` (info: ip, sessionId), `realtime.join` (info: mapId, ip), `realtime.disconnect` (info: причина Socket.IO и итоги соединения — отброшенный ввод, неверные пакеты, RTT), `realtime.closed_by_server` (info: причина), `realtime.packet.invalid` (debug: тип, код), `realtime.packet.flood` (warn: отключение за флуд), `realtime.rate_limited` (debug, чат) |
  | Игра | `game.seat.attach` (info: перехват, число переподключений), `game.seat.detach`, `game.seat.release` (info), `game.spawn` (debug), `game.spawn.fallback` (warn: нет свободной точки), `game.motion.recovered` (warn: recoveryReason MOVE), `game.aoi.truncated` (warn: больше 256 сущностей), `game.delta.large` (warn: пакет > 75% лимита), `game.packet.oversize` (error: пакет больше лимита, не отправлен), `game.tick.slow` (warn: шаг > 50 мс, с числом игроков), `game.tick.stats` (info раз в минуту: p50, p95, max шага и интервала рассылки) |
  | NPC и язык | `npc.request.accepted`, `npc.request.started`, `npc.request.first_partial` (debug), `npc.request.completed`, `npc.request.cancelled` (info), `npc.request.failed`, `npc.request.timeout`, `npc.request.error` (warn: исключение ответчика) — с видом (npc, npc-stream, chat, suggest, babel-npc), длительностями ожидания и генерации, длиной ответа в символах; `npc.rejected` (info), `npc.slot.stuck` (error), `npc.responder.ready`/`language.ready` (info), `npc.responder.unavailable`/`language.unavailable` (error), `babylon.action` (info: тип, результат, длительность), `babylon.language` (debug), `babylon.translation.failed` (warn) |
  | Хранилище | `db.opened` (info: путь, версия схемы), `db.operation.failed` (warn: каждая неудачная операция хранилища), `db.transaction.failed` (error: с контекстом вызывающего), `db.slow` (warn: операция > 50 мс) |
  | Клиент | `client.error`, `client.perf` (OBS-011) |
  | Наблюдаемость | `log.dropped`, `log.sink.failed`, `obs.incident.dumped`, `invariant.violated` (OBS-005) |

- **OBS-004 (бортовой самописец):** в памяти всегда хранится кольцевой буфер последних 5000 событий уровня `debug` и выше, включая события высокой частоты в сокращённой форме, независимо от уровней вывода. Он сбрасывается в файл `data/logs/incident-<ts>-<runId>.jsonl`:
  - при первом событии `error` или `fatal` (не чаще раза в минуту, следующие учитываются счётчиком в следующем дампе);
  - при `invariant.violated`;
  - по кнопке ведущего «Сохранить отчёт» на `/operator`.

  Дамп содержит буфер, снимок метрик OBS-007 и сводку состояния (места, соединения, очередь NPC), без секретов и текстов OBS-006. Так у плавающей ошибки есть подробная история перед ней, даже если `fileLevel` выше `debug`.
- **OBS-005 (проверки инвариантов):** в критичных местах сервер проверяет состояние и при нарушении пишет `invariant.violated` (error, имя инварианта и контекст) и продолжает работу с безопасным исходом, а не падает и не портит состояние молча. Минимальный набор:
  - позиции и скорости игроков конечны; игрок с нечисловой позицией возвращается на безопасную опору;
  - у каждого занятого места не больше одного управляющего соединения, у каждой сущности игрока есть место;
  - счётчики очереди NPC неотрицательны и совпадают с числом задач; у игрока не больше одной незавершённой задачи;
  - revision AOI каждого соединения растёт на 1 с каждой отправленной delta;
  - в снимке нет повторяющихся ID сущностей;
  - отправленный пакет проходит `parseServerMessage` (в тестах — всегда, в рантайме — `monitoring.validateOutgoing`, включён в development); неверный пакет не отправляется;
  - delta больше лимита пакета не отправляется (`game.packet.oversize`): разрыв revision заставляет клиента запросить snapshot.
- **OBS-006 (приватность):** в логи, метрики, дампы и экран ведущего никогда не попадают: токены и их хеши, пароли и их хеши, временные пароли, тексты чата, вопросов и ответов NPC, сообщений и переводов BABEL, записи словаря, рисунки камней. Отображаемое имя пишется только в событиях входа и действиях ведущего, чтобы сопоставить playerId с человеком; в остальных событиях — playerId. Проверка выполняется автотестом, который прогоняет сценарии с известными секретами и текстами и ищет их во всех выводах.

### Метрики

- **OBS-007 (реестр метрик):** в процессе — счётчики, gauge и гистограммы с фиксированными границами корзин, без внешних зависимостей. Обновление метрики — O(1) и не выделяет память на горячем пути. Минимальный набор:
  - процесс: uptime, rss, heap, задержка event loop (p50/p99), число дампов, потерянные логи;
  - игра: длительность шага, интервал рассылки, игроки на местах / подключённые / в удержании, соединения, сущности в AOI, размер delta в байтах, пакеты на вход и выход по типам, отклонённые handshake по коду, неверные пакеты, срабатывания лимитов, резервные точки появления, recovery движения;
  - RTT игроков (OBS-010);
  - NPC и язык: длина очереди, активные генерации, результаты по исходу, время ожидания, время до первого снимка, время генерации, зависшие слоты; действия BABEL по типу и результату с длительностью;
  - HTTP: запросы по шаблону пути и статусу, длительность, байты `/world/*`;
  - вход: исходы по типу, блокировки, отзывы по причине, действующие сессии;
  - БД: длительность транзакций, ошибки, размер файла БД и WAL, свободное место на диске.
- **OBS-008 (доступ к метрикам):**
  - `GET /api/operator/metrics` — JSON-снимок для экрана ведущего, только loopback;
  - `GET /metrics` — текстовый формат Prometheus. Доступен с loopback всегда, а из сети — только с `Authorization: Bearer <monitoring.token>`, если в конфигурации задан `monitoring.token` (≥ 32 символа; по умолчанию не задан, из сети — 404). Токен мониторинга не даёт доступа ни к чему, кроме `/metrics`.

  Ни один из эндпоинтов не содержит данных OBS-006 и имён игроков.
- **OBS-009 (необязательный стек разработчика):** в репозитории `ops/monitoring/` — конфигурация Prometheus (scrape `/metrics` раз в 5 с, хранение 7 дней) и Grafana с готовым дашбордом: шаг и рассылка, игроки и соединения, RTT, NPC (очередь, исходы, время до первого текста), HTTP, вход, БД, процесс; плюс инструкция установки, пока есть интернет. Стек запускается вручную на сервере или на ноутбуке разработчика в той же сети и не входит в `make start`: игра и экран ведущего работают без него. Ожидаемая цена на сервере — около 300 МБ RAM, это учитывается рядом с бюджетом LLM. Логи стек не собирает: разбор — по файлам JSONL (`jq`, любой просмотрщик).

- **OBS-013 (каталог метрик):** полный перечень метрик сервера с типом и метками. Метки — только небольшие фиксированные наборы (маршрут, тип пакета, исход, причина); идентификаторы игроков, NPC, сессий и тексты в метки не попадают — значения по игрокам есть только в JSON панелей (ADMIN-006, OBS-010). «Есть» — уже собирается ([TASK-068](../tasks/068-server-metrics-client-perf.md)), «новая» — пока нет.

  | Группа | Метрика | Тип и метки | Статус |
  |---|---|---|---|
  | Процесс | `process_uptime_seconds`, `process_resident_memory_bytes`, `process_heap_used_bytes` | gauge | есть |
  | | `process_event_loop_delay_ms` | histogram (p99 за минуту) | есть |
  | | `log_dropped_total` | counter | есть |
  | | `log_events_total` | counter `{level, module}` — все события `warn`, `error`, `fatal` | есть |
  | | `invariant_violations_total` | counter `{invariant}` | есть |
  | | `obs_incident_dumps_total` | counter `{reason}` (`error`, `operator`, `admin`, `fatal`) | есть |
  | Игра | `game_tick_duration_ms`, `game_broadcast_interval_ms` | histogram | есть |
  | | `game_players` | gauge `{state: connected\|grace}` | есть |
  | | `game_seat_events_total` | counter `{event: attach\|detach\|release\|takeover}` | есть |
  | | `game_spawn_fallback_total`, `game_motion_recovered_total{reason}` | counter | есть |
  | | `game_delta_bytes` | histogram | есть |
  | | `game_packets_out_total` | counter `{type}` | есть |
  | | `game_aoi_entities` | histogram — сущностей в AOI при рассылке | есть |
  | | `game_npcs` | gauge `{state: active\|disabled\|deleted}` | есть |
  | Realtime | `realtime_connections` | gauge | есть |
  | | `realtime_handshakes_total` | counter `{result}` | есть |
  | | `realtime_packets_in_total`, `realtime_packets_out_total` | counter `{type}` | есть |
  | | `realtime_invalid_packets_total` | counter `{reason}` | есть |
  | | `realtime_rate_limited_total` | counter `{type}` | есть |
  | | `realtime_rtt_ms` | histogram — RTT heartbeat всех соединений | есть |
  | Клиенты | `client_fps`, `client_frame_ms`, `client_draw_calls` | histogram — из отчётов `perf` (OBS-014) | есть |
  | | `client_reports_total` | counter `{kind, result: accepted\|rejected\|limited}` | есть |
  | NPC и язык | `npc_queue` | gauge `{state: queued\|running}` | есть |
  | | `npc_requests_total` | counter `{kind, outcome}` | есть |
  | | `npc_queue_wait_ms`, `npc_generation_ms` | histogram `{kind}` | есть |
  | | `npc_first_partial_ms` | histogram | есть |
  | | `npc_stuck_slots_total` | counter | есть |
  | | `babylon_language_ms` | histogram `{kind, success}` | есть |
  | | `npc_responder_ready`, `language_ready` | gauge 0/1 | есть |
  | HTTP | `http_requests_total` | counter `{route, status}` | есть |
  | | `http_request_ms` | histogram `{route}` | есть |
  | | `http_world_bytes_total`, `http_rate_limited_total{route}` | counter | есть |
  | Вход | `auth_attempts_total` | counter `{method, outcome}` | есть |
  | | `auth_sessions_revoked_total` | counter `{reason}` | есть |
  | | `auth_locks_total` | counter | есть |
  | | `auth_sessions_active` | gauge `{scope: game\|admin}` | есть |
  | БД | `db_operation_ms` | histogram `{operation}` | есть |
  | | `db_errors_total` | counter `{operation}` | есть |
  | | `db_size_bytes` | gauge | есть |
  | | `disk_free_bytes` | gauge — каталог БД | есть |
  | Админка | `admin_actions_total` | counter `{action, result}` | есть |
  | | `content_npc_changes_total` | counter `{action}` | есть |

  Дашборд OBS-009 и панель ADMIN-005 строятся из этого перечня; новая метрика добавляется в таблицу вместе с кодом.
- **OBS-014 (FPS и производительность клиентов):** сервер хранит в памяти последний принятый отчёт `perf` (OBS-011) каждого игрока: FPS, время кадра, draw calls, карту и время приёма — и отдаёт его в данных экрана ведущего и панели администратора. Отчёт старше 30 с считается отсутствующим. Значения также попадают в гистограммы `client_*` (OBS-013). Отчёт привязан к игроку его сессии; данные другого игрока он изменить не может. Клиенту рекомендуется отправлять `perf` раз в 10 с (лимит — 10 отчётов в минуту, OBS-011).

### Экран ведущего и клиент

- **OBS-010 (экран ведущего, расширение OFFLINE-010):** `/operator` дополнительно показывает:
  - **общее состояние** — зелёное, жёлтое или красное с перечнем причин простыми словами. Правила по умолчанию: p95 шага > 5 мс за 5 мин — жёлтое, > 20 мс — красное; p95 интервала рассылки > 120 мс — жёлтое; p99 задержки event loop > 50 мс — жёлтое; NPC или переводчик недоступны — жёлтое; доля таймаутов NPC за 5 мин > 25% — жёлтое; ошибка записи в БД за 5 мин — красное; свободно на диске < 1 ГБ — жёлтое, < 200 МБ — красное; потеря логов — жёлтое;
  - **по каждому игроку:** RTT (медиана за минуту), число переподключений за 10 мин (≥ 3 — предупреждение «нестабильная связь»), время в игре;
  - **последние 20 предупреждений и ошибок:** время, событие, короткое сообщение, без текстов игроков;
  - **действия:** «Выдать временный пароль», «Завершить сессии», «Снять блокировку входа» (AUTH-010), «Сохранить отчёт» (OBS-004). Подтверждение перед действием; защита от CSRF — как AUTH-010.

  RTT измеряется сервером без участия клиентского кода: по heartbeat Engine.IO (время от отправленного сервером `ping` до полученного `pong`), интервал heartbeat — `monitoring.pingIntervalMs` (по умолчанию 5000).
- **OBS-011 (ошибки клиента):** `POST /api/telemetry/client` с Bearer-сессией принимает отчёт клиента `{v: 1, kind: "error" | "unhandled_rejection" | "perf", message?, stack?, source?, build?, fps?, frameMs?, drawCalls?, map?}`: строки ≤ 500 символов (`stack` ≤ 4000), без текстов игроков (это обязанность клиента; сервер обрезает и экранирует). Лимит — 10 отчётов в минуту на сессию, тело ≤ 8 КиБ, неизвестные поля отклоняются. Ответ 204 без тела; ошибки — 400/401/429. Отчёт пишется как `client.error` / `client.perf` с playerId и sessionId. Клиент может не отправлять ничего — это необязательный контракт.
- **OBS-012 (цена наблюдаемости):** события высокой частоты (каждый `input`, каждый пакет delta, каждый запрос чанка, каждое срабатывание лимита) не пишутся по одному: они учитываются метриками, итоги соединения пишутся в `realtime.disconnect`, запросы `/world/*` и опрос state — на уровне debug. С включённой наблюдаемостью p95 шага растёт не больше чем на 0,5 мс на профиле четырёх игроков (REALTIME S7).

## Сценарии

- **S1 · OBS-001–003:** Given запуск, вход двух игроков, чат, вопрос NPC, BABEL-покупка, выход и остановка; When читается файл логов; Then каждое действие оставило событие из каталога с playerId/sessionId/requestId, каждая строка — валидный JSON с `ts`, `seq`, `runId`, `level`, `event`.
- **S2 · OBS-004:** Given `fileLevel: info`; When обработчик HTTP бросает исключение; Then в файле есть `http.failed` со стеком, а в `incident-*.jsonl` — предшествующие debug-события этого запроса и снимок метрик.
- **S3 · OBS-002:** Given лимит каталога 1 МБ в тесте; When пишется 5 МБ событий; Then каталог не превышает лимит, старые файлы удалены. Given недоступный каталог; Then игра продолжает работать, в консоли `log.sink.failed`.
- **S4 · OBS-005:** Given в тесте позиция игрока стала NaN; When выполняется шаг; Then `invariant.violated` с именем инварианта, игрок на безопасной опоре, остальные игроки не затронуты, создан дамп.
- **S5 · OBS-006:** Given сценарий с паролем «секрет12», чатом «тайное слово» и вопросом NPC; When просмотрены консоль, файлы, дампы, `/metrics`, `/api/operator/metrics` и `/api/operator/status`; Then ни пароля, ни токена, ни хешей, ни текстов нет.
- **S6 · OBS-007–008:** Given сервер с игроками; When запрошен `/metrics` с loopback, из сети без токена и из сети с `monitoring.token`; Then 200, 404, 200; метрики шага, игроков и NPC присутствуют в формате Prometheus.
- **S7 · OBS-010:** Given NPC-ответчик не стартовал и у игрока три переподключения; When ведущий открывает `/operator`; Then состояние жёлтое с причинами «NPC недоступны» и «нестабильная связь у игрока …», у игроков видны RTT. When ведущий нажимает «Сохранить отчёт»; Then появляется файл дампа.
- **S8 · OBS-011:** Given клиент отправляет 12 отчётов об ошибке за минуту; Then первые 10 — 204 и записаны как `client.error`, остальные — 429; отчёт с лишним полем — 400.
- **S10 · OBS-013–014:** Given клиент отправил `perf` с FPS 55, а второй игрок — ничего; When запрошены `/metrics` и данные панели; Then `client_fps` содержит наблюдение, у первого игрока в панели FPS 55 и возраст отчёта, у второго — нет данных; через 30 с без отчётов у первого тоже «нет данных». Метки метрик не содержат playerId.
- **S9 · OBS-012:** Given профиль REALTIME S7 с наблюдаемостью и без; Then разница p95 шага ≤ 0,5 мс, `log.dropped` нет.

## Ограничения и вне scope

- Отправка логов и метрик за пределы компьютера-сервера, облачные сервисы, сбор логов в Loki/Elasticsearch — вне scope; стек OBS-009 необязателен.
- Распределённая трассировка не нужна: процесс один, связь событий — через `requestId`, `connectionId` и `sessionId`.
- Метрики LLM (токены, память модели) добавляет адаптер модели через тот же реестр метрик ([LLM](server-llm-runtime.md)); их набор задаёт LLM-QA.

## Передача клиенту

OBS-011 — необязательный контракт: клиент, который хочет, чтобы его ошибки были видны разработчику, отправляет отчёты по этой схеме. Остальная наблюдаемость клиента не требует. Задача передачи создаётся вместе с серверной реализацией.

## Открытые вопросы

- Пороги OBS-010 выбраны по текущему профилю (p95 шага ≈ 1,3 мс, рассылки ≈ 110 мс) и уточняются после замеров на целевых ноутбуках (OFFLINE-017).
- Нужен ли ведущему просмотр файлов логов прямо на `/operator` или достаточно кнопки «Сохранить отчёт».
