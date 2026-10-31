<script lang="ts">
  import { onMount } from 'svelte';
  import type { AppSnapshot, GameApp } from '../app/GameApp';
  import Login from './Login.svelte';
  import Dialog from './Dialog.svelte';
  import Settings from './Settings.svelte';
  import Chat from './Chat.svelte';
  import MarketPanel from './MarketPanel.svelte';
  import { modal } from './modal';

  const { game, startupError }: { game: GameApp | null; startupError: string | null } = $props();
  let viewport: HTMLDivElement;
  let state = $state<AppSnapshot>({
    phase: 'idle', message: null, screen: 'welcome', nearby: null, dialog: null, debug: false, coordinates: '',
    capture: 'idle', captureError: null,
    visualLoading: false, visualError: null, modelStats: '',
    worldReady: false, worldWaiting: false, region: 'Площадь открытий', cacheStats: '', chunkRadius: 1,
    authRequired: false, authPending: false, authError: null, authName: '',
    mode: 'local', settingsOpen: false, settingsError: null, networkStatus: 'unauthorized', networkError: null,
    chatOpen: false, chatMessages: [], chatError: null, dialogPending: false, dialogError: null,
    performance: '', renderStats: '', market: null, marketPanel: null, marketTarget: null,
  });
  const networkLabels = { unauthorized: 'Не авторизован', connecting: 'Подключение…', connected: 'Подключён', lost: 'Связь потеряна', error: 'Ошибка связи', disconnected: 'Отключён' };
  const error = $derived(startupError ?? state.message);

  onMount(() => {
    if (!game) return;
    const unsubscribe = game.subscribe((snapshot) => { state = snapshot; });
    game.start(viewport);
    return () => { unsubscribe(); game.dispose(); };
  });
</script>

<svelte:head><meta name="description" content="Уютный Вавилон: прогулка от третьего лица, история и наука." /></svelte:head>

