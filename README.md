# Учебный 3D-мир

Офлайн-игра для изучения языков в стилизованном Вавилоне: до четырёх игроков гуляют по городу в браузере, выполняют задания вместе и разговаривают с жителями, которых оживляет локальная языковая модель. Один ноутбук в локальной сети служит сервером (авторитетный мир, вход, SQLite, ИИ), остальные открывают игру в браузере; соло-игра работает и на самом сервере с выключенным Wi-Fi. Интернет нужен только один раз, для подготовки.

Клиент: TypeScript strict, Vite, Svelte 5, Three.js. Сервер: Node 24, Socket.IO, `node:sqlite`. Общий контракт — `shared/`.

## Быстрый старт

Нужны Node.js 24.15+ (ветка 24), npm, Make; для игры — настольный браузер с WebGL 2, клавиатура и мышь.

```sh
npm --prefix client ci
npm --prefix server ci

make client   # Vite-стенд клиента, http://localhost:5173/ (локальная прогулка без сервера)
make server   # игровой сервер в development, https://localhost:8080/ (вход по имени разрешён)
make prepare  # один раз, с интернетом: зависимости, сборка клиента, сертификат, самопроверка
make start    # офлайн-запуск в production (только вход по паролю); make demo — синоним
```

Сервер печатает адреса для других устройств; в браузере один раз нужно доверять самоподписанному сертификату (страница `/setup`). Порт меняется так: `make start PORT=9000`. Локальный ИИ для жителей не включается сам: установка — [server/llm/SETUP.md](server/llm/SETUP.md), обзор — [docs/tech/llm.md](docs/tech/llm.md).

## Проверки

```sh
make client-test                    # Vitest клиента
make server-test                    # тесты сервера и shared
npm --prefix client run check       # Svelte/TypeScript strict
npm --prefix server run check       # типы, чистый shared, границы модулей
make docs-check                     # ссылки в Markdown
```

Браузерные и WebGL-проверки, Python-тесты LLM и остальные команды — в [docs/tech/setup.md](docs/tech/setup.md).

## Документация

Начните с [docs/README.md](docs/README.md): индекс документов об игре, устройстве системы и принятых решениях. Установка, команды и окружения — [docs/tech/setup.md](docs/tech/setup.md); эксплуатация во время игры — [docs/tech/operations.md](docs/tech/operations.md); правила для агентов — [AGENTS.md](AGENTS.md).
