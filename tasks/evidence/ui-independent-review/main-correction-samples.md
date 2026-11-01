# Ручные correction samples основного агента

Это supporting evidence, не независимая приёмка и не замена обязательных deadline/FPS checks. Настоящий сервер4387, настоящий guest `focus-bw0-287`, backend=test с видимым предупреждением. Все переходы, enroll и equip выполнены через UI. Pointer Lock — только явный Start/Resume. Никаких подмен DOM, API, game state или capture implementation.

## BW0 — первая correction build, отказ R06 сохранён

- Bundle `index-BW0Z57Ad.js`, CSS `index-CXfTX26t.css`. Public GLB оставались baseline, private V2/V3 не опубликованы. Его candidate build be6895 start2026-11-01T02:48:12Z/end log02:49:05Z, exit0/wall54s: Svelte0/0, TS0,50 focused tests/5 files (15 modal+3 shortcut+28 GameApp+3 preview+1 framing), direct Vite build0. Эти unit passes не покрыли обнаруженную ниже позднюю потерю focus; R06 actual failure сохраняется. Поздний callback не означал новый build во время V4 reviewer freeze.
- 390×844: actual gear rect322/776/56/56, center hit-testtrue. После Settings→Close active BUTTON `aria-label=Настройки`. 0 canvas на login.
- 1280×800: mode начально фокусирует checked INPUT radio, logo/gear находятся внутри активного native dialog; Enter открывает languages.
- Новые login/mode composites действительно просмотрены в общем Browser. BackgroundV1 даёт перспективу/объём, но traveller head остаётся высоким и уличные фасады однообразны. Это основание последующей V2-bake, не её приёмка.
- R06 FAIL: после настоящего Start и I inventory открыт, но active BODY/inDialogfalse. Второй I до equip также оставил inventory открытым.
- Наблюдательные listeners записали focus/PWL events без изменения поведения. После Resume: PWLtrue. I: focusin DIV при303731.6ms; pointerlockchange при303755.7ms, activeDIV/lockfalse; focusout DIV при305104.2ms, затем BODY. Таким образом первый unlock-only one-frame candidate не охватывает позднюю потерю фокуса. Это наблюдаемая последовательность, не доказанная внутренняя причина.
- После UI take jug отображался `В руках: Кувшин`, но activeBODY. HTTP status этого Main sample не записан отдельно; не выдаётся за полный network assertion.
- Полный ответ read-only observer: [raw response](main-bw0-focus-trace.json); [распарсенные15 events](main-bw0-focus-trace-data.json). Timestamp capture2026-11-01T03:01:57.875Z. Исходный raw response не изменён.
- Actual map просмотрена1280×800: крыши/пальмы появились, но схема занимает примерно478px из884px, labels около9px. Goal перекрывает «Загон», own marker — «Рынок». Передан feedback, после него map framing/label anchors изменены; эти последующие source fixes ещё требуют fresh capture.

## Dmp — delayed focusout candidate, положительный ограниченный sample

- Bundle `index-Dmp_w5NJ.js`; `candidate-ui-build-focusout.log` — direct Vite build, не полный pipeline. Callback5d90ba exit0/wall11s, explicit start2026-11-01T03:02:00Z/log end03:02:11Z, CSSqM6L3C1v. Старые public GLB сохранены. Позднее уведомление не запускало новый build во время текущего freeze.
- Первый клик Start не перевёл welcome в playing; последующий snapshot остался welcome. Это не записывается как успешный capture и не закрывает5s readiness.
- Второй явный клик Start:03:04:32.235Z PWLtrue.
- I:03:04:47.799Z activeBUTTON `Закрыть окно`, inDialogtrue, document.hasFocustrue, lockfalse.
- UI take bag изменил `В руках: Сумка`; activeBUTTON `Убрать из рук`, inDialogtrue, lockfalse.
- Второй I закрыл inventory и показал native Pause; capture не возобновлён.
- Это положительный Main sample для initial keyboard opening/ACK/secondI. Pending focus choice, новый modal/Settings, все размеры и independent повтор ещё обязательны. R06 остаётся open.
- Выполнен UI logout, затем общий Browser переведён в about:blank. После этого GPU передан authoring capture.

## Консоль и presentation

В обоих Main world sessions нет записанного page error. Есть предупреждения software fallback/ReadPixels и removed PCFSoftShadowMap. Исходник позже заменён на PCFShadowMap — фактический fallback установленной Three.js; тени не выключены и качество не снижено. Это не диагноз cloth dots. У preview дополнительно исследуется shadow depth/bias отдельным diagnostic A/B, без подмены приёмочных изображений.

В новых панелях действительно видны4 CSS corner facets и parchment gradient. Изменения иллюстраций bag/jug — локальные SVG shading layers с уникальными gradient IDs; они не создают серверные предметы.
