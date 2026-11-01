---
id: TASK-045
type: implementation-task
status: in-progress
spec: ../specs/client-auth-screens.md
requirements: [ENTRY-007, ENTRY-008, ENTRY-009, ENTRY-012, ENTRY-013]
depends_on: []
related:
  - spec: ../specs/client-avatar-select.md
    requirements: [AVATAR-001, AVATAR-002, AVATAR-003, AVATAR-012, AVATAR-013, AVATAR-014]
  - spec: ../specs/server-auth.md
    requirements: [AUTH-001, AUTH-002, AUTH-003, AUTH-004, AUTH-005, AUTH-006]
---

# Серверная регистрация и вход UI

## Цель и изменения требований
Пользователь сначала разрешил честные unavailable-состояния, затем явно расширил scope на недостающий backend. Последнее указание заменяет прежнее ограничение: реализовать регистрацию/парольный вход/отзыв и обязательный first-avatar flow, не подменять гостевым входом. Обновить профильные AUTH/PROTO/STORE требования согласно новому разрешению. Существующий guest endpoint сохранить только явно обозначенным совместимым demo-маршрутом; он не должен обходить пароль существующего защищённого аккаунта.

## Реализация
- [x] Закрытые register/login/logout контракты; строгая валидация; понятные ошибки invalid credentials/name taken/rate limit/full.
- [x] Хеширование пароля с солью через node:crypto, без логирования/хранения plaintext; миграция старых гостевых аккаунтов без присвоения пароля другим человеком.
- [x] Устойчивый marker pending appearance для новых регистраций; existing/return/resume поведение; server-side gate до подтверждения.
- [ ] Сессии только в памяти клиента; отзыв на выход/назад и остановка transport; авторитетные appearance save/update.

## Приёмка
- [ ] Реальные HTTP/browser сценарии registration → avatar → mode → languages → world; неверный/верный пароль; повтор имени; guest не обходит защищённый аккаунт.
- [ ] Незавершённый avatar восстанавливается после входа/рестарта; существующий подтверждённый пропускает экран; сервер не даёт join без подтверждения.
- [ ] Миграции старой БД, SQL constraints, privacy/authorization, expiry/revocation, лимиты попыток и server full проверены.
- [ ] make server-test, типы/import checks, client-test/check/import/build и real-server browser checks; фактические результаты записаны.

## Открытые вопросы
- AUTH-001/002/006 раньше явно исключали пароль/registration/logout/rate limit. Новое разрешение пользователя требует обновления этих ограничений, а не скрытого обхода.
- Повторное использование старого guest имени для password registration не согласовано. Безопасная граница: занятое имя нельзя захватить через регистрацию; guest не выдаёт session для password account. Старые guest остаются demo-аккаунтами.
- AVATAR-008 «Назад» после регистрации: применить выход из уже созданного аккаунта, pending marker сохраняется; форма регистрации не создаёт второй аккаунт. Отзыв теперь входит в разрешённый backend scope.
- Лимиты длины/сложности пароля и хранения credential должны быть зафиксированы в AUTH до реализации; не создавать внешнего identity provider.
- HTTP без TLS в LAN остаётся принятым риском текущей AUTH-поставки; NEXT HTTPS не реализуется здесь и hardware LAN не подменяется localhost.

## Результат
Реализован настоящий password backend: migration004, SQLite credential/session adapter, auth HTTP API, серверный avatar gate, целевой logout transport/NPC/BABEL, capacity preflight до создания нового account с сохранением takeover. Дополнительно подключён закрытый GET/POST equipment API поверх migration005/store другого агента. Сохранён authenticated avatar-model route. Серверные сценарии и оставшиеся проверки описаны в [evidence/task-045-password-auth.md](evidence/task-045-password-auth.md). Browser/client-flow и финальная полная приёмка остаются основному агенту; задача пока не done.
