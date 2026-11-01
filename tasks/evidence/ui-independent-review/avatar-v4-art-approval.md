# V-02 — независимое одобрение private V4 geometry

## Решение

**V4 одобрен для controlled publication и нового строгого geometry golden — только байты с SHA-256 ниже.** Два оставшихся art blockers **V-02b (кисти)** и **V-02c (Ksu side/back hair)** достаточно устранены. Обязательный следующий geometry pass не требуется.

Это закрывает ограниченный geometry art-gate, **не V-02 целиком и не визуальную/функциональную приёмку поставки**. Actual deployed chooser всех 4, portraits, shadow/cloth dots, save/peer appearance/tool attachment и runtime/hardware gates остаются отдельными проверками. Baseline/v2/v3 evidence и старый golden должны сохраняться как история; новое equality/neutral сравнение остаётся строгим.

## Просмотр и независимая CPU-проверка

- Прочитаны `../avatar-models-2026-07-02/visual-v4-candidate/capture-results.json` и распарсен целиком `candidate-geometry-neutral.json`.
- Все **13 целевых neutral idle видов** действительно просмотрены через original full-resolution PNG или pairs, без browser/GPU: front/3⁄4/side каждого ID, дополнительно Ksu back. Открыты reference/V4 пары и важные V3/V4 пары, включая Lukas front/side и Ksu side/back.
- Receipt содержит 13 images, errors `[]`, complete, 2026-11-01T03:21:23.768Z–03:21:31.947Z. Это private standalone renders, не actual chooser и не новый трёхсветовой V4 run.
- Reviewer самостоятельно прочитал **фактические GLB bytes**, вычислил SHA-256 и сверил с обоими receipts. Все 4 совпали. Полные `neutralNodes` каждого ID byte-equivalent по JSON-значениям с V3; transform contracts между этими итерациями не изменены.
- Результат проверки сохранён в `avatar-v4-approval-receipt.json`. Model 11 / WorldBudget 3 / framing passed сообщены Main; reviewer их здесь не перезапускал и не выдаёт за собственный полный pipeline.

## Что исправлено

### V-02b — approved geometry

Поперечная ширина palm block заметно уменьшена, пальцы читаются вдоль руки, thumb отделён, а не выглядит продолжением широкой манжеты. На front/3⁄4 кисть больше не доминирует тяжёлой горизонтальной «полкой»; side сохраняет объём. Faceted stylization остаётся, но она больше не блокирует текущую ограниченную art-коррекцию.

Главное evidence:
- `../avatar-models-2026-07-02/visual-v4-candidate/compare-lukas-front-v3-v4.png`
- `compare-lukas-three-quarter-reference-v4.png`, `compare-lukas-side-v3-v4.png` в том же каталоге;
- Nic/Dan/Ksu front/3⁄4/side captures.

### V-02c — approved geometry

У Ksu меньше равномерных параллельных лопастей; крупные пряди отличаются длиной/наклоном/выносом наружу, side/back outline разомкнут и лучше читается layered volume. Волосы остаются крупно-faceted и не копируют reference, но прежняя одинаковая curtain-кромка больше не является блокирующим отличием.

Главное evidence:
- `../avatar-models-2026-07-02/visual-v4-candidate/compare-ksu-side-v3-v4.png`
- `compare-ksu-back-v3-v4.png`, `compare-ksu-three-quarter-reference-v4.png` в том же каталоге.

Достаточные V3 face/eyes/collar/sleeves/boys-hair области не открываются заново. Physics/lower-body/walk/bounds/normalization не назначаются к переработке.

## Одобренные точные байты

| ID | bytes | GLB SHA-256 |
|---|---:|---|
| lukas | 883556 | `76dccb6dad65f3a00b86937841567f98c5e3f98078a3b97c38d584a27eaf8f71` |
| nic | 883560 | `b452683fc4b402a6b0242879c095264e359493c564445f594f3c80e386cc8c3b` |
| dan | 883568 | `c209d2f78e55b6424689b5e347d1de0423dc72bcce079b646a6cb5878a2a1039` |
| ksu | 720372 | `3f085325b1cf993f2947d65df7493422e394f5463c135374f96bc0132567483b` |

Geometry SHA/neutral evidence находятся в machine-readable approval receipt. Иные повторно экспортированные байты требуют hash/rebuild сверки; визуальное одобрение нельзя переносить автоматически на неизвестный файл.

## Следующий gate

Main может согласованно опубликовать эти 4 GLB, соответствующие portraits/models metadata/manifests и новый strict golden, сохранив old baseline. Все foot stance/drift, lower-body, containment, shared resource/memory, framing и byte-for-byte rebuild gates обязательны без ослабления.

Затем сообщить final deployed bundle/CSS, model hashes и явную передачу GPU для independent correction-review. До передачи reviewer browser не запускает. Shadow-depth A/B и cloth-dot issue не считаются закрытыми этим geometry approval; нужны full-quality actual preview after captures.
