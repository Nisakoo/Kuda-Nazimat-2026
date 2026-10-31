# Интеграция A+B и вход клиента — 2026-10-31

База A: `main` 0d53eac, merge 7398023 в `feat/backend-platform-data`. Стык `server/src/contracts.ts` не изменялся. Корневой shared — код A, клиент импортирует его напрямую. Клиентский UI разрешён отдельным указанием пользователя; LLM, AI и протокол v2 исключены.

## Проверки

Среда: macOS/Apple M4; сервер Node 24.15.0 (отдельный runtime, не системный Node 25); Chrome 156, Playwright, viewport 1280×800 и 640×480.

- `make client-test`: 19 файлов, **146 тестов прошли**.
- `npm --prefix client run check`: svelte-check без ошибок/предупреждений, tsc и headless Core прошли.
- `npm --prefix client run check:imports`: 81 модуль, нарушений нет.
- `PATH=/private/tmp/backend-node24/node_modules/.bin:$PATH make server-test`: 9 файлов, **67 тестов прошли**, пропусков нет.
- `PATH=/private/tmp/backend-node24/node_modules/.bin:$PATH npm --prefix server run check`: типы server/shared, 45 модулей без нарушений импортов.
- `PATH=/private/tmp/backend-node24/node_modules/.bin:$PATH PLAYWRIGHT_CHANNEL=chrome npm --prefix client run test:browser`: сборка успешна; 27 из 28 сценариев прошли, единственный отказ — прежнее ожидание заглушки online в foundation. Проверка заменена ожиданием формы до открытия канала; последующий запуск `playwright test e2e/foundation.spec.ts` — **5/5 прошли**. Остальные 27 сценариев повторно не запускались. В сумме проверены все 28 сценариев актуального набора.
- Vite предупреждает о размере JS: 869,38 kB / gzip 234,59 kB; это предупреждение, сборка успешна.
- `git diff --check` чистый; `git diff 2e67d5b -- server/src/contracts.ts` пустой.

## Настоящий сервер и браузер

`server/test/integration.test.ts` запускает createGame A, HTTP B, Socket.IO, SQLite и NpcDialogueService: Bearer/окрестность, periodic/grace-save, восстановление playerId/позиции, запись NPC до ответа, истечение сессии и отказ старому токену, перехват с отменой NPC до commit.

Пять новых сценариев `client/e2e/server-auth.spec.ts` прошли и отдельно (5/5), и в полном прогоне. Они запускают реальный `server/src/app/main.ts` с временной БД и настоящими картами/content:

1. Вход по имени без ручного токена; защищённый `/world`; takeover с причиной; logout/reload без сохранённого токена.
2. Чат двух игроков выводит HTML-подобную строку текстом. Подход к Лее, ответ, штатный restart сервера, то же имя восстанавливает позицию и память предыдущего вопроса.
3. API-ошибка текстом на 640×480; pending блокирует повтор; смена сервера отменяет запрос и сбрасывает имя.
4. HTTP 401 и клиентское истечение TTL возвращают форму без автоматического повторного POST.
5. Смена карты на server market, загрузка мира и выход; клиентские механики инвентаря не выдаются за серверные.

В браузере обнаружена и исправлена потеря начального join при upgrade polling → WebSocket. Теперь volatile только input; остальные запросы отправляются в подключённый transport, Socket.IO sendBuffer очищается при потере связи, действие после ping expiry возвращает false без replay. Отдельный unit-тест подтверждает это поведение.

## Нагрузка

`PATH=/private/tmp/backend-node24/node_modules/.bin:$PATH node server/test/load-profile.ts`: 61 с настоящего A+B, четыре игрока, движение 20 Hz, чат, одновременные вопросы NPC с задержкой 5 с, SQLite и сохранение 10 с. [Результат JSON](server-load-2026-10-31.json).

p95 шага **0,977 мс**, max 10,493 мс; p95 интервала рассылки **101,195 мс** (609 замеров). 2439 delta, 6 ответов, 18 ожидаемых UNAVAILABLE из-за общего deadline очереди, ошибок сервера нет. Это проверка отсутствия ожидания NPC внутри шага на данной машине, не квалификация LLM или иной аппаратуры.

## Чистый клон и make demo

`git clone --no-hardlinks --branch feat/backend-platform-data . /private/tmp/backend-clean-demo-20261031` создал отдельный клон 8cf3e76. Подготовленные client/server node_modules подключены symlink; npm запущен с `npm_config_offline=true`, runtime Node 24.15.0. Временный harness вне репозитория запускал **make demo**, выполнял guest-вход двумя socket.io-client и завершал именно дочерний сервер SIGTERM. Это не установка зависимостей без кеша и не физическое отключение Wi-Fi.

Два полных запуска make demo прошли. Проверены localhost/LAN-адреса в stdout, UI/config, движение обоих игроков, чат, вопрос Лее и Bearer-ресурс. Первый SIGTERM — 15 мс, второй — 11 мс. После первого stop в SQLite две позиции и один диалог; повторный запуск сохранил их без изменений, вход под тем же именем сохранил playerId, повторный вопрос дал ссылку на прошлый и вторую запись. `inspect` работает на живой WAL-БД; integrity_check=ok. В operational-логах нет значений токенов, текста чата и вопроса. [Результат](demo-smoke-2026-10-31.json).

## Границы подтверждения

Завершены TASK-010/011/012/025/028. TASK-026 остаётся in-progress до полной репетиции и проверки диаграммы в GitHub. Физический LAN/выключенный Wi-Fi, полная шестиминутная репетиция и отрисовка Mermaid в GitHub не выполнялись. Аварийное восстановление проверено отдельно описанным ниже сценарием; результат относится к данному прогону на этой машине.

Конфликтующие формулировки оставлены в открытых вопросах соответствующих спецификаций: ESM-маркер shared, граница клиентских правок, map-wide чат, будущий v2, исходящий лимит пакета realtime, local/mock в защищённой серверной поставке. Они не засчитаны как дополнительные реализованные гарантии.

## STORE S3 и NPC S4

`PATH=/private/tmp/backend-node24/node_modules/.bin:$PATH node server/test/crash-recovery.ts` запускает настоящий дочерний процесс сервера на временной карте/БД. После первого периодического сохранения (интервал 10000 мс) игрок снова двигается, resync подтверждает другую позицию. Через ~5 с выполнены VACUUM INTO и SIGKILL. При рестарте сохранены playerId и последняя committed-позиция; текущая БД и отдельная копия дают integrity_check=ok. Возраст последнего commit в момент аварии — **5159 мс**, меньше saveInterval. [JSON](crash-recovery-2026-10-31.json). Игровой tick не вызывает store; saveMoved запускается отдельным таймером в game/index.ts.

Дополнительно integration.test.ts проверяет реальный A+B с ответчиком, чей start бросает ошибку: health сообщает unavailable, движение сохраняется, чат доставляется, NPC возвращает UNAVAILABLE без текста исключения. После добавления этого сценария полный server-test — 67/67, полный check снова прошёл.