<main>
  <div class="viewport" bind:this={viewport}></div>
  <header>
    <a class="brand" href="./" aria-label="Мир знаний — главная"><span class="brand-mark" aria-hidden="true">◈</span> Мир знаний</a>
    <div class="header-actions"><span class="mode"><span class="dot" class:active={state.mode === 'local' || state.networkStatus === 'connected'}></span> {state.mode === 'local' ? 'Локальное демо' : state.mode === 'mock' ? 'Тестовая сеть' : 'Локальный сервер'}</span>
      {#if state.mode !== 'local'}<output class="small" aria-label="Состояние связи">{networkLabels[state.networkStatus]}</output>{/if}
      {#if game}<button class="glass compact" onclick={() => game.openSettings()}>Настройки</button>{/if}
      {#if game && state.screen === 'playing' && !error}
        <button class="glass compact" onclick={() => game.toggleMenu()}>Меню <kbd>Esc</kbd></button>
      {/if}
    </div>
  </header>

  {#if !error && game && state.authRequired}
    <Login pending={state.authPending} error={state.authError} initialName={state.authName} login={(name) => game.login(name)} />
  {/if}

  {#if !error && game && state.screen === 'welcome' && !state.authRequired}
    <section class="welcome glass" aria-labelledby="scene-title">
      <p class="eyebrow">Добро пожаловать в Вавилон</p>
      <h1 id="scene-title">{#if state.market}Рынок<br />Вавилона.{:else}Город<br />открытий.{/if}</h1>
      <p class="description">{state.market ? 'Золотистый камень, тень навесов и три лавки. За лестницей — пастух и четыре козы, которым нужна ваша помощь.' : 'Кирпичные башни, тёплый песчаник и тень пальм. Познакомьтесь с Леей и Марком на площади древнего города.'}</p>
      {#if state.captureError}<p class="capture-error" role="alert">{state.captureError}</p>{/if}
      {#if state.networkError}<p class="capture-error" role="alert">{state.networkError}</p>{/if}
      {#if state.mode !== 'local'}<p class="small subtle">{state.mode === 'mock' ? 'Тестовый участник и сетевые ответы имитируются; это проверка клиента без сервера.' : 'Сетевая игра использует локальный сервер.'}</p><button class="secondary" onclick={() => game.reconnect()}>Повторить подключение</button>{/if}
      {#if state.mode === 'online'}<button class="secondary capture-exit" onclick={() => game.logout()}>Выйти из сессии</button>{/if}
      {#if state.visualError}<p class="capture-error" role="alert">{state.visualError}</p><button class="secondary" onclick={() => game.retryVisuals()}>Повторить загрузку</button>{/if}
      {#if state.visualLoading}<p class="small subtle">Загружаем оформление…</p>{/if}
      {#if !state.worldReady}<p class="small subtle">Готовим окрестности точки появления…</p>{/if}
      <button class="primary large" disabled={state.capture === 'requesting' || !state.worldReady} onclick={() => game.enterWorld()}>{state.capture === 'requesting' ? 'Захватываем мышь…' : state.captureError ? 'Повторить захват' : 'Начать прогулку'} <span aria-hidden="true">↗</span></button>
      {#if state.captureError || state.capture === 'requesting'}<button class="secondary capture-exit" onclick={() => game.leaveWorld()}>На главный экран</button>{/if}
      {#if state.market}<button class="secondary capture-exit" onclick={() => game.openMarketPanel('intro')}>О мире и управлении</button>{/if}
      <div class="welcome-controls"><p><kbd>W A S D</kbd> движение относительно камеры</p><p><kbd>E</kbd> разговор с персонажем</p><p><kbd>Мышь</kbd> обзор · колесо — масштаб</p><p><kbd>Esc</kbd> освободить курсор и открыть меню</p></div>
      <p class="small subtle">{state.mode === 'online' ? 'Позиция и история разговоров сохраняются на сервере.' : 'Демо работает локально. Учебные ответы подготовлены заранее.'}</p>
    </section>
  {/if}

  {#if !error && state.screen === 'playing'}
    <div class="hud-top"><aside class="location glass"><p class="eyebrow">Вавилон</p><h1>{state.region}</h1><p>{state.market ? `Козы пастуха · ${state.market.fed.length}/4` : 'Лея — история · Марк — наука'}</p></aside>
    {#if state.debug}<div class="debug glass"><output aria-label="Положение игрока">{state.coordinates}</output><p aria-label="Ресурсы оформления">{state.modelStats}</p><p aria-label="Кеш мира">{state.cacheStats}</p><p aria-label="Производительность">{state.performance}</p><p aria-label="Ресурсы сцены">{state.renderStats}</p></div>{/if}
    </div>
    {#if state.worldWaiting}<p class="asset-warning glass">Соседний участок ещё загружается. Движение продолжится после подготовки.</p>{/if}
    <div class="world-actions">{#if state.market}<button class="quest-button glass" onclick={() => game?.openMarketPanel('task')}>Козы пастуха · {state.market.fed.length}/4</button>{/if}<button class="chat-button glass" onclick={() => game?.openChat()}>Общение{state.chatMessages.length ? ` · ${state.chatMessages.length}` : ''}</button>
    {#if state.nearby && !state.dialog && state.phase === 'running'}
      <button class="interaction glass" onclick={() => game?.interact()}><kbd>E</kbd><span>{state.market ? 'Взаимодействовать' : 'Поговорить'}<span class="interaction-name">{state.nearby.name}</span></span></button>
    {/if}</div>
    {#if state.visualError && state.phase === 'running' && !state.dialog}<p class="asset-warning glass" role="alert">{state.visualError}</p>{/if}
  {/if}

  {#if error}
    <section class="modal-backdrop"><div class="panel" role="alert"><p class="eyebrow">Просмотр недоступен</p><h2>{state.phase === 'unavailable' ? 'Режим пока недоступен' : 'Не удалось запустить сцену'}</h2><p>{error}</p>
      {#if game && state.mode === 'online' && !state.authRequired}<button class="secondary" onclick={() => game.logout()}>Выйти из сессии</button>{/if}
      {#if game && state.phase === 'error'}<button onclick={() => game.restart(viewport)}>Попробовать снова</button>
      {:else if startupError}<button onclick={() => window.location.reload()}>Повторить</button>{/if}
      {#if game}<button class="secondary" onclick={() => game.openSettings()}>Настройки</button>{/if}
    </div></section>
  {/if}

  {#if !error && game && state.screen === 'playing' && state.phase === 'stopped' && state.capture !== 'requesting' && !state.chatOpen && !state.settingsOpen && !state.marketPanel}
    <div class="modal-backdrop"><dialog use:modal class="panel pause-panel" aria-labelledby="pause-title" oncancel={(event) => { event.preventDefault(); game.toggleMenu(); }}>
      <p class="eyebrow">Можно не торопиться</p><h2 id="pause-title">Пауза</h2><p class="subtle">Прогулка продолжится с этого места.</p>
      {#if state.captureError}<p class="capture-error" role="alert">{state.captureError}</p>{/if}
      {#if state.networkError}<p class="capture-error" role="alert">{state.networkError}</p>{/if}
      {#if state.mode !== 'local'}<button class="secondary" onclick={() => game.reconnect()}>Повторить подключение</button><button class="secondary" onclick={() => game.logout()}>Выйти из сессии</button>{/if}
      {#if state.mode === 'mock'}<button class="secondary" onclick={() => game.simulateNetworkLoss()}>Проверить разрыв связи</button>{/if}
      {#if state.visualError}<p class="capture-error" role="alert">{state.visualError}</p><button class="secondary" onclick={() => game.retryVisuals()}>Повторить загрузку</button>{/if}
      <div class="menu-buttons"><button disabled={!state.worldReady} onclick={() => game.resume()}>{state.captureError ? 'Повторить захват' : 'Продолжить'}</button><button class="secondary" onclick={() => game.openChat()}>Общение</button><button class="secondary" onclick={() => game.restart(viewport)}>Перезапустить сцену</button><button class="secondary" onclick={() => game.leaveWorld()}>На главный экран</button></div>
      {#if state.market}<div class="menu-buttons market-menu"><button class="secondary" onclick={() => game.openMarketPanel('task')}>Задание</button><button class="secondary" onclick={() => game.openMarketPanel('inventory')}>Сумка</button><button class="secondary" onclick={() => game.openMarketPanel('stone')}>Камень</button><button class="secondary" onclick={() => game.openMarketPanel('words')}>Словарь</button><button class="secondary" onclick={() => game.openMarketPanel('intro')}>О мире и управлении</button></div>{/if}
      <label class="debug-toggle"><input type="checkbox" checked={state.debug} onchange={(event) => game.setDebug(event.currentTarget.checked)} /> Показывать координаты</label>
      <button class="secondary" onclick={() => game.openSettings()}>Настройки</button>
      <label class="debug-toggle radius-setting">Радиус загрузки <select aria-label="Радиус загрузки" value={state.chunkRadius} onchange={(event) => game.setChunkRadius(Number(event.currentTarget.value))}><option value={0}>Текущая область</option><option value={1}>Ближайшие области</option><option value={2}>Расширенный обзор</option></select></label>
      <p class="small subtle">Мышь свободна. Нажмите «Продолжить», чтобы вернуть управление.<br />WASD — идти · мышь — обзор · E — поговорить</p>
    </dialog></div>
  {/if}

  {#if !error && state.screen === 'playing' && state.capture === 'requesting'}
    <div class="modal-backdrop"><div class="panel"><p role="status">Захватываем мышь…</p><button class="secondary" onclick={() => game?.leaveWorld()}>На главный экран</button></div></div>
  {/if}

  {#if !error && game && state.dialog}
    <div class="modal-backdrop dialog-backdrop"><Dialog dialog={state.dialog} pending={state.dialogPending} error={state.dialogError} send={(text) => game.submitDialog(text)} close={() => game.closeDialog()} /></div>
  {/if}
  {#if game && state.settingsOpen}<div class="modal-backdrop"><Settings mode={state.mode} config={game.config} error={state.settingsError} apply={(...args) => game.applySettings(...args)} close={() => game.closeSettings()} /></div>{/if}
  {#if game && state.chatOpen}<div class="modal-backdrop"><Chat messages={state.chatMessages} error={state.chatError ?? state.networkError} canSend={state.mode !== 'local' && state.networkStatus === 'connected'} send={(text) => game.sendChat(text)} close={() => game.closeChat()} /></div>{/if}

  {#if game && state.market}{#key state.market.runId}<MarketPanel {game} market={state.market} panel={state.marketPanel} target={state.marketTarget} />{/key}{/if}

  <footer>
    <p class="status" role="status"><span class:active={state.phase === 'running'} class="dot"></span>{error ? 'Просмотр недоступен' : state.authRequired ? (state.authPending ? 'Вход на сервер…' : 'Войдите, чтобы открыть мир') : state.phase === 'running' ? 'Сцена открыта' : state.phase === 'stopped' ? 'Просмотр приостановлен' : 'Подготовка сцены…'}</p>
    {#if state.screen === 'playing' && !error}<p class="hints"><kbd>W A S D</kbd> идти <span>·</span> <kbd>E</kbd> говорить <span>·</span> <kbd>Мышь</kbd> обзор <span>·</span> <kbd>Esc</kbd> меню</p>{/if}
  </footer>
</main>
