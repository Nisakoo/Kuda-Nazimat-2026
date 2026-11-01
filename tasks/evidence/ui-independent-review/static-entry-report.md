# Независимая проверка статических ENTRY — текущий production

## Вывод

**R-01 воспроизведён; R-03 подтверждён на всех 4 размерах.** Это реальные дефекты доступности настроек, а не только художественные отличия. Полная оценка аватаров/мира ещё запрещена до отдельного GO.

Независимый запуск: `2026-11-01T01:11:20.023Z` — `01:11:48.301Z`, `http://127.0.0.1:4387`, системный headless Chromium, DPR 1. Прочитан фактический script URL: `/assets/index-Bb8RXsDf.js` во всех состояниях.

Команда: `node tasks/evidence/ui-independent-review/static-entry-review.mjs`. Результаты: [JSON](static-entry-results.json), [stdout](static-entry-run.log), [скрипт](static-entry-review.mjs). Все 4 UI-прохода завершены; это результат именно статического исследовательского скрипта, не финальная UI-приёмка.

Во всех 40 fresh кадрах: **canvas 0, WebSocket 0, Pointer Lock отсутствует**, console/page errors 0. Переходов в мир, avatar preview, enroll, регистрации submit и Settings Apply не было. Авторизация — только явно обозначенный guest через реальный UI/сервер. Каждый проход завершён Escape → режим → Escape → настоящий `/api/auth/logout`, HTTP **204**, пустое имя в форме. Скрипт не делает прямых API-вызовов и не подменяет DOM/данные.

## R-01 · P2 · ENTRY-002, ENTRY-004 — mobile gear закрыт табличкой

**Воспроизведение:** открыть текущий production при 390×844; посмотреть и нажать центр кнопки настроек `(331,787)`.

**Ожидается:** шестерёнка видна и открывает настройки.

**Факт:** панель скрывает шестерёнку; `elementFromPoint(331,787)` возвращает `section.entry-login`. Настройки после реального pointer click не открываются. Fresh registration сохраняет то же перекрытие.

- [Fresh login](fresh-static/login-390x844.png).
- [После реального клика](fresh-static/login-gear-click-390x844.png).
- [Fresh registration](fresh-static/registration-390x844.png).
- [Парный PNG: reference слева, current справа](R01-reference-current.png).

**Клавиатура:** настоящий последовательный Tab достигает кнопки «Настройки»; JSON `Login actual Tab traversal` это фиксирует. Значит, кнопка не disabled/inert на login, а перекрыта визуально и для pointer. Открытие через Enter в этом проходе не проверялось.

## R-03 · P2 · ENTRY-002, ENTRY-004, ENTRY-011–013 — видимая gear вне active native modal

**Воспроизведение:** реальный guest → режим; нажать видимую root gear. Затем выбрать режим стрелкой/Enter → языки; повторить нажатие. Размеры: 1622×970, 1280×800, 390×844, 640×480.

**Ожидается:** видимые настройки доступны pointer и Tab; возврат из настроек сохраняет стадию/черновики и возвращает фокус. Последние 2 свойства проверить пока нельзя: настройки из этих стадий не открываются.

**Факт:** текущий `.entry-setup` — полноэкранный `dialog:modal`; gear находится вне него. На desktop/mobile hit-test возвращает dialog, а не gear; реальный pointer click не открывает настройки. Tab 16 раз в mode и 12 раз в languages циклически обходит элементы активного окна, но никогда не достигает gear. Это корректная native inert-механика, применённая к неверно размещённому видимому control. Повышения z-index недостаточно.

При 640×480 root gear частично совпадает с «С друзьями»: hit-test возвращает `label.entry-choice`, pointer click переводит фокус в radio. Следующий Tab попадает в селектор `2/3/4`. Значит, нажатие визуальной gear может изменить выбор режима вместо открытия настроек.

- [Mode 1622](fresh-static/mode-1622x970.png), [1280](fresh-static/mode-1280x800.png), [390](fresh-static/mode-390x844.png), [640](fresh-static/mode-640x480.png).
- [Languages 1622](fresh-static/languages-1622x970.png), [1280](fresh-static/languages-1280x800.png), [390](fresh-static/languages-390x844.png), [640](fresh-static/languages-640x480.png).
- [Mode после настоящих Tab при 640](fresh-static/mode-after-tabs-640x480.png).
- [Парный PNG: reference слева, current справа](R03-reference-current.png). Визуально gear видна; её недоступность доказывают действия/JSON, не один PNG.

**Ожидаемая граница коррекции:** chrome внутри активного native dialog, без обхода native focus containment. Общий логотип/gear в EntrySetup и AvatarSelection. Сохранение стадии/режима/языковых черновиков, явный focus return после Settings должны быть отдельно перепроверены на исправленном build. Это критерии проверки, не утверждение реализации.

## R-04 · P3 · ENTRY-004 — потеря контекстного фокуса после Settings

На свежем 1622×970 **первое действие** — реальный click «Настройки». Native Settings открылось без canvas/WebSocket. После реального click «Закрыть настройки» `document.activeElement === BODY`, а не вызывающая кнопка. Состояние записано в `Settings closed without Apply`.

- [Native Settings, первое действие](fresh-static/settings-first-action-1622x970.png).

Это наблюдаемая проблема focus return. Возврат в **mode/languages** с draft пока не проверен из-за R-03; его нельзя объявить исправным или сломанным по одному login случаю.

## Другие наблюдения и границы

- Размеры текущих entry-контейнеров не имеют горизонтального overflow: scrollWidth равен clientWidth во всех сохранённых состояниях. Это не относится к ещё не открывавшемуся chooser.
- При 640×480 entry содержимое действительно скроллируется: login 752px при clientHeight 480, mode 664px, friends 774px, languages 739px. Реальный Tab/обычный locator-click прокручивают к нижним controls; screenshot до прокрутки сам по себе не доказывает недоступность.
- «С друзьями» выбирается реальной ArrowRight после фокуса radio; появляется реальный UI-селектор 2/3/4. Enter открывает языки, Escape возвращает режим. Команда/профиль не создавались.
- Наличие 3 доступных языков показано UI; persistence и новые переводы ещё не проверены, поскольку final confirm запрещён.
- Функциональные password login/register, создание pending-avatar и server capacity этим запуском не проверены.
- R-02 про chooser/logo/settings остаётся предварительным до отдельного GPU GO. Никаких выводов об исправлении chooser из static run нет.
- Все PNG `fresh-static/` — новый независимый current-build материал, в отличие от исторических `../ui-redesign-2026-07-02/avatar-*.png`.
- Парные PNG собраны CPU-only из оригиналов через `pair-png.mjs`. Слева reference, справа actual; для компоновки применён nearest-neighbour scale до общей высоты. Исходные actual PNG сохранены с настоящим viewport/DPR 1.

## Открытые вопросы

Сохраняются вопросы предварительного отчёта: фонтан/ворота против реального world, chat portraits, static/3D и время суток, ёмкость инструментов, dictionary hotkeys. Данный запуск их не разрешает.

## Не принято и следующий шаг

Полная проверка UI, моделей, серверного persistence, LAN/железа/LLM и GPU budget **не завершена**. Дождаться окончания 5425 suite и отдельного GO. Исправления R-01/R-03/R-04 требуют нового production build и независимого повторения тех же действий с before/after PNG.
