# V-02 — независимая CPU art-review кандидата visual-v2

## Решение

**Не одобрять v2 как новый strict full-geometry golden.** Это art rejection, не утверждение о поломке rig/GLB. Узнаваемые признаки сохранены, но существенные V-02 расхождения лица/волос/кистей остаются. Нужен один ограниченный upper-body refinement; physics, lower-body/walk, bounds и byte-exact gates не менять. Public baseline/golden сохранять до следующего независимого решения.

GPU не использовался. Он остаётся у Main для UI composites.

## Что действительно просмотрено

Открыты все 4 `compare-*-reference-candidate.png`, corrected `capture-results.json`, CPU `tunic-geometry-inspection.json`, Task-048 scope. Все **44 captures** рассмотрены через созданные CPU contact sheets: front/side/back × preview/neutral/market + preview front/side walk по каждому ID. Дополнительно открыты full-resolution Lukas preview side и Ksu neutral front. Это отдельные private GLB, **не actual chooser**, не rendered peer/tool, не hardware/FPS proof.

CPU sheets: `avatar-v2-{lukas,nic,dan,ksu}-contact-sheet.png`; порядок: строки 1/2/3 — preview/neutral/market; колонки front/side/back. Последняя строка — preview walk front/side и пустая ячейка. `avatar-v2-contact-index.json` содержит точный source path каждой ячейки. Nearest-neighbour уменьшение только для контактного листа, оригиналы не изменены.

Corrected receipt: complete, 44 images, errors `[]`, 2026-11-01T02:45:51.422Z–02:46:10.995Z. Первый receipt с 404 сохранён и не переписывается этим результатом. Пустой errors array не доказывает художественное соответствие.

Кандидаты, к которым относится решение:

| ID | SHA-256 |
|---|---|
| lukas | `e1a337342f2187f30d96a5f51ed6f1097812ea4fdd77b7c24c7354f53460ca12` |
| nic | `add2fb9663e1836e566ccfba2a23483393a9bd0a27a9a595cdcf5cb6f6f7e530` |
| dan | `5195a37723ab9fc25227e1e1188670904b4df32ebe05ee9c4f5fd0a388a2627a` |
| ksu | `4a2303ac401352c968946a841505ce9288c12afd66801d591fe6f2f4ce611dab` |

## Конкретная следующая коррекция в scope

### V-02a · P2 художественное · AVATAR-009 / CHAR-002 — лицо и глаза

**Expected:** мягкое faceted chibi-лицо с достаточно крупными вертикально-овальными глазами, плавно сужающимся подбородком, без потери индивидуальных черт.

**Actual:** у всех 4 — более широкий/приплюснутый овал с массивной нижней щекой; глаза существенно меньше и почти круглые относительно лица. Нос/щёки имеют более жёсткий геометрический переход. Это остаётся видно в neutral lighting, поэтому не только тёплый preview. Reference и candidate сняты под разным yaw: точное совпадение силуэта по пикселям не требуется.

**Ограниченное действие:** переработать именно face-surface silhouette/eye shape-size-placement: чуть менее широкая нижняя щека и более читаемые крупные овальные глаза. Не менять весь root scale, height, ноги или approved walk, чтобы исправить лицо.

**Evidence:** `../avatar-models-2026-07-02/visual-v2-candidate/compare-lukas-reference-candidate.png`, `compare-ksu-reference-candidate.png`, `captures/ksu-neutral-front-idle.png`.

### V-02b · P2 художественное · AVATAR-009 / CHAR-002 — кисти

**Expected:** расслабленные stylized кисти с читаемыми palm/thumb и более естественным переходом от предплечья, как в refs.

**Actual:** руки заканчиваются короткими широкими кулакообразными блоками с выступающим поперечным ободком/гребнем суставов; это читается как манжета или костяшки перчатки. На front idle у всех 4 повторяется одинаковый тяжёлый силуэт, на side кисть выглядит укороченной. Изменение цвета это не исправит.

**Ограниченное действие:** убрать выраженную поперечную «полку», сделать сужение к wrist, отдельный читаемый thumb и менее квадратную resting palm/finger silhouette. Сохранить `wrist-right` attachment origin/axes и строгие tool/animation contracts. Не требуются finger rig или новая игровая механика.

**Evidence:** все 4 compare PNG, особенно Lukas/Dan; full `captures/lukas-preview-side-idle.png`, Ksu neutral front.

### V-02c · P2 художественное · AVATAR-009 / CHAR-002 — волосы

**Expected:** объёмные крупные faceted пряди и индивидуальный силуэт: swept blonde Lukas, более спокойные коричневые Nic, тёмный Dan, layered shoulder-length Ksu.

**Actual:** у мальчиков много острых плоских зубцов по периметру; side/back показывают крупную сплошную cap-mass с поверхностными пластинами, а не мягкий объём отдельных прядей. У Ksu боковые/задние пряди — длинные почти параллельные вертикальные лопасти, «шторка» вокруг головы; reference имеет более свободный layered outline с разной длиной и направлением кончиков.

**Ограниченное действие:** уменьшить регулярную зубчатость, заменить часть тонких острых пластин более объёмными округло-faceted прядями; у Ksu варьировать направление/длину боковых и задних прядей. Сохранить hair colors/identity, не добавлять шапочки.

**Evidence:** Lukas side full-resolution, `avatar-v2-lukas-contact-sheet.png`, `avatar-v2-ksu-contact-sheet.png`, `compare-ksu-reference-candidate.png`.

## Что не назначается обязательной новой геометрией

- Сохранить все нужные palette/identity признаки: black vs thin silver glasses, blonde/brown/dark hair, tunics/belts, Ksu cuffs/bow, светлые брюки/boots.
- Штаны, стопы, lower-body rig, gait, физическая высота/скорость/коллизии — вне этой следующей art-коррекции.
- Приподнятые объёмные плечи и широкий V-collar также отличаются от reference, но для ограниченного следующего прохода приоритет — face/hair/hands; torso/lower-body redesign не запрашивается.
- Preview pedestal и свет не входят в GLB anatomy. Не исправлять geometry изменением camera zoom, картинок reference или снижением DPR.

## Белые точки — причина не установлена

На baseline cloth были светлые диагональные точки. В v2 они не выступают заметно в уменьшенных contact sheets, но это **не доказательство исправления** и не доказательство geometry/shadow причины. CPU inspection сообщает 0 exact duplicate/degenerate torso triangles и 2 sampled near-pairs <1 mm как для baseline, так и для candidate. Этот sample не устанавливает причину GPU artifact. Нужен actual deployed chooser full-res after render с прежним качеством/светом; не объявлять точки устранёнными по CPU scan или другой standalone сцене.

## Следующий gate

1. Model-agent делает private v3 только по face/hair/hands, сохраняет исходные baseline и v2 hashes/receipts.
2. Повторяет строгие lower-body/normalization/stance/drift/containment/budget/byte-rebuild gates; не заменяет equality разрешающим списком без независимого решения.
3. После отдельного GPU GO снимает новые paired front/side/back и три света. Проверяется именно исправление трёх перечисленных силуэтов.
4. Только после независимого art approval можно controlled publication и новый strict golden. Затем обязательно переснять все 4 actual deployed chooser previews/portraits и проверить real save/appearance/held tool. Standalone approval само по себе V02 целиком не закрывает.
