<script lang="ts">
  import { onMount } from 'svelte';
  import type { AppSnapshot, GameApp } from '../app/GameApp';

  const { game, startupError }: { game: GameApp | null; startupError: string | null } = $props();
  let viewport: HTMLDivElement;
  let state = $state<AppSnapshot>({ phase: 'idle', message: null });
  const error = $derived(startupError ?? state.message);

  onMount(() => {
    if (!game) return;
    const unsubscribe = game.subscribe((snapshot) => { state = snapshot; });
    game.start(viewport);
    return () => { unsubscribe(); game.dispose(); };
  });
</script>

<svelte:head><meta name="description" content="Учебный трёхмерный мир. Начальная локальная сцена." /></svelte:head>

<main>
  <div class="viewport" bind:this={viewport}></div>
  <header>
    <a class="brand" href="./" aria-label="Мир знаний — главная"><span class="brand-mark" aria-hidden="true">◈</span> Мир знаний</a>
    <span class="mode">Локальный просмотр</span>
  </header>
  <section class="intro" aria-labelledby="scene-title">
    <p class="eyebrow">Место для открытий</p>
    <h1 id="scene-title">Большой мир<br />начинается здесь.</h1>
    <p class="description">Перед вами начальная сцена учебного мира.<br class="desktop" /> Исследования и встречи с персонажами — впереди.</p>
  </section>

  {#if error}
    <section class="notice" role="alert">
      <h2>{state.phase === 'unavailable' ? 'Режим пока недоступен' : 'Не удалось запустить просмотр'}</h2>
      <p>{error}</p>
      {#if game && state.phase === 'error'}
        <button onclick={() => game.restart(viewport)}>Попробовать снова</button>
      {:else if startupError}
        <button onclick={() => window.location.reload()}>Повторить</button>
      {/if}
    </section>
  {/if}

  <footer>
    <p class="status" role="status"><span class:active={state.phase === 'running'} class="dot"></span>
      {error ? 'Просмотр недоступен' : state.phase === 'running' ? 'Сцена открыта' : state.phase === 'stopped' ? 'Просмотр приостановлен' : 'Подготовка сцены…'}
    </p>
    {#if game && (state.phase === 'running' || state.phase === 'stopped')}
      <div class="actions">
        <button onclick={() => state.phase === 'running' ? game.stop() : game.start(viewport)}>
          {state.phase === 'running' ? 'Приостановить' : 'Продолжить'}
        </button>
        <button class="secondary" onclick={() => game.restart(viewport)}>Перезапустить сцену</button>
      </div>
    {/if}
  </footer>
</main>
