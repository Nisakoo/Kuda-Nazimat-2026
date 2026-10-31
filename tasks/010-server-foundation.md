---
id: TASK-010
type: implementation-task
status: in-progress
spec: ../specs/server-foundation.md
requirements: [SERVER-001–005, SERVER-007–008]
depends_on: []
scheduling_note: часть B (платформа и данные); createGame части A подключается по contracts.ts, до готовности — тестовый GameRuntime, production требует A
---

# Сервер: каркас

## Цель и изменения требований
Создать `server/` — каркас модульного монолита с composition root, конфигурацией, HTTP и жизненным циклом. Изменены SERVER-001–006: выбраны расположение в репозитории, Node 24/TypeScript, node:http, правила чистой архитектуры и лимит слотов. Добавлены SERVER-007–008. Остальные модули подключаются своими задачами; до них здесь есть только пустые точки сборки.

## Реализация
- [x] Node 24.15.0, package/lockfile, HTTP без web-фреймворка, strict TypeScript, make server/server-test.
- [x] app: строгий config, композиция через CreateGame из contracts.ts, fail-fast, SIGINT/SIGTERM с лимитом остановки 10 с.
- [x] Публичные UI/config/health, закрытые world-каталоги, Bearer и CORS, безопасные логи.
- [x] Проверка импортов, включая отрицательный пример IO в домене; server/README.md.

## Приёмка
- [x] SERVER-001–004, 007–008: runtime Node 24, HTTP/config/health и правила импортов проверены компонентно.
- [x] SERVER-003 / S2: traversal, неизвестные ресурсы, maps/models и symlink закрыты; /world без токена — 401.
- [x] SERVER-005 / S3: ошибки подготовки не открывают порт; SIGTERM с контрактным GameRuntime сохраняет позицию и завершает процесс за <10 с.
- [ ] SERVER S1/S3/S5: реальный runtime A, LAN-игра, сохранение полного мира и отсутствие текстов чата в логах — после TASK-014.
- [x] make server-test, check:platform проходят.
- [ ] Полный npm run check: ошибки A из main, см. evidence.

## Результат
Реализованы app/http/common и конфиги. SERVER-006 принадлежит A и исключён из реализации B. Production требует настоящий createGame; его отсутствие даёт явную ошибку, не подменяется пустым миром. Проверки и блокеры — [evidence](evidence/backend-platform-data-2026-10-31.md).
