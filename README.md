# Учебный 3D-мир

Многопользовательский образовательный мир в браузере. Один локальный сервер хранит игроков и запускает адаптивных ИИ-персонажей; клиенты работают через LAN/Wi-Fi. Игра должна работать и на серверном ноутбуке с выключенным Wi-Fi, без интернета.

Мир состоит из тематических районов, соединённых переходами; данные загружаются чанками вокруг игрока. Район и чанк — разные понятия. Состав районов, размеры чанков и метрика лимита 10% ещё не утверждены.

Сейчас есть документация и Makefile; код клиента и сервера ещё не написан. Клиент планируется в `client/`: **TypeScript strict, Vite, Svelte 5, Three.js, Socket.IO Client, Vitest**, карты JSON + GLB. Сервер с Socket.IO и SQLite будет отдельным проектом; его спеки хранятся здесь. LocalSession — локальное демо клиента, а не замена полной системы.

## Документация

- [AGENTS.md](AGENTS.md) — краткие правила агента.
- [architecture.md](architecture.md) — границы, стек и целевые модули.
- [SDD-скилл](.agents/skills/sdd/SKILL.md) — порядок работы и шаблоны.
- `specs/` — долгоживущие требования; `tasks/` — этапы реализации и доказательства.
- [Локальная LLM](specs/server-llm-runtime.md), [NPC](specs/server-ai.md), [хранение диалогов](specs/server-persistence.md), [квалификация моделей](specs/npc-llm-evaluation.md) — направление локального ИИ.

В начале спек: `id`, `type`, `status`, `implementation`, `parent`, `summary`. `status` описывает документ (draft/ready/retired), `implementation` — код (not-started/partial/complete). У задач вся метаинформация находится в YAML: `id`, `type`, `status`, `spec`, `requirements`, `depends_on`, при необходимости `related` и `scheduling_note`. Статусы: todo / in-progress / blocked / done. Ссылки в метаданных — относительные пути, зависимости — ID задач. В теле остаются цель, шаги, приёмка и результаты. Значения метаданных пишутся без лишних кавычек. У архитектуры `status: active`. Большинство серверных/интеграционных спек — draft из-за явно перечисленных открытых решений.

## Этапы

[001 — Makefile](tasks/001-client-makefile.md) выполнен: проверена только обвязка команд. Остальные задачи — todo. Номера задают порядок внутри веток; зависимости указаны отдельно. Протокол 009 согласуется до реальной сетевой реализации клиента/сервера.

| № | Задача | Спека | Зависит от |
|---|---|---|---|
| 002 | [Клиент: foundation](tasks/002-client-foundation.md) | [CLIENT](specs/client-foundation.md) | 001 |
| 003 | [Клиент: Core и LocalSession](tasks/003-client-core.md) | [CORE](specs/client-core.md) | 002 |
| 004 | [Клиент: ThreeRenderer](tasks/004-client-render.md) | [RENDER](specs/client-render.md) | 003 |
| 005 | [Клиент: потоковая карта](tasks/005-client-world.md) | [MAP](specs/client-world-streaming.md) | 004 |
| 006 | [Клиент: ввод и UI](tasks/006-client-ui.md) | [UI](specs/client-input-ui.md) | 005 |
| 007 | [Клиент: OnlineSession](tasks/007-client-network.md) | [NET](specs/client-multiplayer.md) | 006, 009 |
| 008 | [Клиент: итоговая проверка](tasks/008-client-verification.md) | [QUALITY](specs/client-quality.md) | 007 |
| 009 | [Общий протокол](tasks/009-shared-protocol.md) | [PROTO](specs/protocol.md) | нет; до реальной сетевой реализации |
| 010 | [Сервер: отдельный проект](tasks/010-server-foundation.md) | [SERVER](specs/server-foundation.md) | нет |
| 011 | [Сервер: SQLite](tasks/011-server-persistence.md) | [STORE](specs/server-persistence.md) | 010 |
| 012 | [Сервер: авторизация](tasks/012-server-auth.md) | [AUTH](specs/server-auth.md) | 009, 011 |
| 013 | [Сервер: мир и AOI](tasks/013-server-world.md) | [SERVER-WORLD](specs/server-world.md) | 012 |
| 014 | [Сервер: мультиплеер](tasks/014-server-realtime.md) | [REALTIME](specs/server-realtime.md) | 009, 012, 013 |
| 015 | [Сервер: локальные NPC](tasks/015-server-ai.md) | [AI](specs/server-ai.md) | 011, 014, 017 |
| 016 | [Система: LAN и автономная игра](tasks/016-system-demo.md) | [DEMO](specs/system-offline-demo.md) | 008, 015, 018 |
| 017 | [Сервер: runtime MLX/Ollama](tasks/017-local-llm-runtime.md) | [LLM](specs/server-llm-runtime.md) | 010; до 015 |
| 018 | [Квалификация LLM и NPC](tasks/018-npc-llm-qualification.md) | [LLM-QA](specs/npc-llm-evaluation.md) | 015, 017; до 016 |

Задачи на сервер выполняются в будущем отдельном проекте. Полная приёмка требует реального сервера, адаптивных NPC и обоих режимов демонстрации; mock-тесты клиента этого не подтверждают. До соответствующих этапов согласовать метрику 10%, локальный вход/handshake, игровой серверный runtime и оставшиеся бюджеты производительности.

## Локальные NPC и LLM

Основная модель выбрана документально: **Qwen3.5-2B 4-bit**, Apache 2.0. Два backend — **MLX LM на Apple Silicon** и **Ollama на поддерживаемых Windows/macOS**, в том числе Intel Mac с CPU inference. Текущий Ollama требует macOS 14+; любой старый Mac автоматически не поддерживается. Один backend/модель обслуживает всех NPC. Резервный кандидат Qwen3-1.7B не включается автоматически.

Общий пиковый бюджет LLM — **4 000 000 000 байт RAM**, включая процессы, веса, контекст и AI-буферы/кеши. Начальный контекст 2048 токенов вместе с выходом до 256, thinking выключен, одна активная генерация и очередь до 4. Для прогретого свободного сервиса выбраны цели p95: первый видимый текст ≤2 с, стандартный полный ответ ≤8 с; это критерии будущих замеров, не достигнутые результаты.

История сообщений и компактная память игрока/NPC хранятся отдельно в SQLite. Ответ стримится как временный и получает успешный финал только после commit; повтор запроса не создаёт новый ответ. История по умолчанию ограничена 30 днями/1000 запросами на player/NPC, память — 16 небольшими записями. Поиск знаний MVP — SQLite FTS5 и локальные aliases для ru/en/es, без отдельной embedding-модели. Полный архив в prompt не отправляется.

Модели не установлены, совместимость MLX text-only артефакта, русский диалог, память и скорость не проверены. Целевые машины и утверждённые учебные материалы ещё нужны; AI/LLM/LLM-QA остаются draft с implementation: not-started. Установка/запуск сервера появятся только после проверки в отдельном проекте.

## Команды

Из корня при установленном GNU Make: `make` / `make help` — справка, `make client` — запуск, `make client-test` — тесты без watch и обязательная часть проверки клиентских изменений.

Команды пока не настроены и завершаются с понятной ошибкой: реализация проекта ещё не началась. На этапе 002 подключить Vite/Vitest к `CLIENT_RUN_CMD` и `CLIENT_TEST_CMD` в Makefile, задокументировать проверенные установку, типизацию и сборку. Успех подставной команды не считается тестированием клиента.
