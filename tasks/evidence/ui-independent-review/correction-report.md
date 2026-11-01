# Независимая повторная проверка UI — correction

## Решение

**Полная приёмка не подтверждена.** Проверенный target — `index-zupTnY5d.js`, CSS `index-qM6L3C1v.css`, настоящий сервер `http://127.0.0.1:4387`. Baseline `4587fa1` / `index-Bb8RXsDf.js` сохранён отдельно. Позднее уведомление826c50 относится к историческим логам другого bundle, не к текущему target.

R-01–05 исправлены в проверенном scope. R-06 не повторился в реальных online focus/ACK наблюдениях; сроки и local-ветвь остаются отдельными незакрытыми условиями. Найдены **R-08/P2**: Español HUD на390 перекрывает языковой текст; **R-09/P2**: chat-seeded dictionary самостоятельно стирает настоящий ручной перевод после завершённого suggest. Сохраняются **V-01b/P3** — две смещённые стойки entry composite — и **P3 cloth dots** с неизвестной причиной. Утверждённую V4 геометрию не переоткрываю.

Этот документ фиксирует решение по замороженному correction, а не DONE TASK-048. Пока текущая финальная word/chat попытка и cleanup не завершены, действует GPU hold. Окончательное освобождение фиксируется только отдельным `GPU-CORRECTION-RELEASED.md`.

## Метод и доказательства

- Только `tasks/evidence/ui-independent-review/`: scripts, logs, JSON, настоящие PNG и CPU-компоновка пар. Implementation/spec/task metadata/dist/public не изменялись.
- Viewports **1622×970,1280×800,390×844,640×480**, DPR1. Chromium `/usr/bin/chromium`, headless, `--enable-unsafe-swiftshader`. Это описание среды, **не** доказанная причина failures.
- Один отображаемый browser client. Не более одного настоящего authenticated Socket.IO peer одновременно. Последовательный outsider — не второй отображаемый LAN-клиент.
- Настоящие password register/login/logout, profile, GLB HTTP, equipment ACK, Babylon actions и peer inputs. Нет fixtures, подмены ответов, application-state/DOM-state injection, fake позиций/слов/сообщений/групп, force clicks или автоматического Pointer Lock.
- Только явные UI Start/resume/retry. Первый быстрый I отправлен после настоящего capture event, не вызывает capture сам. Trace и hit-test читают реальные DOM/events.
- Строгие5s неуспехи сохранены. Наблюдения45s и event/readiness ожидания90s не превращают их в pass. Transport7500ms применялся только к pending focus cases; application10s timeout не менялся.

Основные файлы:
- `baseline-report.md`, `baseline-comparisons.html` — исходная версия и reviewer errors baseline.
- `correction-entry-avatar-review.md` — ENTRY/AVATAR и R-01–05.
- `correction-r06-observation.md` — fast I, delayed focusout, реальные pending ACK/выбор фокуса/новые modal.
- `correction-new-findings.md` — R-08, V-01b и local-host blocker.
- `correction-r09-seed-draft.md` — изолированная повторная потеря manual draft с trusted input и read-only временной шкалой.
- `correction-deadline-observations.md` — строгие failures, без переименования в pass.
- `correction-comparisons.html`, `correction-pair-index.json`, `correction-pairs/` — парные PNG; исходные PNG неизменны.

## Решения по дефектам baseline

| ID / серьёзность | Требования | Независимое решение |
|---|---|---|
| R-01 / P2 | ENTRY-002/004 | Исправлено на4 размерах: формы имеют ограниченную собственную прокрутку; gear доступен и не закрыт формой. |
| R-02 / P2 | AVATAR-004, ENTRY-002 | Исправлено: одна видимая копия chrome находится внутри native chooser; реальные Settings работают до/после preview rotation. Выбор/угол сохраняются. |
| R-03 / P2 | ENTRY-002/004/011–013 | Исправлено: mode/team/languages gear работает, draft/stage/языки/размер сохраняются после закрытия Settings. |
| R-04 / P3 | ENTRY-004 | Исправлено: закрытие первых Settings возвращает фокус доступному opener, не BODY. Проверено на4 размерах. |
| R-05 / P2 | AVATAR-006–008/012 | Исправлено: chooser390 не имеет прежнего горизонтального overflow340/478; вертикальная прокрутка реальна. Supplement проверяет исходный верх390/640 и native radio ArrowRight/Tab/Enter. |
| R-06 / P2 | HUD-006–008/010, UI-002 | Online поведение исправлено в наблюдениях: fast I81,8ms, delayed samples, real equip ACK200, второй I, pending/default/user-focus/Map/Settings. **Не** закрывает5s mouse/deadline; local `Ваша сумка` не упражнена из-за host404. |
| R-07 / P3 | HUD-012/014/016/020 | Наблюдаемые иконки карты/словаря/чата теперь читаемые SVG/обычные поддерживаемые символы, не прежние glyph rectangles. Полное mouse/deadline прохождение окон из этого не следует. |

