---
id: TASK-057
type: implementation-task
status: in-progress
spec: ../specs/world-next-stage.md
requirements: [NEXT-015]
depends_on: []
related:
  - spec: ../specs/client-world-streaming.md
    requirements: [MAP-006]
---

# Локальное аудио живого мира

## Границы

Аудиомодуль, локальные авторские ассеты, отдельный аудиогенератор и проверки. GameApp/UI интегрирует world-client; рендер и генераторы сцены принадлежат world-render. Другие NEXT, редизайн, новая локация, TLS и LLM не входят. Основа: origin/main 87124f4. Ветка: impl/next-006-010-011-015. Координатор подтвердил по runtime metadata модель openai/gpt-6.1-sol и thinkingLevel high всех делегированных сессий.

## Контракт интеграции для world-client

Модуль: `client/src/audio/WorldAudio.ts`, экспорт `WorldAudio`. Создание: `new WorldAudio(worldBudget)`; передаётся тот же `WorldBudget`, что у карты/рендера. Дополнительные `WorldAudioOptions` позволяют подставить только настоящие браузерные границы: AudioContext, fetch и localStorage для теста.

- `unlock(): Promise<void>` — вызвать непосредственно из обработчика действия пользователя. Создание контекста и `resume()` выполняются до первого await; ошибки поглощаются, повторный пользовательский вызов разрешён.
- `volume: number`, `setVolume(value: number): void` — один сохранённый уровень 0..1, default 0.3. Ключ `babylon.world-audio.volume.v1`; не связан с токеном/профилем. Нулевое значение глушит gain, останавливает активные источники и запрещает новое воспроизведение/загрузки.
- `update(deltaSeconds: number): void` — существующий цикл, без нового таймера; редкие порывы ветра, птицы и шелест травы. Нет отдельного режима меню/скрытия вкладки.
- `retainEntities(ids: readonly string[]): void` — перед каждым пакетом movement передать полный авторитетный набор ID присутствующих игроков, включая удалённых. Сохраняются первые 8 уникальных непустых ID; отсутствующие ID освобождают motion-слоты. После первого использования API не входящие в набор sample игнорируются. Первый sample нового/вернувшегося ID всегда тихий, даже при live `jumpStarted`; присутствующие ID сохраняют прогресс шага. Пустой массив очищает слоты. Вызов после dispose ничего не делает.
- `movement({ entityId, tick, position: { x, y, z }, grounded, sprinting, jumpStarted, origin }): void` — подтверждённое движение, не ввод/предсказание. `origin`: `live | snapshot | history | correction`. Последние три значения устанавливают тихую базу. `tick` монотонен для сущности. Первый live sample устанавливает базу, кроме явно подтверждённого `jumpStarted`. Шаги зависят от XZ-дистанции и опоры, sprint выбирает отдельный короткий клип; скачок позиции/длинный разрыв не создаёт шаг. Прыжок звучит только по новому подтверждённому фронту.
- `message({ id, stream, sequence, origin }): void` — новая показанная реплика NPC/игрока. `stream` устойчив между reconnect, `sequence` монотонен в потоке. История/снимок/коррекция только поднимают тихую границу. Текст не передаётся и не синтезируется. Один источник, общий буфер; четыре playbackRate-вариации 0.94/1.03/1.09/0.98.
- `stats` — `sources`, `buffers`, `pending`, `reservedBytes`, `failures`, `unlocked`, `entities`, `streams`, `messageIds`.
- `dispose(): void` — выход/замена сцены. Повторный вызов безопасен. Отмена HTTP/reader, очистка буферов/источников/таблиц и освобождение leases; поздний HTTP-ответ не создаёт AudioBuffer. Контекст закрывается.

