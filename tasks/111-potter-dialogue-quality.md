---
id: TASK-111
type: implementation-task
status: completed
spec: specs/npc-character-behavior.md
requirements:
  - NPC-AI-001
  - NPC-AI-002
  - NPC-AI-004
  - NPC-AI-005
  - NPC-AI-006
depends_on:
  - TASK-110
---

# Улучшение качества диалога Гончара: исторический контекст, естественная история реплик и реакция на чуждые понятия

## Контекст и проблема

В ходе игрового тестирования Гончар демонстрировал неестественные и зацикливающиеся ответы:
1. **Зацикливание и попугайство реплик**: в ход 3 и 4 модель повторяла фразы из прошлых ходов («Hello! I am Potter... Today it is cold and sunny here... Would you like to see me make a clay pot instead? Please choose one»).
2. **Служебный роботизированный тон**: фразы «Please choose from "clay pot" or "water jug" after that», постоянное повторение служебных фраз из квеста с козами.
3. **Бедность карточки**: в `server/src/babylon/content.ts` Гончар имел имя `Potter`, топик `Clay pots and water` и описание из одного предложения. У модели не было исторической опоры и кругозора.
4. **Искажение формата истории в `local_common.py`**: для `locale != 'ru'` история упаковывалась в искусственные JSON-блоки `{'role': 'user', 'content': 'Earlier dialogue data: {"player_said": ..., "npc_said": ...}'}` вместо стандартных ролей `user` и `assistant`. Это ломало многоходовую генерацию Qwen 3.5.
5. **Сбой на русское «Привет»**: при обращении игрока на русском языке («Привет») компактная 2B модель без явного негативного правила могла сгенерировать ответ на кириллице, что вызывало срабатывание `has_obvious_cyrillic_reply()` и ошибку `invalid_response`, переводящую респондер в `unavailable`.

## План реализации

1. **Естественный формат истории диалога в `server/llm/local_common.py`**:
   - Передавать диалоговые пары как стандартные ходы `user` и `assistant` (как в русском режиме и ChatML).
   - Входной вопрос игрока передавать как обычный `{'role': 'user', 'content': question}` без искусственной JSON-обёртки.

2. **Богатая историческая карточка Гончара в `server/src/babylon/content.ts`**:
   - Имя: Ададу (Adadu, по `specs/world-cast-locations.md` CAST-108).
   - Роль и кругозор: мастер-гончар у реки Евфрат в древнем Вавилоне, лепит горшки и кувшины, знает рынок и соседей (Эрибу, Набу), не знает современных понятий, физики и правителей будущего.
   - Естественное приветствие мастера мастерской.

3. **Системный промпт с ролевой основой и защитой от кириллицы в `server/llm/local_common.py`**:
   - Явное негативное правило: `Never reply in Russian or Cyrillic. Entire reply in {language} only.` предотвращает переключение 2B модели на русский язык при вводе игрока на кириллице.
   - Живая реакция жителя древности на современные понятия (Трамп, смартфоны, физика) как на неизвестные вещи/имена из далёких чужих земель за пределами Вавилона.
   - Соблюдение баланса токенов в рамках лимита 1792 для тестов и контекста.
   - Сохранение нормативных требований `NPC-AI-005` (A2 en/es), `NPC-AI-006` (без эмодзи, без исправлений языка игрока).

4. **Тесты и верификация**:
   - `python3 -m unittest discover -s server/llm -p 'test_*.py'` — 101 тест успешно пройден.
   - `npm --prefix server test -- server/test/babylon.test.ts server/test/llm-memory.test.ts server/test/local-language-bridge.test.ts` — 55 тестов успешно пройдены.
   - Прямой прогон live-диалога из 4 реплик через runner Ollama (`qwen3.5:2b-q4_K_M`):
     - Ход 1 («Привет») -> «Hello, traveller! I am Adadu the potter. Welcome to my workshop.» (has cyrillic: False)
     - Ход 2 («какая сегодня погода?») -> «I do not know today's weather. I have no way to see what is happening outside right now. My knowledge ends long before modern times and even ancient history has many things I cannot confirm, like the exact day or the specific mood of the air that makes it feel warmer or colder.» (has cyrillic: False)
     - Ход 3 («что ты можешь мне интересного рассказать?») -> «Hello! Here is what I can share about my work: I shape clay using special tools to make pots and bowls for eating and cooking... Sometimes I meet neighbors like Eriba and Nabu while working with clay...» (has cyrillic: False)
     - Ход 4 («тебе кто-то нравится?») -> «Yes, sometimes I think of a kind man who lives next door to me in the market... So I guess I like talking with my neighbors!» (has cyrillic: False)
