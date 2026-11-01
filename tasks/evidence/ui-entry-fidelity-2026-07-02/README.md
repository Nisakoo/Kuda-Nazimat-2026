# TASK-044 / TASK-048 · вход: история и текущие corrections

## Текущие original offline backgrounds V2

Источники: `client/scripts/entry-background-scene.mjs`, `client/scripts/bake-entry-backgrounds.mjs`. Это собственная локальная Three.js scenery без нарисованных UI/контролов или игрового state. Декоративные жители не являются NPC/игроками runtime world.

- Исторический V1: `baked-v1/`, `bake-v1.log`, capture2026-11-01T02:39:25.477Z. Поздний callbacka66137 exit0/wall10s сверён с этим receipt;1622×970/DPR1,0 errors/failed requests/external resources. Он не запускался заново во время correction review.
- Текущий V2: `baked-v2/`, `bake-v2.log`, capture2026-11-01T03:08:24.367Z. Поздний callbackb31a72 exit0/wall11s сопоставлен с этим неизменным receipt, не новый bake. Те же1622×970/DPR1,0 errors/failed/external. Более низкие/разные уличные крыши, больше sky/layers, ниже головы жителей, крупнее глаза, beveled backpack;4096 shadow map используется только при offline authoring.
- SHA текущего scene source точно совпадает с bake-v2 receipt: `05fe72224aeec298d1654d0b69ff35b294bac23937bd57fbb618f0ae1de68690`.
- Published `city-gates.png`:295161B, SHA `788c7d11590e7f5cc5c3be7e8109ee68f242ac7c0d09425834ababde54829dcb`.
- Published `babylon-market-day.png`:300315B, SHA `c6f1d11d928f139caf047091d92afb32c8ac122e4c296535b31950d95150819c`.
- Read-only audit подтвердил равенство public PNG и baked-v2 bytes. `entry.css`/`avatar-selection.css` используют PNG; старые SVG остаются историей.

Independent CPU comparison (`../ui-independent-review/bake-v2-observation.md`) не требует обязательной новой rebake. Actual composite/cropping/central-sign coverage, footer/gear/focus и все4 viewport проверяются отдельно на coherent real-server bundlezupTnY5d. Эти PNG не являются runtime world/FPS/LAN/AI acceptance. Canonical CPU289/160/check/build0 описан в `../ui-redesign-2026-07-02/README.md`; browser/render failures не отменены.

## Исторический component-fixture этап до TASK-048

Все следующие SVG/screenshots/fixtures и197/2 unit или4 integration errors относятся к прежнему этапу, не текущему source/render и не server acceptance. Старые failures сохраняются рядом с поздними canonical результатами, а не выдаются за текущий pass/fail одного кода.

## Изменённые файлы

- `client/src/ui/entry.css`
- `client/src/ui/Login.svelte`
- `client/src/ui/EntrySetup.svelte`
- `client/public/assets/ui/city-gates.svg`
- `client/public/assets/ui/babylon-market-day.svg`
- `client/public/assets/ui/stone-tablet.svg`
- `client/public/assets/ui/stone-sign.svg`

Общие 4 SVG — оригинальные локальные иллюстрации/декорации, около 24 КБ суммарно. В них нет нарисованных полей, кнопок, подписей интерфейса или скриншотов макета. `city-gates.svg` — общий дневной фон входа/облика; `babylon-market-day.svg` — улица с рынком для выбора режима. CSS применяет фон через `main.entry-screen::before`; `.entry-city-backdrop` также доступен как класс. Сервер/игровой мир не изменены этим исполнителем.

## Исходники и сравнение

Просмотрены `specs/images/autorize.png` и `track.png` (1448×1086), `oblik_page.png` (1672×941), TASK-040/044 и ENTRY/AVATAR. Разные пропорции оригинальных файлов важны: нельзя требовать совпадения координат при viewport 1622×970.

- `comparison-login.png`, `comparison-mode.png`: исходник рядом с результатом при 1622×970.
- `login-{1622,1280,390,640}.png`, `mode-{1622,1280,390,640}.png`: 1622×970, 1280×800, 390×844, 640×480.
- `login-640-scrolled.png`: нижние действия доступны прокруткой короткого экрана.
- `languages-640.png`, `friends-390.png`, `register-390.png`, `error-390.png`: отдельные состояния.