Фактический GameApp при каждом подтверждённом join, в том числе reconnect, вызывает releaseScene/dispose и создаёт новый WorldAudio вместе со сценой. Затем baselineAudioMessages устанавливает тихую историю уже показанных utterance ID; первая действительно новая реплика после unlock получает новые ID и live-события. Это заменяет первоначальную рекомендацию сохранять экземпляр при reconnect. При смене серверной эпохи/сцены также создаётся новый экземпляр после dispose. Холодная загрузка может озвучить событие только в пределах 250 ms по аудиочасам **и** монотонным часам браузера; восстановленная база отменяет отложенное воспроизведение. События не образуют очередь исторических шагов/реплик. Ранний и окончательный контракт переданы координатору сообщениями; прямой инструмент сообщений между агентами у audio-агента отсутствует.

## Реализация

- [x] Семь оригинальных локальных PCM16 WAV: wind, birds, grass, step, sprint, jump, mumble. Происхождение/CC0 — `client/public/assets/audio/PROVENANCE.md`, размеры/SHA-256 — `manifest.json`. Записей, внешних семплов и разборчивой речи нет.
- [x] `client/scripts/generate-world-audio.mjs`: детерминированный offline-генератор, seed 42015. Уже подготовленные файлы не требуют генерации во время игры.
- [x] Один сохранённый уровень 30%, 0% тишины, явный autoplay unlock; блокировка/ошибка не мешают игровым вызовам.
- [x] Шаг/спринт по подтверждённой дистанции с опорой; однократный фронт прыжка. Тихая история/снимки/коррекции и дедупликация сообщений/движения.
- [x] Leases того же WorldBudget до HTTP/createBuffer/source, ограниченные загрузки/источники/таблицы, dispose и пять циклов без остаточного аудиорезерва.
- [ ] Полная интеграция GameApp/UI и маршрут S15 принадлежат world-client и общей приёмке. Автономный browser smoke не заменяет эту проверку.
- [ ] Фактическое прослушивание, целевые ноутбуки, физические LAN/Wi-Fi off, профиль полной сцены с четырьмя игроками остаются unverified.

## Пределы до измерений

- Источники ≤8, одновременные загрузки ≤2, общие decoded buffers ≤7. Активные источники не клонируют AudioBuffer на JS-стороне; для консервативного учёта каждому дополнительно резервируется размер его PCM +512 байт.
- Подготовленные WAV: 328 414 байт. Полный набор float32 PCM: 656 212 байт. Каждый HTTP-запрос резервирует два размера WAV для streaming chunks + contiguous WAV, а также decoded PCM до выделения. При полной загрузке текущего согласованного набора консервативная верхняя оценка аудиорезерва — 3 350 584 байт; общий MAP cap остаётся 67 108 864 байта.
- Нет native `decodeAudioData`: фиксированный mono PCM16 заголовок строго проверяется, затем синхронно заполняется ограниченный AudioBuffer. Поэтому нет неотменяемого фонового декодера после dispose.
- HTTP ограничен объявленным размером; mismatched Content-Length, oversized/truncated body, неверный PCM header, redirect и ошибки отклоняются. Ошибочный клип не повторяет запросы до новой сцены. Недостаток общего бюджета не запускает HTTP.
- Движущиеся сущности ≤8, потоки реплик ≤32, последние message IDs ≤512. При переполнении сущностей/потоков новые слоты отклоняются без вытеснения старой тихой границы. Монотонная sequence защищает старые сообщения после выхода ID из ограниченного кольца.
- Указанные байты — полезные данные/консервативные leases, не RSS браузера, драйвера или скрытые внутренние структуры Web Audio.

## Проверки и фактические результаты

