---
id: TASK-044
type: implementation-task
status: in-progress
spec: ../specs/server-auth.md
requirements: [AUTH-001, AUTH-006, AUTH-009, AUTH-012, AUTH-016]
related:
  - spec: ../specs/server-observability.md
    requirements: [OBS-011]
  - spec: ../specs/client-auth-screens.md
    requirements: [ENTRY-006–013]
  - spec: ../specs/server-foundation.md
    requirements: [SERVER-009]
depends_on: [TASK-042, TASK-043]
scheduling_note: передача от серверной команды 2026-11-01; клиентская задача — объём, UI и требования клиента определяет клиентская команда по SDD
---

# Клиент: пароли, выход, автовход разработчика и отчёты об ошибках (передача от сервера)

## Цель и изменения требований
Сервер реализовал вход по паролю, отзыв сессий, автовход для разработки и приём отчётов об ошибках клиента. Задача фиксирует контракт для клиента; клиентские требования (ENTRY, NET и др.) клиентская команда уточняет сама.

**Важно:** в production вход по имени (`/api/auth/guest`) выключен — текущий клиент в серверной поставке (`make start`) войти не сможет, пока не поддержит пароли. В development (`make server`, `npm start`, клиентские e2e) всё работает как раньше.

Кратко о контракте (полностью — [AUTH-006](../specs/server-auth.md), [OBS-011](../specs/server-observability.md)):
- `GET /api/auth/mode` → `{password: true, guest, dev}` — какую форму показать и можно ли войти автоматически.
- `POST /api/auth/register` `{name, password}` → 201 `{token, expiresAt}`; `login` → 200; `password` `{name, password, newPassword}` → 200 и новая сессия (все прежние отозваны). Пароль 6–128 символов, не равен имени.
- Ошибки `{error: {code, message, retryAfterSeconds?}}`, `message` — готовый текст: `INVALID`, `CREDENTIALS`, `NAME_TAKEN`, `PASSWORD_REQUIRED`, `PASSWORD_CHANGE_REQUIRED` (вход временным паролем — показать смену пароля), `DISABLED`, `RATE_LIMIT` (+ `Retry-After`), `UNAVAILABLE`. 401 от `/api/auth/*` — ошибка формы, а не потеря сессии.
- `POST /api/auth/logout` с Bearer → 204 при выходе.
- Отзыв (выход в другой вкладке, смена пароля, администратор) приходит в игровой канал как `error {requestId: "server", code: "UNAUTHORIZED", message}` — показать `message`.
- Development: `POST /api/auth/dev` с JSON `{}` или `{name}` → сессия без ввода данных, если `mode.dev === true`.
- Необязательно: `POST /api/telemetry/client` с Bearer `{v: 1, kind: "error" | "unhandled_rejection" | "perf", message?, stack?, source?, build?, fps?, frameMs?, drawCalls?, map?}` → 204; ≤10 в минуту; без текстов игроков.
- `/config.json` в development отдаёт `debug: true`.

## Текущий ограниченный объём

Клиентская реализация AUTH-001, AUTH-006, AUTH-009, AUTH-012, AUTH-016 и форм ENTRY-006–009: определение режима, вход, регистрация, смена пароля, guest/dev, серверный выход и причина отзыва. Токен остаётся только в памяти; восстановление после reload не заявляется. Наблюдаемость OBS-011 необязательна и остаётся открытой. Макеты и прочие требования ENTRY вне текущего изменения. Сервер и shared не меняются в рамках клиентского среза; серверная изоляция NPC ведётся отдельно в TASK-070. ENTRY, AUTH и документация обновлены по фактическому функциональному объёму.

## Реализация
- [x] Определён ограниченный функциональный объём; ENTRY-008/009, AUTH и документация обновлены, полные макеты не объявлены готовыми.
- [x] Формы регистрации/входа/смены пароля, выход с запросом отзыва, показ причины отзыва, явный вход разработчика в development.
- [ ] Необязательные отчёты об ошибках OBS-011 не реализованы; решение об их включении отложено.

## Приёмка
- [ ] AUTH S5–S11 со стороны клиента против настоящего сервера (`--env production` и development).
- [x] `make client-test`, клиентские type/import/build checks проходят.
- [ ] Полный релевантный browser-прогон проходит; обнаруженный timeout и непроверенные сценарии указаны ниже.

## Результат

Реализован ограниченный клиентский объём AUTH. Сессия остаётся только в памяти; восстановление после reload не реализовано. При неподтверждённом выходе локальный токен удаляется, а пользователь получает предупреждение. Макеты ENTRY и постоянное хранение токена не входили в изменение.

Проверки: `make client-test` — 227 тестов пройдено; `npm --prefix client run check` — Svelte и TypeScript без ошибок; `npm --prefix client run check:imports` — без нарушений; `npm --prefix client run build` — успешно, предупреждение Vite о размере чанка. `cd client && npx playwright test e2e/production-auth.spec.ts --workers=1` — 1 тест пройден против production-сервера с scripted NPC: регистрация, неверный пароль, вход, выход и отказ отозванному токену, смена пароля, временный пароль. `cd client && npx playwright test e2e/foundation.spec.ts --workers=1` — 5 тестов прошли, включая смену сервера; 1 тест локального 3D-сцены превысил 30 с при проверке размера canvas. Причина не установлена. Основной агент отдельно проверил через общий Chromium регистрацию, неверный пароль, смену пароля и logout против изолированного production-сервера на 127.0.0.1:18080 со scripted/test адаптерами. Read-only запрос к тестовой SQLite подтвердил отзыв сессии после logout. Экран 390×844 проверен визуально: горизонтального переполнения нет, localStorage/sessionStorage пусты. Консоль содержит ожидаемый HTTP 401 отрицательного теста и предупреждения программного WebGL; это не квалификация производительности. Обновлённый browser-сценарий новой AUTH-сессии после рестарта ещё не проверен. Полная приёмка AUTH S5–S11 остаётся открытой. Тесты с моделями не запускались.
