# TASK-045 — password-auth worker evidence

## Реализация

- `server/src/auth/AuthService.ts`: настоящие register/login, scrypt-v1 (N=32768,r=8,p=1), случайная соль 16 байт, hash 64 байта, timingSafeEqual, dummy KDF для неизвестного имени. Не более 2 KDF без очереди; bounded fixed-window limits 20/source и 10/name за 60 с, не более 2048 ключей. Пароль не trim/normalize, 8–128 UTF-16 единиц, максимум 512 UTF-8 байт. Credential и plaintext не передаются логгеру.
- `server/src/auth/ports.ts`, `server/src/persistence/authentication.ts`: SQLite account/player/credential создаются атомарно. Занятое guest имя не присваивается регистрацией, включая гонку во время KDF; guest не выдаёт password session. Явные SQL columns, параметризованные запросы, rollback при ошибке credential.
- `server/src/persistence/migrations/004.sql`: account_credentials с FK и CHECK; 003/005 и equipment store сохранены.
- `server/src/persistence/database.ts`: заменена только accounts/sessions construction на sqliteAuthStores; avatar/equipment/player/dialogue изменения другого агента сохранены.
- `server/src/http/server.ts`: реальные register/login/guest/logout/state маршруты, точный session-response, строгие/ограниченные тела и AuthError mapping. Protected state, logout, avatar, equipment перепроверяют соответствующую сессию; logout принимает пустое тело или {}. Avatar-model route сохранён. GET/POST equipment использует закрытый parseEquipmentState, owner-only save и game.setEquipment.
- `server/src/app/application.ts`: composition auth + equipment stores, capacity predicate, targeted BABEL cancellation.
- `server/src/contracts.ts`, `server/src/game/index.ts`: optional SessionVerifier state/onRevoked и runtime canAdmit, без нарушения старых fake verifier/runtime. Реальный runtime делегирует GameService.canAdmit.
- `server/src/realtime/gateway.ts`: join gate по persisted state, повторная verify при гонке handshake/logout, targeted session-hash revoke; другой новый token того же account не отключается. Disconnect отменяет NPC. Pending-state read failure отклоняет join, а не приводит к необработанному исключению.
- Capacity проверяется до session issue, до нового guest/account creation и повторно после асинхронного register KDF. FULL=503 без нового account/session; уже занятый account сохраняет takeover. Session issue не резервирует слот; attach остаётся авторитетным.
- `server/test/auth.test.ts`: 11 реальных SQLite/service/migration тестов. `server/test/integration.test.ts`: 5 новых HTTP+Socket сценариев, всего 13; auth restart/pending/join/save/logout, exact-session revocation/NPC cancellation, in-flight BABEL no-commit, capacity no-create/takeover, equipment privacy/bounds/AOI. Миграционный fixture создаёт старые строки напрямую, не вызывает современный adapter до его миграций.
- Обновлены AUTH, PROTO, STORE, архитектура и backend checklist TASK-045. Полная browser/client приёмка не объявлена выполненной.

## Последние проверки

- `npm --prefix server test -- test/auth.test.ts test/integration.test.ts test/equipment.test.ts test/migrations.test.ts test/application.test.ts test/contracts.test.ts`: **PASS, 6 files / 66 tests**.
- `npm --prefix server run check`: **PASS**, server/shared TypeScript и dependency-cruiser; 62 modules / 188 dependencies, no violations.
- `make server-test` запуск 1: 152 PASS, 1 FAIL из 153 — существующий subprocess import-rules test timeout 15 s под нагрузкой. Изолированный retry contracts 29/29 PASS, затем включён в 66/66 PASS.
- `make server-test` запуск 2: 150 PASS, 3 FAIL из 153 — реальные world tests отклоняют assets/models/avatars/lukas.glb: фактические 693680 bytes против manifest 728560. AUTH/equipment тесты PASS. Это несогласованные параллельно обновлённые model/manifest; client files worker не изменял. Основному агенту сообщено о необходимости world regeneration после завершения моделей.
- Позже добавленный BABEL logout test сначала имел неверный fixture: solo group не запускает translate. Исправлен на группу 2 игроков; test и весь набор 66/66 PASS. Никаких увеличений test timeout в коде не сделано.

## Оставшаяся приёмка

Основной агент должен регенерировать клиентские world manifests после моделей и повторить полный make server-test. Browser/client-flow, client tests/check/build и реальная hardware LAN-проверка worker не выполнялись. HTTP LAN без TLS и process-local rate counters остаются явно описанными рисками. TASK-045 пока in-progress; server-auth implementation partial до полной согласованной приёмки.
