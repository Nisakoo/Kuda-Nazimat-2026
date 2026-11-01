# Поздний render callbackbc1e21

Получен2026-11-01 около04:13Z. Reported exit1/wall2m36s. Command: `npm --prefix client run test:render > tasks/evidence/ui-redesign-2026-07-02/browser-render-final.log 2>&1`. При чтении background output: exited1, nothing new. Main command не повторял.

## Разделение reused path и archive

- Текущий browser-render-final.log имеет mtime2026-11-01T01:09:45.256Z и принадлежит позднему frozen pipeline5425a1:4pass/4fail, все4 MOVE cases превысили30000ms. Он не приписывается автоматически старомуbc1e21.
- `background list` показывает, что5425a1 перед своим run явно копирует старый browser-render-final.log в browser-render-before-freeze.log. Этот archive mtime2026-11-01T00:37:18.499Z содержит4pass/4fail. Первый30FPS/front case завершился через7.3s с `Execution context was destroyed, most likely because of a navigation` и `Test ended`; остальные3 MOVE cases превысили исходный30000ms. Конкретная причина уничтожения context не доказана.
- Таким образом сохранены2 разных historical render outputs. Archive согласуется с ранним failure, но отдельный start/end/immutable original hash, связывающий его именно с processbc1e21, не записан. Это ограничение атрибуции не скрывается.

Ни один из этих outputs не является V4 corrected render acceptance. Старые mandatory failures сохраняются; viewport/DPR/scene/assertions/deadlines/retained-trace config не изменены. Source/public/build/server frozen, exclusive GPU reviewer сохранён; Main не запускал новый GPU job.
