---
id: TASK-112
type: implementation-task
status: completed
spec: specs/npc-character-behavior.md
requirements:
  - NPC-AI-005
  - NPC-AI-006
  - NPC-AI-017
  - NPC-AI-018
  - NPC-003
  - LLM-001
depends_on:
  - TASK-111
---

# Устранение антипаттерна хрупкой валидации: безопасная очистка эмодзи/тегов мыслей, изоляция ошибок воркера и graceful fallback

## Контекст и проблема

В архитектуре NPC диалогов был обнаружен и устранён критический антипаттерн хрупкой валидации (brittle validation):
1. **Падение на эмодзи и служебных тегах `<think>` вместо очистки**:
   - Если модель генерировала эмодзи (например, `Hello! 🙂`), выбрасывалось исключение `WorkerError('invalid_response', 'Symbol output rejected')`.
   - Если модель (Qwen 2.5 / 3.5) генерировала блоки рассуждений `<think>...</think>`, выбрасывалось исключение `WorkerError('invalid_response', 'Thinking output rejected')`.
2. **Падение сессии и процесса воркера от единичной ошибки (Process Death Antipattern)**:
   - При выбросе `WorkerError('invalid_response')` воркер отдавал wire-ошибку, а адаптер `localLlm.ts` считал любой `invalid_response` фатальным, вызывал `fail(s, 'unavailable')`, принудительно убивал процесс воркера (`process.kill(-s.group, 'SIGTERM')`) и навсегда переводил NPC-сервис в статус `unavailable` до перезапуска сервера (ошибка HTTP 503 на всех последующих запросах).
3. **Отсутствие диалогового фоллбэка**:
   - Вместо предусмотренной спецификацией `NPC-AI-018` естественной переспрашивающей реплики (*«Sorry, I did not understand. Could you say that again?»*) игрок получал системную ошибку.

## Реализация

1. **Безопасная очистка (Sanitization вместо Rejection)**:
   - В `server/llm/local_common.py`:
     - Реализована функция `strip_emoji(text)` с сохранением ZWJ для арабской графики (`preserve script shaping`).
     - Реализована функция `strip_thinking(text)` для аккуратного удаления блоков `<think>...</think>` и `<analysis>...</analysis>` с сохранением полезного текста ответа.
     - В `normalize_target_text(text)`, `normalize_text(text)` и `normalize_translation(text)` служебные теги и эмодзи очищаются, не вызывая фатальных исключений.
2. **Graceful in-dialogue fallback по `NPC-AI-018`**:
   - В `server/llm/ollama_worker.py` и `server/llm/mlx_worker.py`: если при формировании ответа на изучаемом языке (`en`, `es`) возникает ошибка валидации контента (`invalid_response`, `output_limit`), воркер не падает и не эмитит wire-ошибку, а возвращает естественную диалоговую реплику переспроса на целевом языке (`"Sorry, I did not understand. Could you say that again?"` / `"Lo siento, no entendí. ¿Puedes decirlo otra vez?"`) с `finishReason: 'stop'`.
3. **Изоляция ошибок воркера (Устойчивый рантайм)**:
   - В `server/llm/ollama_worker.py`: цикл `while True:` изолирует обработку каждого сообщения в отдельном `try/except`. Единичные сбои не убивают фоновый демон Ollama.
4. **Обновление спецификаций**:
   - `specs/npc-character-behavior.md`: требования `NPC-AI-006`, `NPC-AI-017`, `NPC-AI-018` обновлены — отсутствие эмодзи и артефактов у NPC обеспечивается серверной нормализацией (очисткой), а при сбоях валидации предоставляется естественный диалоговый переспрос.
   - `specs/server-npc-dialogue.md`: требование `NPC-003` закрепляет нормализацию без фатальных исключений.
   - `specs/server-llm-runtime.md`: требование `LLM-001` закрепляет изоляцию ошибок генерации/валидации без завершения процесса воркера.

## Верификация

1. `python3 -m unittest discover -s server/llm -p 'test_*.py'`: **101 tests passed**.
2. `npm --prefix server test -- server/test/babylon.test.ts server/test/localLlm.test.ts server/test/local-language-bridge.test.ts`: **191 tests passed**.
3. **Тест воспроизведения (5 итераций подряд со словом «Здарова» к гончару Adadu)**:
   - Итерации 1, 2, 4, 5 успешно сгенерировали ответы на английском языке A2.
   - Итерация 3 (на которой модель не прошла валидацию) вернула диалоговый переспрос `"Sorry, I did not understand. Could you say that again?"` без падения процесса, а последующие запросы отработали штатно.