**Это изолированные визуальные проверки настоящих Svelte-компонентов, не серверная приёмка.** Оболочка header и данные режима заданы fixture. Парольные callbacks записывают вызов, а не подтверждают вход/регистрацию. Ошибка на `error-390.png` передана через prop `error`. `component-fixture.html` и `private-preview.mjs` сохраняют использованный fixture/сценарий. Команда: `node /tmp/entry-preview.mjs` через отдельный Vite 5299/private proxy 5300 и headless `/usr/bin/chromium`. Общий browser не использовался. Итоговый App, облик и реальные auth/API должен перепроверить основной исполнитель.

## Проверки

`private-preview.json`:
- 0 page errors; горизонтального переполнения нет во всех 8 основных кадрах.
- Короткие экраны прокручиваются внутри полноэкранного entry-контейнера/диалога. Высота содержимого больше viewport; это намеренно не скрытая потеря контролов.
- После «Далее» фокус на `SELECT`; после Esc назад — на выбранном radio (`INPUT`, checked).
- Стрелка вправо на вкладках ставит фокус на выбранную «Регистрация».
- Глаз меняет тип password на text. Смена вкладки, login submit и register submit очищают поле пароля.
- `register` и `loginPassword` вызываются отдельно; guest callback вызывается только отдельной демонстрационной кнопкой. Секреты в JSON скрыты.

`make client-test`: 197 passed, 2 failed; 24 suites passed, 1 failed. Ошибки в `BabylonClient.test.ts`: polling/retry fixtures не содержат добавленные параллельной работой `taskTitle`/`taskTarget`. См. `client-unit.log`. Это не успешная полная приёмка.

`npm --prefix client run check`: снимок интеграционного состояния в `client-check-integration.log`: 4 ошибки вне принадлежащих этому исполнителю файлов — App/Settings exact optional prop, App/WorldMap peers, BabylonClient fixture, playwright.ui.config webServer. Две предупреждавшие разметки Login исправлены после этого снимка. Повторная непосредственная компиляция `Login.svelte` и `EntrySetup.svelte` через Svelte compiler: 0 warnings у обоих.

`npm --prefix client run check:imports`: PASS, 120 modules/360 dependencies (`client-imports.log`).

`git diff --check -- client/src/ui/entry.css client/src/ui/Login.svelte client/src/ui/EntrySetup.svelte`: PASS. Итоговые build/type/unit/browser gates после интеграции остаются задачей основного исполнителя.

## Оставшиеся отличия от художественного концепта

- Фон — плоская статичная SVG-иллюстрация, не 3D-рендер. Освещение, тени, масштаб геометрии, материалы, пальмовые листья и детализация жителей заметно проще; ракурс/позиции объектов и цветовые переходы отличаются.
- Жители — малые декоративные фигуры в светлых шапочках. Они не обозначают реальные NPC или игроков. Фигура с рюкзаком на фоне улицы также декоративна, а не текущий серверный облик.
- Панель теперь имеет светлую фаску, сколы, ромбы, верхние треугольники и центральную охристую эмблему. Вырезы/эмблема и локальная системная типографика приблизительны, не идентичны арту.
- Вход по последнему решению пользователя имеет реальные вкладки/пароль/глаз и обязательные `loginPassword`/`register` callbacks. Дополнительный явно обозначенный guest demo и пояснение делают панель выше концепта. Самостоятельного успеха, password storage или guest fallback у основной формы нет.
- Указатель сохраняет отдельное подтверждение «Далее: языки» и выбор 2–4 участников по фактическому контракту; этих дополнительных элементов нет на track.png. Стрелки, мятная двойная рамка и внешнее клавиатурное выделение теперь различимы.
- На узких экранах фон обрезается по cover, поэтому боковые лавки могут быть не видны. На коротких экранах нужна вертикальная прокрутка. Художественное совпадение и общая TASK-044 приёмка не объявляются завершёнными.
