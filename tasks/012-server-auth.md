---
id: TASK-012
type: implementation-task
status: todo
spec: ../specs/server-auth.md
requirements: [AUTH-001–006]
related:
  - spec: ../specs/protocol.md
    requirements: [PROTO-008]
depends_on: [TASK-011]
scheduling_note: AUTH-005 (перехват) завершается в TASK-014
---

# Сервер: авторизация

## Цель и изменения требований
Реализовать mock-вход по имени, сессии и проверку доступа. Изменены AUTH-001–005: mock-вход вместо паролей, формат токена и TTL, перехват управления; добавлен AUTH-006 (`POST /api/auth/guest`).

## Реализация
- [ ] AuthService: mock-вход по имени, проверка токена; порты `AccountStore`, `SessionStore`, `Clock`.
- [ ] HTTP-маршрут `POST /api/auth/guest` с точным форматом ответа; Socket.IO-middleware handshake (`VERSION`/`UNAUTHORIZED`); Bearer-проверка для `/world/*`.
- [ ] Закрытие соединения в момент `expiresAt`.

## Приёмка
- [ ] AUTH-001, 003, 006 / S1, S2, S5: тестовые клиенты с действующим, отсутствующим и битым токеном; повторный вход под тем же именем; формат и коды ответа.
- [ ] AUTH-002–003 / S3: истечение закрывает соединение, старый токен отклоняется.
- [ ] AUTH-004 / S5: в БД только хеш токена, в логах токена нет.
- [ ] AUTH-005 / S4: проверяется в TASK-014; до этого отмечен непроверенным.
- [ ] `make server-test` и `npm run check` проходят.

## Результат
- Файлы: —
- Проверки: не выполнялись; реализация не начата.
- Отклонения: —
