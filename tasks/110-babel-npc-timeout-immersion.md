---
id: TASK-110
type: implementation-task
status: done
spec: specs/game-babylon.md
requirements:
  - BABEL-011
  - BABEL-016
  - TALK-005
depends_on: []
---

# Задачи: Увеличение таймаута NPC до 5 минут и атмосферные статусы непонимания в диалоге

## Контекст и мотивация

При работе локальной LLM (Qwen 3.5 2B на Intel CPU) генерация ответов с историей контекста может занимать более 30 секунд. Прежний 30-секундный дедлайн приводил к `abort`, убийству воркера Ollama и 28-секундному периоду недоступности, во время которого игрок видел техническую красную ошибку «Переводчик занят или недоступен». Также в диалоге отображалась техническая строка «Ожидаем подтверждения сервера…», разрушающая атмосферу древнего Вавилона.

## План изменений

1. **Серверные лимиты, конфиг и замер памяти macOS**:
   - В `server/config.json` и `~/kuda-llm/profiles.json`: установить `timeoutMs: 300000` (5 минут), `streamTimeoutMs: 300000` и `threads: 2`.
   - В `server/src/npc/adapters/localLlm.ts`:
     - Увеличить таймаут команды `/bin/ps` на macOS до 2500 мс (`memorySampleTimeout`), а дедлайн наблюдателя до 3500 мс (`timeout + 1000 мс`), чтобы системные задержки и event loop lag (до 300 мс) при тяжелом prefill не приводили к ложному `memory_sample_deadline`.
     - Увеличить интервал наблюдателя памяти на macOS с 250 мс до 1000 мс. Это снижает частоту форка системных процессов в 4 раза, предотвращая троттлинг CPU и деградацию времени тика симуляции.
   - В `server/test/llm-memory.test.ts`: зафиксировать таймаут darwin 2500 мс.
   - В `server/src/babylon/BabylonService.ts`: полностью исключить системную формулировку «Переводчик занят или недоступен» из всех BABEL-действий (`npc`, `suggest`, `chat`), возвращая понятные контекстные сообщения.

2. **Клиентский таймаут и интерфейс диалога**:
   - В `client/src/multiplayer/BabylonClient.ts`: увеличить таймаут fetch-запроса до 300 000 мс (`NPC_TIMING.maxMs`), предотвращая преждевременный разрыв соединения клиентом.
   - В `client/src/ui/BabylonPanel.svelte`:
     - Скрыть техническую строку «Ожидаем подтверждения сервера…» в окне взаимодействия с жителями (`panel === 'interaction'`), где уже есть статус «Житель отвечает…».
     - Оформить сообщение о непонимании в стиле мягкой игровой заметки `.babel-dialogue-notice`, а кнопку действия назвать «Спросить снова».
   - В `client/src/ui/babylon-panels.css`: добавить стилизацию `.babel-dialogue-notice`.

3. **Верификация**:
   - `npm --prefix client test -- src/multiplayer/BabylonClient.test.ts`: 13/13 passed.
   - `npm --prefix client test -- src/app/GameApp.test.ts`: 46/46 passed.
   - `npm --prefix client run build`: PASS (2.29s, dist built).
   - `npm --prefix server test -- server/test/babylon.test.ts server/test/llm-memory.test.ts`: 41/41 passed.
   - `npm --prefix server test -- server/test/localLlm.test.ts`: 147/147 passed.

