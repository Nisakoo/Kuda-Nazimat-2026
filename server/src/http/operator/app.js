'use strict';
// This script is embedded by operatorPage.ts. No remote assets or browser persistence.
(() => {
  const $ = id => document.getElementById(id);
  const sections = {
    overview: ['Обзор', 'Состояние мира и подключённых игроков'],
    server: ['Сервер', 'Состояние и производительность сервера'],
    clients: ['Клиенты', 'Подключения и производительность игроков'],
    npc: ['NPC', 'Персонажи города'],
    journal: ['Журнал действий', 'История изменений персонажей и действий администратора'],
    accounts: ['Аккаунты', 'Управление доступом и сессиями игроков'],
  };
  const levels = { green: 'Всё в порядке', yellow: 'Есть предупреждения', red: 'Нужна помощь' };
  let currentSection = 'overview';
  let status = null;
  let lastUpdate = null;
  let refreshing = false;
  let selectedAccount = null;
  let accountRequest = 0;
  let acting = false;
  const number = (value, suffix = '') => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('ru', { maximumFractionDigits: 1 }).format(value) + suffix : 'нет данных';
  const time = value => new Date(value).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const minutes = value => number(Math.floor(value / 60));
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
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
    $(id).replaceChildren(...values.map(([title, value, caption]) => {
      const card = node('article', undefined, 'card');
      card.append(node('h2', title), node('strong', value), node('p', caption));
      return card;
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
    if (!response.ok) throw new Error(body?.error?.message || 'Сервер ответил ошибкой (' + response.status + ').');
    if (body === null) throw new Error('Сервер вернул некорректный ответ.');
    return body;
  }
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
    if (currentSection === 'accounts' && selectedAccount) void findAccount(selectedAccount.name);
  }
  function renderPlayers() {
    if (!status) return;
    const query = $('player-search').value.trim().toLocaleLowerCase('ru');
    const map = $('map-filter').value;
    const players = status.players.filter(p => p.name.toLocaleLowerCase('ru').includes(query) && (!map || p.mapId === map));
    $('players').replaceChildren(...players.map(p => {
      const action = node('button', 'Аккаунт');
      action.addEventListener('click', () => {
        $('account-name').value = p.name;
        location.hash = 'accounts';
        void findAccount(p.name);
      });
      const actions = node('td'); actions.append(action);
      return row([p.name, p.mapId || '—', p.connected ? '● В игре' : 'Вышел, место удержано ' + Math.ceil(p.releaseInMs / 1000) + ' с',
        warnedCell(number(p.rttMs), p.rttMs > 150 ? 'Медленная сеть' : ''), '—', '—', '—', '—',
        warnedCell(number(p.reconnects), p.reconnects >= 3 ? 'Нестабильная связь' : ''), minutes(p.seatedSeconds), actions]);
    }));
    if (!players.length) $('players').append(emptyRow(status.players.length ? 'Игроки не найдены' : 'Подключённых игроков пока нет', 11));
    $('player-count').textContent = 'Показано ' + players.length + ' из ' + status.players.length;
    const online = status.players.filter(p => p.connected);
    $('overview-players').replaceChildren(...online.map(p => row([p.name, p.mapId || '—', warnedCell(number(p.rttMs, ' мс'), p.rttMs > 150 ? 'Медленная сеть' : ''), '—', minutes(p.seatedSeconds) + ' мин'])));
    if (!online.length) $('overview-players').append(emptyRow('Подключённых игроков пока нет', 5));
  }
  function renderStatus() {
    const online = status.players.filter(p => p.connected);
    const rtts = online.map(p => p.rttMs).filter(v => typeof v === 'number' && Number.isFinite(v));
    const averagePing = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null;
    const occupied = 'Места ' + status.seats.used + ' из ' + status.seats.max;
    const onlineLabel = online.length + ' из ' + status.seats.max;
    cards('overview-cards', [['Игроки онлайн', onlineLabel, occupied], ['Активные NPC', 'нет данных', status.npc === 'ready' ? 'Ответчик готов' : 'Ответчик недоступен'], ['Средний ping', number(averagePing, ' мс'), 'По подключённым игрокам'], ['Ошибки за час', 'нет данных', 'История пока недоступна']]);
    const unstable = status.players.filter(p => p.rttMs > 150 || p.reconnects >= 3).length;
    cards('client-cards', [['Игроки онлайн', onlineLabel, occupied], ['Средний ping', number(averagePing, ' мс'), 'По подключённым игрокам'], ['Средний FPS', 'нет данных', 'Отчёты пока недоступны'], ['Нестабильные подключения', String(unstable), 'Ping >150 мс или 3+ переподключения']]);
    const perf = status.performance || {};
    cards('server-cards', [['Шаг сервера', number(perf.tickP95Ms, ' мс'), 'p95 за последнюю минуту'], ['Интервал рассылки', number(perf.broadcastP95Ms, ' мс'), 'p95 за последнюю минуту'], ['Память', number(perf.rssBytes == null ? null : perf.rssBytes / 1024 ** 2, ' МиБ'), 'Куча ' + number(perf.heapBytes == null ? null : perf.heapBytes / 1024 ** 2, ' МиБ')], ['Ошибки за час', 'нет данных', 'История пока недоступна']]);
    $('urls').replaceChildren(...status.addresses.map(address => node('li', address)));
    $('health').className = 'badge ' + status.health.level;
    $('health').textContent = levels[status.health.level] || 'Нет данных';
    $('connection').className = 'badge ' + status.health.level;
    $('connection').textContent = status.health.level === 'green' ? 'Сервер в сети' : 'Сервер: ' + (levels[status.health.level] || 'нет данных').toLowerCase();
    $('environment').textContent = status.environment || 'Окружение: нет данных';
    document.querySelectorAll('.version').forEach(el => { el.textContent = 'Версия ' + (status.version || '—'); });
    $('uptime').textContent = 'Работает ' + minutes(status.uptimeSeconds) + ' мин';
    $('seats').textContent = occupied;
    $('npc-state').textContent = status.npc === 'ready' ? 'NPC готовы' : 'NPC недоступны';
    $('language').textContent = status.language === 'ready' ? 'Переводчик готов' : 'Переводчик недоступен';
    $('reasons').replaceChildren(...status.health.reasons.map(reason => node('li', reason.text)));
    $('warnings').replaceChildren(...status.warnings.map(w => row([time(w.ts), w.level === 'warn' ? 'Предупреждение' : 'Ошибка', w.event, w.msg])));
    if (!status.warnings.length) $('warnings').append(emptyRow('Предупреждений пока нет', 4));
    $('overview-events').replaceChildren(...status.warnings.slice(0, 5).map(w => node('p', time(w.ts) + ' · ' + w.msg)));
    if (!status.warnings.length) $('overview-events').append(node('p', 'Предупреждений пока нет', 'empty'));
    const selectedMap = $('map-filter').value;
    const maps = [...new Set(status.players.map(p => p.mapId).filter(Boolean))].sort();
    $('map-filter').replaceChildren(new Option('Все карты', ''), ...maps.map(map => new Option(map, map)));
    if (maps.includes(selectedMap)) $('map-filter').value = selectedMap;
    renderPlayers();
    $('updated').textContent = 'Обновлено в ' + time(lastUpdate);
  }
  async function refreshMetrics() {
    try {
      const metrics = await request('/api/operator/metrics');
      const queued = metrics.npc_queue?.find(s => s.labels.state === 'queued')?.value ?? null;
      const running = metrics.npc_queue?.find(s => s.labels.state === 'running')?.value ?? null;
      $('queue').replaceChildren(...[['В очереди', number(queued)], ['Выполняются', number(running)], ['Незавершённых', queued === null || running === null ? 'нет данных' : number(queued + running) + ' из 4']].map(([key, value]) => {
        const entry = node('div'); entry.append(node('dt', key), node('dd', value)); return entry;
      }));
      $('metrics-state').textContent = 'Обновлено в ' + time(Date.now());
    } catch { $('metrics-state').textContent = 'Показатели не обновлены. Показаны последние полученные значения.'; }
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    $('refresh').disabled = true;
    try {
      const next = await request('/api/operator/status');
      if (!Array.isArray(next.players) || !Array.isArray(next.addresses) || !Array.isArray(next.warnings) || !next.health || !next.seats) throw new Error('Некорректный статус');
      status = next; lastUpdate = Date.now();
      renderStatus();
      $('connection-error').hidden = true;
    } catch {
      $('connection').className = 'badge red';
      $('connection').textContent = 'Сервер недоступен';
      $('connection-error').textContent = 'Сервер недоступен. ' + (lastUpdate ? 'Показаны данные за ' + time(lastUpdate) + '. ' : '') + 'Следующая попытка — автоматически; можно нажать «Обновить».';
      $('connection-error').hidden = false;
    }
    await refreshMetrics();
    refreshing = false;
    $('refresh').disabled = false;
  }
  function updateActionButtons() {
    for (const button of document.querySelectorAll('[data-action]')) {
      button.disabled = acting || !selectedAccount || (button.dataset.action === 'unlock' && !selectedAccount.loginBlockedSeconds) || (button.dataset.action === 'revoke' && !selectedAccount.activeSessions);
    }
  }
  function showAccount(account) {
    selectedAccount = account;
    $('account-details').hidden = !account;
    updateActionButtons();
    if (!account) return;
    $('account-title').textContent = account.name;
    $('account-avatar').textContent = [...account.name][0].toLocaleUpperCase('ru');
    const blocked = account.loginBlockedSeconds > 0;
    const access = blocked ? 'Вход заблокирован ещё на ' + Math.ceil(account.loginBlockedSeconds / 60) + ' мин' : 'Вход разрешён';
    $('account-access').textContent = access; $('account-access').className = 'badge ' + (blocked ? 'yellow' : 'green');
    $('account-lock').textContent = blocked ? access : 'Ограничений по имени нет.';
    $('account-last-login').textContent = 'Последний вход: ' + (account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString('ru') : 'нет данных');
    $('account-sessions').textContent = account.activeSessions + ' активных';
  }
  async function findAccount(name) {
    const id = ++accountRequest;
    showAccount(null);
    $('account-message').textContent = 'Поиск…';
    $('find-account').disabled = true;
    try {
      const result = await request('/api/operator/accounts');
      if (id !== accountRequest) return;
      const account = result.accounts.find(a => a.name.toLocaleLowerCase('ru') === name.trim().toLocaleLowerCase('ru'));
      showAccount(account || null);
      $('account-message').textContent = account ? '' : 'Аккаунт не найден. Введите полное имя игрока.';
    } catch { if (id === accountRequest) $('account-message').textContent = 'Не удалось найти игрока. Проверьте связь и повторите поиск.'; }
    finally { if (id === accountRequest) $('find-account').disabled = false; }
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
      if (action !== 'dump' && currentSection === 'accounts' && $('account-name').value.trim().toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru')) await findAccount(name);
      void refresh();
    } catch (error) {
      notify('Не удалось подтвердить результат. ' + error.message + ' Обновите данные перед повторным действием.', true);
    } finally { acting = false; updateActionButtons(); $('dump').disabled = false; }
  }
  $('refresh').addEventListener('click', () => {
    void refresh();
    if (currentSection === 'accounts' && selectedAccount) void findAccount(selectedAccount.name);
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
  $('account-search').addEventListener('submit', event => { event.preventDefault(); clearPassword(); void findAccount($('account-name').value); });
  $('account-name').addEventListener('input', () => { ++accountRequest; showAccount(null); clearPassword(); $('account-message').textContent = ''; $('find-account').disabled = false; });
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
  void refresh();
  setInterval(() => void refresh(), 2000);
})();
