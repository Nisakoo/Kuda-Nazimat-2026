<script lang="ts">
  import { onMount } from 'svelte';
  import type { AppSnapshot, GameApp } from '../app/GameApp';
  import Dialog from './Dialog.svelte';
  import { modal } from './modal';

  const { game, startupError }: { game: GameApp | null; startupError: string | null } = $props();
  let viewport: HTMLDivElement;
  let state = $state<AppSnapshot>({
    phase: 'idle', message: null, screen: 'welcome', nearby: null, dialog: null, debug: false, coordinates: '',
  });
  const error = $derived(startupError ?? state.message);

  onMount(() => {
    if (!game) return;
    const unsubscribe = game.subscribe((snapshot) => { state = snapshot; });
    game.start(viewport);
    return () => { unsubscribe(); game.dispose(); };
  });
</script>

<svelte:head><meta name="description" content="Локальная демо-площадь учебного мира: прогулка, история и наука." /></svelte:head>

<main>
  <div class="viewport" bind:this={viewport}></div>
  <header>
    <a class="brand" href="./" aria-label="Мир знаний — главная"><span class="brand-mark" aria-hidden="true">◈</span> Мир знаний</a>
    <div class="header-actions"><span class="mode"><span class="dot active"></span> Локальное демо</span>
      {#if game && state.screen === 'playing' && !error}
        <button class="glass compact" onclick={() => game.toggleMenu()}>Меню <kbd>Esc</kbd></button>
      {/if}
    </div>
  </header>

  {#if !error && game && state.screen === 'welcome'}
    <section class="welcome glass" aria-labelledby="scene-title">
      <p class="eyebrow">Первая прогулка</p>
      <h1 id="scene-title">Площадь<br />открытий.</h1>
      <p class="description">Маленькое место для больших вопросов.<br />Познакомьтесь с Леей и Марком, прогуляйтесь по площади и обсудите историю и науку.</p>
      <button class="primary large" onclick={() => game.enterWorld()}>Начать прогулку <span aria-hidden="true">↗</span></button>
      <div class="welcome-controls"><p><kbd>W A S D</kbd> движение</p><p><kbd>E</kbd> разговор с персонажем</p><p><kbd>ПКМ + мышь</kbd> обзор · колесо — масштаб</p></div>
      <p class="small subtle">Демо работает локально. Учебные ответы подготовлены заранее.</p>
    </section>
  {/if}

  {#if !error && state.screen === 'playing'}
    <aside class="location glass"><p class="eyebrow">Исследуйте мир</p><h1>Площадь открытий</h1><p>Лея — история · Марк — наука</p></aside>
    {#if state.debug}<output class="debug glass" aria-label="Положение игрока">{state.coordinates}</output>{/if}
    {#if state.nearby && !state.dialog && state.phase === 'running'}
      <button class="interaction glass" onclick={() => game?.interact()}><kbd>E</kbd><span>Поговорить<span class="interaction-name">{state.nearby.name}</span></span></button>
    {/if}
  {/if}

  {#if error}
    <section class="modal-backdrop"><div class="panel" role="alert"><p class="eyebrow">Просмотр недоступен</p><h2>{state.phase === 'unavailable' ? 'Режим пока недоступен' : 'Не удалось запустить сцену'}</h2><p>{error}</p>
      {#if game && state.phase === 'error'}<button onclick={() => game.restart(viewport)}>Попробовать снова</button>
      {:else if startupError}<button onclick={() => window.location.reload()}>Повторить</button>{/if}
    </div></section>
  {/if}

  {#if !error && game && state.phase === 'stopped'}
    <div class="modal-backdrop"><dialog use:modal class="panel pause-panel" aria-labelledby="pause-title" oncancel={(event) => { event.preventDefault(); game.toggleMenu(); }}>
      <p class="eyebrow">Можно не торопиться</p><h2 id="pause-title">Пауза</h2><p class="subtle">Прогулка продолжится с этого места.</p>
      <div class="menu-buttons"><button onclick={() => game.start(viewport)}>Продолжить</button><button class="secondary" onclick={() => game.restart(viewport)}>Перезапустить сцену</button><button class="secondary" onclick={() => game.leaveWorld()}>На главный экран</button></div>
      <label class="debug-toggle"><input type="checkbox" checked={state.debug} onchange={(event) => game.setDebug(event.currentTarget.checked)} /> Показывать координаты</label>
      <p class="small subtle">WASD / стрелки — идти · E — поговорить<br />Правая кнопка мыши — обзор · Esc — меню</p>
    </dialog></div>
  {/if}

  {#if !error && game && state.dialog}
    <div class="modal-backdrop dialog-backdrop"><Dialog dialog={state.dialog} send={(text) => game.submitDialog(text)} close={() => game.closeDialog()} /></div>
  {/if}

  <footer>
    <p class="status" role="status"><span class:active={state.phase === 'running'} class="dot"></span>{error ? 'Просмотр недоступен' : state.phase === 'running' ? 'Сцена открыта' : state.phase === 'stopped' ? 'Просмотр приостановлен' : 'Подготовка сцены…'}</p>
    {#if state.screen === 'playing' && !error}<p class="hints"><kbd>W A S D</kbd> идти <span>·</span> <kbd>E</kbd> говорить <span>·</span> <kbd>ПКМ</kbd> обзор</p>{/if}
  </footer>
</main>
