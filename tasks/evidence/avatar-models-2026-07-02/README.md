# TASK-043 / TASK-048 — baseline и approved V4 облики

## Текущая controlled V4 publication — 2026-11-01

[V4 geometry approval](../ui-independent-review/avatar-v4-art-approval.md) и [machine receipt](../ui-independent-review/avatar-v4-approval-receipt.json) разрешают точные байты ниже после просмотра13 targeted neutral views. Private V2/V3 отклонены и сохранены; V3 face/eyes/collar/sleeves/boys hair признаны достаточными, V4 исправляет только hands/Ksu side-back locks. Это не actual chooser, не новый полный three-light V4 run и не full V-02 acceptance.

| ID | V4 bytes | triangles | draws | declared memory |
|---|---:|---:|---:|---:|
| lukas | 883556 | 6814 | 17 | 1767112 |
| nic | 883560 | 6814 | 17 | 1767120 |
| dan | 883568 | 6814 | 17 | 1767136 |
| ksu | 720372 | 5382 | 17 | 1440744 |

Общий GLB3371056B; declared model memory6742112B. Полные SHA — в approval и [publication audit](../ui-redesign-2026-07-02/correction-assets-receipt.json). Source/dist GLB совпали с approval после повторной canonical world generation/build. Текущие static portraits512×512 пересняты тем же локальным exporter из approved V4; они не заменяют4 runtime portraits, которые UI получает последовательно из реальных GLB.

Новый [strict golden](geometry-neutral-approved-v4.json) требует GLB/full-geometry hashes и neutral equality. Original [geometry-neutral-before.json](geometry-neutral-before.json) неизменён. [Старые GLB/models.json](history/shipped-before-art-v4/) byte-exact восстановлены из Git4587fa1; recovery-receipt.json фиксирует Git blobs и original geometry. Старые PNG скопированы перед обновлением. Новые meshes имеют тот же lower-body, rig/attachment origins, точную root normalization, common0.96×1.8×.56m bounds и gait; технические guards не ослаблены.

После публикации passed12 production model checks+3 WorldBudget+1 framing, затем полный canonical client289/server160, Svelte0/0, TS/core/import/shared/build/world0. Все команды/logs/UTC — [UI evidence](../ui-redesign-2026-07-02/README.md). Physical manifest/chunk/collision/asset sizes/worldBytes проверены; declared conservative market66347040/67108864B, margin761824B. Это не замер реальной JS/GPU/RSS памяти. Coherent bundlezupTnY5d на actual4387 передан independent reviewer для fresh correction verification.

Cloth dots остаются без доказанного диагноза. Shadow A/B не считается исправлением; bias не менялся. CPU scan подтвердил local belt/strap intersection, но не причину точек вне этой области; [method/results](visual-v4-candidate/cloth-mesh-v4-evidence.md) ограничены static/front sampling. Runtime chooser/portraits/save/peer/tools и hardware/LAN/performance/all-pose checks не закрыты. Исторические browser/render failures ниже по ссылкам остаются failures до полного нового run.

## Историческая baseline-поставка до художественной V4

Все размеры/хеши/фотографии и geometry-freeze заявления следующих разделов относятся к прежней animation-only поставке. Они сохранены как история и не описывают текущую upper-body geometry. Новый approved strict fixture выше не отменяет исторический baseline и lower-body/gait contracts.

## Источник и происхождение

Редактируемый источник: [`client/scripts/generate-avatar-models.mjs`](../../../client/scripts/generate-avatar-models.mjs). Все меши созданы в репозитории средствами Three.js 0.187.0. Сторонние модели, текстуры и шрифты не использованы. Это оригинальная процедурная скульптура, не перекраска прежнего NPC.

Художественные референсы: [`oblik_page.png`](../../../specs/images/oblik_page.png), [`lukas.png`](../../../specs/images/lukas.png), [`nic.png`](../../../specs/images/nic.png), [`dan.png`](../../../specs/images/dan.png), [`ksu.png`](../../../specs/images/ksu.png). Референсы не применяются как игровые меши или портреты.

API генератора:
- `createAvatarModel(id) → { root, animations }` — browser-safe построитель;
- `generateAvatarModels()` — GLB и `models.json`;
- `generateAvatarPortraits()` — build-time PNG настоящих GLB через локальный Chromium.

Воспроизведение: `node client/scripts/generate-avatar-models.mjs --portraits`. Финальный экспорт уже выполнен. Перед финальным manifest/build основной агент должен использовать перечисленные ниже байты. Повторный экспорт покрыт бинарным regression test.

## Поставляемые модели и бюджеты

Каталог: [`client/public/assets/models/avatars/`](../../../client/public/assets/models/avatars/). GLB 2.0 содержит бинарную геометрию без внешних URI, изображений или текстур. Один матовый vertex-colour материал: roughness=1, metalness=0. GltfLibrary разделяет геометрии и материалы шаблона, но экземпляры имеют раздельные суставы и миксеры.

