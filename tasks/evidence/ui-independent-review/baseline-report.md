# Независимая проверка UI — production baseline

## Итог

**Визуальная приёмка не подтверждена. Исправления ещё не проверены. GPU освобождён.**

Свежие independent captures выполнены на настоящем сервере `http://127.0.0.1:4387`, production `index-Bb8RXsDf.js`, baseline commit `4587fa13bd4568d997a1cae233ebea305e5da6f4`. Новые изменения рабочего дерева не считаются проверенной реализацией. Все reviewer Chromium закрыты к `2026-11-01T02:33:52.563Z`, реальные peer sockets закрыты, peer logout — HTTP 204. Основной агент может bake/publish/build/restart. Повторную проверку нужно начинать после объявления нового bundle и hashes.

[11 свежих парных сравнений](baseline-comparisons.html) · [GPU release](GPU-RELEASED.md) · [ENTRY](static-entry-report.md) · [4 GLB/chooser](avatar-baseline-report.md).

Исторический `preliminary-report.md` сохранён как предварительный срез. Его старый запрет GPU и непроверенные предположения не описывают текущий этап.

## Метод и доказательства

- Прочитаны guide/SDD, ENTRY/HUD/AVATAR/UI/CHAR и TASK-048. Действительно открыты все 11 reference PNG и все 4 свежих GLB preview; основные свежие окна/размеры и scrolled controls открыты как изображения, не только измерены DOM.
- Размеры: **1622×970, 1280×800, 390×844, 640×480; DPR 1**. Сохранены исходные размеры, качество/контент не снижались. SwiftShader — диагностический renderer, не целевое оборудование.
- Один настоящий rendered client и один настоящий authenticated Socket.IO peer. Peer регистрируется/входит, enroll/join/chat проходит через сервер. Это headless-peer evidence, **не физическая LAN-проверка и не второй rendered client**.
- Reviewer не вводил fixtures, позиции, participants, inventory или fake learned flags в DOM/app. Слова, заметки, подтверждение облика, equip, отправка своего сообщения и рисунок введены через настоящие UI-действия. Peer получил spawn/положение/appearance/equipment от сервера.
- Pointer Lock получен только явными кликами «Начать прогулку» / «Продолжить», Escape снимает его. Автоматический requestPointerLock не внедрялся.
- Исходники приложения, public models, dist, specs, task metadata reviewer не менял. Все его файлы находятся в `tasks/evidence/ui-independent-review/`.

### Точные источники

| Источник | Что доказывает |
|---|---|
| `static-entry-results.json`, `fresh-static/`, `static-entry-run.log` | Четыре entry-состояния на четырёх размерах, реальный guest, pointer hit-test, Tab, settings, logout 204; 0 canvas/0 WebSocket |
| `avatar-baseline-results.json`, `fresh-avatar-baseline/` | Новая password-регистрация, настоящие 4 GLB/portrait, selected IDs, SHA-256, responsive chooser, save Ksu |
| `world-baseline-results.json`, `fresh-world-baseline/` | Авторитетный enroll, UI-created basket/jug, note/example, learned, jug equip ACK, BODY-focus и второй I |
| `world-followup-results.json`, `fresh-world-followup/` | Успешный реальный peer, populated chat/stone/map, четыре размера, password logout/login persistence |
| `world-final-baseline-results.json`, `fresh-world-final-baseline/` | Исправленный reviewer-capture карты 1622, scroll controls 640, search/edit/delete/escaping/isolation, live Dan ACK и peer observation, language ACK |
| `world-pair-index.json`, `avatar-pair-index.json` | Пары и пути к оригинальным PNG; слева reference, справа actual |

**Ошибки reviewer-script не являются дефектами продукта:** первый world-run остановлен timeout 900s. Native Fetch `.status()` вместо `.status` сорвал подключение peer; неверный exact locator «К игроку» сорвал map-step. Сохранены исходные лог/JSON; исправленные сценарии успешно повторены. `fresh-world-followup/map-1622x970.png` ошибочно снят после повторного toggle и показывает **Pause**. Он не используется как карта: правильный кадр — `fresh-world-final-baseline/map-1622x970.png`. Статус `step.ok` не заменяет анализ содержимого capture.

