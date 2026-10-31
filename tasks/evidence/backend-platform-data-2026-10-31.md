# Evidence: платформа B и перенос клиента на shared

База: `origin/main` = `2e67d5b`. Ветка: `feat/backend-platform-data`. Среда: macOS arm64; серверные проверки — Node **24.15.0**, установленный изолированно в `/private/tmp/backend-node24` (системный Node 25.6.0 не засчитывается как Node 24). npm 11.8.0. Серверные зависимости установлены, lockfile обновлён; runtime-зависимость только Socket.IO, socket.io-client перенесён в devDependencies.

## Выполнено

| Проверка | Результат |
|---|---|
| `npm --prefix server ci --offline --cache /private/tmp/backend-npm-cache --no-audit --no-fund` (Node 24.15.0) | 113 пакетов установлены из подготовленного кеша без сети |
| `PATH=/private/tmp/backend-node24/node_modules/.bin:$PATH make server-test` | 37 тестов, 4 файла, проходят |
| `npm --prefix server run check:platform` | Типы B, shared без DOM/Node и импорты: проходят |
| `npm --prefix server run check` | НЕ проходит: 8 TS1294 в game/GameService.ts и game/World.ts; TS2339/TS7006 в world/access.ts, код A из main |
| `make client-test` | 137 тестов, 18 файлов, проходят |
| `npm --prefix client run check` | Svelte/TS и headless Core/session: проходят |
| `npm --prefix client run check:imports` | Проходит, shared остаётся чистым |
| `npm --prefix client run build` | Проходит; предупреждение о JS-чанке 863.96 kB, gzip 233.10 kB |
| `PLAYWRIGHT_CHANNEL=chrome npm --prefix client run test:browser -- e2e/world.spec.ts e2e/network.spec.ts` | 5 сценариев проходят: карта, лимит кеша, ошибки загрузки, mock-чат/NPC/reconnect, отказ реального входа без сессии |
| `make server` | Ожидаемый отказ до listen: отсутствует createGame набора A; это блокер, не успешный запуск |
| Сравнение старого клиентского парсера из `origin/main` с shared на Node 24 | 22 сравнения (8 прежних fixtures + 14 общих); значения, коды и тексты ошибок совпали |

Первый offline npm ci выявил неполный кеш (ENOTCACHED); после подготовки сетевой установкой повторный offline ci прошёл. Это проверка зависимостей сервера, не полного make demo на чистом клоне.

HTTP/браузерные проверки выполнялись с разрешением локального listen вне песочницы: первоначальный запуск внутри sandbox получил EPERM и не засчитан. Первый отрицательный тест dependency-cruiser выявил, что Node-модули нормализуются как `fs`, а не `node:fs`: добавлено правило по `dependencyTypes: core`; теперь искусственный импорт IO в домен обнаруживается.

## Покрытие платформы

- Строгая конфигурация, относительные пути, bounds NPC, неизвестные поля; недоступные client/world и ошибка проверки мира останавливают запуск.
- Публичная сборка/config/health, точный ответ guest-входа, JSON ≤1 KiB (включая chunked без Content-Length), невалидные имена/лишние поля; Bearer `/world`, 200/404 от контрактного GameRuntime, allowlisted CORS/preflight, traversal, закрытые world-каталоги и symlink. Логи не содержат токена/хеша.
- SQLite: WAL, FK, FTS5 на Node 24.15.0; транзакционный account+player; NULL до первого join; пакетный rollback; неизвестная версия; очистка старых сессий; история ≤50, контекст ≤6, изоляция пар.
- Согласованный `VACUUM INTO` работающей WAL-БД; SIGKILL дочернего writer после committed позиции, integrity_check=ok; повторное открытие и восстановление отдельной копии. Это не измерение окна потери при игровом saveInterval.
- Очередь FIFO, одна квота на игрока, максимум четыре unfinished; total deadline включает ожидание; cancellation queued/running, зависший слот удерживается после abort и логируется через 2 с; отмена не пишет историю; запись предшествует ответу; сбой store/responder и пустой ответ — unavailable; нормализация ≤4000.
- scripted: профиль темы, память, повторные объяснения и после насыщения контекста; start/stop, abort до/во время, deadline, отсутствие сетевых обращений в контрактном прогоне.
- Composition root проверен с тестовым GameRuntime, реализующим **только contracts.ts**. После restart сохраняются сессия/позиция/история, повторный вопрос ссылается на прошлый. Отдельный дочерний процесс получает SIGTERM, сохраняет позицию, закрывает SQLite/HTTP и выходит с кодом 0 за <10 с.
- CLI inspect читает живую WAL-БД без токенов/хешей/полного ответа, вопрос усечён до 60 символов. CLI backup создаёт копию и отказывает в перезаписи.

## Что остаётся непроверенным

1. Полный запуск `make server`/`make demo`, реальные handshake/expiry/takeover/slots, периодические и grace-сохранения, AOI и доступ к чанкам по реальной позиции, влияние очереди на tick. В main нет `server/src/game/index.ts`, realtime и server/content; код A содержит перечисленные ошибки типов. Финальная интеграция TASK-026 — только после слияния A.
2. Повторный `make demo` на чистом клоне и без интернета, репетиция в браузере и показ реальных двух игроков. UI не вызывает guest-вход: TASK-028.
3. NPC-контент с персонами относится к каталогу A; B получает готовый NpcProfile через зафиксированный контракт. `contracts.ts` не изменён; `game/world/realtime/content` не изменены.
4. Второй физический ноутбук, отключённый Wi-Fi, реальная модель, AI/LLM и STORE-006–010. Никакая заглушка в этом evidence не доказывает их приёмку.

Изменения клиента ограничены явно разрешённым переносом общих контрактов. В shared не добавлены игровые правила, IO, UI, адаптеры, npm-пакет или зависимости; изменён только профиль компиляции для прямого импорта ESM. Клиентские GameCommand/WorldEvent, MovementBounds, cache и render-абстракции остаются локальными.
