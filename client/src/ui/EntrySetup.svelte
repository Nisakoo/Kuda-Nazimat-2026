<script lang="ts">
  import './entry.css';
  import { tick } from 'svelte';
  import type { GameApp, BabylonView } from '../app/GameApp';
  import type { Language, PartySize } from '../../../shared/babylon/types';
  import { modal } from './modal';

  const { game, view }: { game: GameApp; view: BabylonView } = $props();
  const gameState = $derived(view.state);
  const labels: Record<Language, string> = { ru: 'Русский', en: 'English', es: 'Español' };
  let stage = $state<'mode' | 'languages'>('mode');
  let dialog: HTMLDialogElement;
  let size = $state<PartySize>(1);
  let native = $state<Language>('ru');
  let learning = $state<Language>('en');
  $effect(() => { if (gameState?.availableParty) size = gameState.availableParty.size; });
  $effect(() => {
    const languages = gameState?.languages;
    const first = languages?.[0];
    if (!languages || first === undefined) return;
    if (!languages.includes(native)) native = first;
    if (!languages.includes(learning)) learning = languages.find(code => code !== native) ?? first;
  });
  async function changeStage(next: 'mode' | 'languages') {
    stage = next;
    await tick();
    if (stage !== next || !dialog?.open) return;
    dialog.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)')?.focus();
  }
  function back() { if (view.busy) return; if (stage === 'languages') void changeStage('mode'); else game.logout(); }
</script>

<div class="entry-backdrop">
  <dialog bind:this={dialog} use:modal class="entry-setup" aria-labelledby="entry-setup-title" oncancel={(event) => { event.preventDefault(); back(); }}>
    <div class="entry-sign">
      <div class="entry-sign-heading">
        <p class="entry-eyebrow">Вавилон</p>
        <h2 id="entry-setup-title">{stage === 'mode' ? 'Куда отправимся?' : 'Ваши языки'}</h2>
        <div class="entry-divider" aria-hidden="true">△</div>
      </div>
      {#if !gameState}
        <p class="entry-status" role="status">Загружаем данные с сервера…</p>
      {:else if stage === 'mode'}
        {#if gameState.availableParty}<p class="entry-status">Группа ждёт участников: {gameState.availableParty.count}/{gameState.availableParty.size}. Размер группы уже выбран.</p>{/if}
        <fieldset class="entry-choices" disabled={!!gameState.availableParty || view.busy}>
          <legend>Выберите режим</legend>
          <label class:chosen={size === 1} class="entry-choice"><input type="radio" name="entry-mode" checked={size === 1} onchange={() => size = 1} /><span aria-hidden="true" class="entry-person">♙</span><span><strong>Одному</strong><small>Город и его жители</small></span><span aria-hidden="true">→</span></label>
          <label class:chosen={size > 1} class="entry-choice"><input type="radio" name="entry-mode" checked={size > 1} onchange={() => size = 2} /><span aria-hidden="true" class="entry-person">♙♙</span><span><strong>С друзьями</strong><small>Общее приключение</small></span><span aria-hidden="true">→</span></label>
        </fieldset>
        {#if size > 1}<label class="entry-size">Число игроков <select bind:value={size} disabled={!!gameState.availableParty || view.busy}>{#each [2, 3, 4] as count}<option value={count}>{count}</option>{/each}</select></label>{/if}
        <button class="entry-primary" disabled={view.busy} onclick={() => void changeStage('languages')}>Далее: языки →</button>
      {:else}
        <div class="entry-language-panel">
          <p>Пишите на родном языке. Задания и ответы будут на изучаемом.</p>
          <label>Родной язык <select bind:value={native} disabled={view.busy}>{#each gameState.languages as code}<option value={code}>{labels[code]}</option>{/each}</select></label>
          <label>Изучаемый язык <select bind:value={learning} disabled={view.busy}>{#each gameState.languages as code}<option value={code} disabled={code === native}>{labels[code]}</option>{/each}</select></label>
          {#if native === learning}<p class="entry-error" role="alert">Выберите два разных языка.</p>{/if}
          {#if gameState.languages.length < 2}<p class="entry-error" role="alert">Сервер не предоставил достаточно языков.</p>{/if}
          <button class="entry-primary" disabled={view.busy || native === learning || gameState.languages.length < 2 || !gameState.languages.includes(native) || !gameState.languages.includes(learning)} onclick={() => void game.babylonAction({ type: 'enroll', size, native, learning })}>Войти в Вавилон →</button>
        </div>
      {/if}
      {#if view.busy}<p class="entry-status" role="status">Ожидаем подтверждения сервера…</p>{/if}
      {#if view.error}<p class="entry-error" role="alert">{view.error}</p>{/if}
      {#if view.canRetry}<button class="entry-back" disabled={view.busy} onclick={() => void game.retryBabylon()}>Повторить запрос</button>{/if}
      <button class="entry-back" disabled={view.busy} onclick={back}>← Назад</button>
    </div>
  </dialog>
</div>