## Дефекты

R-01–R-05 подробно описаны в linked reports; здесь итоговый реестр. Ни один не закрыт по source-only изменениям.

| ID / severity | Требования | Ожидание → actual | Точное evidence |
|---|---|---|---|
| **R-01 · P2** | ENTRY-002/004 | Узкая табличка не закрывает gear → login/registration 390×844 перекрывают её; реальный click попадает в entry-login, settings не открываются | `static-entry-report.md`, `static-entry-results.json`, `R01-reference-current.png` |
| **R-02 · P2** | AVATAR-004, ENTRY-002 | Logo/gear видны и доступны в chooser → отсутствуют поверх opaque native modal; root gear inert | `avatar-baseline-report.md`, `avatar-baseline-results.json`, `R02-reference-current.png` |
| **R-03 · P2** | ENTRY-002/004/011–013 | Settings доступны на mode/languages → внешний gear inert за native modal на всех размерах; на 640 click по visual позиции выбирает friends | `static-entry-report.md`, `R03-reference-current.png` |
| **R-04 · P3** | ENTRY-004 | Закрытие Settings возвращает invoker → после первого action Settings на 1622 focus BODY | `static-entry-report.md`, `static-entry-results.json` |
| **R-05 · P2** | AVATAR-006–008/012 | Shrinkable mobile chooser → 390 viewport: clientWidth 340 / scrollWidth 478, обрезаны правая колонка и rotation control; vertical scroll не решает horizontal clipping | `avatar-baseline-report.md`, `R05-reference-current.png` |
| **R-06 · P2** | HUD-006–008, UI-002 | Фокус находится в открытом inventory; второй I закрывает его → в keyboard-open/equip сценарии focus BODY, второй I оставляет тот же modal открытым | ниже |
| **R-07 · P3** | HUD-012/014/016/020 | Видимые локальные symbols/actions → перед «Добавить» и «К игроку» виден missing-glyph rectangle; edit/delete/draw не имеют требуемых pencil/trash icons | ниже |

### R-06 — focus loss, а не неподтверждённая причина

**Ожидание:** native dialog удерживает фокус, keyboard I / Esc соответствует подсказке. Пока открыто окно, движение и Pointer Lock выключены.

**Воспроизведение:** password world → явный Start → I → выбрать «Кувшин» → «Взять в руки» → реальный `/api/equipment` ACK 200 → второй I.

**Actual:** `secondICloses:false`; в `beforeEquip`, `afterEquipClick`, `afterEquipAck`, `afterSecondI` active `BODY`, `inDialog:false`, Pointer Lock false. Inventory остаётся `:modal`, Pause не открыт. Фокус потерян **уже до equip**, поэтому нельзя объявлять disabled-button единственной причиной. После Escape/явного Resume обход работает. Прямое открытие inventory через dock в дополнительном run удерживает focus на close button, и I закрывает его: дефект зависит от пути входа, это не утверждение «I сломан всегда».

**Evidence:** `world-baseline-results.json` → `beforeEquip/afterEquipClick/afterEquipAck/afterSecondI/secondICloses`; `fresh-world-baseline/inventory-after-equip-1280x800.png`, `inventory-second-I-1280x800.png`; `baseline-R06-reference-current.png`. Контрпример правильного dock-path — `world-final-baseline-results.json` → `beforeI/afterI`.

**Повторная проверка исправления:** сначала I из захваченного мира, затем pending/ACK и второй I; Tab/Shift+Tab; disabled/removed focused action; закрытие и доступный invoker; Settings/новый modal не получают focus steal; пользовательская смена фокуса до ACK сохраняется. Source fix не доказывает эти случаи.

### R-07 — symbols и action icons

**Evidence:** `fresh-world-followup/dictionary-390x844.png`, `map-390x844.png`; `fresh-world-baseline/dictionary-1622x970.png`; `fresh-world-final-baseline/chat-controls-640x480.png`; `baseline-R07-dictionary-reference-current.png`, `baseline-R07-map-reference-current.png`.

