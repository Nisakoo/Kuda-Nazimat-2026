---
id: server-foundation
type: module-design
status: ready
implementation: partial
parent: architecture
summary: Каркас единственного локального сервера — расположение, runtime, конфигурация, HTTP, жизненный цикл и лимит игроков.
related:
  - shared-contracts.md
  - server-auth.md
  - server-realtime.md
  - server-world.md
  - server-persistence.md
  - server-npc-dialogue.md
---

# SERVER — Основа сервера

## Цель

Один процесс на серверном ноутбуке раздаёт клиент, принимает вход, ведёт авторитетный мир, хранит данные в SQLite и обслуживает NPC через порт. Всё работает без интернета, в LAN и на loopback.

## Требования

- **SERVER-001:** Код сервера находится в `server/` этого репозитория и имеет собственные `package.json`, lockfile и `tsconfig.json`; npm workspaces не используются. Общий контракт импортируется из `../shared/` ([SHARED](shared-contracts.md)), код клиента не импортируется. Стек: Node.js 24 (версия закреплена в `engines` и README), TypeScript strict, Socket.IO 4.8 (совместим с `socket.io-client` 4.8.4 клиента), встроенный `node:sqlite`, Vitest. Web-фреймворк не используется: HTTP построен на `node:http`. Runtime-зависимости по умолчанию — только `socket.io`; любая дополнительная зависимость обосновывается в задаче.
- **SERVER-002:** Модули `app`, `http`, `auth`, `realtime`, `game`, `world`, `npc`, `persistence` в `server/src/` следуют принципам чистой архитектуры из [architecture](../architecture.md):
  - домен без IO;
  - сервисы-use cases;
  - порты только на реальных границах;
  - тонкие адаптеры;
  - единственный composition root `app`.

  Домен (`game`, модель карты в `world`) не импортирует `node:*`, Socket.IO, SQLite и адаптеры; сервисы не импортируют адаптеры. Транспорт не содержит игровых правил, хранилище не управляет сокетами. Проверка импортов автоматизирована (dependency-cruiser): запрещает циклы и импорт IO/адаптеров в домен. Абстракции без второй реализации или реальной границы не вводятся. Сервисы и домен покрываются unit-тестами с in-memory реализациями портов.
- **SERVER-003:** Сервер раздаёт по HTTP:
  - готовую сборку клиента из `clientDir` по `/`, публично;
  - `GET /config.json` — публичную конфигурацию клиента `{session: "online", serverUrl: null, mapId: <defaultMap>, chunkRadius: null, debug: false}`, сформированную из конфигурации сервера; файл `config.json` из сборки клиента не отдаётся;
  - `/api/*` — [AUTH](server-auth.md), `GET /api/health` и публичный `GET /api/game-config` (только effective npcTimeoutMs, no-store/обычный CORS, без model options/путей/pins/секретов);
  - `/world/*` — данные мира только с проверками [SERVER-WORLD](server-world.md).

  Из `clientDir` не отдаются пути `maps/` и `assets/models/`: данные мира не должны быть публичными в обход `/world/`. Статические ответы ограничены `clientDir`, без directory listing и выхода за корень; неизвестный путь — 404. Браузерный клиент не требует установки ПО.
- **SERVER-004:** Конфигурация — JSON-файл (по умолчанию `server/config.json`, путь меняется аргументом `--config`) поверх документированных значений по умолчанию. Неизвестные ключи и неверные типы — ошибка запуска. Для игрового запуска дополнительно доступны `--backend`/`--model` (только вместе) и `--profiles`; Make передаёт соответствующие BACKEND/MODEL/LLM_PROFILES как environment data. Подготовленный внешний каталог по LLM-015 заменяет только npc.adapter/options в effective config на один запуск; отсутствие каталога без явного выбора сохраняет старый config. Повреждённый/явно отсутствующий профиль не вызывает fallback. Общий NPC deadline можно переопределить на один запуск целыми секундами1–300: `make server NPC_TIMEOUT=60` / `make demo NPC_TIMEOUT=60`, env KUDA_NPC_TIMEOUT или CLI `--npc-timeout 60` (CLI приоритетнее env). Без override npc.timeoutMs остаётся из config/default30000мс, config допускает1–300000мс. Override не пишет config/profile. Некорректное значение даёт earlyfail, не clamp/fallback. Минимальный набор:

  | Ключ | По умолчанию | Смысл |
  |---|---|---|
  | host / port | `0.0.0.0` / `8080` | LAN; для автономного режима допустим `127.0.0.1` |
  | clientDir | `../client/dist` | сборка клиента |
  | worldDir | `../client/public` | корень данных мира (раскладка MAP) |
  | maps | `{"market": "maps/market/manifest.json", "demo": "maps/demo/manifest.json", "science": "maps/demo/science.json"}` | mapId → manifest относительно worldDir (генерирует клиентский `world:generate`) |
  | defaultMap | `market` | mapId для `/config.json`; совпадает с картой клиента по умолчанию |
  | contentDir | `content` | серверный контент (NPC) |
  | dbPath | `data/game.sqlite` | SQLite |
  | maxPlayers | `4` | активные игроки |
  | sessionTtlMs | `43200000` | 12 ч, mock-сессия (AUTH-002) |
  | tickHz / broadcastHz | `20` / `10` | симуляция / рассылка |
  | aoiRadius | `64` | м, AOI динамических сущностей |
  | staticChunkRadius | `3` | чанков, допустимая область `/world/` |
  | disconnectGraceMs | `10000` | удержание сущности после разрыва |
  | saveIntervalMs | `10000` | периодическое сохранение позиций |
  | corsOrigins | `[]` | origin dev-клиента, например `http://localhost:5173` |
  | logWorldAccess | `false` | лог выдачи `/world/*` (SERVER-DEMO-004) |
  | npc | `{adapter: "scripted", maxConcurrent: 1, maxUnfinished: 4, timeoutMs: 30000, options: {}}` | [NPC](server-npc-dialogue.md) |

  Относительные пути разрешаются от каталога файла конфигурации. Секреты в конфигурации не нужны. Runtime не обращается в интернет.
