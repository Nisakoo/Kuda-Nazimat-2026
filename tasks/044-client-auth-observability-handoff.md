---
id: TASK-044
type: implementation-task
status: done
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

**Важно:** в production вход по имени (`/api/auth/guest`) выключен; клиент использует реализованные формы паролей. В development (`make server`, `npm start`, клиентские e2e) также доступны guest/dev.

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

Клиентская реализация AUTH-001, AUTH-006, AUTH-009, AUTH-012, AUTH-016 и форм ENTRY-006–009: определение режима, вход, регистрация, смена пароля, guest/dev, серверный выход и причина отзыва. Токен остаётся только в памяти; восстановление после reload не заявляется. Необязательные отчёты об ошибках OBS-011 не включены в этот срез; отдельная передача FPS-телеметрии ведётся в TASK-081. Макеты и прочие требования ENTRY вне текущего изменения. Сервер и shared не меняются в рамках клиентского среза; серверная изоляция NPC ведётся отдельно в TASK-070. ENTRY, AUTH и документация обновлены по фактическому функциональному объёму.

## Реализация
- [x] Объём закреплён в ENTRY-015–016: формы и режим сервера, явный вход для разработки; согласованная форма не заменяется автоматическим входом.
- [x] Формы регистрации/входа/смены пароля, выход с отзывом, показ причины отзыва и отдельное действие для development. Необязательная отправка telemetry не включена: это серверная наблюдаемость, отдельного отсутствующего игрового UI для неё нет.

## Приёмка
- [x] Реальный development: явный вход без пароля. Production: guest/dev недоступны, временный пароль требует смены, новая сессия работает, старая отозвана. Остальные AUTH S5–S11 покрыты серверным регрессионным набором; эта проверка не подменяется mock.
- [x] `make client-test`, типы, импорты, сборка и отдельные браузерные проверки — TASK-087.

## Результат
- Реализовано в PasswordAuth, Login и GameApp; `completion-contracts.spec.ts` проверяет production и development без снимков. Сохраняются очистка секретов, явный вход и отзыв поздно выданного токена. Результаты — [TASK-087](087-map-ui-completion.md).
