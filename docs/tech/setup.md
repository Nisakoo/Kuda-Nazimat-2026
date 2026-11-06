# Установка и команды

Когда читать: разворачиваете окружение разработки, запускаете проверки, выбираете окружение сервера или меняете конфигурацию. Эксплуатация во время игры — [operations.md](operations.md). Установка LLM — [llm.md](llm.md).

## Требования

- Node.js: клиент — 22.12+ в ветке 22 либо 24+; сервер и совместный запуск — **24.15+ в ветке 24** (закреплено в [server/.node-version](../../server/.node-version) и `engines >=24.15.0 <25`). Проверяйте `node --version`.
- npm, Make. Для игры — настольный браузер с WebGL 2, Pointer Lock, клавиатура и мышь.
- LLM (по желанию): uv, Python 3.12, MLX или Ollama — только [llm.md](llm.md).
- Зависимости и браузеры для автоматических проверок готовятся до отключения интернета.

## Установка

```sh
npm --prefix client ci
npm --prefix server ci
```

## Команды Make (из корня)

| Команда | Что делает |
|---|---|
| `make help` | список команд |
| `make client` | Vite dev-сервер клиента (`0.0.0.0`, порт 5173) — локальный стенд, не игровой сервер |
| `make client-test` | Vitest клиента без watch |
| `make server` | сервер в development (`ENV=production` для production) |
| `make server-test` | тесты сервера и shared (`npm --prefix server test`) |
| `make prepare` | один раз, с интернетом: проверка Node 24.15+, `npm ci` клиента и сервера, сборка клиента, `tls init`, `lan:check` |
| `make start` / `make demo` | офлайн: ставит зависимости только если нет `node_modules`, собирает клиент и мир, запускает сервер в **production** |
| `make llm-prepare BACKEND=mlx\|ollama` | подготовка Python-зависимостей по lock (без скачивания весов) |
| `make llm-test` | офлайн-тесты Python-workers через uv |
| `make llm-lock-check` | проверка lock-файлов |
| `make llm-import` | разовый перенос существующих локальных конфигов 2B/0.8B; не установщик |

Переопределения: `PORT=9000`, `ENV=production`, `BACKEND=... MODEL=...` (вместе), `NPC_TIMEOUT=<1–300 с>`, `LLM_PROFILES=/path/profiles.json`, `NODE=/path/to/node`, `CLIENT_RUN_CMD`, `CLIENT_TEST_CMD`. Значения передаются как environment data, не подставляются в shell.

Примеры:
```sh
make server NPC_TIMEOUT=60                          # сохранённый профиль LLM, development
make server BACKEND=ollama MODEL=2b NPC_TIMEOUT=120  # явный профиль на один запуск
make start PORT=9000                                 # если 8080 занят
```

Без make: `npm --prefix client run build`, затем `npm --prefix server start -- --port 9000`.

## Запуск клиента отдельно