1. `node client/scripts/generate-world-audio.mjs` — PASS: 7 WAV, 328 414 байт. Дополнительный Node-прогон сохранил байты manifest/7 WAV до и после повторной генерации и сравнил `assert.deepEqual`: полная побайтная воспроизводимость offline.
2. `cd client && npx vitest run src/audio/WorldAudio.test.ts` — PASS: **42/42**, 1 файл. Сырые результаты: [audio-unit.log](evidence/world-next/audio-unit.log). Проверены громкость/storage/autoplay, реальные байты WAV/hash/quiet endpoints, опора/дистанция/стены/воздух/прыжок/спринт, дедупликация, вариации, cap источников/загрузок/таблиц, бюджет/rollback, шесть вариантов ошибки файла, streaming cancel/late responses, независимые владельцы и пять входов/выходов. Fake AudioContext не доказывает фактическое прослушивание.
3. `make client-test` — PASS наблюдавшегося прогона: **228/228**, 24 файла; аудио 42/42. [audio-full-unit.log](evidence/world-next/audio-full-unit.log). Это результат конкретного прогона во время параллельной реализации, не финальная приёмка последующих изменений других агентов.
4. Из `client/`: `npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM,DOM.Iterable --types vite/client,node --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --noUnusedLocals --noUnusedParameters --verbatimModuleSyntax --isolatedModules --resolveJsonModule --skipLibCheck --allowImportingTsExtensions src/audio/WorldAudio.ts src/audio/WorldAudio.test.ts` — PASS изолированной strict-проверки аудио и его WorldBudget/manifest зависимостей.
5. `npm --prefix client run check:imports` — PASS: без нарушений, последний наблюдавшийся прогон 116 модулей/356 зависимостей.
6. `npm --prefix client run build` — PASS наблюдавшегося прогона Vite: 202 модуля, 4.76 s; есть предупреждение большого JS chunk. [audio-build.log](evidence/world-next/audio-build.log). Последующие чужие изменения требуют повторного общего build.
7. `PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium node client/src/audio/browser-smoke.mjs` — PASS native Web Audio в Chromium **156.0.8078.73**, Linux headless. 7 уникальных локальных WAV, 12 запросов с учётом повторных сцен, 0 внешних запросов, 0 page errors, 8 стартов источников. Наблюдавшийся пик WorldBudget **1 209 000 байт**, 7 decoded buffers, 0 failures. Каждый из **5** входов/выходов вернул sources/buffers/pending/reservedBytes и бюджет к **0**. Нативно проверены user-action unlock, тихие дубли/история/неподвижность, 0% с остановкой, сохранённый 0% после reload. [audio-native-browser.log](evidence/world-next/audio-native-browser.log). Это изолированный модульный browser smoke, не игровой маршрут, физическое прослушивание или аппаратная квалификация.
8. Общий `cd client && npx tsc --noEmit` пока **не прошёл** из-за параллельных изменений вне audio: незавершённые audio-helper методы/поля GameApp и exactOptionalPropertyTypes в server game composition. Аудиофайлы ошибок не дали. Последний наблюдавшийся вывод: [audio-full-types.log](evidence/world-next/audio-full-types.log). Владельцы должны завершить изменения и повторить общий check; предыдущие промежуточные ошибки не объявляются окончательным дефектом ветки.
9. `git diff --check` — PASS наблюдавшегося прогона. Серверные/контрактные проверки принадлежат соответствующему владельцу; аудио-агент не менял shared/server.

## Дополнение: освобождение motion-слотов

По read-only review обнаружено накопление отсутствующих entity ID до лимита 8. Добавлен только `retainEntities(ids)` в аудиомодуль и четыре аудиотеста: 24 разных игрока последовательно, повторное появление/тихие snapshot/history/correction, строгий предел 8 и игнорирование отсутствующих ID, сохранение stride у присутствующего игрока. GameApp/UI аудио-агент не менял. API передан координатору для world-client.

- `cd client && npx vitest run src/audio/WorldAudio.test.ts` — **46/46 PASS** после добавления API. В первом прогоне один прежний autoplay-тест истёк по реальному 250 ms wall deadline под нагрузкой хоста. Исправлен только fake-clock harness: performance.now синхронизирован с FakeContext.currentTime; production deadline/cancellation semantics не менялись.
- Изолированная strict TypeScript команда из пункта 4 — PASS.
- Повторный `make client-test` — наблюдалось **265 PASS / 1 FAIL**, 31 файл/266 тестов. Ошибка в параллельно изменяемом `GameApp.test.ts:266`: последний retainEntities ещё содержал `p2` вместо ожидаемого удаления. Во время чтения владельцем уже добавлялся дополнительный frame advance; этот прогон не объявляет исправленный интеграционный тест прошедшим. Все 46 аудиотестов прошли.
- После изменений владельца `cd client && npx vitest run src/audio/WorldAudio.test.ts src/app/GameApp.test.ts` — **70/70 PASS** (46 audio +24 GameApp). `npm --prefix client run check:imports` — PASS, 122 модуля/387 зависимостей. `git diff --check` — PASS. Полный make client-test после этого точечного успеха повторно не запускался.
- Для отдельной проблемы BABEL cold-load cancellation координатору рекомендовано вызывать все тихие baseline-события до live-событий в одном update. Семантика cancellation аудиомодуля не менялась без согласования.

