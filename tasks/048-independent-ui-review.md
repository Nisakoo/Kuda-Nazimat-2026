---
id: TASK-048
type: implementation-task
status: in-progress
spec: ../specs/client-auth-screens.md
requirements: [ENTRY-001–013]
depends_on: [TASK-073, TASK-074, TASK-075, TASK-076, TASK-077, TASK-045, TASK-046, TASK-047]
related:
  - spec: ../specs/client-game-hud.md
    requirements: [HUD-001–020]
  - spec: ../specs/client-avatar-select.md
    requirements: [AVATAR-001–015]
  - spec: ../specs/client-input-ui.md
    requirements: [UI-001, UI-002]
---

# Независимая оценка UI и устранение подтверждённых расхождений

## Остановка и передача Astra

По указанию пользователя реализация/review/checks остановлены. Разрешён partial handoff commit/push только `impl/client-auth-hud-669eb5`; это не приёмка. [Передача](evidence/ui-independent-review/SHUTDOWN-HANDOFF.md) фиксирует завершённые CPU проверки, прекращённые ресурсы, сохранённый correction report и sanitizer. Сохранённый reviewer report подтверждает R-01–05; открывает R-08/P2 (Spanish HUD390 overlap), R-09/P2 (chat-seeded перевод стирается), V-01b/P3 и cloth dots/P3. Полные corrected browser47/render8 не выполнены; reviewer остановлен до финального ответа/release. Исторические checkbox ниже отражают исходный план, не объявляют дальнейшее выполнение этим исполнителем.

## Цель и изменения требований
По дополнительному поручению пользователя partial push4587fa1 не закрывает работу. После реализации независимый reviewer читает спецификации и все11 референсов, сравнивает реальные экраны и проверяет поведение. Новые игровые правила не вводятся; противоречия не решаются скрыто.

## Граница
- Только ветка impl/client-auth-hud-669eb5. Не push/merge main и не использовать unmerged NEXT.
- Все экраны: вход, регистрация, режим/команда, языки, выбор облика и4 модели, HUD, чат, словарь, инвентарь, карта.
- Четыре размера:1622×970,1280×800,390×844,640×480. Фокус, клавиатура, Pointer Lock и настоящий сервер.
- Не подменять API/данные/Pointer Lock, не снижать viewport/DPR/content/quality ради теста, не увеличивать обязательные deadlines и не ослаблять assertions.
- Прежний full-geometry golden защищал animation-only correction. Для явно порученной визуальной коррекции допустим новый approved golden только после независимой оценки новых paired renders. Старый baseline/hash сохраняется. Сравнение полного hash/neutral transforms остаётся строгим; foot stance/drift, lower-body rig, common bounds, containment, budget и byte-for-byte rebuild не отменяются.
- Hardware/LAN/Wi-Fi-off/real-LLM без доступного оборудования — непроверено, не принято.

## Реализация
- [x] Сверить старый failed check с текущим кодом и более поздним успешным frozen-source run; сохранить оба результата.
- [x] Довести активные47 browser и8 render до фактического результата, без прерывания и без скрытия failures.
- [x] Независимый reviewer открыл все11 reference PNG и спецификации; baseline-report.md и baseline-comparisons.html содержат expected/actual matrix и сравнения.
- [x] Получены fresh baseline captures всех экранов/4 моделей/4 размеров на настоящем сервере, включая populated HUD и реальные peer actions; correction verification выделена следующим gate.
- [ ] Исправить каждый подтверждённый дефект и визуальное расхождение в согласованном scope; для каждого указать ID, код и before/after.
- [x] R-01–05: общий entry chrome внутри активного native dialog, gear справа снизу, резерв 44px/scroll area, сохранение draft/stage и возврат фокуса; shrinkable avatar grid без горизонтального отсечения. Сохранённый correction-report подтверждает исправление в проверенном scope на4 размерах; это не полная приёмка задачи.
- [ ] V-01: оригинальный объёмный фон с перспективой, мягкими тенями и low-poly жителями; допустим локальный статичный PNG, воспроизводимо снятый из собственной Three.js сцены офлайн. Это не runtime world/новый game channel; не использовать screenshot референса с контролами.
- [ ] V-02: уточнить лицо/волосы/руки/материалы четырёх GLB по refs с сохранением physics, lower-body/walk и строгих проверок; approved golden только после независимого сравнения.
- [ ] Повторить затронутые tests/visual checks после каждой коррекции; независимый reviewer проверяет исправления.
- [ ] Закоммитить/отправить corrections и evidence, согласовать final results/spec metadata/README.

