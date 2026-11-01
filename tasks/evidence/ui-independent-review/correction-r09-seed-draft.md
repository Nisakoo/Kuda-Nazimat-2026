# R-09 / P2 — chat-seeded dictionary теряет ручной перевод

## Решение

**Подтверждено на `index-zupTnY5d.js`. Не исправлено.** Требования HUD-007/014–016/018, BABEL-021–023: реальный пользовательский draft нельзя стирать фоновым обновлением. Baseline с равноценной паузой в seeded форме не проверялся; регрессию против4587fa1 не утверждаю.

Это отдельный дефект данных формы, не R-06: фокус остаётся в поле `Перевод`. Это не предположение по единственному timeout, не fake API state и не ошибка peer authorization.

## Условия и воспроизведение

1. Настоящий password login, сохранённый ru→es, настоящий online мир4387. Явный Start/retry; затем явный Escape, без автоматического capture.
2. В настоящем Chat есть входящее **Hola** от реального teammate. Предыдущий completed peer действительно вошёл в game namespace и получил chat200. Старые delivery records не переписаны.
3. Обычным клавиатурным действием активируется `В словарь`. Форма содержит `Слово=Hola`.
4. Дождаться настоящего suggest HTTP200 `{suggestion:"Привет"}` и ещё2000ms. Перед ручным вводом поле действительно содержит `Привет` (`beforeManual.at=116811.2`). Это исключает незавершённый initial suggestion как достаточное объяснение дальнейшего стирания.
5. Через обычный `fill` ввести ручной перевод. Только читать последующие native DOM values и события; не отправлять форму и не менять другое поле.

## Actual trace

`correction-seed-draft-audit.mjs`, `correction-seed-draft-audit-results.json`, `correction-seed-draft-audit-run.log`; actual PNG `correction-seed-draft-audit/chat-seed-draft-after-idle-1622x970.png`.

| Performance timestamp, ms | Событие / значение |
|---:|---|
|126908.2|Trusted native `input`, поле `Перевод`: `Привет — ручной черновик A`|
|129349.3|Первая read-only выборка уже `""`; active label по-прежнему `Перевод`|
|131635.1 /133513.9 /135935.5|Значение остаётся пустым, фокус не ушёл|
|147106.4|Второй trusted native `input`: `Привет — ручной черновик B`|
|149288.0 /151372.9|Read-only DOM действительно содержит полный B, active `Перевод`|
|153207.5 /155435.0|DOM снова `""`, без дополнительного пользовательского действия; active `Перевод`|

**Expected:** введённый B остаётся B до явного изменения/отмены/успешного сохранения. **Actual:** он самостоятельно становится пустым. Для B последнее наличие и первое отсутствие разделены1834.6ms. Нельзя выдавать номинальный `wait400` за фактическую длительность потери: времена RPC и реальные performance timestamps приведены отдельно.

`manualEvents.length=2`, оба `trusted:true`; `seedDraftLost:true`. Step `chat-seed-draft-no-submit-data-loss` имеет `ok:true` только как **успешно завершённый probe**, а не успешная работа приложения. Автоматизация ничего не присваивает DOM/application state, не перехватывает API и не вызывает submit в данном probe.

## Предыдущие неуспехи и их смысл

`correction-word-chat-completion-final-results.json`: настоящий suggest200 `Привет`, реальный seed Hola, но word-save POST не появился за90s event observation. Actual `correction-word-chat-completion-final/failure.png` показывает пустое required поле и native validation focus. Сам по себе этот timeout не был достаточным диагнозом. Новый probe отдельно доказывает потерю draft без submit.

Исходный observation с Buy dates также не доказывает successful chat-to-word save: нет соответствующего POST и сохранённой строки. Его optimistic PASS label остаётся ошибкой проверки. Оба факта сохранены, не переименованы задним числом.

## Связь с кодом и границы

Кандидат для локализации — `client/src/ui/BabylonPanel.svelte` effect по `wordSeed`: при выполнении он присваивает `translation=''` и повторно открывает форму. Вложенные зависимости реальных parent snapshot updates нужно проверить при исправлении. Только чтение исходника не заменяет trace и не доказывает конкретную reactive цепочку.

Нет оснований назначать причиной GPU, shadow, GLB, approved V4 geometry, транспорт либо server word validation. Точное исправление в implementation reviewer не делал. После исправления нужна actual повторная проверка seeded form при фоновых state updates, ручного draft и настоящего word-save200; CPU тестов недостаточно.
