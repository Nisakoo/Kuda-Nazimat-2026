'use strict';
// This script is embedded by operatorPage.ts. No remote assets or browser persistence.
// Every API value is rendered with textContent; charts are plain SVG built here.
(() => {
  const $ = id => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';
  const sections = {
    overview: ['Обзор', 'Состояние мира и подключённых игроков'],
    server: ['Сервер', 'Состояние и производительность сервера'],
    clients: ['Клиенты', 'Подключения и производительность игроков'],
    npc: ['NPC', 'Персонажи города и живой мир'],
    journal: ['Журнал действий', 'История изменений персонажей, мира и действий администратора'],
    accounts: ['Аккаунты', 'Управление доступом и сессиями игроков'],
  };
  const levels = { green: 'Всё в порядке', yellow: 'Есть предупреждения', red: 'Нужна помощь' };
  const levelNames = { info: 'Событие', warn: 'Предупреждение', error: 'Ошибка', fatal: 'Ошибка' };
  const actionNames = {
    'npc.seed': 'Начальные данные', 'npc.create': 'Создание', 'npc.update': 'Редактирование', 'npc.enable': 'Включение', 'npc.disable': 'Выключение',
    'npc.delete': 'Удаление', 'npc.restore': 'Восстановление', 'npc.reset': 'Сброс к исходному', 'world.reset-scene': 'Сброс сцены',
    'account.reset-password': 'Выдан временный пароль', 'account.revoke': 'Завершение сессий', 'account.unlock': 'Снятие блокировки', login: 'Вход в игру',
  };
  const fieldNames = { name: 'Имя', topic: 'Тема', persona: 'Характер', greeting: 'Приветствие', interactionRadius: 'Радиус', mapId: 'Карта', position: 'Позиция', rotationY: 'Поворот', assetId: 'Облик', enabled: 'Включён', deletedAt: 'Удалён' };
  const ALL_FIELDS = ['name', 'topic', 'persona', 'greeting', 'interactionRadius', 'mapId', 'position', 'rotationY', 'assetId', 'enabled'];
  const palette = ['#205d56', '#c88a1e', '#4a6fb5', '#b8505a', '#6b8e23', '#8a5bb0'];
  const DEFAULT_THRESHOLDS = { rttMs: 150, fps: 30, tickP95Ms: 5, tickP95RedMs: 20, broadcastP95Ms: 120, eventLoopP99Ms: 50 };
  let currentSection = 'overview';
  let status = null;
  let history = null;
  let lastUpdate = null;
  let refreshing = false;
  let historyAt = 0;
  let selectedAccount = null;
  let accountRequest = 0;
  let acting = false;
  let npcData = null;
  let npcSelected = null; // NpcView, or { create: true, ... } for a new one
  let worldData = null;
  let journalPage = 1;
  let journalEntries = [];
  const thresholds = () => ({ ...DEFAULT_THRESHOLDS, ...(status?.thresholds || {}) });
  const isNum = value => typeof value === 'number' && Number.isFinite(value);
  const fmt = new Intl.NumberFormat('ru', { maximumFractionDigits: 1 });
  const number = (value, suffix = '') => value === 'inf' ? 'выше шкалы' : isNum(value) ? fmt.format(value) + suffix : 'нет данных';
  const mb = bytes => isNum(bytes) ? bytes / 1024 ** 2 : null;
  const time = value => new Date(value).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const shortTime = value => new Date(value).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const dateTime = value => new Date(value).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const minutes = value => number(Math.floor(value / 60));
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined && text !== null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }
  function svg(tag, attrs = {}, text) {
    const element = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
    if (text !== undefined) element.textContent = String(text);
    return element;
  }
  function row(values) {
    const tr = node('tr');
    tr.append(...values.map(value => value instanceof HTMLElement && value.tagName === 'TD' ? value : node('td', value)));
    return tr;
  }
  function emptyRow(text, columns) {
    const td = node('td', text, 'empty'); td.colSpan = columns;
    return row([td]);
  }
  function warnedCell(value, warning) {
    const td = node('td', value, warning ? 'threshold' : '');
    if (warning) td.append(node('small', warning));
    return td;
  }
  function cards(id, values) {
    $(id).replaceChildren(...values.map(([title, value, caption, warning]) => {
      const card = node('article', undefined, 'card' + (warning ? ' warned' : ''));
      card.append(node('h2', title), node('strong', value), node('p', warning || caption));
      return card;
    }));
  }
  function list(id, entries) {
    $(id).replaceChildren(...entries.map(([key, value, warning]) => {
      const entry = node('div'); const dd = node('dd', value, warning ? 'threshold' : '');
      if (warning) dd.append(node('small', warning));
      entry.append(node('dt', key), dd); return entry;
    }));
  }
  function notify(text, error = false) {
    $('toast-text').textContent = text;
    $('toast').className = error ? 'toast error' : 'toast';
    $('toast').hidden = false;
  }
  async function request(path, options = {}) {
    const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(8000), ...options });
    const body = await response.json().catch(() => null);
    if (!response.ok) { const error = new Error(body?.error?.message || 'Сервер ответил ошибкой (' + response.status + ').'); error.status = response.status; throw error; }
    if (body === null) throw new Error('Сервер вернул некорректный ответ.');
    return body;
  }
  const change = (path, method, data) => request(path, { method, headers: { 'Content-Type': 'application/json', 'X-Operator': '1' }, body: JSON.stringify(data ?? {}) });

  // ---------- Charts: SVG, no libraries. Values: number | null (gap) | "inf" (above the scale).
  function chart(id, series, options = {}) {
    const box = $(id);
    const numeric = series.flatMap(s => s.points.map(p => p[1]).filter(isNum));
    const hasInf = series.some(s => s.points.some(p => p[1] === 'inf'));
    if (!numeric.length && !hasInf) { box.replaceChildren(node('p', options.empty || 'Нет данных за последние 4 часа.', 'empty')); return; }
    const W = 640, H = 220, L = 48, R = 12, T = 12, B = 28;
    const all = series.flatMap(s => s.points.map(p => p[0]));
    const x0 = Math.min(...all), x1 = Math.max(...all, x0 + 1);
    const lines = (options.thresholds || []).filter(t => isNum(t.value));
    let yMax = Math.max(options.min ?? 0, ...numeric, ...lines.map(t => t.value * 1.15));
    if (yMax <= 0) yMax = 1;
    const nice = 10 ** Math.floor(Math.log10(yMax)); yMax = Math.ceil(yMax / nice) * nice;
    const X = t => L + (t - x0) / (x1 - x0) * (W - L - R);
    const Y = v => T + (1 - Math.min(v, yMax) / yMax) * (H - T - B);
    const root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': options.label || '' });
    for (let i = 0; i <= 4; i++) {
      const v = yMax * i / 4, y = Y(v);
      root.append(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'grid' }), svg('text', { x: L - 6, y: y + 4, 'text-anchor': 'end', class: 'axis' }, fmt.format(v)));
    }
    for (let i = 0; i <= 4; i++) {
      const t = x0 + (x1 - x0) * i / 4;
      root.append(svg('text', { x: X(t), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle', class: 'axis' }, shortTime(t)));
    }
    for (const t of lines) {
      const y = Y(t.value);
      root.append(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'limit' }), svg('text', { x: W - R, y: y - 4, 'text-anchor': 'end', class: 'limit-label' }, t.label));
    }
    const plot = raw => raw === 'inf' ? yMax : raw;
    series.forEach((s, index) => {
      const color = s.color || palette[index % palette.length];
      let d = '', open = false;
      for (const [t, raw] of s.points) {
        const v = plot(raw);
        if (!isNum(v)) { open = false; continue; }
        d += (open ? 'L' : 'M') + X(t).toFixed(1) + ' ' + Y(v).toFixed(1) + ' '; open = true;
      }
      if (d) root.append(svg('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
      // An isolated point between gaps would be invisible as a path.
      s.points.forEach(([t, raw], i) => {
        const v = plot(raw);
        if (isNum(v) && !isNum(plot(s.points[i - 1]?.[1])) && !isNum(plot(s.points[i + 1]?.[1]))) root.append(svg('circle', { cx: X(t), cy: Y(v), r: 2.5, fill: color }));
      });
    });
    const cursor = svg('line', { y1: T, y2: H - B, class: 'cursor', visibility: 'hidden' });
    const tip = svg('g', { visibility: 'hidden', class: 'chart-tip' });
    const tipBox = svg('rect', { rx: 4, class: 'tip' });
    tip.append(tipBox);
    const hit = svg('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent', class: 'hit' });
    root.append(cursor, tip, hit);
    const unit = options.unit || '';
    const nearest = (s, t) => s.points.reduce((best, p) => !best || Math.abs(p[0] - t) < Math.abs(best[0] - t) ? p : best, null);
    hit.addEventListener('mousemove', event => {
      const rect = root.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width * W;
      const t = x0 + Math.max(0, Math.min(1, (px - L) / (W - L - R))) * (x1 - x0);
      const at = nearest(series.find(s => s.points.length) || { points: [] }, t);
      if (!at) return;
      const text = [shortTime(at[0])].concat(series.map(s => { const p = nearest(s, at[0]); return s.name + ': ' + (p ? number(p[1], unit) : 'нет данных'); }));
      while (tip.childNodes.length > 1) tip.lastChild.remove();
      text.forEach((line, i) => tip.append(svg('text', { x: 8, y: 18 + i * 17, class: 'tip-text' }, line)));
      const width = Math.max(...text.map(line => line.length)) * 7.8 + 16, height = text.length * 17 + 8;
      tipBox.setAttribute('width', width); tipBox.setAttribute('height', height);
      const cx = X(at[0]);
      cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
      tip.setAttribute('transform', 'translate(' + Math.min(Math.max(cx + 8, L), W - R - width) + ',' + T + ')');
      tip.setAttribute('visibility', 'visible');
    });
    hit.addEventListener('mouseleave', () => { cursor.setAttribute('visibility', 'hidden'); tip.setAttribute('visibility', 'hidden'); });
    const legend = node('ul', undefined, 'legend');
    series.forEach((s, index) => {
      const item = node('li'); const swatch = node('span', undefined, 'swatch'); swatch.style.background = s.color || palette[index % palette.length];
      const last = [...s.points].reverse().find(p => p[1] !== null);
      item.append(swatch, document.createTextNode(s.name + ' — ' + (last ? number(last[1], unit) : 'нет данных')));
      legend.append(item);
    });
    if (hasInf) legend.append(node('li', 'Точки на верхней границе — значения выше шкалы.', 'muted'));
    box.replaceChildren(root, legend);
  }
  const seriesOf = name => history?.series?.[name] || [];
  const toMb = points => points.map(([t, v]) => [t, isNum(v) ? v / 1024 ** 2 : v]);
  function renderCharts() {
    if (!history) return;
    const th = thresholds();
    chart('chart-players', [{ name: 'На местах', points: seriesOf('seated') }, { name: 'Подключены', points: seriesOf('connected') }], { thresholds: [{ value: history.thresholds?.seats ?? status?.seats?.max, label: 'мест' }], label: 'Игроки онлайн' });
    chart('chart-npc', [{ name: 'Первый текст, p95', points: seriesOf('npcFirstPartialP95Ms') }, { name: 'Генерация, p95', points: seriesOf('npcGenerationP95Ms') }], { unit: ' мс', label: 'Время ответа NPC', empty: 'Вопросов к NPC за последние 4 часа не было.' });
    chart('chart-perf', [{ name: 'Шаг сервера, p95', points: seriesOf('tickP95Ms') }, { name: 'Интервал рассылки, p95', points: seriesOf('broadcastP95Ms') }], { unit: ' мс', thresholds: [{ value: th.tickP95Ms, label: 'шаг ' + th.tickP95Ms + ' мс' }, { value: th.broadcastP95Ms, label: 'рассылка ' + th.broadcastP95Ms + ' мс' }], label: 'Производительность сервера' });
    chart('chart-memory', [{ name: 'RSS', points: toMb(seriesOf('rssBytes')) }, { name: 'Куча', points: toMb(seriesOf('heapBytes')) }], { unit: ' МБ', label: 'Память' });
    const players = Object.entries(history.players || {});
    const label = (id, p) => p.name || 'игрок ' + id.slice(0, 6);
    chart('chart-ping', players.map(([id, p]) => ({ name: label(id, p), points: p.rtt || [] })), { unit: ' мс', thresholds: [{ value: th.rttMs, label: th.rttMs + ' мс' }], label: 'Ping по игрокам', empty: 'Данных ping за последние 4 часа нет.' });
    chart('chart-fps', players.map(([id, p]) => ({ name: label(id, p), points: p.fps || [] })), { thresholds: [{ value: th.fps, label: th.fps + ' FPS' }], min: 60, label: 'FPS по игрокам', empty: 'Отчётов FPS от клиентов пока нет.' });
    const lastOf = name => [...seriesOf(name)].reverse().find(p => p[1] !== null)?.[1];
    $('players-last').textContent = 'сейчас ' + number(lastOf('connected'));
    $('npc-last').textContent = 'p95 · ' + number(status?.npcStats?.window5m?.generationP95Ms ?? lastOf('npcGenerationP95Ms'), ' мс');
    $('memory-last').textContent = number(mb(status?.memory?.rssBytes), ' МБ');
  }

  // ---------- Navigation
  function clearPassword() {
    $('temporary-password').textContent = '';
    $('password-for').textContent = '';
    if ($('password-dialog').open) $('password-dialog').close();
  }
  function navigate() {
    const key = location.hash.slice(1);
    currentSection = Object.hasOwn(sections, key) ? key : 'overview';
    clearPassword();
    $('toast').hidden = true;
    for (const [id, [title]] of Object.entries(sections)) {
      $('view-' + id).hidden = id !== currentSection;
      const link = document.querySelector('[data-section="' + id + '"]');
      link.title = title;
      if (id === currentSection) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    $('title').textContent = sections[currentSection][0];
    $('breadcrumb').textContent = sections[currentSection][0];
    $('subtitle').textContent = sections[currentSection][1];
    document.title = sections[currentSection][0] + ' — Вавилон';
    if (currentSection === 'accounts' && selectedAccount) void openAccount(selectedAccount.name);
    if (currentSection === 'npc') void loadNpcs();
    if (currentSection === 'journal') void loadJournal();
  }

  // ---------- Status: overview, server, clients
  function playerWarnings(p) {
    const th = thresholds();
    return {
      rtt: isNum(p.rttMs) && p.rttMs > th.rttMs ? 'Медленная сеть' : '',
      fps: isNum(p.fps) && p.fps < th.fps ? 'Тормозит картинка' : '',
      reconnects: p.reconnects >= 3 ? 'Нестабильная связь' : '',
    };
  }
  function renderPlayers() {
    if (!status) return;
    const query = $('player-search').value.trim().toLocaleLowerCase('ru');
    const map = $('map-filter').value;
    const players = status.players.filter(p => p.name.toLocaleLowerCase('ru').includes(query) && (!map || p.mapId === map));
    $('players').replaceChildren(...players.map(p => {
      const warn = playerWarnings(p);
      const action = node('button', 'Аккаунт');
      action.addEventListener('click', () => {
        $('account-name').value = p.name;
        location.hash = 'accounts';
        void openAccount(p.name);
      });
      const actions = node('td'); actions.append(action);
      return row([p.name, p.mapId || '—', p.connected ? '● В игре' : 'Вышел, место удержано ' + Math.ceil(p.releaseInMs / 1000) + ' с',
        warnedCell(number(p.rttMs), warn.rtt), warnedCell(number(p.fps), warn.fps), number(p.frameMs), number(p.drawCalls),
        isNum(p.reportAgeSeconds) ? number(p.reportAgeSeconds) : '—',
        warnedCell(number(p.reconnects), warn.reconnects), minutes(p.seatedSeconds), actions]);
    }));
    if (!players.length) $('players').append(emptyRow(status.players.length ? 'Игроки не найдены' : 'Подключённых игроков пока нет', 11));
    $('player-count').textContent = 'Показано ' + players.length + ' из ' + status.players.length;
    const online = status.players.filter(p => p.connected);
    $('overview-players').replaceChildren(...online.map(p => {
      const warn = playerWarnings(p);
      return row([p.name, p.mapId || '—', warnedCell(number(p.rttMs, ' мс'), warn.rtt), warnedCell(number(p.fps), warn.fps), minutes(p.seatedSeconds) + ' мин']);
    }));
    if (!online.length) $('overview-players').append(emptyRow('Подключённых игроков пока нет', 5));
  }
  function eventRows(events, limit) {
    return events.slice(0, limit ?? events.length).map(w => {
      const level = node('td', levelNames[w.level] || w.level, 'level ' + (w.level === 'info' ? 'neutral' : w.level === 'warn' ? 'yellow' : 'red'));
      return limit ? row([time(w.ts), level, w.msg]) : row([time(w.ts), level, w.event, w.msg]);
    });
  }
  function renderStatus() {
    const th = thresholds();
    const o = status.overview || {};
    const online = status.players.filter(p => p.connected);
    const rtts = online.map(p => p.rttMs).filter(isNum);
    const averagePing = isNum(o.avgPingMs) ? o.avgPingMs : rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null;
    const occupied = 'Места ' + status.seats.used + ' из ' + status.seats.max;
    const onlineLabel = online.length + ' из ' + status.seats.max;
    const errorsHour = status.errors?.hour?.total ?? o.errorsHour ?? null;
    const pingWarn = isNum(averagePing) && averagePing > th.rttMs ? 'Выше ' + th.rttMs + ' мс' : '';
    const fpsWarn = isNum(o.avgFps) && o.avgFps < th.fps ? 'Ниже ' + th.fps + ' FPS' : '';
    cards('overview-cards', [['Игроки онлайн', onlineLabel, occupied], ['Активные NPC', number(o.npcCount), 'Идёт ответов: ' + number(o.activeGenerations ?? status.npcStats?.running)],
      ['Средний ping', number(averagePing, ' мс'), 'По подключённым игрокам', pingWarn], ['Ошибки за час', number(errorsHour), 'Ошибки сервера', errorsHour > 0 ? 'Есть ошибки — см. «Сервер»' : '']]);
    const unstable = isNum(o.unstable) ? o.unstable : status.players.filter(p => Object.values(playerWarnings(p)).some(Boolean)).length;
    cards('client-cards', [['Игроки онлайн', onlineLabel, occupied], ['Средний ping', number(averagePing, ' мс'), 'По подключённым игрокам', pingWarn], ['Средний FPS', number(o.avgFps), 'По видимым вкладкам за 30 с', fpsWarn], ['Нестабильные подключения', String(unstable), 'Ping >' + th.rttMs + ' мс, FPS <' + th.fps + ' или 3+ переподключения']]);
    const tick = status.tick || {}, memory = status.memory || {}, perf = status.performance || {};
    const tickWarn = isNum(tick.p95Ms) && tick.p95Ms > th.tickP95Ms ? 'Выше нормы ' + th.tickP95Ms + ' мс' : '';
    const broadcastWarn = isNum(tick.broadcastP95Ms) && tick.broadcastP95Ms > th.broadcastP95Ms ? 'Выше нормы ' + th.broadcastP95Ms + ' мс' : '';
    const hourErrors = 'HTTP 5xx · ' + number(status.errors?.hour?.http5xx) + ', БД · ' + number(status.errors?.hour?.db);
    cards('server-cards', [
      ['Шаг сервера', number(tick.lastMinuteP95Ms ?? perf.tickP95Ms, ' мс'), 'p50 ' + number(tick.p50Ms) + ' · p95 ' + number(tick.p95Ms) + ' · макс ' + number(tick.maxMs) + ' (5 мин)', tickWarn],
      ['Интервал рассылки', number(tick.broadcastP95Ms ?? perf.broadcastP95Ms, ' мс'), 'p95 · макс ' + number(tick.broadcastMaxMs, ' мс') + ' (5 мин)', broadcastWarn],
      ['Память', number(mb(memory.rssBytes ?? perf.rssBytes), ' МБ'), 'Куча ' + number(mb(memory.heapBytes ?? perf.heapBytes), ' МБ')],
      ['Ошибки за час', number(errorsHour), hourErrors, errorsHour > 0 ? hourErrors : '']]);
    const q = status.npcStats || {};
    list('queue', [['В очереди', number(q.queued)], ['Выполняются', number(q.running)], ['Незавершённых', isNum(q.unfinished) ? number(q.unfinished) + ' из ' + number(q.maxUnfinished) : 'нет данных']]);
    const w5 = q.window5m || {};
    const timeoutShare = isNum(w5.accepted) && w5.accepted > 0 && isNum(w5.timeouts) ? w5.timeouts / w5.accepted : null;
    list('npc-window', [['Принято', number(w5.accepted)], ['Ответов', number(w5.completed)], ['Таймаутов', number(w5.timeouts), timeoutShare > (th.npcTimeoutShare ?? 0.25) ? 'Больше 25%' : ''], ['Занято', number(w5.busy)], ['Первый текст, p95', number(w5.firstPartialP95Ms, ' мс')], ['Генерация, p95', number(w5.generationP95Ms, ' мс')]]);
    const disk = memory.diskFreeBytes;
    list('disk', [['Свободно', isNum(disk) ? fmt.format(disk / 1024 ** 3) + ' ГБ' : 'нет данных', isNum(disk) && disk < 1024 ** 3 ? 'Меньше 1 ГБ' : ''], ['Размер БД', number(mb(memory.dbBytes), ' МБ')], ['Потеряно строк журнала за час', number(memory.logDroppedHour), memory.logDroppedHour > 0 ? 'Часть журнала не записана' : ''], ['Event loop p99', number(memory.eventLoopP99Ms, ' мс'), memory.eventLoopP99Ms > th.eventLoopP99Ms ? 'Сервер перегружен' : '']]);
    const e5 = status.errors?.window5m || {}, e60 = status.errors?.window60m || {};
    $('error-table').replaceChildren(...[['HTTP 5xx', 'http5xx'], ['База данных', 'db'], ['NPC', 'npc']].map(([label, key]) => row([label, warnedCell(number(e5[key]), e5[key] > 0 ? 'есть' : ''), number(e60[key])])));
    $('urls').replaceChildren(...status.addresses.map(address => node('li', address)));
    $('health').className = 'badge ' + status.health.level;
    $('health').textContent = levels[status.health.level] || 'Нет данных';
    $('connection').className = 'badge ' + status.health.level;
    $('connection').textContent = status.health.level === 'green' ? 'Сервер в сети' : 'Сервер: ' + (levels[status.health.level] || 'нет данных').toLowerCase();
    $('environment').textContent = status.server?.env || status.environment || 'Окружение: нет данных';
    document.querySelectorAll('.version').forEach(el => { el.textContent = 'Версия ' + (status.server?.version || status.version || '—'); });
    $('uptime').textContent = 'Работает ' + minutes(status.uptimeSeconds) + ' мин';
    $('seats').textContent = occupied;
    $('npc-state').textContent = status.npc === 'ready' ? 'NPC готовы' : 'NPC недоступны';
    $('language').textContent = status.language === 'ready' ? 'Переводчик готов' : 'Переводчик недоступен';
    $('reasons').replaceChildren(...status.health.reasons.map(reason => node('li', reason.text)));
    $('warnings').replaceChildren(...eventRows(status.warnings));
    if (!status.warnings.length) $('warnings').append(emptyRow('Событий пока нет', 4));
    $('overview-events').replaceChildren(...eventRows(status.warnings, 6));
    if (!status.warnings.length) $('overview-events').append(emptyRow('Событий пока нет', 3));
    const selectedMap = $('map-filter').value;
    const maps = [...new Set(status.players.map(p => p.mapId).filter(Boolean))].sort();
    $('map-filter').replaceChildren(new Option('Все карты', ''), ...maps.map(map => new Option(map, map)));
    if (maps.includes(selectedMap)) $('map-filter').value = selectedMap;
    renderPlayers();
    $('updated').textContent = 'Обновлено в ' + time(lastUpdate);
  }
  async function refreshHistory(force) {
    if (!force && Date.now() - historyAt < 10_000) return;
    try { history = await request('/api/operator/history'); historyAt = Date.now(); renderCharts(); }
    catch { /* the status banner already reports a lost connection */ }
  }
  async function refresh(force = false) {
    if (refreshing) return;
    refreshing = true;
    $('refresh').disabled = true;
    try {
      const next = await request('/api/operator/status');
      if (!Array.isArray(next.players) || !Array.isArray(next.addresses) || !Array.isArray(next.warnings) || !next.health || !next.seats) throw new Error('Некорректный статус');
      status = next; lastUpdate = Date.now();
      renderStatus();
      $('connection-error').hidden = true;
      await refreshHistory(force);
    } catch {
      $('connection').className = 'badge red';
      $('connection').textContent = 'Сервер недоступен';
      $('connection-error').textContent = 'Сервер недоступен. ' + (lastUpdate ? 'Показаны данные за ' + time(lastUpdate) + '. ' : '') + 'Следующая попытка — автоматически; можно нажать «Обновить».';
      $('connection-error').hidden = false;
    }
    refreshing = false;
    $('refresh').disabled = false;
  }

  // ---------- NPC and world
  const form = $('npc-form');
  async function loadNpcs() {
    try {
      const params = new URLSearchParams();
      if ($('npc-map').value) params.set('map', $('npc-map').value);
      if ($('npc-search').value.trim()) params.set('q', $('npc-search').value.trim());
      if ($('npc-deleted').checked) params.set('deleted', '1');
      const [npcs, all, world] = await Promise.all([request('/api/operator/npcs?' + params), request('/api/operator/npcs?deleted=1'), request('/api/operator/world')]);
      npcData = npcs; worldData = world;
      const active = all.npcs.filter(n => !n.deleted);
      cards('npc-cards', [['Всего персонажей', String(active.length), 'Удалённых: ' + (all.npcs.length - active.length)], ['Включены', String(active.filter(n => n.enabled).length), 'Выключенные не видны игрокам'], ['Карты', String(npcs.maps.length), npcs.maps.map(m => m.mapId).join(', ')]]);
      const selectedMap = $('npc-map').value;
      $('npc-map').replaceChildren(new Option('Все карты', ''), ...npcs.maps.map(m => new Option(m.mapId, m.mapId)));
      $('npc-map').value = selectedMap;
      renderNpcRows(); renderWorld(); fillJournalNpcs(all.npcs);
      $('npc-message').textContent = '';
    } catch (error) { $('npc-message').textContent = 'Не удалось загрузить персонажей: ' + error.message; }
  }
  function renderNpcRows() {
    $('npc-rows').replaceChildren(...npcData.npcs.map(n => {
      const who = node('td'); who.append(node('strong', n.name), node('small', n.id + (n.embedded ? ' · фигура в карте' : '') + (n.quest ? ' · задание' : '') + (n.origin === 'admin' ? ' · создан в панели' : '')));
      const state = node('td', n.deleted ? 'Удалён' : n.enabled ? '● Включён' : 'Выключен', n.deleted ? 'red' : n.enabled ? 'green' : 'neutral');
      const edit = node('button', 'Изменить', 'link'); edit.addEventListener('click', () => void openNpc(n.id));
      const actions = node('td'); actions.append(edit);
      const tr = row([who, n.mapId, state, n.topic, actions]);
      if (npcSelected && npcSelected.id === n.id) tr.className = 'selected';
      return tr;
    }));
    if (!npcData.npcs.length) $('npc-rows').append(emptyRow('Персонажи не найдены', 5));
    $('npc-count').textContent = 'Показано ' + npcData.npcs.length + ' из ' + npcData.total;
  }
  function setField(name, show) { const el = form.querySelector('[data-field="' + name + '"]'); if (el) el.hidden = !show; }
  function fillSelect(select, values, current) {
    select.replaceChildren(...values.map(v => new Option(v, v)));
    if (current && !values.includes(current)) select.append(new Option(current, current));
    select.value = current ?? values[0] ?? '';
  }
  const editableOf = npc => new Set(npc.create ? ALL_FIELDS : npc.editable);
  async function openNpc(id) {
    try {
      const { npc, history: changes } = await request('/api/operator/npcs/' + encodeURIComponent(id));
      showEditor(npc, changes);
    } catch (error) { notify('Не удалось открыть персонажа: ' + error.message, true); }
  }
  function showEditor(npc, changes) {
    npcSelected = npc;
    const create = !!npc.create;
    const editable = editableOf(npc);
    $('npc-editor').hidden = false;
    $('npc-editor-title').textContent = create ? 'Новый персонаж' : 'Редактирование NPC';
    $('npc-form-error').textContent = '';
    setField('id', create);
    for (const field of ALL_FIELDS) setField(field, editable.has(field) && (create || !npc.deleted));
    const flags = [];
    if (npc.deleted) flags.push(['Персонаж удалён и скрыт из мира. Восстановите его, чтобы изменить.', 'danger']);
    if (npc.embedded) flags.push(['Фигура нарисована в модели карты: переместить или сменить облик нельзя; при выключении фигура останется, исчезнут разговор и подпись.', 'info']);
    if (npc.quest) flags.push(['Персонаж участвует в задании рынка: без него задание нельзя пройти.', 'warn']);
    if (create) flags.push(['Персонаж появится в мире сразу после создания. Облик — из моделей, которые уже есть в игре.', 'info']);
    if (!create && npc.overridden?.length) flags.push(['Изменено в панели: ' + npc.overridden.map(f => fieldNames[f] || f).join(', ') + '.', 'info']);
    $('npc-flags').replaceChildren(...flags.map(([text, kind]) => node('p', text, 'flag ' + kind)));
    form.elements.id.value = create ? '' : npc.id;
    form.elements.name.value = npc.name ?? '';
    form.elements.topic.value = npc.topic ?? '';
    form.elements.persona.value = npc.persona ?? '';
    form.elements.greeting.value = npc.greeting ?? '';
    form.elements.interactionRadius.value = npc.interactionRadius ?? 2.5;
    fillSelect(form.elements.mapId, (npcData?.maps || []).map(m => m.mapId), npc.mapId);
    form.elements.x.value = npc.position?.x ?? 0;
    form.elements.z.value = npc.position?.z ?? 0;
    form.elements.rotationY.value = npc.rotationY ?? 0;
    fillSelect(form.elements.assetId, npcData?.appearances || [], npc.assetId);
    form.elements.enabled.checked = create ? true : !!npc.enabled;
    $('npc-reset').hidden = create || npc.origin !== 'content' || !npc.overridden?.length;
    $('npc-delete').hidden = create || !!npc.deleted;
    $('npc-restore').hidden = create || !npc.deleted;
    $('npc-save').hidden = !create && !!npc.deleted;
    $('npc-history').replaceChildren(...(changes || []).map(e => row([dateTime(e.at), actionNames[e.action] || e.action, e.actor === 'seed' ? 'Система (начальная загрузка)' : e.actor === 'system' ? 'Система' : 'Администратор'])));
    if (!changes?.length) $('npc-history').append(emptyRow(create ? 'Появятся после создания' : 'Изменений нет', 3));
    if (npcData) renderNpcRows();
  }
  function closeEditor() { npcSelected = null; $('npc-editor').hidden = true; if (npcData) renderNpcRows(); }
  function formPatch() {
    const create = !!npcSelected.create;
    const editable = editableOf(npcSelected);
    const value = {};
    const text = key => form.elements[key].value.trim();
    const num = key => Number(form.elements[key].value);
    for (const key of ['name', 'topic', 'persona', 'greeting']) if (editable.has(key) && (create || text(key) !== npcSelected[key])) value[key] = text(key);
    if (editable.has('interactionRadius') && (create || num('interactionRadius') !== npcSelected.interactionRadius)) value.interactionRadius = num('interactionRadius');
    if (editable.has('rotationY') && (create || num('rotationY') !== npcSelected.rotationY)) value.rotationY = num('rotationY');
    if (editable.has('mapId') && (create || form.elements.mapId.value !== npcSelected.mapId)) value.mapId = form.elements.mapId.value;
    if (editable.has('position') && (create || 'mapId' in value || num('x') !== npcSelected.position?.x || num('z') !== npcSelected.position?.z)) value.position = { x: num('x'), z: num('z') };
    if (editable.has('assetId') && (create || form.elements.assetId.value !== npcSelected.assetId)) value.assetId = form.elements.assetId.value;
    if (!create && form.elements.enabled.checked !== npcSelected.enabled) value.enabled = form.elements.enabled.checked;
    if (create) value.id = text('id');
    return value;
  }
  async function saveNpc(event) {
    event.preventDefault();
    if (!npcSelected || acting) return;
    const create = !!npcSelected.create;
    const patch = formPatch();
    if (!create && !Object.keys(patch).length) { $('npc-form-error').textContent = 'Изменений нет.'; return; }
    if (npcSelected.quest && patch.enabled === false && !confirm('Персонаж участвует в задании рынка: без него задание нельзя пройти. Выключить?')) return;
    acting = true; $('npc-save').disabled = true; $('npc-form-error').textContent = '';
    try {
      let npc;
      if (create) {
        npc = (await change('/api/operator/npcs', 'POST', patch)).npc;
        if (!form.elements.enabled.checked) npc = (await change('/api/operator/npcs/' + encodeURIComponent(npc.id), 'PATCH', { enabled: false })).npc;
      } else npc = (await change('/api/operator/npcs/' + encodeURIComponent(npcSelected.id), 'PATCH', patch)).npc;
      notify(create ? 'Персонаж «' + npc.name + '» создан.' : 'Изменения сохранены и уже действуют в игре.');
      await loadNpcs(); await openNpc(npc.id);
    } catch (error) { $('npc-form-error').textContent = error.message; }
    finally { acting = false; $('npc-save').disabled = false; }
  }
  async function npcAction(kind) {
    if (!npcSelected || npcSelected.create || acting) return;
    const n = npcSelected;
    const question = {
      delete: 'Удалить персонажа «' + n.name + '»? Он исчезнет из мира, незавершённые ответы отменятся. Восстановить можно с флажком «Показывать удалённых».' + (n.quest ? ' Внимание: без него задание рынка нельзя пройти.' : '') + (n.embedded ? ' Фигура в модели карты останется видна.' : ''),
      restore: 'Восстановить персонажа «' + n.name + '»?',
      reset: 'Сбросить «' + n.name + '» к исходным значениям из файла? Изменения панели будут удалены.',
    }[kind];
    if (!confirm(question)) return;
    acting = true;
    try {
      const path = '/api/operator/npcs/' + encodeURIComponent(n.id);
      const { npc } = kind === 'delete' ? await request(path, { method: 'DELETE', headers: { 'X-Operator': '1' } }) : await change(path + '/' + kind, 'POST', {});
      notify(kind === 'delete' ? 'Персонаж удалён из мира.' : kind === 'restore' ? 'Персонаж восстановлен.' : 'Персонаж сброшен к исходным значениям.');
      await loadNpcs();
      if (npc.deleted && !$('npc-deleted').checked) closeEditor(); else await openNpc(npc.id);
    } catch (error) { notify('Не удалось выполнить действие: ' + error.message, true); }
    finally { acting = false; }
  }
  function renderWorld() {
    $('world-rows').replaceChildren(...worldData.maps.map(m => {
      let scene = 'Нет живой сцены';
      if (m.scene) {
        const moved = m.scene.pots.filter(p => Math.hypot(p.position.x - p.home.x, p.position.z - p.home.z) > 0.01).length;
        const held = m.scene.apples.filter(a => a.state === 'held').length;
        scene = 'Ревизия ' + m.scene.revision + ' · горшков сдвинуто ' + moved + ' из ' + m.scene.pots.length + ' · яблок в руках ' + held + ' из ' + m.scene.apples.length;
      }
      const td = node('td');
      if (m.scene) {
        const button = node('button', 'Сбросить сцену', 'secondary');
        button.addEventListener('click', () => void resetScene(m.mapId));
        td.append(button);
      }
      return row([m.mapId, number(m.chunks), number(m.npcs), scene, td]);
    }));
    if (!worldData.maps.length) $('world-rows').append(emptyRow('Карт нет', 5));
  }
  async function resetScene(mapId) {
    if (acting || !confirm('Сбросить живую сцену карты «' + mapId + '»? Горшки и яблоки вернутся на исходные места, в том числе яблоки из рук игроков.')) return;
    acting = true;
    try {
      const result = await change('/api/operator/world/' + encodeURIComponent(mapId) + '/reset-scene', 'POST', {});
      const skipped = [...result.skipped.pots, ...result.skipped.apples];
      notify('Сцена сброшена: горшков ' + result.reset.pots + ', яблок ' + result.reset.apples + '.' + (skipped.length ? ' Пропущено (место занято игроком): ' + skipped.join(', ') + '.' : ''));
      await loadNpcs();
    } catch (error) { notify('Сцена не сброшена: ' + error.message, true); }
    finally { acting = false; }
  }

  // ---------- Journal
  const journalForm = $('journal-filters');
  function fillJournalNpcs(npcs) {
    const select = journalForm.elements.id; const current = select.value;
    select.replaceChildren(new Option('Все персонажи', ''), ...npcs.map(n => new Option(n.name + ' (' + n.id + ')', n.id)));
    select.value = current;
  }
  function journalParams(withPage) {
    const params = new URLSearchParams();
    for (const key of ['target', 'id', 'action', 'q']) { const value = journalForm.elements[key].value.trim(); if (value) params.set(key, value); }
    const period = journalForm.elements.period.value;
    if (period === 'today') { const start = new Date(); start.setHours(0, 0, 0, 0); params.set('from', String(start.getTime())); }
    else if (period) params.set('from', String(Date.now() - Number(period.replace('d', '')) * 86_400_000));
    if (withPage) { params.set('page', String(journalPage)); params.set('pageSize', '25'); }
    return params;
  }
  function describe(entry) {
    const before = entry.before || {}, after = entry.after || {};
    if (entry.action === 'npc.seed' || entry.action === 'npc.create') return 'Персонаж «' + (after.name ?? entry.targetId) + '»';
    if (entry.action === 'world.reset-scene') return 'Возвращено: горшков ' + number(after.reset?.pots) + ', яблок ' + number(after.reset?.apples);
    const show = v => v === null || v === undefined ? '—' : typeof v === 'object' ? (isNum(v.x) ? 'x ' + fmt.format(v.x) + ', z ' + fmt.format(v.z) : JSON.stringify(v)) : typeof v === 'boolean' ? (v ? 'да' : 'нет') : String(v);
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => k !== 'id' && k !== 'name' || entry.targetType === 'npc' && k === 'name');
    return keys.map(k => (fieldNames[k] || k) + ': ' + show(before[k]) + ' → ' + show(after[k])).join('; ') || '—';
  }
  async function loadJournal() {
    try {
      const result = await request('/api/operator/journal?' + journalParams(true));
      journalEntries = result.entries;
      const actions = new Set([...journalForm.elements.action.options].map(o => o.value));
      for (const key of Object.keys(actionNames)) if (key !== 'login' && !actions.has(key)) journalForm.elements.action.append(new Option(actionNames[key], key));
      $('journal-rows').replaceChildren(...result.entries.map((e, index) => {
        const action = node('td'); action.append(node('span', actionNames[e.action] || e.action, 'pill ' + e.action.split('.')[0]));
        const target = e.targetType === 'npc' ? e.targetId : e.targetType === 'world' ? 'мир · ' + e.targetId : 'аккаунт';
        const tr = row([dateTime(e.at), target, action, e.actor === 'admin' ? 'администратор' : e.actor, e.ip || '—', describe(e)]);
        tr.tabIndex = 0;
        tr.addEventListener('click', () => showJournalEntry(index));
        tr.addEventListener('keydown', event => { if (event.key === 'Enter') showJournalEntry(index); });
        return tr;
      }));
      if (!result.entries.length) $('journal-rows').append(emptyRow('Записей нет', 6));
      const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
      $('journal-count').textContent = 'Записей: ' + result.total;
      const first = pages <= 10 ? 1 : Math.max(1, Math.min(pages - 9, journalPage - 4));
      $('journal-pages').replaceChildren(...Array.from({ length: Math.min(pages, 10) }, (_, i) => {
        const page = first + i;
        const button = node('button', String(page), page === journalPage ? 'primary' : 'secondary');
        if (page === journalPage) button.setAttribute('aria-current', 'page');
        button.addEventListener('click', () => { journalPage = page; void loadJournal(); });
        return button;
      }));
      $('journal-csv').href = '/api/operator/journal.csv?' + journalParams(false);
    } catch (error) { $('journal-rows').replaceChildren(emptyRow('Журнал не загружен: ' + error.message, 6)); }
  }
  function showJournalEntry(index) {
    const e = journalEntries[index]; if (!e) return;
    $('journal-details').hidden = false;
    const npcName = e.targetType === 'npc' ? (e.after?.name ?? e.before?.name ?? '') : '';
    list('journal-detail-meta', [['Действие', actionNames[e.action] || e.action], ['Цель', e.targetType + ' · ' + e.targetId + (npcName ? ' (' + npcName + ')' : '')], ['Автор', e.actor === 'admin' ? 'администратор' : e.actor], ['Время', new Date(e.at).toLocaleString('ru')]]);
    $('journal-before').textContent = e.before ? JSON.stringify(e.before, null, 2) : '—';
    $('journal-after').textContent = e.after ? JSON.stringify(e.after, null, 2) : '—';
  }

  // ---------- Accounts
  const locked = account => isNum(account?.lockedUntil) && account.lockedUntil > Date.now();
  function updateActionButtons() {
    for (const button of document.querySelectorAll('[data-action]')) {
      button.disabled = acting || !selectedAccount || (button.dataset.action === 'unlock' && !locked(selectedAccount)) || (button.dataset.action === 'revoke' && !selectedAccount.activeSessions);
    }
  }
  function showAccount(account) {
    selectedAccount = account;
    $('account-details').hidden = !account;
    updateActionButtons();
    if (!account) return;
    $('account-title').textContent = account.name;
    $('account-avatar').textContent = [...account.name][0].toLocaleUpperCase('ru');
    const blocked = locked(account);
    const access = blocked ? 'Вход заблокирован до ' + shortTime(account.lockedUntil) : 'Вход разрешён';
    $('account-access').textContent = access; $('account-access').className = 'badge ' + (blocked ? 'yellow' : 'green');
    $('account-lock').textContent = blocked ? 'Имя заблокировано после неудачных попыток входа до ' + shortTime(account.lockedUntil) + '.' : 'Ограничений по имени нет.';
    $('account-created').textContent = 'Создан: ' + (account.createdAt ? new Date(account.createdAt).toLocaleDateString('ru') : 'нет данных');
    $('account-last-login').textContent = 'Последний вход: ' + (account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString('ru') : 'нет данных') + (account.mapId ? ' · сейчас на карте ' + account.mapId : '');
    $('account-sessions').textContent = account.activeSessions + ' активных';
    $('account-session-list').replaceChildren(...(account.sessions || []).map(s => node('li', 'Вход ' + dateTime(s.createdAt) + (s.ip ? ' · IP ' + s.ip : '') + (account.mapId ? ' · ' + account.mapId : ''))));
    $('account-history').replaceChildren(...(account.history || []).map(h => {
      const result = String(h.result ?? '');
      const [text, cls] = result.startsWith('revoked') ? ['● завершена', 'neutral'] : result === 'active' ? ['● действует', 'green'] : result === 'expired' ? ['● истекла', 'neutral'] : ['● ' + (result || 'выполнено'), 'green'];
      return row([dateTime(h.at), actionNames[h.action] || h.action, h.actor === 'player' ? 'игрок' : h.actor === 'admin' ? 'администратор' : h.actor, node('td', text, cls)]);
    }));
    if (!account.history?.length) $('account-history').append(emptyRow('Действий пока нет', 4));
  }
  async function openAccount(name) {
    const id = ++accountRequest;
    try {
      const { account } = await request('/api/operator/account?name=' + encodeURIComponent(name));
      if (id !== accountRequest) return;
      showAccount(account); $('account-message').textContent = '';
    } catch (error) { if (id === accountRequest) { showAccount(null); $('account-message').textContent = error.status === 404 ? 'Аккаунт не найден.' : 'Не удалось открыть аккаунт: ' + error.message; } }
  }
  async function findAccount(query) {
    const id = ++accountRequest;
    showAccount(null);
    $('account-results').replaceChildren();
    $('account-message').textContent = 'Поиск…';
    $('find-account').disabled = true;
    try {
      const { accounts } = await request('/api/operator/accounts?q=' + encodeURIComponent(query.trim()));
      if (id !== accountRequest) return;
      const exact = accounts.find(a => a.name.toLocaleLowerCase('ru') === query.trim().toLocaleLowerCase('ru'));
      if (exact || accounts.length === 1) { await openAccount((exact || accounts[0]).name); return; }
      $('account-message').textContent = accounts.length ? 'Найдено: ' + accounts.length + '. Выберите игрока.' : 'Аккаунт не найден. Проверьте имя.';
      $('account-results').replaceChildren(...accounts.slice(0, 20).map(a => {
        const item = node('li'); const button = node('button', a.name, 'link');
        button.addEventListener('click', () => { $('account-name').value = a.name; $('account-results').replaceChildren(); void openAccount(a.name); });
        item.append(button, node('small', ' · сессий: ' + a.activeSessions + (a.mapId ? ' · ' + a.mapId : ''), 'muted'));
        return item;
      }));
    } catch { if (id === accountRequest) $('account-message').textContent = 'Не удалось найти игрока. Проверьте связь и повторите поиск.'; }
    finally { $('find-account').disabled = false; }
  }
  async function act(action) {
    if (acting) return;
    const name = selectedAccount?.name;
    if (action !== 'dump' && !name) return;
    const question = {
      'reset-password': 'Выдать временный пароль игроку «' + name + '»? Все его сессии завершатся.',
      revoke: 'Завершить все сессии игрока «' + name + '»?',
      unlock: 'Снять блокировку входа игрока «' + name + '»?',
      dump: 'Сохранить диагностический отчёт на компьютере сервера?',
    }[action];
    if (!confirm(question)) return;
    clearPassword();
    acting = true; updateActionButtons(); $('dump').disabled = true;
    try {
      const result = await request('/api/operator/actions/' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operator': '1' },
        body: JSON.stringify(action === 'dump' ? {} : { name }),
      });
      if (action === 'reset-password') {
        // The response is never persisted or copied to the toast/history. Clear on every close path.
        if (currentSection === 'accounts' && !document.hidden) {
          $('password-for').textContent = 'Для игрока «' + result.name + '»';
          $('temporary-password').textContent = result.temporaryPassword;
          $('password-dialog').showModal();
        } else notify('Пароль выдан, но показ скрыт. При необходимости выдайте новый пароль.');
      } else notify(action === 'revoke' ? 'Сессии завершены: ' + result.revoked + '. Игроку потребуется войти повторно.' : action === 'unlock' ? (result.unlocked ? 'Блокировка входа снята.' : 'Блокировки не было.') : 'Отчёт сохранён: ' + result.file);
      if (action !== 'dump' && currentSection === 'accounts' && selectedAccount?.name === name) await openAccount(name);
      void refresh();
    } catch (error) {
      notify('Не удалось подтвердить результат. ' + error.message + ' Обновите данные перед повторным действием.', true);
    } finally { acting = false; updateActionButtons(); $('dump').disabled = false; }
  }

  // ---------- Wiring
  $('refresh').addEventListener('click', () => {
    void refresh(true);
    if (currentSection === 'accounts' && selectedAccount) void openAccount(selectedAccount.name);
    if (currentSection === 'npc') void loadNpcs();
    if (currentSection === 'journal') void loadJournal();
  });
  $('toggle-sidebar').addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('collapsed');
    $('toggle-sidebar').setAttribute('aria-expanded', String(!collapsed));
    $('toggle-sidebar').setAttribute('aria-label', collapsed ? 'Развернуть боковую панель' : 'Свернуть боковую панель');
  });
  $('section-search').addEventListener('input', () => {
    const query = $('section-search').value.trim().toLocaleLowerCase('ru');
    for (const [id, [label]] of Object.entries(sections)) document.querySelector('[data-section="' + id + '"]').hidden = !label.toLocaleLowerCase('ru').includes(query);
  });
  $('player-search').addEventListener('input', renderPlayers);
  $('map-filter').addEventListener('change', renderPlayers);
  let npcSearchTimer = 0;
  $('npc-search').addEventListener('input', () => { clearTimeout(npcSearchTimer); npcSearchTimer = setTimeout(() => void loadNpcs(), 250); });
  $('npc-map').addEventListener('change', () => void loadNpcs());
  $('npc-deleted').addEventListener('change', () => void loadNpcs());
  $('npc-create').addEventListener('click', () => showEditor({ create: true, mapId: npcData?.maps?.[0]?.mapId, interactionRadius: 2.5, rotationY: 0, position: { x: 0, z: 0 }, assetId: npcData?.appearances?.[0] }, []));
  $('npc-close').addEventListener('click', closeEditor);
  $('npc-cancel').addEventListener('click', () => { if (npcSelected?.create) closeEditor(); else if (npcSelected) void openNpc(npcSelected.id); });
  form.addEventListener('submit', event => void saveNpc(event));
  $('npc-delete').addEventListener('click', () => void npcAction('delete'));
  $('npc-restore').addEventListener('click', () => void npcAction('restore'));
  $('npc-reset').addEventListener('click', () => void npcAction('reset'));
  let journalTimer = 0;
  journalForm.addEventListener('input', () => { clearTimeout(journalTimer); journalTimer = setTimeout(() => { journalPage = 1; void loadJournal(); }, 250); });
  journalForm.addEventListener('submit', event => event.preventDefault());
  $('account-search').addEventListener('submit', event => { event.preventDefault(); clearPassword(); void findAccount($('account-name').value); });
  $('account-name').addEventListener('input', () => { ++accountRequest; showAccount(null); clearPassword(); $('account-results').replaceChildren(); $('account-message').textContent = ''; $('find-account').disabled = false; });
  for (const button of document.querySelectorAll('[data-action]')) button.addEventListener('click', () => void act(button.dataset.action));
  $('dump').addEventListener('click', () => void act('dump'));
  $('close-toast').addEventListener('click', () => { $('toast').hidden = true; });
  $('close-password').addEventListener('click', clearPassword);
  $('password-dialog').addEventListener('close', clearPassword);
  $('password-dialog').addEventListener('cancel', clearPassword);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearPassword(); });
  window.addEventListener('pagehide', clearPassword);
  window.addEventListener('hashchange', navigate);
  navigate();
  void refresh(true);
  setInterval(() => void refresh(), 2000);
})();
