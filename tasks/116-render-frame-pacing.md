---
id: TASK-116
type: implementation-task
status: done
spec: ../specs/client-render-frame-pacing.md
requirements: [RFRAME-001, RFRAME-002, RFRAME-003, RFRAME-004, RFRAME-005, RFRAME-006, RFRAME-007]
related:
  - spec: ../specs/client-render-optimization.md
    requirements: [ROPT-001, ROPT-002, ROPT-003, ROPT-004, ROPT-005, ROPT-006, ROPT-007]
depends_on: [TASK-115]
---

# GPU-стоимость и плавность кадра

## Цель и изменения требований

Пятый этап после принятой оценки RDETAIL. Требования пока не меняются: ограниченные прототипы до решения, defaults прежние. При принятии пользовательского adaptive mode согласовать RENDER-009/SET до кода настройки. FrameFence и физика сохраняются.

## Метрики до кода

- Стандартная сцена/маршрут RPERF, M4/Chrome; три профиля. Дополнительно обычная игра high CSS 1440×932/DPR2 из TASK-114. Steady-state минимум три чередующиеся 60 s пары; вход/первый shader/выстрелы отдельно. Целевой бюджет кадра 16.7 ms.
- Упрощение только opaque roughness=1/metalness=0 материалов без текстур/пользовательских shader hooks: Lambert и Lambert с diffuse factor .96 как два фиксированных кандидата. Цель whole GPU median ≥10% и больше разброса, P95 не хуже 5%. До performance сравнить одну замороженную сцену: mean absolute RGB error ≤2/255 и ≥99% pixels с max-channel error ≤8/255, плюс визуальные контрольные кадры. Не компенсировать потерю силуэтов/bias. Пул ≤64 материалов и временная таблица ≤2048 Mesh, резерв 512 KiB; overflow — оригинал.
- compileAsync: максимум одна активная подготовка и один pending batch, без вторых городов/targets. Цель cold first-render P95 CPU ≥10%, entry не становится хуже. Потеря контекста/выход/отмена не оставляют pending shader polling/поздних моделей. Отсутствие выигрыша означает отказ от усложнения lifecycle.
- Raycast: использовать уже существующий broad phase и triangle ranges; сравнить ближайший поиск/сортировку только если существенная доля shoot/camera CPU подтверждена. Не вводить второй индекс автоматически.
- Отдельный raycast-кандидат до опыта: один существующий CameraRaycast для CameraObstruction и ShotgunVisuals вместо двух. Цель — median CPU shots первого выстрела (окно 0.9–1.6 s маршрута) ≥10% и выше разброса; общий P95 не хуже 5%. Индексы остаются WeakMap того же алгоритма, без новой геометрии/памяти; после выхода ссылки не удерживаются.
- Adaptive high: оценить отдельно по доказанной DPR-чувствительности TASK-114, scale .75–1 с шагом .05 не чаще 1 s. Снижение требует FPS ниже 54 и GPU backpressure, не одного CPU spike; восстановление после ≥3 s устойчивого GPU-запаса. При недоступных свежих GPU данных фиксированный 1. До приёмки вариант только экспериментальный; production default fixed.
- Adaptive до полного опыта: primary — median submitted FPS стоящей сцены high CSS1440×932/DPR2, улучшение ≥10% и выше разброса трёх повторов; P95 не хуже 5%. Это сравнение с явным снижением разрешения, не одинакового качества. Изменения scale не чаще 1 s, .75–1; кадры/ресурсы и границы фиксируются отдельно.
- Meshopt/Draco/KTX2/depth prepass оценить по фактической clone/parse/upload/texture/shading стоимости; новые декодеры не добавлять без bottleneck. Материалы и дополнительные GPU ресурсы считать отдельно от payload.

## Реализация и приёмка

- [x] RFRAME S1: ограниченная shader preparation с lifecycle/ошибками либо проверенный отказ.
- [x] RFRAME S2: камера/дробь сохраняют ближайшие hits, группы, стороны и динамические transform; пики/аллокации оценены.
- [x] RFRAME S3: adaptive overload/recovery/visibility/resize/profile/context, корректные UI/Pointer Lock/прицел либо отказ с evidence.
- [x] RFRAME S4: локальные ресурсы/AssetManager/budget не обходятся; codecs/depth prepass обоснованы.
- [x] RPERF сравнение, все обязательные проверки, metadata/README/architecture/evidence.

## Результат

Принят общий CameraRaycast: CPU первого выстрела 6.60→1.95 ms (−70.45%), больше разброса повторов; P95 не хуже. Lambert, compileAsync и adaptive оценены и отклонены; defaults прежние. Evidence (артефакт удалён).

Итог: make client-test 485/485,60 files; check0 errors/0 warnings, imports/build PASS; Chrome test:render19/19, graphics/shotgun4/4. Команды, сырые записи и архивы в evidence/render-frame. При прототипе adaptive487tests; после удаления485. Сервер/shared не менялись.

Артефакты проверок удалены по запросу пользователя; исторические результаты и команды выше сохранены. Новые материалы проверок хранятся вне checkout (TASK-119).
