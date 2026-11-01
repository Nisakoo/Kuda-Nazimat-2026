---
id: TASK-044
type: implementation-task
status: todo
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
- Отзыв (выход в другой вкладке, смена пароля, ведущий) приходит в игровой канал как `error {requestId: "server", code: "UNAUTHORIZED", message}` — показать `message`.
- Development: `POST /api/auth/dev` с JSON `{}` или `{name}` → сессия без ввода данных, если `mode.dev === true`.
- Необязательно, но нужно для FPS в панели администратора ([ADMIN-006](../specs/server-admin.md), OBS-014): отчёт `perf` раз в 10 с. `POST /api/telemetry/client` с Bearer `{v: 1, kind: "error" | "unhandled_rejection" | "perf", message?, stack?, source?, build?, fps?, frameMs?, drawCalls?, map?}` → 204; ≤10 в минуту; без текстов игроков.
- `/config.json` в development отдаёт `debug: true`.

## Реализация
- [ ] Клиентская команда решает объём и обновляет свои спеки (ENTRY-008/009 уже ждут этот контракт).
- [ ] Формы регистрации/входа/смены пароля, выход с отзывом, показ причины отзыва, автовход в development, отчёты об ошибках.

## Приёмка
- [ ] AUTH S5–S11 со стороны клиента против настоящего сервера (`--env production` и development).
- [ ] `make client-test` и клиентские проверки проходят.

## Результат
- Не начато.