- **SERVER-005:** При запуске проверяются конфигурация, доступность `clientDir`, миры ([SERVER-WORLD](server-world.md)), NPC-контент, БД и миграции, готовность NpcResponder. Ошибка выводится понятным текстом с путём/ключом и завершает процесс с ненулевым кодом. Сервер не слушает порт до готовности. По SIGINT/SIGTERM выполняется штатная остановка:
  1. новые HTTP-запросы и handshake отклоняются;
  2. ожидающие NPC-запросы отменяются;
  3. соединения закрываются;
  4. позиции всех игроков сохраняются;
  5. БД закрывается.

  Остановка укладывается в 10 с, иначе процесс завершается с ошибкой в логе. Сбой NpcResponder не останавливает мир (NPC-005).
- **SERVER-006:** Не более `maxPlayers` (4) активных игроков. Активный игрок — аккаунт, чья сущность находится в мире: подключён или в grace после разрыва. Новое соединение аккаунта, не являющегося активным, при занятых слотах получает отказ handshake `UNAVAILABLE` без создания сущности. Дополнительная вкладка или устройство того же аккаунта не занимает второй слот и не расширяет квоты: управление переходит по AUTH-005. Число слотов не подменяется числом TCP-соединений.
- **SERVER-007:** `GET /api/health` публичен и возвращает `{status: "ok", protocol: 1, npc: "ready" | "unavailable"}` без данных игроков. Логи — строки в stdout с уровнем, временем и модулем. В логи не попадают токены и их хеши, тексты чата и NPC-диалогов; допустимы ID, коды ошибок и длительности. Для dev-клиента на другом origin CORS разрешён только для `corsOrigins` (включая preflight для `Authorization`); по умолчанию — same-origin.
- **SERVER-008:** Команды из корня: `make server` — запуск, `make server-test` — тесты без watch; в `server/` — `npm run check` (типы `server` и `shared`, импорты) и `npm test`. Тестовые клиенты в интеграционных тестах используют `socket.io-client` и `shared/protocol`, без браузера и кода `client/`.

## Сценарии

- **S1 · SERVER-001–004, 008:** Given подготовленный ноутбук без интернета; When выполнен `make server`; Then сервер слушает настроенный адрес, отдаёт клиент и `/config.json` с `session: "online"`, `/api/health` отвечает. Проверка импортов не находит циклов и запрещённых зависимостей game.
- **S2 · SERVER-003:** Given сборка клиента содержит `maps/demo/manifest.json`; When запрошены `/maps/demo/manifest.json` и `/../server/config.json`; Then оба ответа — 404, а `/world/maps/demo/manifest.json` без токена — 401.
- **S3 · SERVER-004–005:** Given неверный ключ конфигурации, отсутствующий worldDir или недоступная БД; When выполняется запуск; Then процесс завершается с понятной ошибкой и ненулевым кодом, порт не открыт. Given 2 игрока в мире; When приходит SIGTERM; Then позиции сохранены, БД закрыта, процесс завершился за ≤10 с.
- **S4 · SERVER-006:** Given 4 активных игрока; When пятый аккаунт подключается, а первый открывает вторую вкладку; Then пятый получает `UNAVAILABLE` без сущности, у первого по-прежнему один playerId и один слот.
- **S5 · SERVER-007:** Given вход, чат и NPC-вопрос; When просматривается лог; Then в нём нет токена и текстов сообщений.

## Ограничения и вне scope

- Без микросервисов, облачной БД, внешнего ИИ, TLS и обратного прокси. HTTP в LAN — принятый риск офлайн-демо.
- Выбор/квалификация LLM-backend — [LLM](server-llm-runtime.md). В MVP включена только заглушка NpcResponder.
- Серверный runtime не импортирует код `client/`; UI входа принадлежит клиентскому фасаду GameApp (NET-007).

## Открытые вопросы

- Default `worldDir: ../client/public` подходит для разработки: в нём лежит демо-мир, сгенерированный клиентским `world:generate`. Для поставки нужно решить, кто готовит мир сервера и как исключить `maps/` из клиентской сборки. До этого сервер только закрывает публичный доступ (SERVER-003).

- Прежняя граница «сервер не меняет client/» конфликтовала с необходимой интеграцией входа. Пользователь разрешил клиентские доработки для функций бэкенда; разделение runtime-модулей остаётся обязательным, запрет на совместный diff к этой интеграции не применяется.
