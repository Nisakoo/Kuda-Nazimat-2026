# Протокол клиент ↔ сервер

Когда читать: перед изменением сообщений Socket.IO, HTTP-API игры или чтением/записью чего-либо через границу client/server. Точные формы и лимиты — в коде, здесь обзор.

Исполняемый контракт: [types.ts](../../shared/protocol/types.ts), [validate.ts](../../shared/protocol/validate.ts), [fixtures.json](../../shared/protocol/fixtures.json) (общий набор valid/invalid пакетов для обеих сторон), [npcTiming.ts](../../shared/protocol/npcTiming.ts) (сроки NPC).

## Версии и каналы

| Канал | Версия | Где контракт |
|---|---|---|
| Игровой Socket.IO `/game`, событие `game` | v3 (`auth: {version: 3, token}`, `v: 3` в каждом пакете) | [shared/protocol/](../../shared/protocol/) |
| `world-life` (живой мир, руки, дробовик), тот же namespace | v1 | [shared/world-life/](../../shared/world-life/), [shared/shotgun/](../../shared/shotgun/) |
| HTTP BABEL `POST /api/babylon` | v2 | [shared/babylon/](../../shared/babylon/) |
| HTTP облик `GET/POST /api/avatar` | без версии | [shared/avatar/](../../shared/avatar/) |
| HTTP вход `/api/auth/*`, админ `/api/admin/*`, телеметрия | — | см. [server.md](server.md) |
| Данные мира `GET /world/*` | Bearer | см. ниже |

- v1/v2 игрового Socket.IO отклоняются ошибкой `VERSION`; параллельной поддержки нет.
- Socket.IO: path `<serverUrl pathname>/socket.io`; на клиенте `autoConnect` и reconnection выключены. Транспорт открывается только с серверной сессией.
- Токен — непрозрачная строка 16–512 символов; хранится в памяти клиента, не в localStorage/URL.

## Игровые сообщения v3

Все пакеты — JSON `{v: 3, type, ...}`, лишние поля отклоняются.

| Направление | type | Данные |
|---|---|---|
| клиент → сервер | `join` | requestId, mapId |
| клиент → сервер | `input` | requestId, sequence, direction {x,z} (‖d‖ ≤ 1), sprint, jumpId, preparedChunks[] (≤25) |
| клиент → сервер | `interact` | requestId, targetId |
| клиент → сервер | `npc-question` | requestId, targetId, text, stream? |
| клиент → сервер | `npc-cancel` | requestId, questionId |
| клиент → сервер | `chat-send` | requestId, text |
| клиент → сервер | `resync` | requestId, revision |
| сервер → клиент | `joined` | requestId, playerId, revision, snapshot {tick, entities}, world (bootstrap) |
| сервер → клиент | `snapshot` / `delta` | revision (+ baseRevision, tick, upsert[], remove[]) |
| сервер → клиент | `interacted`, `chat`, `error` | requestId и данные |
| сервер → клиент | `npc-answer`, `npc-partial`, `npc-cancelled` | см. «Ответы NPC» |

Лимиты: пакет ≤256 KiB; ≤256 сущностей в AOI; ≤256 upsert и ≤128 remove; ID 1–80 символов `[A-Za-z0-9_-]`; координаты ±1e6; скорость ≤20; имя ≤80; чат 1–500; вопрос NPC ≤240; ответ NPC ≤4000 символов.

Коды ошибок: `UNAUTHORIZED`, `VERSION`, `INVALID`, `FORBIDDEN`, `RATE_LIMIT`, `NOT_READY`, `UNAVAILABLE`. Клиент закрывает сессию при `UNAUTHORIZED` и не делает retry при `VERSION`.

Сущность игрока: `transform`, `movement`, `renderable`, `character{kind:player}`, `animationState`, обязательный `motion {grounded, phase, verticalVelocity, locomotion, stamina, sprintBlocked, jumpAck}`. У NPC `motion` нет.

## Правила обмена

- **Намерения.** Ввод не задаёт позицию; сервер проверяет форму, владельца и допустимость. `input` с `sequence` ≤ принятого игнорируется; частый `input` молча отбрасывается; без `input` 250 мс намерение обнуляется (клиент шлёт `input` через volatile emit). `jumpId` монотонен, увеличенный ID обрабатывается один раз.
- **Частоты.** Симуляция сервера 20 Hz, рассылка AOI до 10 Hz, клиент шлёт последнее намерение до 20 Hz.
- **Revision/delta.** Delta применяется только при `baseRevision` = последней и `revision = baseRevision + 1`; `upsert` содержит сущность целиком. Пропуск → клиент чистит историю и шлёт `resync`; ответ — `snapshot` с текущей revision. Пустые delta не отправляются.
- **Дубликаты.** Повтор `requestId` в соединении → `error INVALID`, эффекта нет. Сообщения вне запроса (перехват управления, истечение сессии) имеют `requestId: "server"`.
- **Переподключение.** Всегда новый `join` и новый снимок; действия до разрыва не воспроизводятся. Retry клиента 1/2/4 с, не более трёх попыток, таймаут подключения 5 с; отказ авторизации или версии — без retry.
- **Pending.** Обычные запросы (включая чат) — 10 с. Для NPC клиент ждёт `npcTimeoutMs` сервера + 2000 мс (берёт из `GET /api/game-config`); без достоверной настройки NPC отключён, мир и чат работают.
- **Handshake-отказы** (`connect_error` с `data: {code, message}`): `UNAUTHORIZED` (нет/истёк/отозван токен), `VERSION`, `UNAVAILABLE` (заняты 4 места или остановка).
- **Лимиты частоты на соединение:** `input` 30/с, `chat-send` 1/с (всплеск 3), прочие команды 5/с (всплеск 10), до 4096 уникальных requestId на соединение.
- **Bootstrap мира** в `joined.world`: `manifestUrl` (относительно `/world/`), `worldBytes`, `manifestBytes ≤ worldBytes/10`, `assets` (≤128 записей, каждая `bytes ≤ worldBytes/10`, `memory ≤ 32 MiB`).