## Приёмка
- [ ] Полный независимый отчёт: expected/actual, severity, requirement IDs, evidence paths и сравнения screenshot; все перечисленные экраны покрыты.
- [ ] Все подтверждённые scope defects исправлены и независимо перепроверены; обязательные failed checks не объявлены проходящими.
- [ ] Неизменность server authority, auth/session boundaries, teams/languages/tasks/chat/stones/dictionary и явного resume подтверждена релевантными проверками.
- [ ] Итог содержит фактические команды/результаты, commits и push result; main не изменён.

## Открытые вопросы
- HUD-011 требует фонтан/ворота из mockup, но world/задание их не содержат; карта не может показывать ложные координаты. Нужна оценка reviewer и явное решение, если требуется менять world, а не presentation.
- HUD-017 требует avatars в чате; AVATAR оставляет соответствие портретам напарников открытым. Не назначать непроверенный облик или фиктивного участника.
- ENTRY оставляет статичный/живой фон, время суток и расхождение стиля world открытыми. Reviewer должен отделить обязательные художественные признаки от новой игровой сцены.

## Результат
- Исходная partial реализация:4587fa13bd4568d997a1cae233ebea305e5da6f4, push только implementation branch подтверждён.
- Старый check d22102: /tmp/ui-check.log,2026-10-31T21:31:56Z,2 TS errors по languages[0]; копия client-check-earlier-failure.log в UI evidence.
- Текущий код явно проверяет first===undefined; исправление уже включено в4587fa1. Более поздний client-check-final.log завершён2026-11-01T00:38:39Z:0 errors/0 warnings, TypeScript/core exit0. Unit264/264, imports/build exit0. Это не отменяет старый failure, а фиксирует исправление и повторную проверку.
- Frozen-source pipeline background5425a1 завершён: browser15 passed/32 failed (27.8m), render4 passed/4 failed (2.9m), итог exit1; final-status.log завершён2026-11-01T01:09:45Z. Ни один failure не принят.
- Independent reviewer independent-visual-review завершил полный baseline на неизменном index-Bb8RXsDf.js; baseline-report.md и baseline-comparisons.html — все11 refs,4 размера, actual chooser/4 GLB и populated HUD. Реальный authenticated peer подтвердил chat/translation/stones/task map, dictionary persistence/edit/delete и live Dan appearance. R-01–07/V-01–04 записаны. Все baseline browsers/sockets закрыты, GPU released2026-11-01T02:33:52.563Z; receipt GPU-RELEASED.md. Диагностическое90s ожидание не прошло5s readiness.
- Подтверждён дефект теста babylon.spec.ts:44: has locator включает родительский dialog. Исправлен относительным locator после frozen-source run; affected scenario ещё не повторён из-за текущего независимого GPU review.
- Chrome candidate: shared EntryChrome, сохранённые underlying dialogs, bottom-right octagonal gear, bounded scroll, explicit focus restoration, shrinkable avatar grid, scoped initial/stage focus. Actual world-baseline подтвердил BODY после equip200 и secondICloses=false; добавлен top-modal focus recovery при disable/removal без перехвата пользовательского/нового modal focus. 10 modal unit passed; повторный client-direct-corrections-after-framing.log: Svelte0 errors/0 warnings, tsc exit0,14 focused tests passed, syntax checks двух baker scripts exit0. Это не канонический полный pipeline и не visual acceptance. Ошибочный npmcheck вызвал generator без tracked public diff и затем7 App rune/shadow errors; сохранён task-048-check-incident.log. Variable snapshot устранил ошибки; канонический pipeline повторяется после публикации corrections.
- Исторический private V2 имел11 focused checks, но независимая art-review его отклонила. V3 исправил face/eyes/collar/sleeves/boys hair, однако reviewer оставил2 blockers: горизонтальная palm shelf и равномерные Ksu side/back blades. Оба отказа сохранены в avatar-v2-art-review.md/avatar-v3-art-review.md; public/golden не менялись до одобрения V4.
- Preview candidate: half-height1.10/lookAtY.86,54svh stage; projection проверена на8 yaw ×16 idle ×4 aspects,4 shipped+4 candidate GLB и pedestal. MaxNDCY.975929, margin1.2%;3 прежних preview unit и framing test passed. После этого direct check выявил2 TS errors optional position attribute в новом test; явный fail-fast guard добавлен; более поздний direct rerun02:24:11Z прошёл14/14 и0 Svelte/TS errors. DPR/residency/lifecycle неизменны; visual approval pending.
- V-01: оригинальный offline Three.js scenery/baker выполнил V1 и V2 bake с локальными ресурсами,1622×970/DPR1 и0 remote/error. V2 снижает крыши/головы, добавляет sky/layers и bevelled backpack, использует4096 shadow map только при offline authoring. PNG опубликованы вместо SVG; source/logs/hash в ui-entry-fidelity-2026-07-02/. Reviewer CPU-read V2: обязательная новая rebake не нужна, но actual composite/cropping/central sign ещё проверяется. Guest alternative вынесен из auth tablet в отдельный footer.
- Полный sanitized failure matrix: UI evidence/browser-failure-triage.md,55 checks =19 pass/36 fail. Источник различает доказанный selector defect, наблюдаемые blocked/loading/FPS/chunk/focus условия и недоказанные причины; blanket SwiftShader attribution не применяется.
- Preliminary report и последующий полный actual-render baseline сохранены раздельно в tasks/evidence/ui-independent-review/. Последующий baseline подтвердил прежде предполагаемый R-02 и дополнил R-06/R-07. Source candidates не выдаются за independent correction acceptance.
- R-06 focus candidate: прежний BW0 real-server sample не прошёл. Focus был на BODY до equip; сохранён main-bw0-focus-trace.json. Trace показал потерю фокуса из открытого babel modal через 1,35 с после pointer-lock exit, поэтому один unlock-rAF был недостаточен. В modal.ts добавлен ограниченный focusout→BODY recovery: только connected/open/top modal и документ с фокусом; новая пользовательская активность или другой modal отменяют отложенный возврат. Нет автоматического Pointer Lock. Unit:20 modal и3 inventory-shortcut tests прошли; direct svelte-check0 errors/0 warnings и tsc exit0. Это source evidence, не полная client-suite acceptance.
- Main выполнил ограниченную ручную проверку actual bundle Dmp_w5NJ с реальным сервером: после явного Start Pointer Lock=true; I открыл inventory с фокусом на «Закрыть окно» внутри dialog. После server UI действия «Взять в руки» состояние «В руках: Сумка» и фокус «Убрать из рук» подтверждены. Второй I открыл Pause без повторного захвата. Это положительный sample, не закрытие R-06: независимая полная проверка и остальные сценарии focus/ACK ещё нужны. Предыдущий BW0 failure сохраняется в evidence.

