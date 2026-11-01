---
id: TASK-016
type: implementation-task
status: in-progress
spec: ../specs/offline-multiplayer.md
requirements: [OFFLINE-001–003, OFFLINE-005–019]
related:
  - spec: ../specs/server-realtime.md
    requirements: [REALTIME-010]
depends_on: [TASK-013, TASK-014, TASK-026]
scheduling_note: серверная часть; клиентские OFFLINE-004 и скрытие режимов из OFFLINE-014 сняты из спеки 2026-11-01 и сюда не входят
---

# Офлайн-мультиплеер: LAN, Wi-Fi и один компьютер

## Цель и изменения требований
Реализовать [OFFLINE](../specs/offline-multiplayer.md) — продуктовый офлайн-режим трёх сетей (свой роутер, существующая сеть, один компьютер). Добавлены OFFLINE-001–019 и REALTIME-010; DEMO-001–006 сняты вместе со спекой system-offline-demo. LLM-квалификация из задачи убрана в TASK-018. 2026-11-01: сняты OFFLINE-004 (клиент) и клиентская часть OFFLINE-014; изменены OFFLINE-003 (`--port`, `PORT=`, `EACCES` в Windows), OFFLINE-009 (`protocol: 3`), OFFLINE-018 (замена symlink/SIGTERM в Windows).

## Реализация
- [x] `make prepare` / `make start` (`make demo` — синоним), самопроверка, блок подключения с интерфейсами и предупреждениями, понятная ошибка занятого порта (OFFLINE-001–003).
- [x] `npm run lan:check` (OFFLINE-008), таблица диагностики и инструкции брандмауэра в README (OFFLINE-006, 009).
- [x] Экран ведущего `/operator` и `/api/operator/status` только с loopback (OFFLINE-010).
- [x] Раздельное появление игроков (REALTIME-010 / OFFLINE-013).
- [x] Логи входа в мир/отключения/перехвата/освобождения места с IP без секретов (OFFLINE-016).
- [x] Автотесты OFFLINE-018, в том числе по не-loopback IPv4; перенос серверных тестов на Windows (пути, symlink, SIGTERM).
- [ ] Ручной протокол OFFLINE-019 на R1/R2/R3 и замеры OFFLINE-017 на целевых ноутбуках.

## Приёмка
- [ ] OFFLINE S1–S7 выполнены; R2 при изоляции клиентов записан как «неприменимо».
- [x] REALTIME S8 проходит.
- [ ] `make server-test`, `npm --prefix server run check`, `make client-test` проходят на Windows и macOS.
- [x] Неисполненные проверки явно отмечены и не выданы за успешные.

## Результат
- Файлы: `Makefile` (prepare, start, demo, `PORT=`), `server/src/common/network.ts` (адреса, блок подключения, брандмауэр, loopback), `server/src/app/selfCheck.ts` и `server/src/cli/lanCheck.ts` (`lan:check`), `server/src/http/operatorPage.ts` и маршруты в `server/src/http/server.ts`, `server/src/game/spawn.ts`, `presence()` в GameService/GameRuntime, логи в `server/src/realtime/gateway.ts`, `--port` в `server/src/app/config.ts`, `server/src/app/main.ts`; тесты `server/test/offline.test.ts`, `test/harness.ts` (общий настоящий сервер для интеграционных тестов), Windows-правки `platform.test.ts`, `application.test.ts`.
- Проверки (Windows 11, Node 24.15.0, 2026-11-01):
  - `npm --prefix server test` — 19 файлов, 170 тестов, все прошли; `npm --prefix server run check` — без ошибок; `npm --prefix client test` — 190 тестов прошли, `npm --prefix client run check` без ошибок (клиент не менялся).
  - OFFLINE-018: два `socket.io-client` по не-loopback адресу машины `192.168.1.96` (сервер на `0.0.0.0`): вход, движение у второго игрока, чат, `/world` с Bearer и 401 без него. Без такого адреса тест помечается пропущенным, а не успешным. `/operator` и `/api/operator/status` по этому адресу — 404, с loopback — 200 без токенов и текстов. Занятый порт — понятная ошибка. Логи «Вход в мир/Игрок отключился/Соединение закрыто сервером/Место освобождено» содержат playerId и IP, но не токен и не текст чата.
  - Ручной запуск `node src/app/main.ts --config <tmp> --port 9000`: блок подключения напечатан (localhost, Wi-Fi 192.168.1.96, VPN-адаптер, link-local помечен «нет сети», адрес экрана ведущего, подсказка Windows), `/api/health` — `protocol: 3`, `/operator` с loopback 200, по LAN-адресу 404, игра по LAN-адресу 200, второй запуск на том же порту — «Порт 9000 уже занят…».
  - `npm run lan:check -- --port 9000` после `npm --prefix client run build` — все строки OK. На порту 8080 этой машины слушает чужой `AgentService`; Windows вернул `EACCES`, и это теперь показывается как занятый порт с подсказкой `--port`.
  - Перенос тестов на Windows: путь конфигурации через `resolve`, symlink-проверка выполняется при наличии прав и иначе проверяет отсутствующий файл, graceful shutdown дочернего процесса в Windows вызывается через `process.emit('SIGTERM')` (POSIX — настоящий сигнал).
- Не выполнено и не засчитано:
  - `make prepare`/`make start` как цели make: на этой машине нет `make`; их шаги выполнены вручную теми же командами npm.
  - Ручной протокол OFFLINE-019 (R1 — свой роутер и два физических ноутбука, R2, R3 с выключенным Wi-Fi) и замеры OFFLINE-017 на целевом оборудовании; S1–S7 целиком.
  - Прогон на macOS и Linux.