## Данные мира `GET /world/*`

Только `Authorization: Bearer`, `Cache-Control: no-store`, без redirect. 401/403 клиент считает потерей сессии. Манифест, модели и зависимости доступны игроку своей карты; чанк — в радиусе `staticChunkRadius` (3 по Чебышёву) от авторитетной позиции; иначе 404. Публичные `maps/` и `assets/models/` из клиентской сборки не отдаются.

## Ответы NPC

- Обычный путь: `npc-question` → один `npc-answer` (или `error`).
- Поток (opt-in): `npc-question` с `stream: true` → `npc-partial {requestId, targetId, seq, text}` (весь текст на данный момент, не дельта; не чаще 10/с на вопрос; volatile) → терминальный `npc-answer`/`error`. После терминального сообщения снимков нет; клиент игнорирует снимок с меньшим `seq`. Снимки не хранятся и не повторяются после reconnect.
- Отмена: `npc-cancel {questionId}` → всегда `npc-cancelled` (идемпотентно); история не пишется; слот очереди освобождается только после физической остановки генерации. Разрыв и перехват управления отменяют вопрос.
- Дедлайн: `npc.timeoutMs` (обычный) и `npc.streamTimeoutMs` (поток), по умолчанию 30000 мс, 1–300000. Клиент с потоком ждёт терминальное сообщение по потоковому сроку, а не продлевает его каждым снимком.
- Реализация потока: сервер (`scripted`, настоящие Ollama/MLX workers) и клиент (`dialogPartial` в `GameApp`/`OnlineSession`) его поддерживают. Расхождение: старые документы называли клиентскую часть и настоящие LLM-partial нереализованными; по коду и истории git это сделано.
- Текст отображается как текст, не HTML.

## HTTP BABEL v2 (`/api/babylon`)

`POST`, JSON ≤256 KiB, Bearer. Запрос `{v:2, requestId, action:{type,...}}`; ответ `{v:2, requestId, state, notice?, suggestion?}` после commit в SQLite или `{v:2, requestId, error:{code,message}}`.

| action.type | Назначение |
|---|---|
| `state` | личный снимок (клиент опрашивает раз в секунду) |
| `create` / `join` / `enroll` | группа 1–4 игроков (`enroll` — совместимость) |
| `languages`, `intro-seen` | языки, окно информации |
| `buy`, `feed` | покупки и кормление (роль, расстояние, шаг задания) |
| `chat` | сообщение группе с переводом на языки получателей |
| `npc` | личный ответ NPC на изучаемом языке |
| `carve` | камень группы (≤64 штрихов, ≤256 точек на штрих, ≤4096 суммарно) |
| `word-save`, `word-learn`, `word-delete`, `suggest` | личный словарь и подсказка перевода |

Идемпотентность по `(playerId, requestId)` и SHA-256 нормализованного действия: тот же запрос возвращает прежнее подтверждение, другое тело — `CONFLICT`. HTTP-коды: INVALID 400, UNAUTHORIZED 401, FORBIDDEN 403, CONFLICT/NOT_READY 409, RATE_LIMIT 429, UNAVAILABLE 503. Для buy/feed/npc/chat/carve нужно управляющее Socket.IO-соединение, уже вошедшее в мир.

## `world-life` v1

Событие `world-life` в том же namespace, пакеты `{v:1, type, ...}`. Клиент: `scene-sync`, `hand {action: pickup|place, targetId?}`, `shotgun {action: fire|reload, yaw, pitch}`. Сервер: `scene-state` (полный снимок: sceneId, revision, serverTimeMs, epochMs, 4 горшка, 5 яблок, 3 кошки, птицы), `hand-result`, `shotgun-state` (до 12 мишеней, 4 оружия, последние 12 выстрелов за 30 с). Подъём — ближайшее яблоко в 2 м; результат рук фиксируется в SQLite (receipt по `(playerId, requestId)`). Пакет ≤64 KiB, частота 5/с. Общий исходящий бюджет `game` + `world-life`: ≤32 ожидающих надёжных пакета и 1 MiB, иначе транспорт закрывается.

## Планируется, не реализовано

Новые wire-схемы приветствия NPC при открытии, настроек языка, чтения durable-результата после reconnect, ledger запросов. Снятый черновик `npc.dialogue.*` не возвращается без нового решения.