52 PNG static-flow: `correction-static/`, JSON `correction-static-results.json`;13 состояний на каждый viewport.11 PNG actual GLB chooser: `correction-avatar/`, JSON `correction-avatar-results.json`. Supplement: `correction-supplement-results.json`, `correction-supplement/chooser-top-{390x844,640x480}.png`. Его AVATAR keyboard часть успешна: initial ready2794ms, ArrowRight последовательно Nic/Dan/Ksu/Lukas, Enter сохраняет реальный Lukas, ACK200, logout204. Ошибка последующей local-загрузки не превращает эти пройденные действия в дефект chooser и не даёт local pass.

### Новое R-08 / P2

HUD-002/003/007, S1/S7: на390×844 с настоящим сохранённым Español header-actions переходит на вторую строку, а task chip остаётся на фиксированной высоте. Языковой текст визуально закрыт.

`correction-final-observation/hud-390x844.png`; контроль `hud-640x480.png`, `hud-1622x970.png`. Read-only proof `correction-word-chat-completion-joined-results.json`: language `(144.984,74,170.016,44)`, task `(28,92,298.391,49)`, вертикальное пересечение26px. Hit-test центра возвращает language: **блокировка клика не доказана**, претензия — скрытая подпись/выбранный язык. Это впервые обнаружено в correction с Español; эквивалентный baseline390/Spanish не снимался, поэтому регрессию не утверждаю.

### Новое R-09 / P2

HUD-007/014–016/018, BABEL-021–023: после настоящего `В словарь` для входящего Hola и завершённого suggest200 пользовательский перевод сам становится пустым. В `correction-seed-draft-audit-results.json` native trusted input фиксирует A126908.2ms и B147106.4ms. B реально присутствует в151372.9ms, пуст в153207.5ms; фокус всё время `Перевод`. Probe не отправляет форму и не меняет другое поле. Это data-loss, не ошибка Pointer Lock/missing peer join и не доказанная GPU/GLB проблема.

`seedDraftLost:true`; `ok:true` у probe означает завершённое измерение **дефекта**, не успешную работу приложения. Actual PNG `correction-seed-draft-audit/chat-seed-draft-after-idle-1622x970.png`; подробности и ожидаемое/фактическое — `correction-r09-seed-draft.md`. Эквивалентный baseline с паузой не снимался: regression не утверждается.

## Все11 reference: визуальный вывод

| Reference | Actual correction / вывод |
|---|---|
| `autorize.png` | `correction-static/login-1622x970.png`: низкополигональный baked город, пергамент, локальная графика и настоящая форма вместо плоского baseline. Demo warning сохранён отдельно. Не pixel-identical. |
| `track.png` | `correction-static/friends-1622x970.png`, `mode-390x844.png`: выбор/иерархия/вывески существенно лучше. **V-01b/P3:** видны UI-стойка и смещённая более широкая bake-стойка; reference содержит одну. Не закрываю V-01 полностью без коррекции или явного принятия. |
| `oblik_page.png` | `correction-avatar/lukas-1622x970.png` и narrow supplement: настоящая3D сцена и4 настоящих портрета, responsive scroll, не bitmap-контролы. |
| `lukas.png` | Actual фронтальный `correction-avatar/lukas-1622x970.png`: круглые объёмы/очки/волосы утверждённой V4; остаточные светлые точки на ткани. |
| `nic.png` | `correction-avatar/nic-1622x970.png`: V4 фактический GLB/портрет. Geometry approval сохранён. |
| `dan.png` | `correction-avatar/dan-1622x970.png`: V4; дополнительно настоящий live save Dan подтверждён ACK и реальным peer. |
| `ksu.png` | `correction-avatar/ksu-1622x970.png`, rotated image: V4 перед/зад и волосы, настоящий mouse/keyboard rotation, Settings не сбрасывает выбор/угол. |
| `inventar.png` | `correction-world-observation/inventory-1622x970.png`, narrow images: узнаваемые иллюстрации Bag/Jug, выбор, детали и реальные empty cells. Не рисуются фиктивные apples/quantities из reference. |
| `map.png` | `correction-world-observation/map-1622x970.png`: вместо плоской схемы — изометрические реальные authored footprints/пальмы, читаемые подписи/легенда/метки. **V-03 частично:** Fountain/Gates отсутствуют в runtime world, см. вопросы. На390 применяется горизонтальная карта600px, не общий document overflow; native ArrowRight и «К игроку» проверены. |
| `dictionary.png` | Настоящие owner слова/примеры/заметка, learned tab и server persistence; исходные изображения перечислены в pair index. V-04 панель/инструменты/иконки заметно ближе. Не подменяются counts/слова из reference. |
| `chat.png` | Настоящий populated chat, translated peer слева, native own справа, delivery status и свой stone. `chat-stone-1280x800.png` показывает реальный вырезанный штрих, не reference рисунок. Initials вместо ассоциированных3D portraits остаются открытым вопросом, не придуманными avatar IDs. |

