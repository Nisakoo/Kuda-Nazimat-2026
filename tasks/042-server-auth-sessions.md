---
id: TASK-042
type: implementation-task
status: done
spec: ../specs/server-auth.md
requirements: [AUTH-001–010, AUTH-012–016]
related:
  - spec: ../specs/server-foundation.md
    requirements: [SERVER-004, SERVER-009]
  - spec: ../specs/protocol.md
    requirements: [PROTO-008]
depends_on: [TASK-012, TASK-016]
scheduling_note: серверная часть; клиентские экраны и автовход — передача TASK-044
---

# Сервер: пароли, сессии с отзывом, лимиты и окружения

## Цель и изменения требований
Защитить аккаунты паролем в production, сделать сессии отзываемыми, ограничить подбор и дать ведущему управление аккаунтами; удобный вход без пароля оставить разработке. Изменены AUTH-001–006 и SERVER-004; добавлены AUTH-007–010, 012–016 и SERVER-009; AUTH-011 (переход старых аккаунтов) снят — данные тестовые, production начинается с отдельной чистой БД.

## Реализация
- [x] Окружения development/production/test: пресеты, слои defaults → пресет → файл → `HOST`/`PORT` → `--port`, `--env`/`APP_ENV`, отдельные БД, запрет входа без пароля в production (`src/app/config.ts`).
- [x] Миграция `003.sql`: пароль, временный пароль, публичный sessionId, IP, отзыв; данные не удаляются.
- [x] scrypt с параметрами в записи, пересчётом слабых хешей, хешем-пустышкой и очередью из 2 вычислений (`src/auth/password.ts`).
- [x] AuthService: guest, dev, register, login, смена пароля, logout, verify с отзывом, лимит сессий, блокировка имени и лимит по IP (`src/auth/AuthService.ts`, `limits.ts`).
- [x] Отзыв закрывает живые сокеты с причиной (`GameRuntime.closeSessions`).
- [x] HTTP `/api/auth/*` с таблицей ошибок и `Retry-After`; лимиты сессии на `/api/babylon` и `/world/*` (`src/http/authRoutes.ts`, `server.ts`).
- [x] Действия ведущего на `/operator` с защитой CSRF и CLI `npm --prefix server run auth`.
- [x] `make start` — production, `make server` — development; `config.example.json`.

## Приёмка
- [x] S1–S4: прежние тесты AUTH проходят (`a-realtime`, `integration`, `platform`).
- [x] S5, S7, S8, S11 и AUTH-002/009/012/013: `test/auth.test.ts` (сервис).
- [x] S6, S9, S10 и HTTP-контракт: `test/auth.test.ts` (настоящий HTTP и Socket.IO).
- [x] SERVER-009: `test/config.test.ts`.
- [x] `npm --prefix server test` — 22 файла, 195 тестов, все прошли (дважды подряд); `npm --prefix server run check` без ошибок. Windows 11, Node 24.15.0, 2026-11-01.

## Результат
- Клиентский контракт и автовход описаны в AUTH «Передача клиенту»; клиент пока умеет только `guest`, поэтому в production он войти не сможет до TASK-044 — решение пользователя 2026-11-01.
- Не проверено: цели `make` (на машине нет make; шаги выполнены командами npm), пароль на реальных ноутбуках в LAN.
