/**
 * ADMIN-001–009: self-contained admin page. The admin token lives in sessionStorage of the tab and is
 * sent as Bearer (no cookies, so cross-site requests cannot act as the admin). Values are rendered
 * with textContent only.
 */
export const ADMIN_PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Вавилон — администратор</title>
<style>
  body { font: 15px/1.4 system-ui, sans-serif; margin: 0; background: #f6f1e7; color: #2b2620; }
  header { display: flex; gap: 12px; align-items: center; padding: 10px 20px; background: #2f5d5a; color: #fff; }
  header h1 { font-size: 18px; margin: 0 16px 0 0; } header button { margin-left: auto; }
  nav button { background: none; border: 0; color: #dfeee9; font: inherit; padding: 6px 10px; cursor: pointer; } nav button.on { color: #fff; border-bottom: 2px solid #fff; }
  main { padding: 16px 20px; } section { display: none; } section.on { display: block; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; } td, th { padding: 5px 8px; border-bottom: 1px solid #e3d9c6; text-align: left; vertical-align: top; }
  th { cursor: pointer; } tr.bad { background: #f8dcd6; } .muted { color: #7a6f60; } .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
  .card { background: #fffaf0; border: 1px solid #e3d9c6; border-radius: 6px; padding: 10px; } .card b { display: block; font-size: 22px; }
  #health { padding: 4px 10px; border-radius: 6px; } .green { background: #cfe8d0; color: #1f3d21; } .yellow { background: #f6e3a1; color: #4a3b06; } .red { background: #f2b8b2; color: #4d1510; }
  form, .box { background: #fffaf0; border: 1px solid #e3d9c6; border-radius: 6px; padding: 14px; max-width: 520px; }
  label { display: block; margin: 8px 0 2px; } input, textarea, select { font: inherit; width: 100%; box-sizing: border-box; padding: 5px; } textarea { min-height: 70px; }
  button { font: inherit; padding: 5px 12px; margin: 6px 6px 0 0; cursor: pointer; } button:disabled { opacity: .45; cursor: not-allowed; }
  #message { min-height: 1.4em; font-weight: 600; } .err { color: #a3271f; } .ok { color: #1f5d2c; }
  .flex { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; }
</style>
</head>
<body>
<header><h1>Вавилон — администратор</h1><nav id="tabs"></nav><span id="who"></span><button id="logout" hidden>Выйти</button></header>
<main>
<p id="message"></p>
<form id="login" hidden>
  <h2>Вход администратора</h2>
  <label for="name">Имя</label><input id="name" autocomplete="username" maxlength="32" required>
  <label for="password">Пароль</label><input id="password" type="password" autocomplete="current-password" required>
  <button type="submit">Войти</button><button type="button" id="dev" hidden>Войти без пароля (development)</button>
</form>
<form id="change" hidden>
  <h2>Задайте свой пароль</h2><p class="muted">Вы вошли временным паролем. После смены войдите снова.</p>
  <label for="newPassword">Новый пароль (от 6 символов)</label><input id="newPassword" type="password" autocomplete="new-password" required>
  <button type="submit">Сменить пароль</button>
</form>
<section id="server"><div class="flex"><span id="health"></span><span id="meta" class="muted"></span></div><ul id="reasons"></ul><div class="grid" id="cards"></div>
  <h3>Ошибки по событиям</h3><table><thead><tr><th>Событие</th><th>За 5 мин</th><th>За 60 мин</th></tr></thead><tbody id="errors"></tbody></table>
  <h3>Последние предупреждения и ошибки</h3><table><tbody id="warnings"></tbody></table></section>
<section id="clients"><table><thead><tr id="clientHead"></tr></thead><tbody id="clientRows"></tbody></table><p class="muted">Красным — ping больше 150 мс, FPS меньше 30 или 3+ переподключения за 10 мин. FPS приходит от клиента; «нет данных» — клиент не прислал отчёт за 30 с.</p></section>
<section id="npcs"><div class="flex"><div><label><input type="checkbox" id="showDeleted" style="width:auto"> показывать удалённых</label><table><thead><tr><th>NPC</th><th>Карта</th><th>Состояние</th><th>Тема</th></tr></thead><tbody id="npcRows"></tbody></table></div>
  <div class="box" id="editor" hidden><h3 id="npcTitle"></h3><p id="npcInfo" class="muted"></p><p id="npcLimits" class="err"></p>
    <label for="persona">Персона</label><textarea id="persona" maxlength="500"></textarea>
    <label for="topic">Тема</label><input id="topic" maxlength="80">
    <label for="greeting">Приветствие</label><textarea id="greeting" maxlength="500"></textarea>
    <label for="radius">Радиус разговора, м (0,5–10)</label><input id="radius" type="number" step="0.1" min="0.5" max="10">
    <button id="save">Сохранить поведение</button>
    <h4>Позиция</h4><div class="flex"><div><label for="x">x</label><input id="x" type="number" step="0.1"></div><div><label for="z">z</label><input id="z" type="number" step="0.1"></div><div><label for="rot">поворот, рад</label><input id="rot" type="number" step="0.1"></div></div>
    <button id="move">Переместить</button><button id="toggle"></button><button id="remove">Удалить</button></div></div></section>
<section id="changes"><label for="changeNpc">NPC</label><select id="changeNpc"><option value="">все</option></select><table><thead><tr><th>Время</th><th>NPC</th><th>Действие</th><th>Кто</th><th>IP</th><th>Изменения</th></tr></thead><tbody id="changeRows"></tbody></table></section>
<section id="accounts"><div class="box"><label for="account">Имя игрока</label><input id="account" maxlength="32">
  <button data-account="reset-password">Выдать временный пароль</button><button data-account="revoke">Завершить сессии</button><button data-account="unlock">Снять блокировку входа</button></div></section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const TABS = [['server', 'Сервер'], ['clients', 'Клиенты'], ['npcs', 'NPC'], ['changes', 'Журнал'], ['accounts', 'Аккаунты']];
let token = null; try { token = sessionStorage.getItem('adminToken'); } catch {}
let npcs = []; let selected = null; let sort = { key: 'name', dir: 1 }; let timer = null;
const say = (text, ok) => { $('message').textContent = text || ''; $('message').className = ok ? 'ok' : 'err'; };
const cell = (text) => { const td = document.createElement('td'); td.textContent = text == null ? '—' : String(text); return td; };
const row = (cells, bad) => { const tr = document.createElement('tr'); if (bad) tr.className = 'bad'; tr.append(...cells.map((c) => c instanceof Node ? c : cell(c))); return tr; };
const ms = (v) => v == null ? '—' : (Math.round(v * 10) / 10) + ' мс';
const mb = (v) => v == null ? '—' : Math.round(v / 1048576) + ' МБ';
function store(value) { token = value; try { value ? sessionStorage.setItem('adminToken', value) : sessionStorage.removeItem('adminToken'); } catch {} }
async function api(method, path, body) {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store' });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.status === 401 && path !== '/api/admin/login') { signedOut('Сессия администратора закончилась. Войдите снова.'); throw new Error('unauthorized'); }
  return { status: response.status, data };
}
function show(view) {
  $('login').hidden = view !== 'login'; $('change').hidden = view !== 'change';
  $('tabs').hidden = $('logout').hidden = view !== 'panel';
  for (const [id] of TABS) $(id).classList.toggle('on', view === 'panel' && current === id);
}
let current = 'server';
for (const [id, title] of TABS) { const b = document.createElement('button'); b.textContent = title; b.onclick = () => { current = id; for (const x of $('tabs').children) x.classList.toggle('on', x === b); show('panel'); refresh(); }; if (id === current) b.className = 'on'; $('tabs').append(b); }
function signedOut(text) { store(null); clearInterval(timer); timer = null; $('who').textContent = ''; show('login'); say(text); }
async function start() {
  const mode = await (await fetch('/api/auth/mode')).json().catch(() => ({}));
  $('dev').hidden = !mode.dev;
  if (!token) { show('login'); return; }
  show('panel'); await refresh(); timer = setInterval(() => { if (current === 'server' || current === 'clients') refresh(); }, 2000);
}
let pending = null;
$('login').onsubmit = async (e) => {
  e.preventDefault(); say('');
  const credentials = { name: $('name').value.trim(), password: $('password').value };
  const r = await api('POST', '/api/admin/login', credentials);
  if (r.status === 200) { store(r.data.token); $('password').value = ''; start(); return; }
  if (r.data && r.data.error && r.data.error.code === 'PASSWORD_CHANGE_REQUIRED') { pending = credentials; show('change'); say(r.data.error.message); return; }
  say(r.data && r.data.error ? r.data.error.message : 'Не удалось войти.');
};
$('dev').onclick = async () => { const r = await api('POST', '/api/admin/dev', {}); if (r.status === 200) { store(r.data.token); start(); } else say(r.data && r.data.error ? r.data.error.message : 'Не удалось войти.'); };
$('change').onsubmit = async (e) => {
  e.preventDefault();
  const r = await api('POST', '/api/auth/password', { name: pending.name, password: pending.password, newPassword: $('newPassword').value });
  if (r.status !== 200) { say(r.data && r.data.error ? r.data.error.message : 'Не удалось сменить пароль.'); return; }
  if (r.data && r.data.token) fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + r.data.token } });
  $('newPassword').value = ''; $('password').value = ''; pending = null; show('login'); say('Пароль изменён. Войдите с новым паролем.', true);
};
$('logout').onclick = async () => { await api('POST', '/api/admin/logout').catch(() => {}); signedOut('Вы вышли.'); };
async function refresh() {
  try {
    if (current === 'server' || current === 'clients') renderStatus((await api('GET', '/api/admin/status')).data);
    if (current === 'npcs' || current === 'changes') await loadNpcs();
    if (current === 'changes') await loadChanges();
  } catch {}
}
function renderStatus(s) {
  if (!s) return;
  $('who').textContent = 'администратор: ' + s.admin;
  $('health').className = s.health.level; $('health').textContent = { green: 'Всё в порядке', yellow: 'Есть предупреждения', red: 'Нужна помощь' }[s.health.level];
  $('meta').textContent = s.env + ' · версия ' + s.version + (s.commit ? ' (' + s.commit + ')' : '') + ' · работает ' + Math.floor(s.uptimeSeconds / 60) + ' мин · места ' + s.seats.used + ' из ' + s.seats.max + ' · NPC: ' + (s.npcReady ? 'готовы' : 'недоступны') + ' · переводчик: ' + (s.languageReady ? 'готов' : 'недоступен');
  $('reasons').replaceChildren(...s.health.reasons.map((r) => { const li = document.createElement('li'); li.textContent = r.text; return li; }));
  const v = s.server; const cards = [
    ['Шаг сервера', v.tick ? 'p50 ' + ms(v.tick.p50) + ' · p95 ' + ms(v.tick.p95) + ' · макс ' + ms(v.tick.max) : 'считается…'],
    ['Интервал рассылки', v.broadcast ? 'p95 ' + ms(v.broadcast.p95) + ' · макс ' + ms(v.broadcast.max) : 'считается…'],
    ['Очередь NPC', 'в очереди ' + v.npc.queued + ' · выполняются ' + v.npc.running + ' · незавершённых ' + v.npc.unfinished + ' из 4'],
    ['NPC за 5 мин', 'принято ' + v.npc.requests5m + ' · ответов ' + v.npc.completed5m + ' · таймаутов ' + v.npc.timeouts5m + ' · «занято» ' + v.npc.busy5m],
    ['NPC, p95 с запуска', 'первый текст ' + ms(v.npc.firstPartialP95) + ' · генерация ' + ms(v.npc.generationP95)],
    ['Память', 'RSS ' + mb(v.memory.rss) + ' · куча ' + mb(v.memory.heapUsed) + ' · event loop p99 ' + ms(v.memory.eventLoopP99)],
    ['Ошибки', 'за 5 мин ' + v.errors.last5m + ' · за 60 мин ' + v.errors.last60m + ' · HTTP 5xx ' + v.errors.http5xx5m + ' · БД ' + v.errors.db5m + ' · потеряно строк журнала ' + v.errors.logDropped5m],
    ['Диск и БД', 'свободно ' + mb(v.diskFreeBytes) + ' · БД ' + mb(v.dbBytes)],
  ];
  $('cards').replaceChildren(...cards.map(([t, x]) => { const d = document.createElement('div'); d.className = 'card'; const b = document.createElement('span'); b.className = 'muted'; b.textContent = t; const p = document.createElement('div'); p.textContent = x; d.append(b, p); return d; }));
  $('errors').replaceChildren(...v.errors.byEvent.map((e) => row([e.event, e.last5m, e.last60m])));
  $('warnings').replaceChildren(...s.warnings.map((w) => row([w.ts.slice(11, 19), w.level, w.event, w.msg])));
  const cols = [['name', 'Игрок'], ['mapId', 'Карта'], ['state', 'Состояние'], ['ip', 'IP'], ['rttMs', 'Ping, мс'], ['fps', 'FPS'], ['frameMs', 'Кадр, мс'], ['drawCalls', 'Draw calls'], ['perfAge', 'Отчёт, с'], ['reconnects', 'Переподкл.'], ['minutes', 'В игре, мин']];
  $('clientHead').replaceChildren(...cols.map(([k, t]) => { const th = document.createElement('th'); th.textContent = t + (sort.key === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''); th.onclick = () => { sort = { key: k, dir: sort.key === k ? -sort.dir : 1 }; renderStatus(s); }; return th; }));
  const rows = s.players.map((p) => ({ name: p.name, mapId: p.mapId, state: p.connected ? 'подключён' : 'вышел, место удержано ' + Math.ceil(p.releaseInMs / 1000) + ' с', ip: p.ip, rttMs: p.rttMs, fps: p.perf ? p.perf.fps : null, frameMs: p.perf ? p.perf.frameMs : null, drawCalls: p.perf ? p.perf.drawCalls : null, perfAge: p.perf ? Math.round(p.perf.ageMs / 1000) : null, reconnects: p.reconnects, minutes: Math.floor(p.seatedSeconds / 60) }));
  rows.sort((a, b) => (a[sort.key] ?? -Infinity) > (b[sort.key] ?? -Infinity) ? sort.dir : -sort.dir);
  $('clientRows').replaceChildren(...rows.map((r) => row(cols.map(([k]) => r[k] == null ? (k === 'fps' ? 'нет данных' : '—') : (typeof r[k] === 'number' && !Number.isInteger(r[k]) ? Math.round(r[k] * 10) / 10 : r[k])), (r.rttMs ?? 0) > 150 || (r.fps !== null && r.fps < 30) || r.reconnects >= 3)));
}
const STATE = { active: 'включён', disabled: 'выключен', deleted: 'удалён' };
async function loadNpcs() {
  const r = await api('GET', '/api/admin/npcs' + ($('showDeleted').checked ? '?deleted=1' : ''));
  npcs = r.data ? r.data.npcs : [];
  $('npcRows').replaceChildren(...npcs.map((n) => { const tr = row([n.name, n.mapId, STATE[n.state], n.topic]); tr.style.cursor = 'pointer'; tr.onclick = () => select(n.id); return tr; }));
  const options = [['', 'все'], ...npcs.map((n) => [n.id, n.name])];
  const value = $('changeNpc').value;
  $('changeNpc').replaceChildren(...options.map(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; })); $('changeNpc').value = value;
  if (selected) select(selected);
}
function select(id) {
  const n = npcs.find((x) => x.id === id); selected = n ? id : null; $('editor').hidden = !n; if (!n) return;
  $('npcTitle').textContent = n.name + ' (' + n.id + ')';
  $('npcInfo').textContent = STATE[n.state] + ' · ревизия ' + n.revision + ' · изменил ' + n.updatedBy + ' ' + new Date(n.updatedAt).toLocaleString() + ' · позиция ' + n.position.x.toFixed(1) + ', ' + n.position.z.toFixed(1);
  for (const [field, key] of [['persona', 'persona'], ['topic', 'topic'], ['greeting', 'greeting']]) $(field).value = n[key];
  $('radius').value = n.interactionRadius; $('x').value = n.position.x; $('z').value = n.position.z; $('rot').value = n.rotationY;
  const mapRule = n.restrictions.mapFigure ? 'Фигура нарисована в модели карты — нужна поддержка клиента.' : '';
  const babel = n.restrictions.babelRequired ? 'От этого NPC зависит задание BABEL: выключение и удаление пока запрещены.' : '';
  $('npcLimits').textContent = [mapRule, babel].filter(Boolean).join(' ');
  $('move').disabled = !!mapRule || n.state === 'deleted';
  $('toggle').textContent = n.state === 'disabled' ? 'Включить' : 'Выключить';
  $('toggle').disabled = !!mapRule || (n.state !== 'disabled' && !!babel) || n.state === 'deleted';
  $('remove').disabled = !!mapRule || !!babel || n.state === 'deleted';
  $('save').disabled = n.state === 'deleted';
}
async function act(method, path, body, question) {
  if (question && !confirm(question)) return;
  const r = await api(method, path, body);
  if (r.status === 200) { say('Сохранено. Ревизия ' + r.data.npc.revision + '.', true); await loadNpcs(); return; }
  if (r.status === 409 && r.data.current) say(r.data.error.message + ' Сейчас: ревизия ' + r.data.current.revision + ', изменил ' + r.data.current.updatedBy + '.');
  else say(r.data && r.data.error ? r.data.error.message : 'Не получилось.');
  await loadNpcs();
}
$('save').onclick = () => {
  const n = npcs.find((x) => x.id === selected); const patch = { revision: n.revision }; const changes = [];
  for (const [field, key, title] of [['persona', 'persona', 'персона'], ['topic', 'topic', 'тема'], ['greeting', 'greeting', 'приветствие']]) if ($(field).value.trim() !== n[key]) { patch[key] = $(field).value; changes.push(title); }
  if (Number($('radius').value) !== n.interactionRadius) { patch.interactionRadius = Number($('radius').value); changes.push('радиус'); }
  if (!changes.length) { say('Нет изменений.'); return; }
  act('PATCH', '/api/admin/npcs/' + n.id, patch, 'Сохранить изменения у «' + n.name + '»: ' + changes.join(', ') + '?');
};
$('move').onclick = () => { const n = npcs.find((x) => x.id === selected); act('POST', '/api/admin/npcs/' + n.id + '/move', { revision: n.revision, x: Number($('x').value), z: Number($('z').value), rotationY: Number($('rot').value) }, 'Переместить «' + n.name + '»?'); };
$('toggle').onclick = () => { const n = npcs.find((x) => x.id === selected); const on = n.state === 'disabled'; act('POST', '/api/admin/npcs/' + n.id + (on ? '/enable' : '/disable'), { revision: n.revision }, (on ? 'Включить' : 'Выключить') + ' «' + n.name + '»?'); };
$('remove').onclick = () => { const n = npcs.find((x) => x.id === selected); if (prompt('Удаление нельзя отменить. Введите имя NPC «' + n.name + '» для подтверждения:') !== n.name) { say('Удаление отменено.'); return; } act('POST', '/api/admin/npcs/' + n.id + '/delete', { revision: n.revision }); };
$('showDeleted').onchange = loadNpcs; $('changeNpc').onchange = loadChanges;
async function loadChanges() {
  const id = $('changeNpc').value; const r = await api('GET', '/api/admin/changes?limit=200' + (id ? '&npcId=' + encodeURIComponent(id) : ''));
  const ACTION = { seed: 'начальные данные', update: 'поведение', move: 'перемещение', disable: 'выключение', enable: 'включение', delete: 'удаление' };
  const text = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > 80 ? s.slice(0, 80) + '…' : s; };
  $('changeRows').replaceChildren(...(r.data ? r.data.changes : []).map((c) => row([new Date(c.at).toLocaleString(), c.npcId, ACTION[c.action] || c.action, c.actorName, c.ip, Object.entries(c.changes).map(([k, d]) => k + ': ' + text(d.from) + ' → ' + text(d.to)).join('; ')])));
}
for (const b of document.querySelectorAll('button[data-account]')) b.onclick = async () => {
  const name = $('account').value.trim(); if (!name) { say('Введите имя игрока.'); return; }
  if (!confirm('Выполнить «' + b.textContent + '» для «' + name + '»?')) return;
  const r = await api('POST', '/api/admin/accounts/' + b.dataset.account, { name });
  if (r.status !== 200) { say(r.data && r.data.error ? r.data.error.message : 'Не получилось.'); return; }
  say(b.dataset.account === 'reset-password' ? 'Временный пароль для «' + r.data.name + '»: ' + r.data.temporaryPassword + ' (покажите игроку, больше он не отобразится)' : b.dataset.account === 'revoke' ? 'Завершено сессий: ' + r.data.revoked : (r.data.unlocked ? 'Блокировка снята.' : 'Блокировки не было.'), true);
};
start();
</script>
</body>
</html>
`;
