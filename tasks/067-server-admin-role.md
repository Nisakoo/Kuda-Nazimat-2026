---
id: TASK-067
type: implementation-task
status: done
spec: ../specs/server-auth.md
requirements: [AUTH-017–020]
related:
  - spec: ../specs/server-admin.md
    requirements: [ADMIN-002, ADMIN-003]
depends_on: [TASK-042]
scheduling_note: вторая из четырёх частей админки (CONTENT → AUTH-017–020 → OBS-013/014 → ADMIN)
---

# Сервер: роль администратора и административная сессия

## Цель и изменения требований
Роль администратора у аккаунта, отдельная административная сессия, вход администратора и команды назначения. Добавлены AUTH-017–020.

## Реализация
- [x] Миграция: роль аккаунта и область сессии.
- [x] AuthService: `adminLogin`, `adminDev`, `verifyAdmin`; игровые проверки отклоняют административные сессии; снятие роли отзывает их.
- [x] HTTP: `POST /api/admin/login`, `/api/admin/dev`, `/api/admin/logout`.
- [x] CLI: `create-admin`, `grant-admin`, `revoke-admin`; конфиг `admin.sessionTtlMs`.

## Приёмка
- [x] AUTH S12 и разделение областей сессий покрыты тестами (~60%).
- [x] `npm --prefix server test` и `npm --prefix server run check` проходят.

## Результат
- Файлы: миграция `server/src/persistence/migrations/010.sql` (роль аккаунта, область сессии); `AuthService`: `adminLogin`, `adminDev`, `verifyAdmin`, `operator.createAdmin/grantAdmin/revokeAdmin`, `verify` отклоняет административные сессии; `server/src/http/adminRoutes.ts` (`/api/admin/login|dev|logout`); CLI `auth -- create-admin|grant-admin|revoke-admin`; конфиг `admin.sessionTtlMs` (8 ч).
- Административный вход не занимает место в мире и работает при заполненном сервере. Не-администратор с верным паролем получает `CREDENTIALS` и не блокируется для игрового входа.
- Проверки (Windows 11, Node 24.15.0, 2026-11-01): `test/admin-auth.test.ts` — AUTH S12 и разделение областей сессий; весь `npm --prefix server test` и `npm --prefix server run check` проходят.
- Не сделано здесь: страница `/admin` и остальные `/api/admin/*` — в задаче ADMIN.
