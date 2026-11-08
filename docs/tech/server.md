# Сервер

Когда читать: перед правкой `server/`, добавлением HTTP-маршрута, миграции, адаптера или метрики.

Стек: Node.js 24.15+ (ветка 24), TypeScript strict, Socket.IO 4.8, встроенные `node:http` и `node:sqlite`, Vitest. Нет web-фреймворка и сборки: Node сам стирает типы, `tsc --noEmit` только проверяет. Один процесс, модульный монолит. Общие границы — [architecture.md](architecture.md), сообщения — [protocol.md](protocol.md), LLM — [llm.md](llm.md).

## Модули `server/src/`

| Модуль | Роль |
|---|---|
| [app](../../server/src/app/) | composition root: загрузка и проверка конфигурации, сборка модулей, запуск, штатная остановка (`main.ts`, `application.ts`, `config.ts`, `llmProfiles.ts`, `selfCheck.ts`) |
| [http](../../server/src/http/) | `node:http`: клиент, `/config.json`, `/api/*`, `/world/*`, `/operator`, `/admin`, `/setup`; вызывает auth и правила доступа world |
| [realtime](../../server/src/realtime/) | Socket.IO `/game`: handshake, разбор пакетов shared-парсером, лимиты частоты, отправка; `PartialThrottle` для потока NPC |
| [auth](../../server/src/auth/) | `AuthService`, scrypt, сессии с отзывом, лимиты попыток; порты `AccountStore`, `SessionStore` |
| [game](../../server/src/game/) | домен мира (`World`, tick 20 Hz, AOI, delta, `WorldLife`, спавн) и `GameService`; порты `PlayerStore`, `Clock` |
| [world](../../server/src/world/) | `GameMap` (коллизии, bootstrap), `access` (правила `/world/*`), `loader` (проверка `worldDir` и `contentDir` на старте), `npcContent` |
| [npc](../../server/src/npc/) | `NpcDialogueService`, `GenerationQueue`, порт `NpcResponder`, адаптеры `scripted`/`localLlm` (ollama, mlx), классификатор намерений, экстрактор фактов |
| [babylon](../../server/src/babylon/) | `BabylonService` (роли, языки, предметы, задание, камни, словарь, перевод), `LanguagePort` (`test` или borrowed `local`) |
| [city](../../server/src/city/) | задания и прогресс города (правильные ответы только здесь) |
| [content](../../server/src/content/) | `NpcCatalog` (слой правок поверх `npcs.json`), `ContentAdmin` |
| [persistence](../../server/src/persistence/) | `DatabaseSync`, миграции, реализации Store-портов |
| [obs](../../server/src/obs/) | вывод логов, самописец, история метрик, пороги, телеметрия клиента |
| [tls](../../server/src/tls/) | самоподписанный сертификат, собственный DER-кодировщик |
| [common](../../server/src/common/) | `logger`, `metrics`, `TokenBucket`, `time`, `network` |
| [cli](../../server/src/cli/) | `auth`, `backup`, `inspect`, `lanCheck`, `report`, `tls`, `importLlmProfiles` |

Модуль `game` не импортирует realtime/http/persistence. Контракт между модулями — [contracts.ts](../../server/src/contracts.ts). Новый адаптер NPC реализует [NpcResponder.ts](../../server/src/npc/NpcResponder.ts), регистрируется в [adapters/index.ts](../../server/src/npc/adapters/index.ts) и проходит [responderContract.ts](../../server/test/responderContract.ts).

## Конфигурация и окружения

`defaults → пресет окружения → config.json → PORT/HOST → аргументы`. Неизвестные ключи, неверные типы и лимиты — ошибка до открытия порта. Относительные пути считаются от каталога файла конфигурации. Шаблоны: [config.example.json](../../server/config.example.json), [config.ollama.example.json](../../server/config.ollama.example.json), [config.mlx.example.json](../../server/config.mlx.example.json), [config.ollama-08b.example.json](../../server/config.ollama-08b.example.json). Команды и таблица окружений — [setup.md](setup.md).

Значения по умолчанию: `0.0.0.0:8080`; `maxPlayers` 4; `sessionTtlMs` 43 200 000 (12 ч); `tickHz` 20 / `broadcastHz` 10; `aoiRadius` 64 м; `staticChunkRadius` 3; `disconnectGraceMs` 10 000; `saveIntervalMs` 10 000; `auth.maxSessions` 5; `defaultMap` `market`; карты `market`, `demo`, `science`; `npc`: `adapter: scripted`, `maxConcurrent` 1, `maxUnfinished` 4, `timeoutMs` 30000, `streamTimeoutMs` 30000; `language`: `adapter: test`. Окружение `production` не позволяет включить вход без пароля — сервер не стартует.

