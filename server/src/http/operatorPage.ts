/**
 * OFFLINE-010 / OBS-010: a self-contained page for the person running the server. It polls
 * /api/operator/status every 2 s and renders values with textContent only, so player names are never HTML.
 * Actions are POSTed with X-Operator: 1 from this same origin (AUTH-010 CSRF guard).
 */
export const OPERATOR_PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Вавилон — экран ведущего</title>
<style>
  body { font: 18px/1.4 system-ui, sans-serif; margin: 24px; background: #f6f1e7; color: #2b2620; }
  h1 { font-size: 28px; margin: 0 0 16px; } h2 { font-size: 20px; margin: 24px 0 8px; }
  .urls li { font: 600 32px/1.3 ui-monospace, monospace; }
  .muted { color: #7a6f60; }
  table { border-collapse: collapse; } td, th { padding: 6px 16px 6px 0; text-align: left; vertical-align: top; }
  #health { display: inline-block; padding: 6px 14px; border-radius: 6px; font-weight: 600; }
  .green { background: #cfe8d0; } .yellow { background: #f6e3a1; } .red { background: #f2b8b2; }
  button { font: inherit; padding: 4px 10px; margin-right: 6px; cursor: pointer; }
  #result { font: 600 22px ui-monospace, monospace; } #error { color: #a3271f; }
</style>
</head>
<body>
<h1>Вавилон — экран ведущего</h1>
<p>Откройте в браузере на устройстве игрока:</p>
<ul class="urls" id="urls"></ul>
<p><span id="health"></span> <strong id="seats"></strong> · NPC: <span id="npc"></span> · переводчик: <span id="language"></span> · <span class="muted" id="uptime"></span></p>
<ul id="reasons"></ul>
<h2>Игроки</h2>
<table><thead><tr><th>Игрок</th><th>Карта</th><th>Состояние</th><th>Связь</th><th>FPS</th><th>В игре</th><th></th></tr></thead><tbody id="players"></tbody></table>
<h2>Аккаунт</h2>
<p><input id="name" placeholder="Имя игрока" maxlength="32">
<button data-action="reset-password">Выдать временный пароль</button><button data-action="revoke">Завершить сессии</button><button data-action="unlock">Снять блокировку входа</button>
<button data-action="dump">Сохранить отчёт</button></p>
<p id="result"></p>
<h2>Последние предупреждения</h2>
<table><tbody id="warnings"></tbody></table>
<p id="error"></p>
<script>
const $ = (id) => document.getElementById(id);
const LEVEL = { green: 'Всё в порядке', yellow: 'Есть предупреждения', red: 'Нужна помощь' };
function cell(text) { const td = document.createElement('td'); td.textContent = text; return td; }
function row(cells) { const tr = document.createElement('tr'); tr.append(...cells.map((c) => typeof c === 'string' ? cell(c) : c)); return tr; }
function item(text) { const li = document.createElement('li'); li.textContent = text; return li; }
async function act(action, name) {
  if (action !== 'dump' && !name) { $('result').textContent = 'Введите имя игрока.'; return; }
  const question = { 'reset-password': 'Выдать новый временный пароль игроку «' + name + '»? Его текущие сессии завершатся.', revoke: 'Завершить все сессии игрока «' + name + '»?', unlock: 'Снять блокировку входа для «' + name + '»?', dump: 'Сохранить отчёт для разработчика?' }[action];
  if (!confirm(question)) return;
  const response = await fetch('/api/operator/actions/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operator': '1' }, body: JSON.stringify(action === 'dump' ? {} : { name }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { $('result').textContent = (body.error && body.error.message) || 'Не получилось.'; return; }
  $('result').textContent = action === 'reset-password' ? 'Временный пароль для «' + body.name + '»: ' + body.temporaryPassword + ' (покажите игроку, больше он не отобразится)'
    : action === 'revoke' ? 'Завершено сессий: ' + body.revoked : action === 'unlock' ? (body.unlocked ? 'Блокировка снята.' : 'Блокировки не было.') : 'Отчёт сохранён: ' + body.file;
}
for (const button of document.querySelectorAll('button[data-action]')) button.addEventListener('click', () => act(button.dataset.action, $('name').value.trim()));
async function refresh() {
  try {
    const status = await (await fetch('/api/operator/status', { cache: 'no-store' })).json();
    $('urls').replaceChildren(...status.addresses.map(item));
    $('health').className = status.health.level; $('health').textContent = LEVEL[status.health.level];
    $('reasons').replaceChildren(...status.health.reasons.map((r) => item(r.text)));
    $('seats').textContent = 'Места: ' + status.seats.used + ' из ' + status.seats.max;
    $('npc').textContent = status.npc === 'ready' ? 'готовы' : 'недоступны';
    $('language').textContent = status.language === 'ready' ? 'готов' : 'недоступен';
    $('uptime').textContent = 'работает ' + Math.floor(status.uptimeSeconds / 60) + ' мин';
    $('players').replaceChildren(...status.players.map((p) => {
      const kick = document.createElement('button'); kick.textContent = 'Завершить'; kick.addEventListener('click', () => act('revoke', p.name));
      const link = (p.rttMs === null ? '—' : p.rttMs + ' мс') + (p.reconnects >= 3 ? ', нестабильно (' + p.reconnects + ')' : p.reconnects ? ', переподключений: ' + p.reconnects : '');
      const td = document.createElement('td'); td.append(kick);
      return row([p.name, p.mapId || '—', p.connected ? 'подключён' : 'вышел, место удержано ' + Math.ceil(p.releaseInMs / 1000) + ' с', link, p.perf && p.perf.fps !== null ? Math.round(p.perf.fps) + ' (' + Math.round(p.perf.ageMs / 1000) + ' с назад)' : 'нет данных', Math.floor(p.seatedSeconds / 60) + ' мин', td]);
    }));
    $('warnings').replaceChildren(...status.warnings.map((w) => row([w.ts.slice(11, 19), w.level === 'warn' ? 'внимание' : 'ошибка', w.msg, w.event])));
    $('error').textContent = '';
  } catch { $('error').textContent = 'Нет связи с сервером.'; }
}
refresh(); setInterval(refresh, 2000);
</script>
</body>
</html>
`;
