<script lang="ts">
  import { onMount } from 'svelte';
  import type { AppSnapshot, GameApp } from '../app/GameApp';
  import Login from './Login.svelte';
  import BabylonPanel from './BabylonPanel.svelte';
  import Dialog from './Dialog.svelte';
  import Settings from './Settings.svelte';
  import Chat from './Chat.svelte';
  import MarketPanel from './MarketPanel.svelte';
  import { modal } from './modal';
  import Stamina from './Stamina.svelte';
  import EntrySetup from './EntrySetup.svelte';
  import EntryChrome from './EntryChrome.svelte';
  import AvatarSelection from './AvatarSelection.svelte';
  import HudDock from './HudDock.svelte';
  import WorldMap from './WorldMap.svelte';
  import Icon from './Icon.svelte';
  import './game-ui.css';

  const { game, startupError }: { game: GameApp | null; startupError: string | null } = $props();
  let viewport: HTMLDivElement;
  let snapshot = $state<AppSnapshot>({
    babylon: null, babylonPanel: null, babylonTarget: null, babylonWord: '', mapOpen: false, mapPlayer: null, mapPeers: [], avatar: null, avatarOpen: false, avatarPurpose: 'settings', equipment: null,
    phase: 'idle', message: null, screen: 'welcome', nearby: null, dialog: null, debug: false, buildingSymbols: true, coordinates: '',
    capture: 'idle', captureError: null,
    visualLoading: false, visualError: null, modelStats: '',
    worldReady: false, worldWaiting: false, region: 'Площадь открытий', cacheStats: '', chunkRadius: 1,
    authRequired: false, authPending: false, authError: null, authName: '',
    mapId: 'demo', mode: 'local', settingsOpen: false, settingsError: null, networkStatus: 'unauthorized', networkError: null,
    chatOpen: false, chatMessages: [], chatError: null, dialogPending: false, dialogError: null,
    performance: '', renderStats: '', market: null, marketPanel: null, marketTarget: null, stamina: 100, sprintBlocked: false,
  });
  let avatarMounted = $state(false);
  let entryMounted = $state(false);
  // A pending login can finish while Settings is the top modal. Defer a new
  // entry modal until Settings closes, but keep an existing one mounted.
  $effect(() => {
    if (!snapshot.avatarOpen) avatarMounted = false;
    else if (!snapshot.settingsOpen) avatarMounted = true;
    if (snapshot.babylonPanel !== 'setup' || snapshot.avatarOpen || !snapshot.babylon) entryMounted = false;
    else if (!snapshot.settingsOpen) entryMounted = true;
  });
  const networkLabels = { unauthorized: 'Не авторизован', connecting: 'Подключение…', connected: 'Подключён', lost: 'Связь потеряна', error: 'Ошибка связи', disconnected: 'Отключён' };
  const marketMap = $derived(snapshot.mapId === 'market');
  const error = $derived(startupError ?? snapshot.message);
  const activeHud = $derived(snapshot.mapOpen ? 'map' : snapshot.chatOpen ? 'chat' : snapshot.babylonPanel === 'inventory' || snapshot.babylonPanel === 'words' || snapshot.babylonPanel === 'chat' ? snapshot.babylonPanel : snapshot.marketPanel === 'inventory' || snapshot.marketPanel === 'words' ? snapshot.marketPanel : null);
  const languageNames = { ru: 'Русский', en: 'English', es: 'Español' };
  const profile = $derived(snapshot.babylon?.state?.profile);
  const overlayOpen = $derived(Boolean(snapshot.avatarOpen || snapshot.babylonPanel || snapshot.marketPanel || snapshot.mapOpen || snapshot.chatOpen || snapshot.settingsOpen || snapshot.dialog));

  onMount(() => {
    if (!game) return;
    const unsubscribe = game.subscribe((next) => { snapshot = next; });
    game.start(viewport);
    return () => { unsubscribe(); game.dispose(); };
  });
</script>

<svelte:head><meta name="description" content="Уютный Вавилон: прогулка от третьего лица, история и наука." /></svelte:head>