Запуск: проверка конфигурации, `clientDir`, миров, контента NPC, БД и миграций; сбой `NpcResponder`/`LanguagePort` запуск не останавливает. Остановка (SIGINT/SIGTERM): новые запросы отклоняются → ожидающие NPC-запросы отменяются → соединения закрываются → позиции сохраняются → БД закрывается; всё в пределах 10 с.

## HTTP

| Маршрут | Доступ |
|---|---|
| `GET /` клиентская сборка | публично; `maps/` и `assets/models/` не отдаются, traversal и symlink за корень закрыты |
| `GET /config.json` | публично: `{session:"online", serverUrl:null, mapId, chunkRadius:null, debug}` из настроек сервера |
| `GET /api/health` | публично (и по открытому HTTP): `{status, protocol:3, npc}` |
| `GET /api/game-config` | публично: только `{npcTimeoutMs}` |
| `/api/auth/*` | вход, регистрация, смена пароля, выход, режимы (см. ниже) |
| `GET/POST /api/avatar`, `GET /api/auth/state` | Bearer |
| `POST /api/babylon` | Bearer, управляющее соединение для игровых действий |
| `GET /world/*` | Bearer + активный игрок на карте |
| `POST /api/telemetry/client` | Bearer; ошибки 10/мин, `perf` 12/мин; тело ≤8 КиБ, ответ 204 |
| `/operator`, `/api/operator/*` | только loopback (с других адресов 404); изменения — `Origin` сервера и `X-Operator: 1` |
| `/admin`, `/api/admin/*` | из LAN, отдельная admin-сессия |
| `/setup`, `/server.crt` | по HTTP и HTTPS: страница доверия сертификату |

Rate limit (token bucket на сессию): `/api/babylon` 10/с запас 20; `/world/*` 50/с запас 300; admin API 20/с запас 40. Превышение — 429 без закрытия сессии.

## Вход и сессии (auth)

- Production: только регистрация и вход по имени и паролю. Development/test: дополнительно `guest` (имя без пароля) и `POST /api/auth/dev`. `GET /api/auth/mode` сообщает доступные способы.
- Имя 1–32 символа после trim; ключ аккаунта — нижний регистр. Пароль 6–128 символов (NFC), хеш scrypt `N=2^15, r=8, p=1`, соль 16 байт; сравнение `timingSafeEqual`.
- Токен — 32 случайных байта (base64url); в БД только SHA-256. Сессия живёт 12 ч без продления, ≤5 действующих на аккаунт (старейшая отзывается с причиной `limit`). Отзыв — запись `revokedAt` и причины; открытые сокеты получают `error UNAUTHORIZED` с причиной. Токен проверяется при каждом защищённом запросе без кеширования.
- Ответ входа строго `{token, expiresAt}`. Одно имя — один игрок; одно управляющее соединение на аккаунт: новое соединение атомарно перехватывает управление (старое получает `UNAUTHORIZED` «Игра открыта в другом окне.», его NPC-запрос отменяется, сущность сохраняется).
- Лимиты попыток (в памяти): 5 неудач за 15 мин → блокировка имени на 15 мин (повторно за час — на 60); по IP 30 запросов `/api/auth/*` в минуту и 10 регистраций в час.
- Роли `player`/`admin`; admin-сессия живёт 8 ч, принимается только `/api/admin/*` и не занимает игровое место. Роль выдаётся только CLI на сервере (`auth -- create-admin | grant-admin | revoke-admin`).
- Временный пароль (сброс администратором): 10 символов, действует 24 ч, вход им → `PASSWORD_CHANGE_REQUIRED`.
- Парольный аккаунт без выбранного облика (`avatar_id IS NULL`) не может выполнить `join`.
- Секреты (токены, пароли, хеши) не попадают в логи, метрики и ответы.

## Игровой мир (game, world, realtime)

