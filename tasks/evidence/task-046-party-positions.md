# TASK-046 — HUD-013 task-scoped party positions

## Контракт и реализация

- `shared/babylon/types.ts`: обязательный `BabylonState.partyPositions`, readonly массив `{id,name,x,z}`.
- `shared/babylon/validate.ts`: максимум 4 записи; точные поля; валидные ID/имена; уникальные ID, не self; ID и name совпадают с текущими party.members; caller тоже член party; конечные x/z в ±1 000 000. Нет party → разрешён только пустой массив. Отсутствие поля не проходит парсер.
- `server/src/babylon/BabylonService.ts`: `BabylonDeps.peerLocation?(playerId): BabylonLocation|null`. state вызывает provider только для текущих членов g.members, исключает caller и дубли, максимум 4 candidate IDs. Не перечисляет мир, не запрашивает аккаунты. Неизвестный/отсутствующий actor, не-market map и невалидные x/z пропускаются. Нет enrollment/provider → []. Чужие задания и произвольные playerId не принимаются.
- `server/src/game/GameService.ts`: `playerLocation(playerId)` читает только world.locate(playerId), возвращает копию позиции или null; нет SQLite position/spawn/account fallback. Grace actor остаётся живым в World до release, после удаления координаты не выдаются.
- `server/src/contracts.ts`, `server/src/game/index.ts`: optional runtime playerLocation, делегирование GameService.
- `server/src/app/application.ts`: peerLocation связан с runtime playerLocation. HTTP/auth/equipment/model-preview код не изменён.
- Позиции приходят в существующем BABEL state polling и результатах команд; новый endpoint/запрос по чужому playerId отсутствует. Данные ephemeral, схема SQLite не меняется.
- Обновлены PROTO-009 и заметки TASK-046. Клиентские реализации/тесты не изменялись; основной агент объединяет partyPositions с более свежим AOI и обновляет client fixtures.

## Тесты

Добавлены 5 сценариев:
1. Текущая группа из 2 игроков видит только своего peer; другая группа/сам caller не запрашиваются; state polling отражает новое/пропавшее местоположение.
2. Группа 4 даёт максимум 3 peers, чужая карта/Infinity/out-of-range и отсутствующий provider не получают фиктивную замену.
3. Shared parser отклоняет missing/malformed/oversized/duplicate/self/nonmember/wrong-name/extra-field/nonfinite/out-of-range позиции.
4. GameService использует stable playerId, не accountId и не persistence, не отдаёт mutable World reference и возвращает null после удаления actor.
5. Реальный HTTP+Socket сценарий: 2 task peers вне AOI (radius 8), третий unrelated actor. State отдаёт только текущего task peer, unenrolled actor получает [], попытка произвольного playerId →400, release удаляет позицию из polling даже при наличии сохранённой позиции.

## Проверки

- `npm --prefix server test -- test/babylon.test.ts test/a-world.test.ts test/integration.test.ts`: **PASS, 3 files / 38 tests**.
- `npm --prefix server run check`: **PASS**, server/shared TypeScript и dependency-cruiser; 62 modules / 188 dependencies, no violations.
- Полный make server-test, client checks и browser HUD/main-map flow после этой правки не запускались worker; основной агент повторяет их на итоговой интеграции. Предыдущий full server PASS 154 относится к состоянию до этой правки и не выдается за её проверку.

Коммиты не создавались.