**Actual:** тексты и targets сохраняются, поэтому P3, не функциональная блокировка. Unicode `＋` / `⌖` отображаются квадратиками в данном offline окружении. У edit/delete/stone-draw текст есть, reference icons отсутствуют. Нужны локальные воспроизводимые SVG/icons или подтверждённый офлайн glyph, не внешний font CDN.

## Художественные отличия

- **V-01 · P2 · ENTRY-001–003/006/011:** flat SVG entry против объёмного low-poly города, мягких света/теней и перспективы refs. Обязательные мотивы присутствуют; static SVG сам по себе не запрещён. Художественное соответствие не доказано тестами. Пары R01/R03/R02 и entry report.
- **V-02 · P2 · AVATAR-009, CHAR-002:** свежие 4 реальные GLB сохраняют необходимые волосы/очки/цвета/бантик/светлые брюки/ботинки без шапочек. Но лица/руки/кисти шире и короче, волосы более острые и пластинчатые, preview меньше/жёстче reference. На ткани видны светлые диагональные точки; причина не диагностирована. Пары `baseline-{lukas,nic,dan,ksu}-reference-current.png`.
- **V-03 · P2 художественное · HUD-005/011–012:** map честно показывает реальный рынок и server positions, но плоская редкая схема с крошечными labels существенно отличается от крупной заполненной иллюстрации. На 390 подписи мест и имена почти не читаются; простое выдумывание landmarks недопустимо. Пара `baseline-map-reference-current.png`, actual `map-390x844.png`.
- **V-04 · P3 художественное · HUD-005/008/015/017/020:** палитра/структура/dock узнаваемы, но шрифтовая пластика, flat panels, декоративные corners, avatars-initials и tool drawings отличаются от мягких faceted refs. В плотных окнах disclosure и верхняя часть занимают много места; на 640 initial viewport не показывает controls. **Это не доказанная недоступность:** реальные scroll/Tab доводят до note/actions/compose/stone; scrolled captures сохранены. Не записываем below-fold как блокировку.

## Функциональная матрица — что действительно подтверждено

| Область / IDs | Независимое evidence и граница вывода |
|---|---|
| ENTRY-001–013 | Свежие 4 состояния × 4 размера, first-action Settings, actual guest login/logout; отдельная настоящая password registration и последующий password login; saved task mode/languages не пере-enroll. Не все negative auth/full/busy/persistence settings сценарии повторены. |
| AVATAR-001–008/012–015 | 4 GLB radio selections, previews/portraits, responsive dimensions и UI save Ksu. Позднее Settings → appearance → Dan → actual `/api/avatar` 200; Settings восстановлены. Headless peer получил `renderable.assetId:avatar-dan`, `equipment.tool:jug`. Не второй rendered LAN-client. |
| AVATAR-009–011 / CHAR | Свежие actual 4 model PNG, сохранены hashes; мировые Ksu и Dan. Полный walk/idle/360°, все 3 освещения и каждому tool attachment по 4 моделям не приняты. Screenshot со спины и protocol tool ACK не заменяют close-up визуальное доказательство jug в руке. |
| HUD-001–007 / UI-002 | HUD на 4 размерах, настоящие переключения dock, Esc/Resume, native modal и Tab samples. Под inventory удержание W 800ms не изменило позицию в наблюдении peer: `(0,0,-26)` до/после, zero movement. R06 воспроизведён, поэтому blanket keyboard acceptance нет. |
| HUD-008–010 | Server inventory bag/jug, selected cards, empty contents, UI equip ACK 200. В peer snapshot реальный jug; после password logout/login он сохранён. Не выдаём protocol observation за rendered-peer screenshot руки. |
| HUD-011–013 | Реальные own `(0,-26)` и task peer `(0,8)` positions + goal; zoom и center actual buttons. Карта на 4 размерах, верный 1622 capture отдельно. Не выполнена динамическая трасса перемещения peer и отрицательная проверка outsider. |
| HUD-014–016 | UI create basket/jug с examples/notes; note save, learned count 1/1, password logout/login сохранил basket learned+note/example. Search no-match, edit, создание literal `<b>safe</b>` без HTML-интерпретации и delete через UI. Реальный peer state.words пуст; это 2-account isolation sample, не полный security audit. |
| HUD-017–020 | Реальный task peer написал «Купи финики», клиент показывает `Buy dates`, machine translation, delivered; собственное «Привет» на родном с delivery; реальный UI stone polyline доставлен и видим после scroll. Это `backend=test` с видимым честным disclosure, не LLM acceptance. Add-to-dictionary из входящего сообщения, untranslated/error/retry paths отдельно не завершены. |
| HUD-003 | Реальный UI native ru / learning es, action `languages` HTTP 200 с `profile.learning:es`; старые `Buy dates` / `Привет` в ACK не переписаны. Новое сообщение peer принято сервером, но его новый перевод/отрисовка не подтверждены: final helper `changedLanguage/messagesAfterLanguage` снят до актуального poll. Использовать настоящий ACK в `events`, не этот stale convenience field. Полная S7-приёмка остаётся открытой. |