- Шаг фиксирован `tickHz` с компенсацией дрейфа, ≤5 догоняющих шагов. Рассылка каждые `tickHz/broadcastHz` шагов. Скорость 3 м/с, спринт 5 м/с.
- Коллизии: общий swept-путь по bitmap чанков из [shared/map/](../../shared/map/) (след ±0,25 м, отсутствующий чанк непроходим), `heightSurfaces`, `ceilingVolumes` (≤128 общих и ≤128 на запись чанка). Сервер не пускает игрока в чанк вне `preparedChunks`.
- AOI: свои сущности + сущности карты в радиусе `aoiRadius` по XZ, ближайшие первыми, всего ≤256. Delta по сравнению с последним отправленным соединению.
- Присутствие: при разрыве сущность остаётся неподвижной `disconnectGraceMs`, занимает место, затем удаляется; позиция сохраняется. Не более 4 активных игроков (5-й → `UNAVAILABLE`). Выносливость в SQLite не сохраняется.
- Появление: первая свободная проходимая точка из кандидатов вокруг spawn (шаги 1,5 / 3 / 4,5 м по 8 направлениям), не ближе 1,2 м к другому игроку.
- Чат: 1–500 символов, всей карте, не сохраняется, `messageId` уникален между перезапусками. `interact`: расстояние ≤ `radius + 0.5`.
- `WorldLife`: горшки сдвигает только проверенное касание движения; яблоки и руки — durable (SQLite, receipts); кошки/птицы/ветер — расписание от `epochMs`, без состояния в БД.
- Дробовик: симуляция [shared/shotgun/](../../shared/shotgun/), сервер проверяет боезапас и темп (6 патронов), клиент шлёт только углы. Клиент сейчас скрыт флагом `SHOTGUN_ENABLED` (см. [client.md](client.md)): не шлёт выстрелы и игнорирует `shotgun-state`.
- Контент NPC: `contentDir/npcs.json` — исходник; правки администратора в SQLite накладываются поверх и применяются на ходу без перезапуска.

## Хранение (persistence)

- SQLite (`DatabaseSync`, WAL, `foreign_keys=ON`) в основном процессе; игровой шаг к БД не обращается. Запросы параметризованы. Миграции [001–012](../../server/src/persistence/migrations/) нумерованы, применяются при старте в транзакции; более новая версия БД — ошибка запуска. Для старых dev-баз с пересекающимися номерами недостающие поля восстанавливаются без потери данных.
- Основные таблицы: `accounts`, `sessions`, `players` (позиция, карта, `avatar_id`), `npc_dialogue`, группы и профили BABEL с receipts, `world_apples` и `world_hand_receipts`, `npc_overrides`, `admin_journal`, `npc_relationships`, `npc_memory_facts`.
- Позиция сохраняется раз в `saveIntervalMs` (если изменилась), при удалении из мира и при остановке. Окно потери при аварии ≤ интервал + время записи. Истёкшие более суток назад сессии удаляются при старте и раз в час.
- BABEL: агрегаты меняются вместе с receipt в одной транзакции; ошибка откатывает всё. Идемпотентность по `(playerId, requestId)` + SHA-256 действия.
- NPC-история: ответ пишется в `npc_dialogue` до доставки; на пару игрок/NPC хранится ≤50 последних пар, в prompt до 6 пар; чтение изолировано по `(AUTH sessionId, playerId, npcId)`; записи без `sessionId` не приписываются новой сессии. Таймаут и отмена историю не создают.
- Отношения NPC (`ordinary`, `displeased`, `friendly`) и факты о путешественнике — в `npc_relationships`/`npc_memory_facts` с тем же scope.
- Яблоки: каталог карты добавляет только отсутствующие ID; неожиданный сохранённый экземпляр — отказ старта.
- Планируется, не реализовано: полный архив сессии с поиском старых эпизодов, компактная память, ledger запросов, квоты и очистка. Пока действуют окна 50/6.
- Бэкап и осмотр — [operations.md](operations.md). SQLite и копии не шифруются.

## Очередь и NPC

[GenerationQueue](../../server/src/npc/GenerationQueue.ts) общая для NPC, переводов, словаря и ответов BABEL: FIFO, ≤`maxUnfinished` (4) незавершённых, ≤1 на `playerId`, `maxConcurrent` 1. Допуск `npc-question`: управляющее соединение в мире; NPC на карте игрока; расстояние ≤ `interactionRadius + 0.5`; текст 1–240; нет другого незавершённого запроса игрока (иначе `RATE_LIMIT` «Дождитесь ответа»); очередь не полна (иначе `UNAVAILABLE` «Собеседники заняты»). Ответ нормализуется (trim, `\n`, без управляющих символов, ≤4000). Остальное — [llm.md](llm.md). `scripted` — детерминированная заглушка (`delayMs` 300, `failEvery` 0).

