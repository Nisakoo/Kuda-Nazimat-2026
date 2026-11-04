---
id: TASK-117
type: implementation-task
status: done
spec: ../specs/client-render-occlusion.md
requirements: [ROCC-001, ROCC-002, ROCC-003, ROCC-004, ROCC-005, ROCC-006, ROCC-007]
related:
  - spec: ../specs/client-render-optimization.md
    requirements: [ROPT-001, ROPT-002, ROPT-003, ROPT-004, ROPT-005, ROPT-006]
depends_on: [TASK-116]
---

# Оценка отсечения за стенами

## Цель

Шестой этап после принятого RFRAME. Новых требований нет. Сначала проверить потенциальную экономию без изменения видимости. Город открытый, районы streaming не являются порталами: консервативная PVS без доказанной закрытости показывает все зоны.

## Метрики до кода

- High, рынок/двор/лестницы/открытое пастбище, RPERF маршрут1280×800/DPR2, три60 s пары baseline/query observer. Primary GPU whole median, порог10% выше разброса, P95≤+5%. Observer сам не оптимизация; его расходы и доля полностью скрытых bounds служат gate перед culling.
- ≤8 крупных статичных opaque Mesh, ≥4096 triangles, максимум2048 проверенных Mesh; резерв256 KiB того же WorldBudget на ограниченную metadata. ≤8 queries outstanding, ≤1 query/frame и ≤2 polls/frame. CPU budget.25 ms/frame, GPU.25 ms/frame; превышения запрещают внедрение.
- ANY_SAMPLES_PASSED_CONSERVATIVE вокруг реальных крупных main draw calls (отрицательный ответ относится только к этой группе материала, не всему Mesh); camera inside/near-plane/unknown geometry → show без query. Читать только при AVAILABLE. Видимость всегда исходная; движение камеры/ветра исключает повторное использование отрицательных результатов. Shadow/raycast/коллизии прежние. Context loss/close освобождают queries/lease.
- Первые proxy-box варианты невалидны: сначала вызов вне currentRenderState, затем geometry без обычной подготовки GPU buffers. Оба исключены; до полной серии выбран actual-draw observer без отдельной геометрии/прохода.
- Hi-Z только при достаточном потенциале и резерве после простого варианта. Если gate не пройден, описать depth convention/max reduction/форматы/WebGL2 consumption, без неподтверждённого нового pass и без заявления о реализации Hi-Z.

## Приёмка

- [x] ROCC S1: стоимость observer/потенциал на обоих маршрутах, gate и решение.
- [x] ROCC S2–S3: uncertainty/near-plane/turn/moving/load/context не скрывают пиксели; shadow/raycast прежние.
- [x] ROCC S4: caps/fallback/release; пять циклов ресурсов.
- [x] Проверки, evidence и metadata обновлены.

## Результат

Actual-draw observer оценён и отклонён: CPU spikes .8–1.0 ms >cap.25, безопасное использование delayed negative не доказано; Hi-Z gate не пройден. Production без occlusion. Три60 s пары и extension, пять frozen pixel A/B, cap8, budget fallback, context loss и5 cycles прошли. Evidence (артефакт удалён).

make client-test485/485; check0 errors/0 warnings; imports/buildPASS; test:render19/19. Логи в evidence/render-occlusion.

Артефакты проверок удалены по запросу пользователя; исторические результаты и команды выше сохранены. Новые материалы проверок хранятся вне checkout (TASK-119).