| ID | Финальный GLB, байт | Треугольники | Основные mesh draws | Manifest memory, байт |
|---|---:|---:|---:|---:|
| lukas | 760932 | 5726 | 17 | 1521864 |
| nic | 760940 | 5726 | 17 | 1521880 |
| dan | 760948 | 5726 | 17 | 1521896 |
| ksu | 687564 | 5082 | 17 | 1375128 |

Всего GLB: **2970384 байт**; консервативный резерв manifest: **5940768 байт** по формуле `max(fileBytes * 2, 1048576)`. Это резерв, не измеренный GPU/heap. Четыре модели дают 68 основных mesh draws; мир, подписи, инструменты и тени считаются дополнительно. Полный CHAR-013 профиль этим расчётом не подтверждён.

Портреты `<id>-portrait.png` — заново снятые локальные прозрачные PNG 512×512. Они используют финальные GLB 1.8 м, не референсы. Камера: perspective FOV 28°, position `(0.22, 1.50, 2.18)`, look-at `(0, 1.39, 0)`, yaw модели -0.12 rad, ACES exposure=1.05.

[`models.snapshot.json`](models.snapshot.json) фиксирует финальные пути, размеры, bounds и клипы. SHA-256:

```text
lukas df28e3be7f6cbe3f188315edd69b7e4994dfd97980c158d8afd35013bfa66d69
nic   35dce034ea20f55a2658d1b508f8a232f9c91dafa5da0782a127b5ce61e2b79a
dan   c30616282873678cdad3835ab7e62ef7b67ec8bfa1a1e83c4e53221cb4227038
ksu   efdb7e1384fb0cf535577246851ad5ec6663358b51c398a00a881b6b4a68f994
```

## Масштаб и сохранение геометрии

Единица — метр, +Y вверх, +Z вперёд. Origin находится на земле между стопами. Нейтральный AABB всех четырёх моделей: **0.96 × 1.8 × 0.56 м**, minY отличается от 0 менее чем на 0.00000001 м. Серверная высота, скорость и коллизии не менялись.

Для согласования с существующей физической высотой игрока прежняя высота 1.95 м заменена общей Y-нормализацией 1.8 м: новый root scaleY равен старому `scaleY × 1.8/1.95`. ScaleX/scaleZ, данные мешей, материалы, исходные положения/вращения суставов и ширина/глубина не менялись. Невидимой bounding-геометрии и walk scaling нет.

[`geometry-neutral-before.json`](geometry-neutral-before.json) сохраняет SHA-256 массивов geometry и нейтральные node transforms до walk-коррекции. Regression test сравнивает финальные реальные GLB: geometry идентична байт-в-байт; единственное разрешённое изменение neutral transform — указанная Y-нормализация узла `avatar`.

## Суставы и клипы

```text
avatar
├─ torso
│  ├─ neck
│  ├─ head → face / hair
│  ├─ shoulder-left → elbow-left → wrist-left
│  └─ shoulder-right → elbow-right → wrist-right
├─ hip-left → knee-left → ankle-left
└─ hip-right → knee-right → ankle-right
```

Это иерархия групп, не skin/skeleton. Поверхности имеют суффикс `-surface`. `wrist-right` сохранён для held tool; кисть продолжается от его origin вдоль local -Y. Исходные сегменты ноги: **0.32/0.30 м**, до root normalization. Иерархия и данные клипов одинаковы для всех обликов.

- `idle`: 4 с, 33 ключа на track, слабое дыхание/голова/руки; исходные данные idle сохранены.
- `walk`: 0.9 с (в GLB Float32 — 0.899999976 с), **257 ключей на каждом из 15 tracks**. Полный source cycle — **1.2 м**, не одиночный шаг. В опорной половине контакт идёт от +0.3 до -0.3 м.
- Нет root motion, изменения игровой позиции или walk scale tracks. Translation tracks разрешены только у `torso`, `hip-left`, `hip-right`; их X/Z остаются исходными.

Общая вертикальная добавка для torso и обоих hips:

```text
contactZ = 0.3 - 1.2 * (cyclePhase % 0.5)
stanceDown = sqrt(0.6199² - contactZ²)
offset = 0.16 + stanceDown - 0.78
torsoY = 0.95 + offset
hipY = 0.78 + offset
```

IK использует длины 0.32/0.30 м и `down=stanceDown` в опоре. В переносе `down=stanceDown-lift`, где `lift=0.02*sin(swingPhase*π)`; Z линейно возвращается от -0.3 к +0.3. Низкая спокойная дуга сохраняет clearance внутри неизменной туники. Лодыжка контрвращается, подошва остаётся горизонтальной. Torso имеет небольшой counter-lean -0.025 rad и сдержанный sway; голова компенсирует lean. Максимальное source изменение Y меньше 0.078 м.

## Runtime pace и точные измерения

[`AvatarWalkPace.ts`](../../../client/src/render/three/AvatarWalkPace.ts) включает новый режим только по узлу `avatar`, закрытому ID, корректным units/forward/stride и длительности clip. GltfLibrary оставляет legacy-моделям `speed/3` и clamp 0.2–2×. У проверенных avatar разрешён clamp 0–16×. Нулевая/некорректная скорость или scale дают 0.

