---
id: TASK-078
type: implementation-task
status: in-progress
spec: ../specs/server-npc-dialogue.md
requirements: [NPC-001–005, NPC-009]
related:
  - spec: ../specs/server-auth.md
    requirements: [AUTH-002, AUTH-005, AUTH-009]
  - spec: ../specs/server-persistence.md
    requirements: [STORE-006–008, STORE-011–012]
  - spec: ../specs/npc-character-behavior.md
    requirements: [NPC-AI-010, NPC-AI-012, NPC-AI-015]
depends_on: [TASK-070, TASK-071, TASK-072]
---

# Синхронизация локального NPC runtime с актуальным main

## Основание и границы

Пользователь прямо разрешил rebase из main и синхронизацию ветки. Исходная ветка `npc-llm-clean-start`: `a01c15ade457d73cefce16b5a6f6333aed23c0be`; актуальный main при начале: `2d12d12b1dc2b66eb8d3dbd490d4c9da173c6339`. Старое состояние сохранено в `backup/npc-before-main-rebase-a01c15a`. Локальный main `02eb786dd5bf9f839532919a7c4be350a60c57b9` не изменяется.

Сохранить новые UI/HUD, регистрацию/облик, сохранённые игры, живой мир и серверные контракты main вместе с AUTH-изоляцией NPC, выбранной общей локальной моделью и одной очередью. Архив, отношения и приветствия не добавляются. Модели, Python/runtime и подготовленные локальные конфиги пользователя не переустанавливаются. Настоящие Ollama/MLX, inference, downloads и diagnose здесь не запускаются.

## Реализация и приёмка

- [ ] Rebase завершён, main является предком итогового HEAD; main не изменён.
- [ ] Конфликты клиентского entry/auth/HUD и NPC metadata решены без потери main-функций и stale-context/logout guards.
- [ ] Миграции сохраняют обе истории БД: старую NPC-ветку и main; legacy не назначается новой AUTH-сессии.
- [ ] BABEL сохраняет новую замену игры/профиль и изоляцию истории, guards перед моделью/commit/delivery, исходный бюджет и одну модель/очередь.
- [ ] Пересечения ID задач устранены с сохранением контекстных ссылок; документы отличают текущую реализацию от неквалифицированного полного NPC-AI.
- [ ] Актуальные server/shared и client tests, type/import/build, Python fixtures; релевантная browser-проверка без настоящей модели. Неисполненные проверки перечислены отдельно.
- [ ] Опубликована только feature-ветка с явным lease на проверенный прежний remote SHA; итоговый рабочий каталог чист.

## Результат

Rebase и согласование начаты. Прошлая приёмка 622 server / 227 client / 93 Python относится к состоянию до этого rebase и не заменяет новый прогон.
