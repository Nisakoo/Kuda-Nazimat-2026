---
id: TASK-012
type: implementation-task
status: in-progress
spec: ../specs/server-auth.md
requirements: [AUTH-001–002, AUTH-004, AUTH-006]
related:
  - spec: ../specs/protocol.md
    requirements: [PROTO-008]
  - spec: ../specs/server-auth.md
    requirements: [AUTH-003]
depends_on: [TASK-011]
scheduling_note: часть B (платформа и данные); handshake и перехват (AUTH-003/005 на стороне сокета) делает часть A в TASK-014
---

# Сервер: авторизация

## Цель и изменения требований
Реализовать mock-вход по имени, сессии и проверку доступа. Изменены AUTH-001–005: mock-вход вместо паролей, формат токена и TTL, перехват управления; добавлен AUTH-006 (`POST /api/auth/guest`).

## Реализация
- [x] AuthService, AccountStore/SessionStore, проверка токена и TTL, случайный токен 32 байта и SHA-256.
- [x] POST /api/auth/guest, JSON ≤1 KiB, точное тело успеха, валидация имени и Bearer /world.
- [ ] Handshake/expiry/takeover — A/TASK-014; B предоставляет SessionVerifier.

## Приёмка
- [x] AUTH-001–002, 004, 006: одна идентичность при разном регистре, новое значение токена, имя первого входа, hash-only store, точный формат и 400.
- [x] AUTH-003 (HTTP/верификация): без токена 401; истёкший/битый токен отклоняется, boundary expiresAt проверен.
- [ ] AUTH S1/S3/S4: настоящий Socket.IO-handshake, закрытие по TTL и перехват — после A.
- [x] make server-test, check:platform проходят.
- [ ] Полный npm run check: ошибки A из main.

## Результат
Реализованы auth и HTTP-вход; нет паролей, logout или API v2. Клиентская форма входа описана в TASK-028 и не реализована в B. [Evidence](evidence/backend-platform-data-2026-10-31.md).