**V-02:** узкое геометрическое одобрение V4 остаётся в `avatar-v4-art-approval.md` и `avatar-v4-approval-receipt.json`:13 targeted views, неизменная neutral lower-body evidence. Каждый served `/api/avatar/models/{lukas,nic,dan,ksu}.glb` в correction independently совпал с approved byte/SHA256; также проверены повторные загрузки. Full hashes и response records — `correction-avatar-results.json`, `correction-entry-avatar-review.md`. Это не автоматическое одобрение8-view render pipeline или runtime RAM/FPS.

**Cloth dots/P3:** точки видны на настоящем preview. Причина не доказана. Нельзя назначить виновником GPU, тени, геометрию, normals или предлагать переоткрытие утверждённых лиц/волос/рук без отдельного actual defect evidence.

## Настоящая authority / сохранение

- Основной игрок `p_d5w1o440fuyfxno4`, настоящий peer `p_yy2bt5jku8ez3lx0`, общая party `b_s8rzrbswf058jfhn`. Peer сначала читает profile/state, не делает повторный enroll.
- Equip/Jug, Bag и4 pending случая получили200. `responseStillPending:true` доказан реальным HTTP response counter, а не предположением. Natural второй I действительно закрывает Inventory в Pause, без автоматического capture.
- Во время Map W600ms не двигает основного игрока: обе серверные выборки `(0,0,-26)`. Реальный peer получает actual manifest и9 prepared chunks с проверкой bytes, затем проходит20 настоящих inputs: `(0,0,8) → (3,0,8)`. Map показывает актуального peer, zoom и center меняют настоящий viewBox.
- Outsider `p_6wop725kkae0zzvn` существует в server snapshot, но относится к другой party `b_9lf05xhwrhf3ruuo`, не основной. Его имя отсутствует в actual Map SVG (`map-real-outsider-excluded-1280x800.png`). Это реальная отрицательная проверка, не повторное подключение своего teammate и не аппаратный LAN тест.
- Basket/Jug созданы UI; note/example, learned, edit и search подтверждены реальными word-save/word-learn200. Peer state.words пуст: owner words не появились у другого участника. Basket learned/note снова видны после настоящего password relogin: `correction-final-observation/dictionary-persistence-1280x800.png`.
- Language action200 действительно сохраняет `ru→es`. Новый login показывает Es; HUD/task реально Español/«Las cabras del pastor». Failed5s response waiter не отменяет полученный и сохранённый HTTP200, но остаётся failed case.
- Настоящий joined teammate отправил chat200 при сохранённом Español основного игрока. Actual `correction-word-chat-completion-final/chat-es-new-old-preserved-1622x970.png` показывает новое Hola; `oldMessagesStable:true` подтверждает неизменность прежних records. Собственные сообщения при этом правильно сохраняют native source.
- Live Dan200 виден реальному protocol peer как `renderable.assetId:avatar-dan`, `equipment.tool:jug`. После свежего password login read-only authenticated GET200 `/api/avatar`=`dan`, `/api/equipment`=`jug`: `correction-persistence-http-readback.json`. Реальный rendered Dan показан в `correction-final-observation/hud-1622x970.png`.
- Это logout/relogin persistence, **не** перезапуск сервера. SQLite restart во время freeze не проводился.

