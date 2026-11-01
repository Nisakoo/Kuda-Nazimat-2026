---
id: TASK-047
type: implementation-task
status: in-progress
spec: ../specs/client-input-ui.md
requirements: [UI-001, UI-002]
depends_on: [TASK-044]
related:
  - spec: ../specs/character-presentation.md
    requirements: [CHAR-009, CHAR-010, CHAR-013]
---

# Ограничить очередь GPU без подмены визуальной проверки

## Основание
Обязательные browser checks зависают при enter/capture даже в прежнем local demo. Диагностика `tasks/evidence/ui-redesign-2026-07-02/compare-*.log`: normal drawing 38.4 с до capture, подавление draw 5.5 с, DPR0.5 13.6 с. CPU profile не показывает JS infinite loop; Chromium сообщает GPU ReadPixels stalls. Эти диагностические варианты не являются визуальной приёмкой.

## Граница реализации
- Не менять физику/авторитет, чанки/бюджеты, модели или содержание кадра.
- Ограничить число незавершённых GPU кадров неблокирующей WebGL2 fence; не вызывать finish/ожидание с timeout.
- Освобождать fence при завершении/ошибке/context loss/dispose; сохранить CPU load/animation lifecycle.
- Никаких test-only no-draw, меньшего viewport, подмены request/capture или пропуска assertion.
- Start/Resume и фасад requestPlay не принимают захват при реальной очереди/загрузке моделей (`visualLoading`). Это UX gate, не доказательство завершения GPU кадра; deferred chunks не блокируют его. Существующие loading/error/reconnect/exit остаются доступны.

## Приёмка
- [ ] Не отправляется новый кадр, пока предыдущая GPU fence не завершена; UI и серверная симуляция не блокируются ожиданием GPU.
- [x] Состояния signaled/timeout/wait-failed/dispose проверены headless unit tests.
- [ ] Во время visualLoading захват не запрашивается; после завершения требуется новое явное действие. Loading/error и выход не теряются.
- [ ] С тем же содержимым и viewport пройдены capture/движение/modal сценарии в Chromium; фактическая длительность записана.
- [ ] Client tests/check/import/build проходят. FPS/качество на аппаратном профиле остаются отдельной непроверенной приёмкой.

## Открытые вопросы
- SwiftShader — не целевое оборудование QUALITY. Улучшение отзывчивости не доказывает 30 FPS и не закрывает hardware/LAN/визуальную приёмку.
