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
  import WorldMap from './WorldMap.svelte';
  import Icon from './Icon.svelte';
  import './game-ui.css';
  import './window-ui.css';

  const { game, startupError }: { game: GameApp | null; startupError: string | null } = $props();
  let viewport: HTMLDivElement;
  let snapshot = $state<AppSnapshot>({
    pauseOpen: false,
    controlsHint: false,
    entryStage: null, entryReveal: false, avatarRequired: false,
    babylon: null, babylonPanel: null, babylonTarget: null, babylonWord: '', mapOpen: false, mapPlayer: null, mapPeers: [], avatar: null, avatarOpen: false, avatarPurpose: 'settings', equipment: null,
    phase: 'idle', message: null, screen: 'welcome', nearby: null, dialog: null, debug: false, buildingSymbols: true, coordinates: '',
    capture: 'idle', captureError: null,
    visualLoading: false, visualError: null, modelStats: '',
    worldReady: false, worldWaiting: false, region: 'Площадь открытий', cacheStats: '', chunkRadius: 1,
    authRequired: false, authPending: false, authError: null, authName: '', authChangeRequired: false, authRevision: 0,
    mapId: 'demo', mode: 'local', settingsOpen: false, settingsError: null, networkStatus: 'unauthorized', networkError: null,
    chatOpen: false, chatMessages: [], chatError: null, dialogPending: false, dialogError: null,
    performance: '', renderStats: '', market: null, marketPanel: null, marketTarget: null, stamina: 100, sprintBlocked: false,
    carryHint: null, carryPending: false, carryError: null, heldItemId: null, volume: .3, graphicsQuality: 'balanced', audioStats: 'Источники: 0 · Буферы: 0 · Загрузки: 0 · Память: 0 байт',
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
  const marketMap = $derived(snapshot.mapId === 'market');
  const error = $derived(startupError ?? snapshot.message);
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

<main class:entry-screen={snapshot.authRequired || snapshot.babylonPanel === 'setup' || snapshot.avatarOpen || (snapshot.entryStage === 'loading' && !snapshot.entryReveal)} class:game-screen={snapshot.screen === 'playing'}>
  <div class="viewport" bind:this={viewport}></div>
  <header>
    {#if snapshot.authRequired && game}
      <EntryChrome openSettings={() => game.openSettings()} />
    {:else if !snapshot.avatarOpen && snapshot.babylonPanel !== 'setup'}
    <div class="header-actions">{#if snapshot.screen === 'playing' && profile}<div class="language-display parchment" aria-label="Текущий язык"><Icon name="globe" size={23}/><span>Изучаю {languageNames[profile.learning]}</span></div>{/if}
      {#if game && snapshot.screen !== 'playing'}<button class="glass compact settings-button" aria-label="Настройки" onclick={() => game.openSettings()}><Icon name="settings" size={25}/></button>{/if}
    </div>
    {/if}
  </header>

  {#if !error && game && snapshot.authRequired}
    {#key snapshot.authRevision}<Login pending={snapshot.authPending} error={snapshot.authError} initialName={snapshot.authName} changeRequired={snapshot.authChangeRequired} discoverMode={(signal) => game.discoverAuth(signal)} login={(name, action, password, next) => game.login(name, action, password, next)} />{/key}
  {/if}

  {#if !error && game && snapshot.screen === 'welcome' && !snapshot.entryStage && !snapshot.authRequired && snapshot.babylonPanel !== 'setup'}
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

      <p class="small subtle">{snapshot.mode === 'online' ? 'Позиция сохраняется на сервере. Память NPC связана с текущей сессией входа.' : 'Демо работает локально. Учебные ответы подготовлены заранее.'}</p>
    </section>
  {/if}

  {#if !error && snapshot.screen === 'playing'}
    <div class="hud-top"><aside class="location"><div class="task-chip parchment" aria-label="Текущее задание"><span>{profile ? snapshot.babylon?.state?.taskTitle : snapshot.market ? 'Козы пастуха' : snapshot.region}{#if profile || snapshot.market}<span class="task-count"> · {snapshot.babylon?.state?.fed.length ?? snapshot.market?.fed.length ?? 0} / 4</span>{/if}</span></div></aside>
    {#if snapshot.debug}<div class="debug glass"><output aria-label="Область мира">{snapshot.region}</output><output aria-label="Состояние связи">{snapshot.networkStatus === 'connected' ? 'Подключён' : snapshot.networkStatus}</output><output aria-label="Положение игрока">{snapshot.coordinates}</output><p aria-label="Ресурсы оформления">{snapshot.modelStats}</p><p aria-label="Кеш мира">{snapshot.cacheStats}</p><p aria-label="Производительность">{snapshot.performance}</p><p aria-label="Ресурсы сцены">{snapshot.renderStats}</p><p aria-label="Звук">{snapshot.audioStats}</p></div>{/if}
    </div>
    {#if snapshot.worldWaiting}<p class="asset-warning glass">Соседний участок ещё загружается. Движение продолжится после подготовки.</p>{/if}
    <div class="world-actions">
    {#if snapshot.phase === 'running' && !snapshot.dialog && !snapshot.chatOpen && !snapshot.settingsOpen && !snapshot.marketPanel && !snapshot.babylonPanel && !snapshot.mapOpen && !snapshot.avatarOpen}
      {#if !snapshot.controlsHint && (snapshot.stamina < 100 || snapshot.sprintBlocked)}<Stamina value={snapshot.stamina} blocked={snapshot.sprintBlocked} />{/if}
    {/if}
    {#if !overlayOpen && snapshot.phase === 'running' && (snapshot.carryHint || snapshot.carryPending || snapshot.carryError || snapshot.heldItemId)}
      <aside class="hand-status parchment" role="status" aria-label="Предмет в руке">{snapshot.carryError ?? (snapshot.carryPending ? 'Подождите…' : snapshot.heldItemId ? 'В руке яблоко' : snapshot.carryHint)}</aside>
    {/if}
    {#if snapshot.nearby && !snapshot.dialog && snapshot.phase === 'running'}
      <div class="interaction glass"><span>{snapshot.nearby.name}</span></div>
    {/if}</div>
    {#if snapshot.controlsHint && !overlayOpen && snapshot.phase === 'running'}
      <aside class="controls-hint parchment" aria-label="Управление">
        <h2>Управление</h2>
        <dl><dt>W A S D / ↑ ← ↓ →</dt><dd>Движение</dd><dt>Мышь / колесо</dt><dd>Камера / приближение</dd><dt>Shift / Пробел</dt><dd>Бег / прыжок</dd><dt>E</dt><dd>Взаимодействие</dd><dt>F</dt><dd>Взять / положить предмет</dd><dt>Tab</dt><dd>Задачи</dd><dt>1</dt><dd>Чат</dd><dt>2</dt><dd>Словарь</dd><dt>3</dt><dd>Карта</dd><dt>4</dt><dd>Язык</dd><dt>Esc</dt><dd>Меню</dd></dl>
      </aside>
    {/if}
    {#if snapshot.visualError && snapshot.phase === 'running' && !snapshot.dialog}<p class="asset-warning glass" role="alert">{snapshot.visualError}</p>{/if}
  {/if}

  {#if game && !error && snapshot.entryStage === 'loading'}
    <section class="entry-loading" class:revealing={snapshot.entryReveal} aria-label="Загрузка мира">
      <div class="loading-card"><div class="loading-spinner" aria-hidden="true"></div>
        <h2 role="status">{snapshot.networkError ? 'Нет связи с сервером' : snapshot.visualError ? 'Не удалось загрузить мир' : snapshot.entryReveal ? 'Город появляется…' : snapshot.networkStatus !== 'connected' ? 'Подключаемся…' : 'Загружаем мир…'}</h2>
        <p role="status">{snapshot.networkError ?? snapshot.visualError ?? 'Ваш персонаж ждёт, пока окружение будет готово.'}</p>
        {#if snapshot.networkError}<button onclick={() => game.reconnect()}>Повторить подключение</button>{/if}
        {#if snapshot.visualError}<button onclick={() => game.retryVisuals()}>Повторить загрузку</button>{/if}
        <button class="secondary" onclick={() => game.cancelEntry()}>Вернуться в кабинет</button>
      </div>
    </section>
  {/if}

  {#if error}
    <section class="modal-backdrop"><div class="panel" role="alert"><p class="eyebrow">Просмотр недоступен</p><h2>{snapshot.phase === 'unavailable' ? 'Режим пока недоступен' : 'Не удалось запустить сцену'}</h2><p>{error}</p>
      {#if game && snapshot.mode === 'online' && !snapshot.authRequired}<button class="secondary" onclick={() => game.logout()}>Выйти из сессии</button>{/if}
      {#if game && snapshot.phase === 'error'}<button onclick={() => game.restart(viewport)}>Попробовать снова</button>
      {:else if startupError}<button onclick={() => window.location.reload()}>Повторить</button>{/if}
      {#if game}<button class="secondary" onclick={() => game.openSettings()}>Настройки</button>{/if}
    </div></section>
  {/if}

  {#if !error && game && snapshot.screen === 'playing' && snapshot.phase === 'stopped' && !snapshot.entryStage && snapshot.capture !== 'requesting' && !overlayOpen && snapshot.pauseOpen}
    <div class="modal-backdrop"><dialog use:modal class="panel pause-panel" aria-labelledby="pause-title" oncancel={(event) => { event.preventDefault(); game.toggleMenu(); }}>
      <h2 id="pause-title">Пауза</h2>
      {#if snapshot.captureError}<p class="capture-error" role="alert">{snapshot.captureError}</p>{/if}
      {#if snapshot.networkError}<p class="capture-error" role="alert">{snapshot.networkError}</p>{/if}
      {#if snapshot.networkError}<button class="secondary" onclick={() => game.reconnect()}>Повторить подключение</button>{/if}
      {#if snapshot.mode === 'mock'}<button class="secondary" onclick={() => game.simulateNetworkLoss()}>Проверить разрыв связи</button>{/if}
      {#if snapshot.visualError}<p class="capture-error" role="alert">{snapshot.visualError}</p><button class="secondary" onclick={() => game.retryVisuals()}>Повторить загрузку</button>{/if}
      {#if snapshot.visualLoading}<p class="small" role="status">Загружаем оформление… Можно перезапустить сцену или выйти.</p>{/if}
      <div class="menu-buttons"><button disabled={!snapshot.worldReady || snapshot.visualLoading} onclick={() => game.resume()}>{snapshot.captureError ? 'Вернуть управление' : 'Продолжить'}</button>{#if snapshot.captureError && snapshot.mode === 'online'}<button class="secondary" onclick={() => game.cancelEntry()}>Вернуться в кабинет</button>{/if}<button class="secondary" onclick={() => game.leaveWorld()}>На главный экран</button></div>
      <button class="secondary" onclick={() => game.openSettings()}>Настройки</button>
      {#if snapshot.mode === 'online'}<button class="secondary" onclick={() => game.logout()}>Выйти из сессии</button>{/if}
    </dialog></div>
  {/if}

  {#if !error && game && snapshot.screen === 'playing' && snapshot.phase === 'stopped' && !snapshot.entryStage && snapshot.capture !== 'requesting' && !overlayOpen && !snapshot.pauseOpen}
    <section class="capture-recovery parchment" aria-label="Возврат управления">
      {#if snapshot.captureError}<p role="alert">{snapshot.captureError}</p>{/if}
      <button disabled={!snapshot.worldReady || snapshot.visualLoading} onclick={() => game.resume()}>Вернуть управление</button>
      {#if snapshot.captureError && snapshot.mode === 'online'}<button class="secondary" onclick={() => game.cancelEntry()}>Вернуться в кабинет</button>{/if}
    </section>
  {/if}

  {#if !error && snapshot.screen === 'playing' && snapshot.capture === 'requesting'}
    <div class="modal-backdrop"><div class="panel"><p role="status">Захватываем мышь…</p><button class="secondary" onclick={() => game?.leaveWorld()}>На главный экран</button></div></div>
  {/if}

  {#if !error && game && snapshot.dialog}
    <div class="modal-backdrop dialog-backdrop"><Dialog dialog={snapshot.dialog} pending={snapshot.dialogPending} error={snapshot.dialogError} send={(text) => game.submitDialog(text)} close={() => game.closeDialog()} /></div>
  {/if}
  {#if game && snapshot.chatOpen}<div class="modal-backdrop"><Chat messages={snapshot.chatMessages} error={snapshot.chatError ?? snapshot.networkError} canSend={snapshot.mode !== 'local' && snapshot.networkStatus === 'connected'} send={(text) => game.sendChat(text)} close={() => game.closeChat()} /></div>{/if}

  {#if game && snapshot.market}{#key snapshot.market.runId}<MarketPanel {game} market={snapshot.market} panel={snapshot.marketPanel} target={snapshot.marketTarget} />{/key}{/if}

  {#if game && snapshot.avatarOpen && avatarMounted}<AvatarSelection {game} view={snapshot.avatar} first={snapshot.avatarPurpose === 'first'}/>{/if}
  {#if game && snapshot.mapOpen}<WorldMap simulated={snapshot.mode === 'mock'} player={snapshot.mapPlayer} peers={snapshot.mapPeers} goal={snapshot.babylon?.state?.taskTarget ?? null} market={marketMap} close={() => game.closeMap()}/>{/if}
  {#if game && snapshot.babylon}
    {#if snapshot.babylonPanel === 'setup' && !snapshot.avatarOpen && entryMounted}<EntrySetup {game} {snapshot} view={snapshot.babylon}/>{/if}
    <BabylonPanel {game} view={snapshot.babylon} panel={snapshot.babylonPanel === 'setup' || snapshot.avatarOpen ? null : snapshot.babylonPanel} target={snapshot.babylonTarget} wordSeed={snapshot.babylonWord} equipment={snapshot.equipment} avatarId={snapshot.avatar?.state?.avatarId ?? null}/>
  {/if}

  {#if game && snapshot.settingsOpen}<div class="modal-backdrop"><Settings quality={snapshot.graphicsQuality} mode={snapshot.mode} config={game.config} error={snapshot.settingsError} volume={snapshot.volume} setVolume={(percent) => game.setVolume(percent)} apply={(...args) => game.applySettings(...args)} close={() => game.closeSettings()} {...(snapshot.mode === 'online' && !snapshot.authRequired && !snapshot.avatarOpen ? { appearance: () => game.openAvatar() } : {})} /></div>{/if}



</main>

<style>
.entry-loading { position: fixed; inset: 0; z-index: 35; display: grid; place-items: center; background: transparent; isolation: isolate; }
.entry-loading::before { content: ""; position: absolute; inset: 0; z-index: -1; background: var(--entry-background); transition: opacity .3s; }
.entry-loading.revealing::before { opacity: 0; }
.entry-loading.revealing { background: transparent; align-items: end; padding: 20px; }
.loading-card { max-width: min(90vw, 520px); padding: 24px; text-align: center; background: #fbf1dff0; color: #073c48; border: 2px solid #e8d0a8; }
.loading-card button { margin: 6px; }
.loading-spinner { width: 42px; height: 42px; margin: 0 auto 18px; border: 4px solid #ddc6a0; border-top-color: #086e70; border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media(prefers-reduced-motion:reduce) { .loading-spinner { animation: none; }.entry-loading::before { transition: none; } }
</style>