```text
worldCycleMetres = walkCycleMetres * length(avatar.matrixWorld column +Z)
pace = observedSpeed * actualClipDuration / worldCycleMetres
```

Учитываются текущий parent scale и неизменная source +Z normalization. Наблюдаемая скорость берётся из уже ограниченного displacement EntityVisuals, не из физического изменения скорости.

| Облики | Полный мировой цикл, м | Pace при 3 м/с | Циклы/с при 3 м/с |
|---|---:|---:|---:|
| lukas/nic/dan | 1.1387615858 | 2.3709966705 | 2.6344408148 |
| ksu | 1.1363385480 | 2.3760523949 | 2.6400582865 |

[`contact-measurements.json`](contact-measurements.json) получен из **реальных финальных GLB**, по 8192 фазам на модель, со сдвигом половины sample. Это 32 междуключевых пробы на каждый интервал. Результаты:

- максимальная абсолютная ошибка опорной подошвы по Y: **0.000004579 м = 0.004579 мм**;
- максимальная ошибка локальной contact Z после мирового scale: **0.000002632 м = 0.002632 мм**;
- максимальный дрейф planted world Z за опорную половину при согласованном перемещении root: **0.000005238 м = 0.005238 мм**;
- мировой torso bob: **0.06773–0.07053 м**;
- мировой максимальный swing clearance: **0.01750–0.01823 м**.

Это кинематическая проверка чистого цикла на ровной поверхности. Она не подтверждает контакт во время blending, сетевых коррекций, поворотов, на лестницах или при родительском scale, изменённом посреди шага.

## Проверки

Запускалась только focused suite, без полного client/server gate:

```sh
cd client
npx vitest run src/render/three/AvatarModels.test.ts src/render/three/AvatarWalkPace.test.ts
```

Результат: **20 passed**, [`walk-correction-tests.log`](walk-correction-tests.log). Модельные 11 проверок включают IDs, одинаковую иерархию, neutral height 1.8 м, geometry freeze, GLB без внешних URI, бюджеты, loop continuity, dense offset tracks без root motion, actual GLB ground/contact на 2048 междуключевых фазах, pants/tunic containment на 512 фазах и бинарную воспроизводимость. Ещё 9 проверок покрывают metadata pace, runtime scale, все реальные GLB, legacy 2× cap и EntityVisuals call site. Quaternion сравнения нормализованы, чтобы Float32 norm error не давала ложный angleTo failure.

Предыдущие полные проверки относились к старым байтам и не объявляются итоговой приёмкой. Основной агент должен заново построить manifests и выполнить финальные gates.

## Обновлённые изображения и короткое наблюдение

Все PNG ниже пересняты с **новых GLB 1.8 м и walk 1.2 м** через локальный Three.js в Chromium SwiftShader; тени отключены:

- [`front-idle.png`](front-idle.png), [`back-idle.png`](back-idle.png);
- [`side-walk-contact.png`](side-walk-contact.png), [`side-walk-swing.png`](side-walk-swing.png), [`three-quarter-walk.png`](three-quarter-walk.png);
- отдельные 800×1000: [`lukas-full.png`](lukas-full.png), [`nic-full.png`](nic-full.png), [`dan-full.png`](dan-full.png), [`ksu-full.png`](ksu-full.png);
- 1280×800: [`neutral-light.png`](neutral-light.png), [`demo-light.png`](demo-light.png), [`market-light.png`](market-light.png);
- [`browser-check.json`](browser-check.json): page errors/failed requests не было в этой съёмке.

[`walk-three-mps.webm`](walk-three-mps.webm) — короткое диагностическое наблюдение Lukas в отдельной сцене: 3 м/с, camera-follow, неподвижная мировая сетка, правильный metadata pace. [`walk-video.json`](walk-video.json) фиксирует ограничения: headless SwiftShader под нагрузкой выполнил лишь 18 draws за 3 с, несмотря на captureStream(30). **Это не видео при 30 FPS и не подтверждение плавности или render budget.** Оно годится только для просмотра отдельных поз и направления контакта.

## Оставшиеся различия и непроверенное

Отказ от прежнего stride 0.48 м устраняет известную частоту 6.6 циклов/с. При 3 м/с теперь 2.63–2.64 цикла/с, без изменений физики. На кадрах опора и силуэт читаются, пересечения штанов с туникой не наблюдались; containment test пройден. Лица/волосы остаются более гранёными, чем на рисунках; юбка не имеет cloth simulation.

Низкий swing clearance рассчитан на ровную поверхность. Границы опора/перенос имеют смену скорости линейного Z, а общий bob имеет смену вертикального наклона в double contact; возможна стилизованная жёсткость. Нужна оценка движения при настоящих 30/60 FPS. Blending, повороты, LAN jitter, held-tool clipping, потолки в реальной карте и полный 60-секундный performance/memory/lifecycle профиль остаются финальной проверке основной реализации. Короткое headless наблюдение не закрывает эти критерии.
