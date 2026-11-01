/**
 * OFFLINE-010: a self-contained page for the person running the server. It polls /api/operator/status
 * every 2 s and renders values with textContent only, so player names are never interpreted as HTML.
 */
export const OPERATOR_PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Вавилон — экран ведущего</title>
<style>
  body { font: 18px/1.4 system-ui, sans-serif; margin: 24px; background: #f6f1e7; color: #2b2620; }
  h1 { font-size: 28px; margin: 0 0 16px; }
  .urls li { font: 600 32px/1.3 ui-monospace, monospace; }
  .muted { color: #7a6f60; }
  table { border-collapse: collapse; margin-top: 8px; }
  td, th { padding: 6px 16px 6px 0; text-align: left; }
  #error { color: #a3271f; }
</style>
</head>
<body>
<h1>Вавилон — экран ведущего</h1>
<p>Откройте в браузере на устройстве игрока:</p>
<ul class="urls" id="urls"></ul>
<p><strong id="seats"></strong> · NPC: <span id="npc"></span> · <span class="muted" id="uptime"></span></p>
<table><thead><tr><th>Игрок</th><th>Карта</th><th>Состояние</th></tr></thead><tbody id="players"></tbody></table>
<p id="error"></p>
<script>
const $ = (id) => document.getElementById(id);
function row(cells) { const tr = document.createElement('tr'); for (const text of cells) { const td = document.createElement('td'); td.textContent = text; tr.append(td); } return tr; }
async function refresh() {
  try {
    const status = await (await fetch('/api/operator/status', { cache: 'no-store' })).json();
    $('urls').replaceChildren(...status.addresses.map((url) => { const li = document.createElement('li'); li.textContent = url; return li; }));
    $('seats').textContent = 'Места: ' + status.seats.used + ' из ' + status.seats.max;
    $('npc').textContent = status.npc === 'ready' ? 'готовы' : 'недоступны';
    $('uptime').textContent = 'работает ' + Math.floor(status.uptimeSeconds / 60) + ' мин';
    $('players').replaceChildren(...status.players.map((p) => row([p.name, p.mapId ?? '—', p.connected ? 'подключён' : 'вышел, место удержано ' + Math.ceil(p.releaseInMs / 1000) + ' с'])));
    $('error').textContent = '';
  } catch { $('error').textContent = 'Нет связи с сервером.'; }
}
refresh(); setInterval(refresh, 2000);
</script>
</body>
</html>
`;