### 2026-11-01: controlled V4 publication и новый canonical CPU run
- Независимый avatar-v4-art-approval.md/receipt одобрил только точные4 V4 GLB после13 targeted neutral views. V-02b hands/V-02c Ksu hair достаточно исправлены; face/eyes/collar/sleeves/boys hair V3 не переоткрываются. Это не новый V4 three-light run, не actual chooser и не full V-02 acceptance.
- Public V4: Lukas883556/Nic883560/Dan883568/Ksu720372 bytes. Полные SHA в approval receipt и UI evidence/correction-assets-receipt.json. Новая geometry-neutral-approved-v4.json сохраняет строгие GLB/full-geometry/neutral equality; original geometry-neutral-before.json неизменна.12 production model checks,3 budget и1 framing прошли. Exact original lower-body/normalization/gait/bounds/17 calls сохранены.
- До получения отдельной инструкции public baseline был заменён; agent восстановил4 старых GLB/models.json точно из Git4587fa1. recovery-receipt.json подтверждает Git blobs и original geometry. История history/shipped-before-art-v4/ содержит также старые static portraits, скопированные перед их обновлением.
- После остановки только task server4387 выполнены согласованные world generation и полные canonical CPU gates:2026-11-01T03:33:06Z–03:36:00Z, exit0. make client-test289/289,36 files; make server-test160/160,16 files; npm client check Svelte0/0+TS/core0, imports0; server strict/shared/import0; build/world0. Команды и UTC в run-correction-cpu-gates.sh/correction-cpu-status.log, отдельные correction-*.log. Ранние failures не удалены и deadlines/assertions не ослаблены.
- Static portraits заново сняты существующим локальным exporter из approved V4; это authoring PNG, не actual runtime chooser evidence. Последующий canonical build exit0. verify-correction-assets.mjs проверил approval/source/dist GLB hashes, PNG equality, фактические размеры всех manifest/chunk/collision/assets и worldBytes для demo/science/market. Declared conservative market memory66347040/67108864B, margin761824B; не actual JS/GPU/RSS measurement.
- Coherent deployment: index-zupTnY5d.js / index-qM6L3C1v.css. Новый own server taskd2fdbd на4387; HTTP200 подтверждён03:42:12Z в correction-deployment-readiness.json, не как5s world readiness.
- Independent reviewer получил exclusive GPU GO после закрытия portrait browser. Все source/public/build/server заморожены до его release. Повторная actual verification R-01–07/V-01/V-03/V-04/chooser/cloth dots выполняется. Main работает только с docs/CPU read-only audit.
- Старые browser47=15pass/32fail и render8=4pass/4fail пока не заменены новым canonical запуском и остаются обязательными failures. Shadow A/B не доказал причину cloth dots; speculative bias не опубликован. Hardware/LAN/Wi-Fi-off/real-LLM/all-pose tools не проверены.
- Полная приёмка не заявляется.