## Дополнение: две новые реплики в одном poll

GameApp/audioPresentation владельца клиента разделяет впервые показанные вопрос и ответ NPC на два устойчивых utterance ID; при reconnect оба ID получают тихую history-базу. В аудиомодуле удалён только временной mumble cooldown: разные принятые ID больше не исключают друг друга в одном poll. Для холодного общего mumble-буфера добавлен счётчик до 8 свежих событий, использующий тот же единичный HTTP/decode load. Счётчик имеет deadline и epoch самого старого события, не продлевает срок и обнуляется после load/dispose. Лимиты источников 8, загрузок 2, декодированных буферов 7 и прежние leases не изменены. Source cap имеет приоритет над числом новых реплик; дедупликация ID/sequence и отмена после history/snapshot остаются прежними. Кошки/птицы/движение и API GameApp не менялись аудио-агентом.

Добавлены регрессии: два разных question/answer ID в одном poll при холодном и прогретом буфере; дубли не создают третий источник; cold burst 100 ID ограничен 8 источниками и одним load; истечение deadline, history и dispose не воспроизводят старую пару.

- `cd client && npx vitest run src/audio/WorldAudio.test.ts --pool=threads --maxWorkers=1` — **52/52 PASS**. Начальная попытка с default forks не запустила worker за timeout: 0 выполненных тестов, это не PASS. Thread-прогон выполнен отдельно без изменения конфигурации проекта.
- `cd client && npx vitest run src/app/audioPresentation.test.ts src/app/GameApp.test.ts src/audio/WorldAudio.test.ts --pool=threads --maxWorkers=1` — **83/83 PASS** (52 audio, 26 GameApp, 5 audioPresentation).
- Изолированная strict TypeScript команда из пункта 4 — PASS. `git diff --check` — PASS.
- Полный финальный набор проверок и интегрированный browser-сценарий выполняет координатор; аудио-агент не заявляет их прохождение в этом изменении.

## Итоговая проверка координатора

После всех production-исправлений полный `make client-test CLIENT_TEST_CMD='npm --prefix client test -- --pool=threads --maxWorkers=1'` — **284 passed /33 файла**, включая 52 audio. Svelte, strict/Core TypeScript, imports и build — PASS; большой Vite chunk остаётся предупреждением. Актуальные команды, historical failures, нативные browser-результаты и ограничения не объединяются в ложный общий PASS: [acceptance.md](evidence/world-next/acceptance.md).

## Незавершённая приёмка

Последний integrated browser-v6: UI30%, сохранение0%, отсутствие native source starts при0% и изменение45% наблюдались; затем истёк30 s response wait для прогрева mumble. Backend доставил сообщение, UI показывал1 pending load, но причина задержки не доказана. Live mumble/+2 NPC pair и5 integrated lifecycle cycles не завершены и не считаются PASS. Это не отменяет52 модульных теста и отдельный native smoke.

S15 подтверждён только на уровне модуля и изолированного нативного браузера. Прослушивание на маршруте рынок → пастбище → двор, стиль/комфорт/неразборчивость на реальных динамиках, S7/S11/S12 полной сцены, четыре полноценных GPU-клиента, реальные LAN/Wi-Fi off и целевая QUALITY-производительность не проверены. Linux Chromium не заменяет квалификацию целевых ноутбуков. Поэтому общий статус задачи остаётся `in-progress`, без утверждения полной приёмки NEXT-015.
