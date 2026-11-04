---
id: TASK-119
type: implementation-task
status: done
spec: ../specs/client-render-measurement.md
requirements: [RPERF-007]
related:
  - spec: ../specs/client-render-optimization.md
    requirements: [ROPT-005, ROPT-006]
depends_on: []
---

# Удаление накопленных артефактов проверок

## Цель и изменения требований

По запросу пользователя удалить tasks/evidence целиком и запретить хранение генерируемых скриншотов, логов, видео, сырых замеров и архивов исходников в репозитории. RPERF-007 уточняется: в задаче сохраняются команды, окружение, основные результаты и ограничения; временные сырые материалы находятся вне checkout и не являются обязательным содержимым Git.

## Реализация и приёмка

- [x] tasks/evidence удалена; AGENTS.md и .gitignore закрепляют правило.
- [x] Проверки по умолчанию выводят артефакты вне checkout и не создают удалённую папку.
- [x] Необходимые эталоны аватаров сохранены как тестовые входные фикстуры; тесты не ослаблены.
- [x] Документация сохраняет краткие результаты; ссылки на удалённые материалы убраны.
- [x] Клиентские/серверные проверки и релевантные browser scenarios проходят без evidence.

## Результат

Удалены2783 файла/840,871,786 bytes из tasks/evidence, включая tracked и untracked материалы. Исторические итоги в задачах сохранены,ссылки на удалённые материалы сняты; действующих broken Markdown links не осталось. Обновлены AGENTS/.gitignore/RPERF-007, defaults Playwright/captures/coverage/серверных профилей и текущие команды README. Сохранены2 неизменяемые JSON-фикстуры аватаров; значения, проверяемые тестами, не изменены. Compare-render больше не требует удалённый архив: его checksum опционален через MEASURE_BASELINE_ARCHIVE.

Проверки на Node24.22.2/M4/Chrome156:

- `NODE_OPTIONS=--no-experimental-webstorage make client-test`:485/485,60 files.
- `npm --prefix client run check`:0 errors/0 warnings; `check:imports` и `build`PASS. Обычное предупреждение bundle>500kB сохраняется.
- Отдельный Vitest config с include scripts/avatar-models.checks.mjs:12/12; проверены утверждённые GLB, geometry и transforms из перенесённых fixture inputs.
- `npm --prefix server run check`:PASS. Обычный make server-test:732pass/12fail/15skip из-за auto-selection установленного домашнего каталога LLM в llm-diagnostic.test.ts. Снятие KUDA env не помогает, так как defaultProfilesPath использует os.homedir. Код диагностик и этих tests не менялся.
- `NODE_OPTIONS=--import=<external-isolated-home.mjs> make server-test`:744pass/15skip,54 files. Внешний preload заменяет только os.homedir и вызывает syncBuiltinESMExports; HOME, пользовательские файлы/настройки и runtime проекта не изменялись. Каталоги profiles явных test fixtures продолжают проверяться.
- Chrome graphics/shotgun (FPS chart и V/fire/reload):2/2; один WebGL MOVE pickup/carry/place30FPS:PASS, actual29.85 FPS. Скриншоты и видео созданы во временном competition-2026-artifacts вне checkout.
- `OPERATOR_CHROMIUM_EXECUTABLE=<Chrome> node server/test/operator.browser.mjs`:PASS;11 снимков во внешнем admin-panel-sections. HTTP/SQLite/Socket.IO и controlled API fixtures, без квалификации физической LAN/LLM.
- Дополнительный legacy hub scenario остановился на ERR_CERT_AUTHORITY_INVALID при HTTP→HTTPS/self-signed redirect; trace/error-context корректно созданы вне checkout. Это существующий TLS integration gate (TASK-098), его не объявляем пройденным и не расширяем scope очистки.
- git diff --check, пути всех6 Playwright configs/coverage, отсутствие executable ссылок на tasks/evidence, Markdown links и git check-ignore:PASS. После проверок удалённая папка не восстановилась; исходный пользовательский pasture.glb сохранён.

Логи этой проверки находятся только во внешнем временном каталоге ОС, в Git не добавляются. Сырые материалы предыдущих проверок удалены по явному запросу; их исторические результаты в задачах не означают наличия старых архивов/скриншотов.
