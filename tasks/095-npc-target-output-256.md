---
id: TASK-095
type: implementation-task
status: done
spec: ../specs/server-llm-runtime.md
requirements: [LLM-008, LLM-009, LLM-015]
depends_on: [TASK-071, TASK-072]
related:
  - spec: ../specs/npc-character-behavior.md
    requirements: [NPC-AI-016]
---

# Максимум 256 токенов для NPC en/es

## Цель и изменения требований

По явному запросу пользователя увеличить только выход NPC en/es в Ollama и MLX, включая существующий local-мост BABEL, до 256 токенов. Уточнить текущий срез LLM-008: контекст 2048, точный вход ≤1792, выход en/es ≤256; перевод и legacy ru остаются на 128. Ответ en/es ≤800 кодовых точек, нормальное завершение обязательно; 256 — максимум, не требуемая длина.

## Реализация

- [x] Изменить только целевые ветви workers без рефакторинга, новых функций и изменения таймаутов/клиента.
- [x] Fake-проверки лимитов, точных входных границ, stop/length/неизвестного завершения и совместимости перевода/ru.
- [x] Кратко обновить действующие документы и записать результаты проверок.

## Приёмка

- [x] Оба backend передают 256 для NPC en/es; перевод и ru передают 128.
- [x] Вход 1792 принимается, 1793 отклоняется; история удаляется только целыми старыми парами.
- [x] Stop может завершить короткий ответ; length/неизвестное завершение и выход за cap не превращаются в успех или усечение.
- [x] Сохраняются 800 кодовых точек, очередь/AUTH/cancel/RAM, отсутствие retry/fallback и прежний предел клиента BABEL 30 с.
- [x] Python fixtures, make server-test и server/shared type/import checks проходят без реальных моделей/diagnose/скачиваний.

## Результат

Изначальная база ветки `fix/npc-target-256`: origin/main `1860422`; перед слиянием ветка перенесена поверх `288b30d`. Номер задачи изменён с 093 на 095: 093/094 заняты новыми задачами main. Перед переключением оба пользовательских checkout были чистыми; локальных правок workers на 192/256 не обнаружено, исходные конфигурации сохранены. Установка Ollama 2B завершена отдельно **до этой задачи**; её реальный прогон не является проверкой изменения лимита. В этой задаче реальные модели и загрузки запрещены.

Причина конкретного `ollama_response_invalid` не установлена; увеличение лимита не обещает устранить все такие отказы.

### Проверки 2026-11-01

Перед слиянием поверх `288b30d` повторены генерация карт, полный server suite, Python fixtures и type/import checks. Ниже и в логах приведены успешные результаты повторного прогона; реальных моделей и скачиваний не было.

- `make llm-test` (uv offline, Python 3.12.11) — **100 passed, 1 skipped** из 101; Linux-only проверка bound-port semantics на macOS пропущена. [Лог](evidence/npc-target-256/python-tests.txt).
- `KUDA_TEST_PYTHON=<prepared Python 3.12> VITEST_MAX_WORKERS=2 make server-test` (Node 24.22.2) — **724 passed / 48 files**. Включены проверки local BABEL, общей очереди, AUTH, отмены и отказов без повтора. [Лог](evidence/npc-target-256/server-tests.txt).
- `npm --prefix server run check` — TypeScript server/shared и imports PASS: 104 modules / 355 dependencies. [Лог](evidence/npc-target-256/type-import-check.txt).
- Первый server-прогон: 9 world-fixture failures из-за оставшихся generated manifests от предыдущего main. Выполнен `npm --prefix client run world:generate`, затем полный успешный повтор. Отслеживаемые файлы `client/` не менялись; client acceptance для этой серверной правки не требуется.
- `git diff --check` — PASS. Реальные модели, diagnose, downloads и браузерный inference для этой правки не запускались. Аппаратная скорость/качество нового предела остаются непроверенными.

Новые fake-сценарии проверяют MLX stop на 129/256 событиях и отказ на 257, length/unknown на cap, точную передачу token IDs, границу входа 1792/1793; Ollama — фактический `num_predict` в payload для en/es/ru/translation, `num_ctx: 2048`, tokenizer count и отказ length/unknown. Прежние проверки целых пар истории и 800/801 кодовых точек сохранены. Production-изменения ограничены двумя workers; в MLX параметризован существующий helper без новой функции.
