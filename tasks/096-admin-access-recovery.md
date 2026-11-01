---
id: TASK-096
type: implementation-task
status: in-progress
spec: ../specs/server-admin-access.md
requirements: [ADMIN-ACCESS-001–007]
related:
  - spec: ../specs/server-auth.md
    requirements: [AUTH-017–020]
  - spec: ../specs/server-admin-content.md
    requirements: [ADMIN-SRV-009, ADMIN-SRV-012–014]
  - spec: ../specs/admin-panel-ui.md
    requirements: [ADMIN-001, ADMIN-007, ADMIN-019–028]
depends_on: [TASK-080, TASK-093, TASK-095]
---

# Завершение admin-server и перенос решений прерванной admin-panel

## Цель и изменения требований
По запросу пользователя перенести из `origin/feat/admin-panel` административный вход из LAN, отдельные сессии, CLI создания администратора, авторство и защиту одновременных правок. История и графики остаются встроенными; Prometheus/Grafana не возвращаются. HTTPS развивается отдельно, затем проверяется совместная поставка.

Новые требования: ADMIN-ACCESS-001–007, AUTH-017–020, ADMIN-SRV-013–014; ADMIN-001/007 и AUTH/OBS согласуются с дополнительным `/admin` без изменения loopback-доступа `/operator`. Номера задач контента и страницы перенесены в 093–095 из-за коллизий с main/HTTPS.

## Реализация
- [x] Сохранить HTTPS и прерванную интеграцию, собрать admin-server из серверной основы, страницы и актуального main.
- [ ] Завершить авторизацию, CLI, `/admin` и UI входа/смены пароля/выхода.
- [ ] Завершить авторство журнала и устойчивые revision NPC с обработкой конфликтов.
- [ ] Сверить административные требования с кодом, устранить расхождения и записать матрицу.
- [ ] Выполнить серверные, браузерные и регрессионные проверки на Node 24.

## Приёмка
- [ ] ADMIN-ACCESS S1–S5: LAN-вход, изоляция game/admin, отзыв, смена временного пароля, CLI и журнал проверены.
- [ ] ADMIN-SRV-014: устаревшая revision не перезаписывает чужие изменения, revision переживает restart/reset/очистку журнала.
- [ ] Проверки server/shared и браузерная проверка всех разделов проходят; закрытые критерии подтверждены доказательствами.
- [ ] Speс/task metadata, команды Windows и оставшиеся аппаратные проверки соответствуют фактам.

## Результат
- Исходные рабочие папки сохранены; резервная копия `/private/tmp/kuda-admin-tls-preserve-l6mf1w_f`.
- Рабочая папка admin-server: `/private/tmp/kuda-admin-server-integration`, основа `7558468`.

- Перенесены отдельные административные сессии/роль, Windows CLI, `/admin` с входом/сменой пароля/выходом, авторство журнала, revision и защита embedded/BABEL. Prometheus/Grafana удалены; `/metrics` отсутствует.
- Admin-server отдельно: 724 теста, TypeScript/import check и два браузерных сценария — pass на Node 24.15. Совместно с HTTPS: 737 тестов и оба браузерных сценария — pass; type/import check — pass (121 modules / 441 dependencies).
- Браузер использовал Chrome на macOS и настоящий сервер/SQLite/Socket.IO; автоматический HTTPS-контекст разрешает тестовый сертификат. Это не проверка установки сертификата в Windows.
- Открытая приёмка: физические Windows/два ноутбука/Wi-Fi off; TASK-081 (реальные FPS), TASK-091/094 (клиентский handoff); браузерные ADMIN S5/S9 с живой генерацией/сценой. Полное выполнение всех спецификаций не заявляется. Исторические аппаратные критерии TASK-080/095 остаются открыты.
