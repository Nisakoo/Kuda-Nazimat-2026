# Независимая baseline-съёмка 4 обликов — текущий production

## Вывод для координации

**Все 4 baseline текущих GLB сохранены в настоящем chooser.** Основной агент может начинать согласованные изменения моделей. Reviewer не менял source, dist или GLB.

Сервер `http://127.0.0.1:4387`, bundle `index-Bb8RXsDf.js`. Новая настоящая password-регистрация через UI, затем обязательный выбор облика. Каждый ID выбран настоящим radio-click; подтверждение ждало loaded preview, присутствовали все 4 portrait img. Никаких fixtures, DOM/API injection, reduced DPR/контента или automatic Pointer Lock. Системный Chromium/SwiftShader, headless, DPR 1.

- [Lukas](fresh-avatar-baseline/lukas-1622x970.png)
- [Nic](fresh-avatar-baseline/nic-1622x970.png)
- [Dan](fresh-avatar-baseline/dan-1622x970.png)
- [Ksu](fresh-avatar-baseline/ksu-1622x970.png)

Все 4 PNG открыты и просмотрены reviewer. [JSON](avatar-baseline-results.json) содержит timestamps, SHA-256 всех 4 исходных GLB, фактические selected IDs/bundle/viewport/modal, requests и ошибки. [Скрипт](avatar-baseline.mjs), [stdout](avatar-baseline-run.log). Отдельно сохранены current chooser/control кадры 1280×800, 390×844, 640×480.

В конце Ksu подтверждён реальным UI/server save, открыт режим; Escape вызвал настоящий logout 204. В мир baseline-аккаунт не входил. Только 1 preview canvas, Pointer Lock отсутствовал.

## R-02 · P2 · AVATAR-004, ENTRY-002 — теперь подтверждён свежими кадрами

Ожидаются логотип слева сверху и настройки справа снизу. В текущем chooser оба элемента отсутствуют визуально. Внешний rootGear существует, но hit-test его точки возвращает native dialog, не кнопку; он вне native modal. Это не прежний/компонентный кадр.

[Парный PNG](R02-reference-current.png): `specs/images/oblik_page.png` слева, fresh Lukas chooser справа.

## R-05 · P2 · AVATAR-006–008, AVATAR-012 — chooser обрезан при 390×844

Актуальный native dialog: **clientWidth 340, scrollWidth 478**. Правая колонка карточек и правая стрелка preview обрезаны. У нижнего текста нет полного видимого конца. «Продолжить» можно достигнуть вертикальной прокруткой, но она не исправляет горизонтальный overflow.

- [Исходный fresh mobile chooser](fresh-avatar-baseline/chooser-390x844.png).
- [Fresh после реального scrollIntoView подтверждения](fresh-avatar-baseline/chooser-controls-390x844.png).
- [Парный PNG с референсом](R05-reference-current.png).

При 1280×800 horizontal overflow нет: 1062/1062. При 640×480 — 590/590, но 971px содержимого при clientHeight 428; нижние actions достижимы прокруткой. Это не проверка доступности каждого элемента Tab, она остаётся следующему проходу.

## V-02 · подтверждённое художественное расхождение · AVATAR-006, AVATAR-009

Обязательные отличительные цвета/очки/волосы/пояса/манжеты/бантик у всех 4 видимы. Однако reference имеет более вытянутый силуэт/руки, мягкое лицо и проработанную причёску; current выглядит шире/короче, с крупными геометрическими прядями и резкими гранями лица. Current preview заметно меньше reference относительно высоты таблички, лицо/волосы менее выразительны. На tunic видны мелкие светлые точечные диагонали; их причина не установлена, нормали/мерцание по статичному кадру не диагностируются.

Парные PNG:
- [Lukas](baseline-lukas-reference-current.png)
- [Nic](baseline-nic-reference-current.png)
- [Dan](baseline-dan-reference-current.png)
- [Ksu](baseline-ksu-reference-current.png)

Каждая пара содержит character reference слева и **полный actual chooser** справа, не вырезанную/подставленную модель. Исходные PNG сохранены; компоновка CPU-only через `pair-png.mjs`, без изменения приложения.

## Открытые вопросы

Static/day entry против sunset world и chat portrait semantics остаются открытыми. Baseline не доказывает 360°, качество всех поз, walk плавность, held-tool clipping, live peer смену облика, performance или hardware/LAN.

## Следующий этап

Свежая независимая world/HUD проверка, populated chat/dictionary/inventory/map, реальные server actions и headless peer, focus после equip pending/ACK и второе I, все 4 viewport. Этот файл фиксирует готовность **baseline**, не полную приёмку.
