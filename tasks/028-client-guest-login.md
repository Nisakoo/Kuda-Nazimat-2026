---
id: TASK-028
type: implementation-task
status: todo
spec: ../specs/client-multiplayer.md
requirements: [NET-007]
related:
  - spec: ../specs/server-auth.md
    requirements: [AUTH-006]
depends_on: [TASK-012]
---

# Клиентский вызов mock-входа

## Цель и изменения требований
Закрыть описанную в SERVER-DEMO внешнюю зависимость. Новых серверных API и требований нет. Реализация UI не входит в набор B; разрешённое изменение клиента в нём — только TASK-027.

## Реализация
- [ ] В online без сессии запросить имя, отправить POST /api/auth/guest {name} и передать {token, expiresAt} в GameApp.provideServerSession.
- [ ] Ошибки показать текстом, токен хранить только в памяти; после истечения предложить вход заново.

## Приёмка
- [ ] NET-007 / AUTH-006: браузер входит по имени без ручной вставки токена, подключается к /game и загружает /world с Bearer.
- [ ] Невалидное имя/ошибка сети не открывают игровой канал; повторный вход восстанавливает игрока.
- [ ] make client-test, check, check:imports, build и браузерный сценарий с реальным сервером.

## Результат
Не реализовано в наборе B; блокирует браузерную репетицию TASK-026.