`make client` → [http://localhost:5173/](http://localhost:5173/) (Vite печатает LAN-адрес). Игра: `session: local`, стенд рынка со сбросом данных; игровой сервер — `make start`. Готовая сборка:

```sh
npm --prefix client run build
npm --prefix client run preview -- --host 0.0.0.0 --port 4173 --strictPort
```

Мир генерируется автоматически перед `dev`, `build`, тестами и `check`; вручную — `npm --prefix client run world:generate`. Оригинальные GLB: `node client/scripts/generate-avatar-models.mjs` (портреты — флаг `--portraits`), `models:generate` для табличек. `client/dist/` раздаётся обычным HTTP-сервером; `file://` не нужен. CDN, внешних шрифтов и облачных API нет.

## Проверки

Клиент (из корня):
```sh
make client-test
npm --prefix client run check             # генерация мира, svelte-check, tsc strict, check:core
npm --prefix client run check:imports     # dependency-cruiser: циклы и границы модулей
npm --prefix client run build
PLAYWRIGHT_CHANNEL=chrome npm --prefix client run test:browser   # собирает production, HTTP на 127.0.0.1:4173
PLAYWRIGHT_CHANNEL=chrome npm --prefix client run test:render    # WebGL-стенд, порт 5174
npm --prefix client run test:coverage     # V8-покрытие, HTML в client/coverage/index.html
```
- `check:core` — Core, session и GameLoop без DOM/Node.
- Параллельные worktree: `PLAYWRIGHT_PORT` и `PLAYWRIGHT_RENDER_PORT` (по умолчанию 4173/5174). `PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium` вместо установленного Chrome; либо один раз `cd client && npx playwright install chromium`. Тесты не используют чужой dev-сервер и разрешают исходящие запросы только на свой origin.
- Сценарии UI/авторизации (сам поднимает настоящий сервер с временной SQLite): `npm --prefix client run build`, затем `cd client && npx playwright test --config playwright.ui.config.ts`. Сценарии города — `client/playwright.city.config.ts`.
- Артефакты Playwright — `client/test-results/`, `client/render-test-results/` (каталог переопределяется `TEST_ARTIFACT_DIR`); в git их не хранят.

Сервер:
```sh
make server-test
npm --prefix server run check             # tsc сервера и shared + dependency-cruiser
npm --prefix server run check:platform    # типы, чистый shared без DOM/Node, импорты
node server/test/operator.browser.mjs     # браузерная проверка админ-панели (Chromium, временная БД)
node server/test/crash-recovery.ts        # ручная проверка аварийного завершения
```
- `OPERATOR_BROWSER_PACKAGE` — абсолютный путь к `package.json` с Playwright, `OPERATOR_CHROMIUM_EXECUTABLE` — к готовому Chromium, `OPERATOR_EVIDENCE_DIR` — каталог снимков (вне репозитория).
- Автотесты клиента и сервера ходят без реальной LLM; fake-workers и fixtures качество модели не доказывают.

Правила приёмки: для клиента — `make client-test` плюс `check`/`check:imports`/`build`; для сервера и shared — `make server-test` плюс `check`. Неподтверждённые проверки не считаются пройденными.

## Ручная проверка

- **Локальный стенд рынка** (`make client`, `session: local`): WASD, мышь, `E` — взаимодействие, `Esc` — меню. Покупки у лавок бесплатны; неверный корм козе не расходуется; четыре кормления открывают итоги. Окно «Камень» хранит черновик при закрытии, «Высечь» переносит неизменный рисунок в локальную историю. При перезапуске сцены локальный прогресс очищается; роли, перевод и серверное восстановление здесь не имитируются.
- **Двор башни** в стенде: от начальной точки рынка налево по боковому проходу (Z≈9); справа наружная лестница на площадку 3 м, верхние террасы и дверь закрыты.
- **Карты `demo` и `science`** и тестовая сеть выбираются в настройках (радиус 0–2). Тестовая сеть проверяет чат, ответы NPC, разрыв и повторное подключение без сервера и явно помечена в UI.
- **Серверный режим** (`make start`): откройте `https://localhost:8080/`, зарегистрируйтесь, выберите облик и два разных языка, создайте игру (соло или 2–4 игрока) или подключитесь по IP. Повторный вход восстанавливает данные. Если порт отказывает в соединении, сервер не запущен: `make start` (с клиентской сборкой) или `make server` (клиент уже собран).
- Не проверено автоматически: второй физический ноутбук с реально выключенным Wi-Fi, прослушивание звука, профиль на целевых ноутбуках, качество реальной LLM.

## Окружения сервера

Выбор: `--env <имя>` или `APP_ENV` (аргумент важнее). Неизвестное имя — ошибка. Порт — `--port` или `PORT`, адрес — `HOST`. Остальные CLI (`inspect`, `backup`, `lan:check`, `auth`, `tls`, `report`) принимают те же `--env` и `--config`.

| | development (по умолчанию) | production | test |
|---|---|---|---|
| Запуск | `make server`, `npm --prefix server start` | `make start`, `npm --prefix server run start:prod`, `--env production` | `--env test`, автотесты |
| Вход | имя без пароля, `POST /api/auth/dev`, а также пароль | только пароль | как development |
| БД | `data/dev.sqlite` | `data/game.sqlite` | `data/test.sqlite` |
| Консоль / файл логов | debug / debug | info / debug | warn / выключен |
| CORS | `https://localhost:5173` (Vite по HTTPS) | `[]` (same-origin) | `[]` |
| `/config.json` `debug` | `true` | `false` | `false` |

Включить вход без пароля в production нельзя: сервер не стартует. При старте событие `app.start` называет окружение и источники значений.

## Конфигурация сервера

- Без `server/config.json` действуют документированные defaults ([server.md](server.md)). Для своей конфигурации скопируйте [config.example.json](../../server/config.example.json) в `config.json` (файл вне git). Иной путь: `npm --prefix server start -- --config /absolute/path/config.json`.
- Для LLM: [config.ollama.example.json](../../server/config.ollama.example.json), [config.mlx.example.json](../../server/config.mlx.example.json), [config.ollama-08b.example.json](../../server/config.ollama-08b.example.json); замените все `/absolute/...` и `REPLACE_...`. Для подготовленной модели меняйте в своём `config.json` только `defaultMap: "market"` и `language: {"adapter": "local", "options": {}}`, не теряя `npc`, пути и профили.
- `corsOrigins: []` — same-origin; для Vite укажите `https://localhost:5173`. `logWorldAccess: false` по умолчанию (включение логирует выдачу `/world/*`).
- `GET /config.json` игрового сервера строится из серверной конфигурации; `client/public/config.json` — только для Vite-стенда (поля — [client.md](client.md)).

## Репозиторные правила артефактов

Скриншоты, видео, логи, сырые измерения, профили, отчёты тестов и архивы в checkout не хранятся (каталог `tasks/evidence/` не воссоздавать): временный каталог ОС или явно выбранный путь вне репозитория. В git остаются только исходные ассеты и неизменяемые входные fixtures (например, эталоны аватаров в `client/scripts/fixtures/avatars`).