## Строгие сроки и границы

`correction-world-results.json`: initial readiness5042ms fail; actionable Start5015ms fail. После более длинного retry capture получен за3271ms; это **не** pass первых двух gates. Отдельные реальные visible/enabled/stable pointer actions также не завершились за5s. Отдельный keyboard diagnostic тоже не стал полным успешным5s run.

В наблюдательных потоках встречались failed capture после явного Continue/Start и затем явный успешный retry. Причина не доказана; не списываю это на конкретное оборудование или CSS. Нельзя незаметно заменить требуемые5s на45s/90s.

Frozen **browser15/47, render4/8** остаются открытыми. Свежий полный canonical47/8 независимым reviewer не запущен/не принят. Main CPU log `../ui-redesign-2026-07-02/correction-cpu-status.log` и assets receipt подтверждают исполнителем завершённый CPU цикл; заявленные289 client /160 server tests не заменяют этот visual/browser verdict. Declared market accounting66,347,040/67,108,864 bytes (margin761,824) — не actual JS/GPU/RSS/heap measurement.

Не проверены hardware/LAN/Wi-Fi-off4-player сценарий, MLX/Ollama/real AI, RAM≤4,000,000,000, FPS/P95/heap/draw-call квалификация, движения/door collisions всех4 внешностей во втором отображаемом клиенте. Local shortcut заблокирован намеренным404 public `/maps` на4387; metadata не должно записывать его pass.

## Ошибки reviewer, не продуктовые дефекты

Сохранены все ранние attempts. В частности: hidden radio `.check()` вместо настоящей карточки; старый capture regex `/avatars/`; repeated-enroll CONFLICT с downstream FORBIDDEN; disabled saved-mode radio; orphaned response waiters; прежний baseline map PNG оказался Pause (корректный — `fresh-world-final-baseline/map-1622x970.png`). `historical-path-map.json` сохраняет связь старых JSON paths с attempts.

В world observation программа называла dictionary шаг `...delete`, но не удаляла запись. Chat-seed save не подтверждён actual POST/появлением слова; последующий поиск `Buy dates` и640 `Моя заметка` в оставшейся форме были ошибочными предпосылками. Нельзя записывать эти названия/PASS строки как доказательство удаления/добавления.

`correction-final-observation` WebSocket-only monitor пропустил initial joined через polling и сохранил entity=null. Это не доказательство неправильного Dan; реальный protocol peer и authenticated GET подтверждают Dan/Jug. Ожидание Hola от **собственного** сообщения также неверно: HUD-018 требует свой native source. Проверка нового foreign translation требует сообщения реального peer.

Последовательные completion attempts сохранены отдельно: первый failed capture; второй peer без game join получил корректный403; третий mouse click dock при активном Pointer Lock ожидаемо перехватывает canvas. Это **не** неисправность dock: сначала нужен явный Escape/I. Финальная completion попытка делает настоящий peer join и явный unlock: реально доказывает Hola на новом языке и неизменность старых delivery records. Но её seeded word-save90s снова не появился. Не объявляю это pass. Следующий отдельный read-only audit доказывает R-09 без submit: введённое поле действительно стирается. Поэтому предыдущие optimistic labels не могут скрыть настоящий UI дефект.

## Открытые вопросы

1. HUD-011 требует «Фонтан»/«Ворота», но у настоящей рыночной сцены нет подтверждённых таких landmarks. Нельзя выдумывать их координаты. Нужны согласованная world работа либо утверждённое изменение требования; reviewer спецификации не редактировал.
2. Что должен означать portrait в HUD/chat: актуальный avatar online entity, исторический avatar сообщения или fallback? Соответствие не надо выдумывать. AVATAR/HUD требования требуют решения по association и offline/history случаю.
3. Какой поддерживаемый frontend host нужен local-only UI? На4387 local root `/maps` намеренно запрещён. Нельзя обходить auth, выдавать LocalSession за server/AI или молча менять target.
4. Dictionary hotkeys, расширенные capacity/transfer/NEXT hands не определены достаточно для новой функциональности в этой проверке. Нельзя добавлять фиктивные серверные данные ради сходства.
5. Точное происхождение cloth dots и принятие остаточной art variation требуют отдельного решения/evidence. Утверждённая V4 geometry и declared memory сами по себе не закрывают performance/render qualification.
