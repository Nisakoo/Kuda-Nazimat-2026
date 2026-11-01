# Ручная проверка через общий Browser

Контекст: настоящий сервер `http://127.0.0.1:4387`, config `/tmp/ui-hud-669eb5-config.json`, отдельная SQLite `/tmp/ui-hud-669eb5/game.sqlite`, market, расширенный radius2. Системный Chromium156 / SwiftShader. Клиент served из production dist. Это не физический LAN и не аппаратная приёмка.

Через обычные UI контролы, без подмены fetch/session/game data и без программного присвоения Pointer Lock:
1. Явный demo guest `UI-visual-review` → mode Solo → languages ru/en → server enroll → intro → закрыть.
2. Явное нажатие «Начать прогулку». Snapshot показал HUD. Чтение DOM (не изменение) подтвердило `{captured:true,canvasCount:1,hasAlerts:0}`.
3. Escape освобождает мышь. Следующее чтение DOM подтвердило `captured:false` и native dialog «Пауза».
4. Dock → Inventory → Jug → Take. В ожидании показаны disabled кнопка и старое состояние «ничего»; после сервера — «В руках: Кувшин» и «Убрать из рук». Никакого локального оптимистического equip.
5. В том же native слоте Dock → Map: реальная схема, goal в загоне, self у рынка, только task scope. Нового захвата мыши нет.
6. Escape → Pause → Logout → чистый вход, поля имени/пароля пустые.

Скриншоты HUD/Inventory/Map показаны в разговоре инструментом Browser. Это не файлы из private Playwright suite и не замена её обязательных assertions. Фото до финального логического исправления dictionary drafts; markup этих окон не менялся.

Обнаружен настоящий визуальный дефект карты: corner background-image перекрывал parchment gradient без fallback color, поэтому dialog был прозрачным. Исправлен постоянный paper background-color в `game-ui.css`; финальный build и повторный screenshot нужны для проверки исправления. Остальные различия с исходными PNG остаются художественной приёмке.

Это доказывает только перечисленные операции в данном браузере. Default bundled Playwright capture predicate в отдельном suite всё ещё не проходит; тесты не объявляются пройденными на основании этой ручной проверки. FPS/P95/heap/draw-call qualification и физический Pointer Lock не измерялись.
