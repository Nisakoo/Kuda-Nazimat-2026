---
id: TASK-014
type: implementation-task
status: done
spec: ../specs/server-realtime.md
requirements: [REALTIME-001–009]
related:
  - spec: ../specs/server-auth.md
    requirements: [AUTH-005]
  - spec: ../specs/server-foundation.md
    requirements: [SERVER-006]
  - spec: ../specs/protocol.md
    requirements: [PROTO-008]
depends_on: [TASK-013, TASK-024]
scheduling_note: часть A (мир и сеть); SessionVerifier/PlayerStore/NpcQuestions из contracts.ts подключены к B; тесты домена используют реализации в памяти
---

# Сервер: мультиплеер PROTO v1

## Цель и изменения требований
Реализовать серверную сторону PROTO v1 для готового клиента: join, движение, AOI/delta, resync, взаимодействие, чат, присутствие, слоты и перехват. Изменены REALTIME-001–006, добавлены REALTIME-007–009. NPC-вопросы до TASK-025 получают `error UNAVAILABLE`.

## Реализация
- [x] Домен `game`: мир, шаг, движение со скольжением и preparedChunks, AOI, расчёт delta по соединению, слоты и управляющее соединение, grace.
- [x] GameService: join/input/interact/chat/resync/присутствие; периодическое сохранение через `PlayerStore`; `PlayerLocator` для world.
- [x] Адаптер `realtime`: handshake (из TASK-012), разбор shared-парсером, лимиты input/chat, отклонение повторного requestId, отправка пакетов, перехват по AUTH-005.
- [x] Интеграционные тесты с несколькими `socket.io-client` и shared/protocol; нагрузочный сценарий S7.

- [x] Раздельная точка появления REALTIME-010 (вместе с TASK-016 / OFFLINE-013).

## Приёмка
- [x] REALTIME-001–009 / S1–S7 проверены интеграционными тестами; все исходящие пакеты проходят `parseServerMessage`.
- [x] AUTH-005 / AUTH S4 и SERVER-006 / SERVER S4: перехват и пятый игрок.
- [x] PROTO-008 / PROTO S4: все уточнения v1.
- [x] Браузерная проверка online через UI mock-входа, защищённый мир, чат и NPC (TASK-028).
- [x] `make server-test` и `npm run check` проходят.

## Результат
- Файлы: server/src/game/{World,AoiStream,GameService,index,ports}.ts, server/src/realtime/{gateway,TokenBucket}.ts; тесты server/test/a-realtime.test.ts (реальный socket.io-client), a-world.test.ts.
- Проверки: `npm --prefix server test` — 4 файла, 26 тестов, все прошли; `npm --prefix server run check` — tsc server + shared без ошибок, dependency-cruiser без нарушений; `node -e "import('./src/game/index.ts')"` в Node 24.15.0 — модуль грузится без сборки. Среда: Windows 11, Node 24.15.0, npm 11.12.1. Проверено: handshake UNAUTHORIZED/VERSION/UNAVAILABLE; join с валидным snapshot и bootstrap; delta второму игроку с revision+1 и без пустых пакетов; стена, скольжение, preparedChunks, сброс намерения через 250 ms, старый sequence; interact/npc-question (FORBIDDEN вдали, ответ через NpcQuestions с персоной и trim); чат обоим с requestId отправителя, HTML как текст, управляющие символы → INVALID; NOT_READY до join, повтор requestId и лишнее поле → INVALID, resync → snapshot; перехват второй вкладкой (error server UNAUTHORIZED, тот же playerId, отмена NPC первой вкладки); освобождение слота и сохранение позиции после grace. Все входящие пакеты тестов проходят parseServerMessage.
- Оставшиеся проверки A: переподключение внутри grace без remove у наблюдателя (S5, первая часть), remove при выходе из aoiRadius (S4, вторая часть), лимиты input 30/с и чата 1/с, отключение после 10 неверных пакетов. Статус in-progress до закрытия этих критериев. Runtime-ограничение исходящего пакета 256 KiB перенесено в открытые вопросы REALTIME-005: в текущем gateway его нет.

После объединения A+B дополнительно проверены expiry через настоящий SessionVerifier/SQLite, periodic/grace-save, takeover с отменой реального NpcDialogueService и UI входа/чата/NPC в Chrome. REALTIME S7: [профиль 61 с](evidence/server-load-2026-10-31.json), p95 шага 0,977 мс, рассылки 101,2 мс. Предыдущий список непроверенных expiry/браузера/нагрузки закрыт этими прогонами; остальные указанные сценарии не считаются выполненными автоматически. [Evidence](evidence/backend-integration-2026-10-31.md).

### Закрытие приёмки 2026-11-01
- S1–S2: `a-realtime.test.ts`, `a-world.test.ts`, `movement.test.ts` (как выше).
- S3: `realtime-scenarios.test.ts` — поле `position` и чужой `playerId` дают INVALID без изменения мира и без доставки чата, 40 input пачкой отбрасываются молча (без error), `v: 2` в игровом пакете — VERSION и отключение; чат: три подряд, четвёртое — RATE_LIMIT; 11 неверных пакетов за 10 с отключают соединение.
- S4: resync отвечает snapshot с revision последнего отправленного delta, следующий delta строится на ней; выход за `aoiRadius` даёт ID в `remove`.
- S5: переподключение внутри grace — тот же playerId и позиция, у наблюдателя нет `remove` и второй сущности; долгий разрыв, освобождение места и сохранение — `a-realtime.test.ts`, `integration.test.ts`.
- S6: interact рядом — `interacted`, в 5 м — FORBIDDEN; чат двух игроков доходит до обоих с уникальными messageId, `<script>` доставлен как текст.
- S7: [профиль 60 с, 4 клиента, NPC 5 с](evidence/server-load-2026-11-01.json): p95 шага 1,275 мс, p95 интервала рассылки 110,3 мс (max 147 мс), ошибок сервера нет; часть NPC-вопросов ожидаемо получила UNAVAILABLE по дедлайну 8 с при одном слоте.
- S8 / REALTIME-010: `a-world.test.ts` — три новых игрока и четвёртый с сохранённой позицией первого стоят попарно ≥1,2 м, все на проходимых точках, четвёртый не дальше 4,5 м от сохранённой; свободная сохранённая позиция сохраняется с поворотом; без свободной точки — база. Реализация `src/game/spawn.ts`, вызывается из `GameService.join` для spawn карты, ролевой точки BABEL и занятой сохранённой позиции.
- AUTH S4 и SERVER S4: перехват второй вкладкой с отменой NPC — `a-realtime.test.ts`, `integration.test.ts`; занятые места — `a-realtime.test.ts` (maxPlayers из конфигурации, UNAVAILABLE для лишнего аккаунта, вторая вкладка не занимает второе место).
- PROTO S4: `connect_error UNAVAILABLE`, `error` с `requestId: "server"`, чат с requestId отправителя, отсутствие пустых delta, остановка через 250 мс и 404 без закрытия сессии — `a-realtime.test.ts`, `a-world.test.ts`, `integration.test.ts`; все входящие пакеты тестов проходят `parseServerMessage`.
- Остаётся открытым вопросом спеки, а не критерием приёмки: runtime-ограничение исходящего пакета 256 KiB.
- Проверки: `npm --prefix server test` — 19 файлов, 170 тестов, все прошли; `npm --prefix server run check` без ошибок. Windows 11, Node 24.15.0.