`LanguagePort`: `test` (по умолчанию, известные переводы, произвольная фраза → ошибка) или явный `local` — заимствует тот же responder/worker и очередь; автоматического fallback в `test` нет.

## Наблюдаемость (obs)

- Логи JSONL, одно событие на строку (`ts`, `seq`, `runId`, `level`, `event`, ...); имена событий стабильны (фильтры и отчёт строятся по ним). Ротация 20 МБ, всего ≤200 МБ и ≤14 дней. Ошибка записи файла игру не останавливает.
- Бортовой самописец: кольцо последних 5000 событий уровня `debug`+; при первой ошибке и по кнопке сбрасывается в `incident-<ts>-<runId>.jsonl` (+ снимок метрик и последние 10 минут истории).
- Инварианты: нарушение → `invariant.violated`, безопасный исход, без падения.
- Метрики: реестр счётчиков/gauge/гистограмм без внешних зависимостей, O(1) на горячем пути. История: кадр раз в 10 с, кольцо 1440 кадров (4 часа). Раз в минуту событие `metrics.minute` в журнал.
- Пороги (одни для плиток, графиков и отчёта): p95 шага ≤5 мс (жёлтое >5, красное >20), p95 рассылки ≤120 мс, ошибки сервера 0, RTT ≤150 мс, FPS клиента ≥30 (видимая вкладка), таймауты NPC ≤25%, потерянные строки журнала 0.
- RTT измеряет сервер по heartbeat Engine.IO (`monitoring.pingIntervalMs`, 5000). FPS приходит из `perf`-отчётов клиента; нет отчёта — «нет данных».
- Приватность: в логи, метрики, дампы и админку не попадают токены, пароли и хеши, тексты чата/NPC/BABEL, словарь, рисунки камней. Частые события (input, delta, запросы чанков) идут в метрики, а не по одному в лог.

## Админка и контент

- `/operator` — loopback, тот же интерфейс на `/admin` из LAN после входа администратора. Разделы: Обзор, Сервер, Клиенты, NPC, Журнал, Аккаунты. Страница офлайн, без внешних ресурсов, графики SVG из встроенной истории. Исходники — [http/operator/](../../server/src/http/operator/).
- Данные: `/api/operator/status` (раз в 2 с), `/history` (ряды за 4 часа, ≤256 КиБ), `/metrics` (JSON-снимок), `/npcs`, `/world`, `/journal(.csv)`, `/accounts`, `/account`, `POST /actions/<действие>`.
- NPC: слой правок поверх `npcs.json` (`npc_overrides`); все изменения принимают `revision`, устаревшая → 409 с актуальным NPC; удаление мягкое; ≤64 NPC с учётом удалённых; у NPC, нарисованных в GLB чанка, нельзя менять позицию и облик; NPC задания BABEL нельзя выключить или удалить; дистанция ≥1,2 м до другого NPC.
- «Сбросить сцену» возвращает горшки и яблоки на исходные места. Каждое изменение — запись в `admin_journal` и событие `admin.change` (без значений полей).
- Не редактируются: геометрия карт, предметы, состав задания BABEL, расписание живой сцены.

## TLS

Всё приложение — только HTTPS/WSS на порту игры; режима без TLS нет ни в одном окружении. Подробности и эксплуатация — [operations.md](operations.md).
- Самоподписанный сертификат ECDSA P-256 + SHA-256, срок 825 дней, SAN: `localhost`, `<hostname>.local`, `127.0.0.1`, `::1`, LAN IPv4, `tls.extraNames` (≤8). Ключ `0600`, каталог `0700` (`server/data/tls/`, вне git); права шире — ошибка запуска.
- Кодирование X.509 — собственный минимальный DER ([tls/der.ts](../../server/src/tls/der.ts)) на `node:crypto`, без OpenSSL и npm.
- Один порт: протокол определяется по первому байту (`0x16` — TLS). Открытый HTTP обслуживает только `/setup`, `/server.crt`, `/api/health`; `GET` остального → 308 на https, прочее → 426.
- Сервер сам сертификат не перевыпускает: при несовпадении адресов или остатке срока <30 дней предупреждает в блоке подключения, `/operator`, логе и `lan:check`.