<main class:entry-screen={snapshot.authRequired || snapshot.babylonPanel === 'setup' || snapshot.avatarOpen} class:game-screen={snapshot.screen === 'playing'}>
  <div class="viewport" bind:this={viewport}></div>
  <header>
    {#if snapshot.authRequired && game}
      <EntryChrome openSettings={() => game.openSettings()} />
    {:else if !snapshot.avatarOpen && snapshot.babylonPanel !== 'setup'}
    <a class="brand" href="./" aria-label="Вавилон — главная"><Icon name="logo" size={44}/> Вавилон</a>
    <div class="header-actions">{#if snapshot.screen === 'playing' && profile}<button class="language-button parchment" onclick={() => game?.openBabylonPanel('languages')}><Icon name="globe" size={23}/><span>Изучаю {languageNames[profile.learning]}</span><span aria-hidden="true">⌄</span></button>{/if}<span class="mode"><span class="dot" class:active={snapshot.mode === 'local' || snapshot.networkStatus === 'connected'}></span> {snapshot.mode === 'local' ? 'Локальное демо' : snapshot.mode === 'mock' ? 'Тестовая сеть' : 'Локальный сервер'}</span>
      {#if snapshot.mode !== 'local'}<output class="small" aria-label="Состояние связи">{networkLabels[snapshot.networkStatus]}</output>{/if}
      {#if game}<button class="glass compact settings-button" aria-label="Настройки" onclick={() => game.openSettings()}><Icon name="settings" size={25}/></button>{/if}
      {#if game && snapshot.screen === 'playing' && !error}
        <button class="glass compact" onclick={() => game.toggleMenu()}>Меню <kbd>Esc</kbd></button>
      {/if}
    </div>
    {/if}
  </header>

  {#if !error && game && snapshot.authRequired}
    <Login pending={snapshot.authPending} error={snapshot.authError} initialName={snapshot.authName} login={(name) => game.login(name)} loginPassword={(name, password) => game.loginPassword(name, password)} register={(name, password) => game.register(name, password)} configure={() => game.openSettings()} />
  {/if}

  {#if !error && game && snapshot.screen === 'welcome' && !snapshot.authRequired && snapshot.babylonPanel !== 'setup'}
    <section class="welcome glass" aria-labelledby="scene-title">
      <p class="eyebrow">Добро пожаловать в Вавилон</p>
      <h1 id="scene-title">{#if marketMap}Рынок<br />Вавилона.{:else}Город<br />открытий.{/if}</h1>
      <p class="description">{marketMap ? 'Золотистый камень, тень навесов и три лавки. За лестницей — пастух и четыре козы, которым нужна ваша помощь.' : 'Кирпичные башни, тёплый песчаник и тень пальм. Познакомьтесь с Леей и Марком на площади древнего города.'}</p>
      {#if snapshot.captureError}<p class="capture-error" role="alert">{snapshot.captureError}</p>{/if}
      {#if snapshot.networkError}<p class="capture-error" role="alert">{snapshot.networkError}</p>{/if}
      {#if snapshot.mode !== 'local'}<p class="small subtle">{snapshot.mode === 'mock' ? 'Тестовый участник и сетевые ответы имитируются; это проверка клиента без сервера.' : 'Сетевая игра использует локальный сервер.'}</p><button class="secondary" onclick={() => game.reconnect()}>Повторить подключение</button>{/if}
      {#if snapshot.mode === 'online'}<button class="secondary capture-exit" onclick={() => game.logout()}>Выйти из сессии</button>{/if}
      {#if snapshot.visualError}<p class="capture-error" role="alert">{snapshot.visualError}</p><button class="secondary" onclick={() => game.retryVisuals()}>Повторить загрузку</button>{/if}
      {#if snapshot.visualLoading}<p class="small subtle">Загружаем оформление…</p>{/if}
      {#if !snapshot.worldReady}<p class="small subtle">Готовим окрестности точки появления…</p>{/if}
      <button class="primary large" disabled={snapshot.capture === 'requesting' || !snapshot.worldReady || snapshot.visualLoading} onclick={() => game.enterWorld()}>{snapshot.capture === 'requesting' ? 'Захватываем мышь…' : snapshot.captureError ? 'Повторить захват' : 'Начать прогулку'} <span aria-hidden="true">↗</span></button>
      {#if snapshot.captureError || snapshot.capture === 'requesting'}<button class="secondary capture-exit" onclick={() => game.leaveWorld()}>На главный экран</button>{/if}
      {#if snapshot.market}<button class="secondary capture-exit" onclick={() => game.openMarketPanel('intro')}>О мире и управлении</button>{/if}
      <div class="welcome-controls"><p><kbd>W A S D</kbd> движение относительно камеры</p><p><kbd>Space</kbd> прыжок · <kbd>Shift</kbd> спринт</p><p><kbd>E</kbd> разговор с персонажем</p><p><kbd>Мышь</kbd> обзор · колесо — масштаб</p><p><kbd>Esc</kbd> освободить курсор и открыть меню</p></div>
      <p class="small subtle">{snapshot.mode === 'online' ? 'Позиция и история разговоров сохраняются на сервере.' : 'Демо работает локально. Учебные ответы подготовлены заранее.'}</p>
    </section>
  {/if}

  {#if !error && snapshot.screen === 'playing'}
    <div class="hud-top"><aside class="location"><button class="task-chip parchment" onclick={() => profile ? game?.openBabylonPanel('task') : snapshot.market ? game?.openMarketPanel('task') : game?.toggleMenu()}><span class="task-gem" aria-hidden="true">✓</span><span>{profile ? snapshot.babylon?.state?.taskTitle : snapshot.market ? 'Козы пастуха' : snapshot.region}{#if profile || snapshot.market}<span class="task-count"> · {snapshot.babylon?.state?.fed.length ?? snapshot.market?.fed.length ?? 0} / 4</span>{/if}</span><span aria-hidden="true">⌄</span></button></aside>
    {#if snapshot.debug}<div class="debug glass"><output aria-label="Положение игрока">{snapshot.coordinates}</output><p aria-label="Ресурсы оформления">{snapshot.modelStats}</p><p aria-label="Кеш мира">{snapshot.cacheStats}</p><p aria-label="Производительность">{snapshot.performance}</p><p aria-label="Ресурсы сцены">{snapshot.renderStats}</p></div>{/if}
    </div>
    {#if snapshot.worldWaiting}<p class="asset-warning glass">Соседний участок ещё загружается. Движение продолжится после подготовки.</p>{/if}
    {#if snapshot.phase === 'running' && !snapshot.dialog && !snapshot.chatOpen && !snapshot.settingsOpen && !snapshot.marketPanel && !snapshot.babylonPanel && !snapshot.mapOpen && !snapshot.avatarOpen}
      <Stamina value={snapshot.stamina} blocked={snapshot.sprintBlocked} />
    {/if}
    <div class="world-actions">
    {#if snapshot.nearby && !snapshot.dialog && snapshot.phase === 'running'}
      <button class="interaction glass" onclick={() => game?.interact()}><kbd>E</kbd><span>{snapshot.market ? 'Взаимодействовать' : 'Поговорить'}<span class="interaction-name">{snapshot.nearby.name}</span></span></button>
    {/if}</div>
    {#if !overlayOpen && snapshot.phase === 'running'}{@render navigation()}{/if}
    {#if snapshot.visualError && snapshot.phase === 'running' && !snapshot.dialog}<p class="asset-warning glass" role="alert">{snapshot.visualError}</p>{/if}
  {/if}

  {#if error}
    <section class="modal-backdrop"><div class="panel" role="alert"><p class="eyebrow">Просмотр недоступен</p><h2>{snapshot.phase === 'unavailable' ? 'Режим пока недоступен' : 'Не удалось запустить сцену'}</h2><p>{error}</p>
      {#if game && snapshot.mode === 'online' && !snapshot.authRequired}<button class="secondary" onclick={() => game.logout()}>Выйти из сессии</button>{/if}
      {#if game && snapshot.phase === 'error'}<button onclick={() => game.restart(viewport)}>Попробовать снова</button>
      {:else if startupError}<button onclick={() => window.location.reload()}>Повторить</button>{/if}
      {#if game}<button class="secondary" onclick={() => game.openSettings()}>Настройки</button>{/if}
    </div></section>
  {/if}

  {#if !error && game && snapshot.screen === 'playing' && snapshot.phase === 'stopped' && snapshot.capture !== 'requesting' && !snapshot.chatOpen && !snapshot.settingsOpen && !snapshot.marketPanel && !snapshot.babylonPanel && !snapshot.mapOpen && !snapshot.avatarOpen}
    <div class="modal-backdrop"><dialog use:modal class="panel pause-panel" aria-labelledby="pause-title" oncancel={(event) => { event.preventDefault(); game.toggleMenu(); }}>
      <p class="eyebrow">Можно не торопиться</p><h2 id="pause-title">Пауза</h2><p class="subtle">Прогулка продолжится с этого места.</p>
      {#if snapshot.captureError}<p class="capture-error" role="alert">{snapshot.captureError}</p>{/if}
      {#if snapshot.networkError}<p class="capture-error" role="alert">{snapshot.networkError}</p>{/if}
      {#if snapshot.mode !== 'local'}<button class="secondary" onclick={() => game.reconnect()}>Повторить подключение</button><button class="secondary" onclick={() => game.logout()}>Выйти из сессии</button>{/if}
      {#if snapshot.mode === 'mock'}<button class="secondary" onclick={() => game.simulateNetworkLoss()}>Проверить разрыв связи</button>{/if}
      {#if snapshot.visualError}<p class="capture-error" role="alert">{snapshot.visualError}</p><button class="secondary" onclick={() => game.retryVisuals()}>Повторить загрузку</button>{/if}
      {#if snapshot.visualLoading}<p class="small" role="status">Загружаем оформление… Можно перезапустить сцену или выйти.</p>{/if}
      <div class="menu-buttons"><button disabled={!snapshot.worldReady || snapshot.visualLoading} onclick={() => game.resume()}>{snapshot.captureError ? 'Повторить захват' : 'Продолжить'}</button><button class="secondary" onclick={() => game.openChat()}>Общение</button><button class="secondary" onclick={() => game.restart(viewport)}>Перезапустить сцену</button><button class="secondary" onclick={() => game.leaveWorld()}>На главный экран</button></div>
      {#if snapshot.market}<div class="menu-buttons market-menu"><button class="secondary" onclick={() => game.openMarketPanel('task')}>Задание</button><button class="secondary" onclick={() => game.openMarketPanel('inventory')}>Сумка</button><button class="secondary" onclick={() => game.openMarketPanel('stone')}>Камень</button><button class="secondary" onclick={() => game.openMarketPanel('words')}>Словарь</button><button class="secondary" onclick={() => game.openMarketPanel('intro')}>О мире и управлении</button></div>{/if}
      {#if marketMap}<label class="debug-toggle"><input type="checkbox" checked={snapshot.buildingSymbols} onchange={(event) => game.setBuildingSymbols(event.currentTarget.checked)} /> Символы над башней</label>{/if}
      {#if snapshot.babylon?.state?.profile}<div class="menu-buttons market-menu">{#each [['task', 'Задание'], ['inventory', 'Сумка'], ['stone', 'Камень'], ['words', 'Словарь'], ['languages', 'Языки'], ['intro', 'О мире и управлении']] as [panel, label]}<button class="secondary" onclick={() => game.openBabylonPanel(panel as import('../app/GameApp').BabylonPanel)}>{label}</button>{/each}</div>{/if}
      <label class="debug-toggle"><input type="checkbox" checked={snapshot.debug} onchange={(event) => game.setDebug(event.currentTarget.checked)} /> Показывать координаты</label>
      <button class="secondary" onclick={() => game.openSettings()}>Настройки</button>
      <label class="debug-toggle radius-setting">Радиус загрузки <select aria-label="Радиус загрузки" value={snapshot.chunkRadius} onchange={(event) => game.setChunkRadius(Number(event.currentTarget.value))}><option value={0}>Текущая область</option><option value={1}>Ближайшие области</option><option value={2}>Расширенный обзор</option></select></label>
      <p class="small subtle">Мышь свободна. Нажмите «Продолжить», чтобы вернуть управление.<br />WASD — идти · Space — прыжок · Shift — спринт · E — поговорить</p>
      {@render navigation()}
    </dialog></div>
  {/if}

  {#if !error && snapshot.screen === 'playing' && snapshot.capture === 'requesting'}
    <div class="modal-backdrop"><div class="panel"><p role="status">Захватываем мышь…</p><button class="secondary" onclick={() => game?.leaveWorld()}>На главный экран</button></div></div>
  {/if}

  {#if !error && game && snapshot.dialog}
    <div class="modal-backdrop dialog-backdrop"><Dialog dialog={snapshot.dialog} pending={snapshot.dialogPending} error={snapshot.dialogError} send={(text) => game.submitDialog(text)} close={() => game.closeDialog()} /></div>
  {/if}
  {#if game && snapshot.chatOpen}<div class="modal-backdrop"><Chat messages={snapshot.chatMessages} error={snapshot.chatError ?? snapshot.networkError} canSend={snapshot.mode !== 'local' && snapshot.networkStatus === 'connected'} send={(text) => game.sendChat(text)} close={() => game.closeChat()} {navigation} /></div>{/if}

  {#if game && snapshot.market}{#key snapshot.market.runId}<MarketPanel {game} market={snapshot.market} panel={snapshot.marketPanel} target={snapshot.marketTarget} {navigation} />{/key}{/if}

  {#if game && snapshot.avatarOpen && avatarMounted}<AvatarSelection {game} view={snapshot.avatar} first={snapshot.avatarPurpose === 'first'}/>{/if}
  {#if game && snapshot.mapOpen}<WorldMap simulated={snapshot.mode === 'mock'} player={snapshot.mapPlayer} peers={snapshot.mapPeers} goal={snapshot.babylon?.state?.taskTarget ?? null} market={marketMap} close={() => game.closeMap()} {navigation}/>{/if}
  {#if game && snapshot.babylon}
    {#if snapshot.babylonPanel === 'setup' && !snapshot.avatarOpen && entryMounted}<EntrySetup {game} view={snapshot.babylon}/>{/if}
    <BabylonPanel {game} view={snapshot.babylon} panel={snapshot.babylonPanel === 'setup' || snapshot.avatarOpen ? null : snapshot.babylonPanel} target={snapshot.babylonTarget} wordSeed={snapshot.babylonWord} equipment={snapshot.equipment} {navigation}/>
  {/if}

  {#if game && snapshot.settingsOpen}<div class="modal-backdrop"><Settings mode={snapshot.mode} config={game.config} error={snapshot.settingsError} apply={(...args) => game.applySettings(...args)} close={() => game.closeSettings()} {...(snapshot.mode === 'online' && !snapshot.authRequired && !snapshot.avatarOpen ? { appearance: () => game.openAvatar() } : {})} /></div>{/if}

  {#snippet navigation()}{#if snapshot.screen === 'playing' && snapshot.babylonPanel !== 'intro' && snapshot.marketPanel !== 'intro'}<HudDock active={activeHud} select={(panel) => game?.toggleHudPanel(panel)}/>{/if}{/snippet}

  <footer>
    {#if snapshot.screen === 'playing' && !error}<div class="status current-region" role="group" aria-label="Текущая область">{snapshot.region}</div>{/if}
    <p class="status" role="status"><span class:active={snapshot.phase === 'running'} class="dot"></span>{error ? 'Просмотр недоступен' : snapshot.authRequired ? (snapshot.authPending ? 'Вход на сервер…' : 'Войдите, чтобы открыть мир') : snapshot.phase === 'running' ? 'Сцена открыта' : snapshot.phase === 'stopped' ? 'Просмотр приостановлен' : 'Подготовка сцены…'}</p>
    {#if snapshot.screen === 'playing' && !error}<p class="hints"><kbd>W A S D</kbd> идти <span>·</span> <kbd>E</kbd> говорить <span>·</span> <kbd>Мышь</kbd> обзор <span>·</span> <kbd>Esc</kbd> меню</p>{/if}
  </footer>
</main>
