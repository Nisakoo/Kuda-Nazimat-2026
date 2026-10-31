# Промежуточные доказательства UI

Исходная база: fc8724f28c8779407db9b142a93a20db0477513d. Ветка: impl/client-auth-hud-669eb5. Эти результаты относятся к промежуточным незавершённым изменениям, не к финальной поставке.

- client-check.log / client-imports.log / client-build.log: прошли до расширения scope, сборка с предупреждением о размере JS.
- client-test.log: первый общий прогон 189 passed / 2 failed. Тест онлайн-обновлений исправлен по синхронизации fake clock; тест второго I перенесён на правильную UI-границу. Нужен повтор полного прогона.
- server-test.log: 128 passed / 3 failed (таймауты a-real-world/building-height); приёмка не заявляется.
- ui-browser-initial.log: запуск остановился из-за занятого preview-порта 4173. Новый playwright.ui.config.ts отделяет real-server suite от preview.
- Последующие browser-логи ещё предварительные.
- Runtime: Node v24.22.2, Linux/Chromium с программным WebGL; сервер настоящий node:sqlite/Socket.IO/HTTP, npc adapter scripted, BABEL backend test. Реальная LLM, LAN на 4 устройствах, выключенный Wi-Fi и физический Pointer Lock не проверены.

После запроса пользователя fetch origin/main получил bcb20dfc965c3aad96d980999b75f4b8e7a9f9a6. Текущие изменения сохраняются отдельным WIP-коммитом перед интеграцией. Визуальная приёмка НЕ пройдена: отсутствует фон города, карта схематичная, пропорции/детали отличаются от макетов. Требуется отдельный проход коррекции и client-avatar-select.
