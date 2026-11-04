---
id: TASK-113
type: implementation-task
status: done
spec: ../specs/client-render-shadows.md
requirements: [RSHADOW-001, RSHADOW-002, RSHADOW-003, RSHADOW-004, RSHADOW-005, RSHADOW-006]
related:
  - spec: ../specs/client-render-optimization.md
    requirements: [ROPT-001, ROPT-002, ROPT-003, ROPT-004, ROPT-005, ROPT-006, ROPT-007]
  - spec: ../specs/client-render-measurement.md
    requirements: [RPERF-001, RPERF-002, RPERF-003, RPERF-004, RPERF-005, RPERF-006, RPERF-007]
depends_on: [TASK-111]
---

# Стоимость и устойчивость обычных теней

## Цель и изменения требований

Третий этап ROPT после принятого batching. Требования не меняются. Измерить одну directional PCF shadow map; реализовать только подтверждённое улучшение либо оформить проверенный отказ, сохранив безопасный путь.

## Метрики и варианты до кода

- Сцена/маршрут RPERF: market, radius 2, CSS 1280×800, device DPR 2, M4 / 16 GB, установленный Chrome. Low без теней/MSAA, balanced одна PCF 1024, high одна PCF 2048. Batching low/balanced и legacy high из TASK-111 сохраняются baseline.
- Исходная область shadow camera: ±24 в обеих осях, near 1 / far 85, направление (18,12,−12), свет следует игроку; normalBias .035 / bias −.0001. Контрольные точки: рынок, двор, лестница, пастбище, первое лицо/поворот, источник за камерой.
- Раздельные неблокирующие GPU queries **shadow** и **main after shadow**; CPU shadow, calls/triangles и отдельная GPU memory estimate. Они не вложены; cap остаётся четыре query handles. Неизмеренная GPU preparation до shadow не объявляется нулём/частью полного GPU duration. Обычный whole-frame probe сохраняется.
- Целевая метрика кандидата — медиана GPU shadow ms: ≥10% и больше разброса трёх чередующихся ≥60 с повторов; P95 интервала отправок не хуже 5%. CPU управления и память включаются в отчёт. Кандидат с потерей нужной тени отклоняется по качеству до дорогой performance-серии; такой отказ не называется измеренным ускорением.
- Ограниченные test-only варианты: ортографическая область ±18 при прежнем размере карты; baseline ±24 с привязкой центра к texel-сетке. Bias/геометрия/коллизии не меняются. Прототипы изолированы в e2e, обычная игра до решения прежняя.
- Кэш оценить по реальным изменениям света, набора casters, их world/instance/bone/morph transforms; при постоянной инвалидизации не добавлять второй target/разделение static/dynamic без доказанной пользы. Proxy оценивать только для подтверждённо дорогих силуэтов по inventory; отсутствие прототипа не выдавать за доказанный проигрыш proxy.
- Повторы: baseline по три ≥60 с на профиль после ≥5 с прогрева, одинаковый маршрут; A/B только прошедшим контроль качества. Из-за межсерийного дрейфа TASK-111 не использовать старый FPS как контроль кандидата.

## Реализация

- [x] Раздельные CPU/GPU/calls/triangles shadow/main без вложенных запросов, с lifecycle и bounded capture.
- [x] Inventory casters/receivers и стоимость исходной карты, оценка cache invalidation.
- [x] Контроль тесной области и texel stability; принятие/отказ с evidence.
- [x] Три профиля, context loss/recovery, переключение и пять входов; обязательные проверки.

## Приёмка

- [x] RSHADOW S1: закамерный caster остаётся при повороте/первом лице; нужные тени не отсекаются main frustum.
- [x] RSHADOW S2: ветер/персонажи/лестницы/streaming актуальны, нет замороженных теней и утечек ресурсов.
- [x] RSHADOW S3: профили, GPU/CPU shadow/main, качество/мерцание и память зафиксированы; ускорение отделено от качества и шума.
- [x] ROPT-005: unit, check, imports, build, render и релевантные browser-сценарии; документы/metadata соответствуют результату.

## Результат

Завершена оценка; принят исходный безопасный путь одной PCF-карты. Новый явно включаемый probe измеряет shadow/main отдельно, без вложенных queries; полный GPU duration в этом режиме остаётся null. Обычная игра сохраняет прежние map sizes, область, casters и autoUpdate. Эксперименты доступны только в e2e.

15 записей ≥60 с: low baseline ×3, balanced/high по три чередующихся baseline/snap пары. GPU shadow median трёх повторов balanced 1.322 → 1.281 мс (−3.1%, разброс 11.3%); high 3.022 → 2.633 мс (−12.9%, разброс 21.0%). Парные результаты разнонаправлены, цель не подтверждена. P95 интервалов 16.7–16.8 мс. Tight ±18 теряет нужную дальнюю тень; snap стабилизирует локальную проекцию, но не принимается как ускорение. Полный cache непригоден: 0/149 неизменных стоячих кадров в каждом профиле с тенями; движущийся trace также инвалидируется. Shadow proxy и static/dynamic split не внедрены и не названы измеренно проигравшими.

Unit **484/484**, check **0 errors/warnings**, imports/build PASS; WebGL **19/19**, включая настоящие context loss/recovery всех профилей и новые GPU samples после восстановления; regular browser **4/4** (профили, GPU backpressure, FPS-график, стрельба/камера). Дополнительные повороты первого лица и третье лицо сохраняют закамерный caster в balanced/high. Каждый профиль прошёл пять close/open: освобождены shadow targets, geometry/textures и WorldBudget; retained heap после GC ниже прогретого baseline. Точные условия/команды, raw/summary, PNG/видео, inventory и ограничения — evidence (артефакт удалён), источник — `accepted-source.tar.gz` рядом; hashes всех 236 файлов совпали до/после серии.

Сервер/shared не менялись; исходный пользовательский pasture.glb сохраняет SHA-256 из TASK-110. Аппаратная квалификация слабого ноутбука и полной системы LAN/LLM не заявляется. Стабильная остановка после этапа 3; следующий — RDETAIL, ещё не начат.

Артефакты проверок удалены по запросу пользователя; исторические результаты и команды выше сохранены. Новые материалы проверок хранятся вне checkout (TASK-119).