### Persistence и cleanup

`world-followup-results.json.persistenceState` после настоящего logout/password login: learned basket, example/translation/note, unlearned jug, task party и progress сохранены. Реальный `/api/equipment` вернул jug; profile avatar Ksu сохранялся, затем через UI изменён на Dan. У последнего аккаунта learning language теперь es, jug в руках, Dan; словарь изменён настоящими UI действиями. Эти факты нужны для correction-run, чтобы не повторять новый enroll и не создавать дубликаты.

Все 3 private world браузера завершены; первый timeout сохранён, последующие успешные cleanup/login/logout выполнены. Последние peer revokes — 204. Если понадобится новый baseline для readiness, начинать как отдельный измерительный run без screenshot внутри интервала.

## Validation и ограничения приёмки

Основной агент передал frozen результаты: browser **15 passed / 32 failed**, render **4 passed / 4 failed**. Reviewer их не переписывает. Дополнительные диагностические сценарии с timeout 90s **не превращают обязательные 5s readiness в pass**. Поля `initialLoadingMs` первого/второго review-run включают intervening screenshots/peer setup и не являются чистым readiness benchmark. Причина failures не приписывается GPU без отдельного evidence.

Нет проверок 4 физических LAN-устройств, Wi-Fi-off, целевого GPU/аппаратного Pointer Lock, MLX/Ollama, FPS/P95/heap/draw limits. Headless peer/SwiftShader и backend=test этих acceptance gates не закрывают. Negative auth, all team sizes, dynamic outsider-map isolation, chat add-word/error/retry, полный CHAR timing/light/tool matrix остаются явно непроверенными независимо. Поэтому отчёт охватывает весь визуальный scope, но не утверждает выполнение каждого acceptance scenario.

## Открытые вопросы

- Reference «Фонтан»/«Ворота» и соответствующий task-step отсутствуют в утверждённом world. Нельзя рисовать вымышленные coordinates/landmarks как server truth.
- Семантика портрета peer в чате и связь с реальным выбранным обликом открыты; initials не равны fictional verified portrait.
- Дневной static entry и закатный world имеют разные художественные основания; tests не решают это согласование.
- Reference «Мира», счёт 1/3, набор предметов/слов — примеры, не повод подменять server state.
- Tool capacity/content transfer и NEXT unified hands не определяются тремя пустыми cells.
- Dictionary hotkeys конфликтуют с I-inventory; новое решение не придумывается в review.
- Не выполненные hardware/LAN/LLM/performance проверки не считаются passing.

## Следующий gate — независимая коррекция

После bake/publish/build/restart основной агент должен назвать bundle, model hashes и применённые IDs. Повторить R01–R07 и V01–V03 на новых actual renders, сохранить отдельные `after` PNG и before/after пары. Особое условие R06 — initial keyboard opening, ACK focus recovery без перехвата Settings/другого modal/нового пользовательского focus. Не закрывать IDs только unit-тестами, исходным кодом или пересъёмкой старого dist.
