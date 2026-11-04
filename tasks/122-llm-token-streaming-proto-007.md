---
id: TASK-122
type: implementation-task
status: done
spec: specs/protocol.md
requirements:
  - PROTO-007
  - NPC-005
  - NPC-007
depends_on:
  - TASK-121
---

# Потоковый вывод ответов LLM (Streaming токенов) по PROTO-007

## Контекст и цели

Контракт PROTO-007 (`npc-question.stream`, `npc-partial`, `npc-cancel`) и клиентская поддержка `dialogPartial` в `GameApp.ts`, `OnlineSession.ts` и `Dialog.svelte` уже были заложены в протокол и клиент. Однако реальные локальные воркеры LLM (Ollama и MLX) возвращали только готовый финальный ответ.

Цели задачи:
1. **Эмиссия токенов в Python-воркерах**:
   - `server/llm/ollama_worker.py`: при потоковом вызове `/api/generate` (`stream=True`) эмитить `{"type": "partial", "text": clean_partial}` по мере декодирования чанков.
   - `server/llm/mlx_worker.py`: в цикле `stream_generate` эмитить частичный накопленный текст с удалением `<think>`-тегов.
2. **Передача потока в `server/src/npc/adapters/localLlm.ts`**:
   - Передавать `stream: true` в JSON-запрос к воркеру при наличии `onPartial`.
   - В обработчике `output` принимать `message.type === 'partial'` с лимитом `partialCount <= 512` (отдельно от строгой границы `count <= 12` для progress-сообщений) и передавать в `onPartial(text)`.
3. **Стриминг в Socket.IO (PROTO-007)**:
   - `NpcDialogueService` и `realtime/gateway.ts` дросселируют через `PartialThrottle` (≤10 снимков/с) и доставляют `npc-partial` клиенту.
   - Клиентский UI (`Dialog.svelte`) отображает `streaming-answer` в реальном времени.

## Результаты верификации

- `server/llm/test_ollama_worker.py`: 51/51 тест пройден (включая проверку `test_stream_true_emits_partial_tokens`).
- `server/llm/test_mlx_worker.py`: 7/7 тестов пройдено.
- `server/llm/test_diagnostic_budget.py`: 4/4 теста пройдено.
- `server/test/localLlm.test.ts`: 148/148 тестов пройдено.
- `server/test/gateway-npc-access.test.ts`: 3/3 теста пройдено.
- `server/test/local-language-bridge.test.ts`: 14/14 тестов пройдено.
- `server/test/integration.test.ts`: 21/21 тест пройден (включая стриминг и отмену по реальному сокету).
