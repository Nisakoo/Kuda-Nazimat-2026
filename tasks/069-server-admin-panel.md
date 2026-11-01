---
id: TASK-069
type: implementation-task
status: done
spec: ../specs/server-admin.md
requirements: [ADMIN-001–010]
related:
  - spec: ../specs/server-npc-content.md
    requirements: [CONTENT-004–011]
  - spec: ../specs/server-auth.md
    requirements: [AUTH-017–020]
  - spec: ../specs/server-observability.md
    requirements: [OBS-013, OBS-014]
depends_on: [TASK-066, TASK-067, TASK-068]
scheduling_note: последняя из четырёх частей админки
---

# Сервер: панель администратора

## Цель и изменения требований
Страница `/admin` и `/api/admin/*`: мониторинг сервера и клиентов, управление NPC, журнал изменений и действия с аккаунтами. Реализуются ADMIN-001–010.

## Реализация
- [x] `/api/admin/status`: состояние, сервер, клиенты (ping, FPS, IP), ошибки по событиям.
- [x] `/api/admin/npcs*` и `/api/admin/changes`: каталог, правка, перемещение, выключение, удаление, журнал; конфликт revision с текущими данными.
- [x] `/api/admin/accounts/*`, лимит запросов сессии, событие `admin.action` и `admin_actions_total`.
- [x] Страница `/admin`: вход, смена временного пароля, вкладки, подтверждения.

## Приёмка
- [x] ADMIN S1–S6 покрыты тестами (~60%).
- [x] `npm --prefix server test` и `npm --prefix server run check` проходят.

## Результат
- Файлы: `server/src/http/adminRoutes.ts` (весь `/api/admin/*`), `server/src/http/adminPage.ts` (страница `/admin`), сборка `/api/admin/status` в `app/application.ts`; IP устройства в данных присутствия; p50/максимум шага и максимум рассылки в `GameRuntime.stats()`; подсчёт ошибок по событиям за 5/60 мин в `obs/index.ts`; метрика `admin_actions_total`, событие `admin.action`.
- Проверки (Windows 11, Node 24.15.0, 2026-11-01): `test/admin-panel.test.ts` — ADMIN S1–S6 на настоящем сервере: 401 без входа и 403 с игровой сессией; статус с игроком, IP и очередью NPC; правка приветствия и темы применяется к следующему вопросу и следующей delta без перезапуска; устаревшая revision — 409 с текущими данными; перемещение, выключение и удаление фигуры рынка — 403 с сообщением; журнал из БД с автором и IP; завершение сессий игрока; аудит и метрика; выход. Весь `npm --prefix server test` — 28 файлов, 264 теста; `npm --prefix server run check` без ошибок. Живой сервер: `/admin` открывается по LAN-адресу (200), `/operator` по LAN — 404; каталог показывает 4 NPC рынка как фигуры карты и нужные BABEL.
- Не проверено: страница `/admin` в настоящем браузере (проверен только синтаксис её скрипта); перемещение NPC из панели на живом сервере — на текущих картах перемещаемы только Лея и Марк площади demo (покрыто тестами каталога).
- Отклонение от ADMIN-005: p95 времени до первого текста и генерации NPC показываются с момента запуска, а не за 5 минут (гистограммы накопительные); счётчики «принято/ответов/таймаутов/занято» — за 5 минут.
