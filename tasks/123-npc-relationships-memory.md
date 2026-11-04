---
id: TASK-123
type: implementation-task
status: completed
spec: specs/npc-character-behavior.md
requirements:
  - NPC-AI-007
  - NPC-AI-008
  - NPC-AI-009
  - NPC-AI-010
  - NPC-AI-011
depends_on:
  - TASK-122
---

# Отношения NPC (3 дискретных состояния) и сессионная память диалогов

## Контекст и цели

По спекам ([specs/npc-character-behavior.md](specs/npc-character-behavior.md), правила NPC-AI-007 – NPC-AI-011):
1. **Дискретные отношения NPC**:
   - Ровно 3 состояния: `ordinary` (по умолчанию), `displeased`, `friendly`.
   - Область изоляции: `(sessionId, playerId, npcId)`.
   - Правила перехода (NPC-AI-008):
     - Направленное оскорбление в адрес NPC переводит в `displeased`.
     - Повторные оскорбления не усиливают враждебность (остается `displeased`).
     - Искреннее извинение возвращает `displeased` строго в `ordinary`.
     - Повторные извинения не дают `friendly`.
     - Цитаты («он сказал: ты дурак»), вопросы о значении ругательств и оскорбления третьих лиц (царя, стражника) отношение НЕ ухудшают.
     - Только подтвержденная сервером помощь или авторское событие может перевести в `friendly`.
     - Технические ошибки и отмена запроса отношение не меняют (NPC-AI-009).
2. **Влияние на стиль речи NPC**:
   - `displeased`: холодный, сухой тон, выставление личных границ (не терпит оскорблений, говорит только по делу).
   - `friendly`: теплый, радушный тон, открытость старого друга.
   - `ordinary`: базовый авторский тон сословия/профессии.
3. **Хранение в SQLite (миграция 012.sql)**:
   - Таблица `npc_relationships (session_id, player_id, npc_id, attitude, updated_at)`.
   - Таблица `npc_memory_facts (session_id, player_id, npc_id, fact, created_at)` для долговременных фактов о путешественнике («игрок сказал...»).
4. **Точечная верификация**:
   - Тестирование классификатора намерений, переходов состояний и промптов только целевыми тестами.

## Реализация

- [x] Создана миграция `server/src/persistence/migrations/012.sql` для таблиц `npc_relationships` и `npc_memory_facts`.
- [x] Реализован классификатор намерений `server/src/npc/intentClassifier.ts` (`classifyPlayerIntent`, `transitionAttitude`) с поддержкой Unicode-границ и фильтрацией цитат, словарных вопросов и третьих лиц.
- [x] Реализован экстрактор долговременных фактов путешественника `server/src/npc/factExtractor.ts` (`extractPlayerFact`).
- [x] В `DialogueStore` и `server/src/persistence/database.ts` добавлены методы `attitude`, `setAttitude`, `facts`, `appendFact`.
- [x] В `NpcDialogueService.ts` подключена авторитетная проверка намерений, передача вычисленного `attitude` и `facts` в генерацию, и атомарный коммит обновлений при успешном ответе.
- [x] В `server/llm/local_common.py` добавлена валидация `attitude` и `facts` и внедрение соответствующих контекстных инструкций в системный промпт (для `ru`, `en`, `es`).

## Результаты верификации

- `server/test/intentClassifier.test.ts`: 14/14 тестов пройдено (проверка оскорблений, извинений, цитат, словарных вопросов, переходов состояний).
- `server/test/npc-relationships.test.ts`: 7/7 тестов пройдено (интеграция с сервисом диалогов, сохранение в базу, изоляция сессий).
- `server/test/migrations.test.ts`: 8/8 тестов пройдено.
- `server/llm/test_prompt_style.py`: 6/6 тестов пройдено.
- `server/test/npc.test.ts`: 9/9 тестов пройдено.
- `server/test/localLlm.test.ts`: 148/148 тестов пройдено.
- `server/test/local-language-bridge.test.ts`: 14/14 тестов пройдено.
