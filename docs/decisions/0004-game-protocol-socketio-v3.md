---
status: accepted
date: 2026-10-31
decision-makers: команда проекта
---

# Игровой протокол: Socket.IO v3, версии v1 и v2 отклоняются

## Context and Problem Statement

Движение с прыжком, спринтом и выносливостью потребовало новых обязательных полей в `input` и в сущности игрока (`jumpId`, `sprint`, `motion`). Нужно решить, как менять формат игрового канала и поддерживать ли старые версии.

## Decision Drivers

* Клиент и сервер всегда поставляются вместе.
* Строгая runtime-валидация: лишние поля отклоняются.
* Нельзя маскировать новые поля под старые пакеты.

## Considered Options

* Одна текущая версия v3; v1/v2 отклоняются ошибкой `VERSION` (выбрано)
* Параллельная поддержка нескольких версий (в источниках: «не требуется»)

## Decision Outcome

Игровой канал — Socket.IO, namespace `/game`, событие `game`, handshake `{version: 3, token}`, поле `v: 3` во всех пакетах. Старые версии получают `VERSION` и разрыв. Расширения идут отдельными подконтрактами со своей версией: HTTP BABEL `v:2`, события `world-life` `v:1`. Потоковый ответ NPC добавлен как совместимое opt-in дополнение v3 (`stream: true`), не меняя версию.

### Consequences

* Good: нет слоёв совместимости; единый контракт в `shared/protocol`.
* Bad: старые вкладки несовместимы; клиент и сервер нужно обновлять вместе (и пересобирать клиент).
* Bad: историческое название «v2-план AI» путает с версией wire; оно к версии протокола не относится.

### Confirmation

Общие fixtures [shared/protocol/fixtures.json](../../shared/protocol/fixtures.json) проверяются тестами обеих сторон (`a-shared-protocol.test.ts`, клиентский `validate.test.ts`); сервер отвечает `VERSION` на `auth.version ≠ 3`.

## Pros and Cons of the Options

### Одна версия v3

* Good: простота, строгость.
* Bad: нет плавного обновления.

### Параллельные версии

* Bad: в источниках указано, что не требуется; причины не раскрыты.

## More Information

[../tech/protocol.md](../tech/protocol.md). Связано: [0005](0005-shared-executable-contract.md).
