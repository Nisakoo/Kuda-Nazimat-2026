# Документация

Здесь собрано всё, что нужно знать об игре и о том, как она устроена. Документы короткие и разделены по темам: `game/` — что за игра (дизайн, мир, жители, интерфейс), `tech/` — как она устроена и запускается, `decisions/` — журнал решений (что выбрали, что отвергли и почему). Точные формы протокола, лимиты и форматы данных — исполняемый контракт в коде (`shared/`) и его тесты; документы дают обзор и ссылки.

**Правило: документ обновляется в том же PR, что и код.** Изменили поведение, лимит, команду или границу модулей — исправьте затронутый документ; приняли новое решение — запишите его в [decisions/README.md](decisions/README.md). Для агентов правила зон лежат в `AGENTS.md` (корень и вложенные).

## Индекс

| Тема | Документ | Когда читать |
|---|---|---|
| Обзор игры | [game/overview.md](game/overview.md) | первым: что за игра, что уже есть, куда смотреть дальше |
| Мир и карта | [game/world.md](game/world.md) | перед работой над картой, сценами, заданиями или новым жителем |
| Жители и сюжет | [game/cast.md](game/cast.md) | при работе над конкретным жителем, районом или заданием |
| Механики | [game/mechanics.md](game/mechanics.md) | перед изменением перевода, заданий, движения, предметов, камеры, оружия |
| Поведение жителей | [game/npc.md](game/npc.md) | перед правкой реплик, подсказок, профилей, памяти и отношений жителей |
| Интерфейс | [game/ui.md](game/ui.md) | перед работой над экраном, HUD, окном или горячими клавишами |
| Стиль и графика | [game/art-style.md](game/art-style.md) | перед созданием моделей, сцен, освещения, компонентов UI |
| Макеты экранов | [game/images/](game/images/) | как ориентир стиля при работе над UI (не точные требования) |
| Архитектура | [tech/architecture.md](tech/architecture.md) | перед изменением, пересекающим границу client / server / shared, и перед новым модулем |
| Протокол | [tech/protocol.md](tech/protocol.md) | перед изменением сообщений Socket.IO, HTTP-API, границы client/server |
| Сервер | [tech/server.md](tech/server.md) | перед правкой `server/`: маршрут, миграция, адаптер, метрика |
| Клиент | [tech/client.md](tech/client.md) | перед правкой `client/`: сессии, карта, рендер, ввод, звук, профили графики |
| Локальная LLM | [tech/llm.md](tech/llm.md) | перед правкой диалога NPC, очереди, workers, переводчика, таймаутов, профилей |
| Установка и команды | [tech/setup.md](tech/setup.md) | при развёртывании окружения, запуске проверок, выборе окружения сервера |
| Эксплуатация | [tech/operations.md](tech/operations.md) | при подготовке ноутбука-сервера, диагностике, доступе администратора, бэкапе |
| Журнал решений | [decisions/README.md](decisions/README.md) | перед изменением того, что похоже на договорённость; при принятии нового решения |
| Шаблон решения | [decisions/template.md](decisions/template.md) | при записи крупного решения (MADR) |
| Офлайн без интернета | [decisions/0001-offline-without-internet.md](decisions/0001-offline-without-internet.md) | перед любой зависимостью от сети |
| Авторитетный сервер | [decisions/0002-authoritative-server.md](decisions/0002-authoritative-server.md) | перед переносом логики между клиентом и сервером |
| Стек клиента | [decisions/0003-client-stack-threejs-svelte-vite.md](decisions/0003-client-stack-threejs-svelte-vite.md) | перед добавлением клиентского фреймворка или движка |
| Протокол v3 | [decisions/0004-game-protocol-socketio-v3.md](decisions/0004-game-protocol-socketio-v3.md) | перед изменением версии или формата игровых сообщений |
| Общий контракт | [decisions/0005-shared-executable-contract.md](decisions/0005-shared-executable-contract.md) | перед правкой `shared/` |
| SQLite | [decisions/0006-sqlite-node-sqlite.md](decisions/0006-sqlite-node-sqlite.md) | перед изменением хранилища |
| Вход на игровых каналах | [decisions/0007-mandatory-auth-on-game-channels.md](decisions/0007-mandatory-auth-on-game-channels.md) | перед правкой авторизации и окружений входа |
| Одна LLM с бюджетом | [decisions/0008-single-local-llm-with-budget.md](decisions/0008-single-local-llm-with-budget.md) | перед изменением модели, очереди, лимитов RAM |
| HTTPS в LAN | [decisions/0009-https-self-signed-in-lan.md](decisions/0009-https-self-signed-in-lan.md) | перед правкой TLS и страницы `/setup` |
| Мониторинг | [decisions/0010-prometheus-grafana-optional-monitoring.md](decisions/0010-prometheus-grafana-optional-monitoring.md) | перед подключением внешнего мониторинга |
| История метрик | [decisions/0011-builtin-metrics-history.md](decisions/0011-builtin-metrics-history.md) | перед правкой панели администратора и метрик |
| Модульный монолит | [decisions/0012-modular-monolith-clean-architecture.md](decisions/0012-modular-monolith-clean-architecture.md) | перед разбиением на процессы или слои |
| Защита проекта | [defense.md](defense.md) | при подготовке к защите: сценарий на 6 минут, запасные планы |
| Установка LLM на машину | [../server/llm/SETUP.md](../server/llm/SETUP.md), [README](../server/llm/README.md), [PROFILES](../server/llm/PROFILES.md), [TIMEOUT](../server/llm/TIMEOUT.md), [UPDATING](../server/llm/UPDATING.md) | руководства оператора: установка с нуля, справочник runtime, профили, таймаут, обновление |
| Конкретные Mac | [../server/llm/MAC-INTEL.md](../server/llm/MAC-INTEL.md), [MAC-INTEL-08B](../server/llm/MAC-INTEL-08B.md), [MAC-30S](../server/llm/MAC-30S.md) | журналы подготовки и проверок на конкретных машинах |
| Запуск сервера | [../server/README.md](../server/README.md) | справочник оператора: конфигурация, HTTP-API, админ-панель, диагностика |
| Скиллы агентов | [../.agents/skills/install-local-ai/SKILL.md](../.agents/skills/install-local-ai/SKILL.md) | когда агент устанавливает или обновляет локальный ИИ на компьютере |
