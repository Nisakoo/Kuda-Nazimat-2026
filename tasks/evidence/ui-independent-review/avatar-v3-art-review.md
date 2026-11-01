# V-02 — независимая CPU art-review private v3

## Решение

**V3 не одобрен для controlled publication / нового strict geometry golden.** Список оставшихся блокирующих art-правок сокращён до **двух ранее заявленных**: кисти и side/back силуэт волос Ksu. Это не новые требования и не основание менять lower body, rig, gait, bounds или normalization.

Face/eyes, collar/sleeves и смягчение зубчатости мужских причёсок достаточно улучшены для следующего этапа. Дальнейшая обязательная переработка этих областей в текущем ограниченном проходе **не запрашивается**. Это не pixel-perfect сравнение фронтального GLB с 3/4 reference.

## Просмотр и provenance

Открыты все 4 private `compare-*-reference-candidate.png`; все 44 captures рассмотрены через CPU `avatar-v3-{lukas,nic,dan,ksu}-contact-sheet.png`. Отдельно открыты full-resolution `captures/ksu-neutral-side-idle.png` и `captures/lukas-neutral-front-idle.png`. `avatar-v3-contact-index.json` перечисляет источники ячеек; rows preview/neutral/market, columns front/side/back; последняя строка preview walk front/side.

Никакой browser/GPU не запускался. Corrected capture receipt: 44 images, errors `[]`; notes указывают private GLB, SwiftShader, no tool attachment. Тесты model 11 + WorldBudget 3 + framing переданы Main как passed; reviewer их сейчас не запускал. CPU art-review не заменяет технические gates или actual chooser.

| ID | SHA-256 / bytes |
|---|---|
| lukas | `7c520f452cfbbc8880bec3a4b2855d027ecb5f48049423251f8d99b88c2e6ecd` / 883556 |
| nic | `d28c8a633e1c42f7171578caefe7cc388d0612aab5af867e7da5bbc30de97220` / 883560 |
| dan | `af745129f6f7727c118504503e6dd85e49682c240d2a6710a62c85f7f9e4741a` / 883568 |
| ksu | `fce030f72f71ef00685c435c201cd21655c3793fd3c4c431ff8a6d389737bef0` / 756852 |

## Улучшения, которые засчитываются

- Нижняя щека/подбородок уже, глаза крупнее и более вертикально-овальные. V-02a уменьшается; следующий обязательный face pass не требуется.
- Collar меньше доминирует; плечи/рукава менее раздуты. Эти части не блокируют следующий gate.
- У мальчиков менее регулярный зубчатый периметр; отдельные крупные пластины ещё заметны, но дополнительный обязательный boy-hair pass не назначается.
- В кистях виднее отдельные кончики пальцев. Это реальное улучшение, но основной силуэт ниже ещё не решён.

## Две оставшиеся правки

### V-02b · P2 art · AVATAR-009 / CHAR-002 — тяжёлый поперечный palm block

На full-resolution `captures/lukas-neutral-front-idle.png` и всех 4 compare PNG кисть по-прежнему выглядит как широкий горизонтальный трапециевидный блок с небольшими кончиками пальцев снизу и выступом thumb сбоку. Добавление кончиков не изменило основной cuff/glove-like outline. В reference кисть длиннее вдоль руки, со спокойным изогнутым palm/finger silhouette и без такой выраженной поперечной «полки».

**Следующий ограниченный pass:** изменить именно palm/finger mesh silhouette: уменьшить горизонтальную полку, вытянуть силуэт вдоль local -Y, смягчить сужение к wrist и отделить resting thumb. Не переносить сустав/attachment origin, не масштабировать весь root/предплечье. Не требуется finger rig. Критерий: front idle и 3/4 читаются как расслабленная кисть, а не поперечная перчатка с точками пальцев; side сохраняет толщину без висящей пластины.

### V-02c · P2 art · AVATAR-009 / CHAR-002 — Ksu curtain-like side/back

Front Ksu улучшен, но full-resolution `captures/ksu-neutral-side-idle.png` и back columns contact sheet сохраняют большую однородную cap-mass с почти параллельными вертикальными лопастями. Разные маленькие острые кончики у нижней кромки не создают layered объём reference. Это замечание было в v2, не новый пункт.

**Следующий ограниченный pass:** переработать только Ksu side/back hair mesh: несколько более объёмных крупных прядей с различным направлением, наклоном, длиной и внешней кривизной; часть кончиков отвести от головы/плеча для мягкого layered outline. Не ограничиваться добавлением зубцов на ровный bob-bottom. Сохранить shoulder-length dark identity, без шапочек. Критерий: side/back silhouette больше не читается как равномерная вертикальная «шторка».

## Cloth dots и shadow A/B

Не используются как основание текущего geometry rejection. Причина светлых точек не установлена; Main сообщил о pending shadow-depth A/B. Диагностика с неизменными geometry/draw quality и включёнными shadows допустима отдельно. Её нельзя объявлять actual chooser acceptance; нужна последующая full-quality production пересъёмка. Нельзя утверждать «geometry исправила dots» по отсутствию точек на downscaled contact sheet.

## Следующее решение

Сохранить baseline, v2, v3 hashes/receipts и не менять public/golden сейчас. Private следующий pass ограничить двумя пунктами выше. Повторить строгие model/budget/framing gates и paired front/3/4/side/back renders после отдельного GPU GO. Reviewer затем решает только эти две оставшиеся art-правки, без нового обязательного пересмотра уже достаточных face/collar/sleeves/boy-hair частей. Actual deployed chooser всех 4 остаётся отдельным обязательным этапом после geometry approval.
