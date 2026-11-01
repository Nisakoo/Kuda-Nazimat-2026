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
  const lockedSize = $derived(gameState?.profile ? gameState.party?.size : gameState?.availableParty?.size);
  $effect(() => { if (lockedSize) size = lockedSize; });
  let profileInitialized = false;
  $effect(() => { const profile = gameState?.profile; if (profile && !profileInitialized) { profileInitialized = true; native = profile.native; learning = profile.learning; } });
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
    dialog.querySelector<HTMLElement>('input:checked:not(:disabled), select:not(:disabled), button:not(:disabled)')?.focus();
  }
  function back() { if (view.busy) return; if (stage === 'languages') void changeStage('mode'); else game.logout(); }
</script>

<div class="entry-backdrop">
  <dialog bind:this={dialog} use:modal class="entry-setup" aria-labelledby="entry-setup-title" onkeydown={event => { if (stage === 'mode' && gameState && !view.busy && event.code === 'Enter' && !event.repeat && !event.isComposing && event.target instanceof HTMLInputElement && event.target.type === 'radio') { event.preventDefault(); void changeStage('languages'); } }} oncancel={(event) => { event.preventDefault(); back(); }}>
    <div class="entry-sign">
      <div class="entry-sign-heading">
        <div class="entry-heading-gems" aria-hidden="true"><span class="entry-gem"></span><span class="entry-gem"></span></div>
        <p class="entry-eyebrow">Вавилон</p>
        <h2 id="entry-setup-title">{stage === 'mode' ? 'Куда отправимся?' : 'Ваши языки'}</h2>
        <div class="entry-divider" aria-hidden="true">△</div>
      </div>
      {#if !gameState}
        <p class="entry-status" role="status">Загружаем данные с сервера…</p>
      {:else if stage === 'mode'}
        {#if gameState.profile}<p class="entry-status">Продолжение сохранённого задания. Режим и прогресс сохраняются.</p>{:else if gameState.availableParty}<p class="entry-status">Группа ждёт участников: {gameState.availableParty.count}/{gameState.availableParty.size}. Размер группы уже выбран.</p>{/if}
        <fieldset class="entry-choices" disabled={!!lockedSize || view.busy}>
          <legend>Выберите режим</legend>
          <label class:chosen={size === 1} class="entry-choice">
            <input type="radio" name="entry-mode" checked={size === 1} onchange={() => size = 1} />
            {@render chosenLine()}{@render people(false)}
            <span><strong>Одному</strong><small>Город и его жители</small></span><span class="entry-choice-arrow" aria-hidden="true">→</span>
          </label>
          <label class:chosen={size > 1} class="entry-choice">
            <input type="radio" name="entry-mode" checked={size > 1} onchange={() => size = 2} />
            {@render chosenLine()}{@render people(true)}
            <span><strong>С друзьями</strong><small>Общее приключение</small></span><span class="entry-choice-arrow" aria-hidden="true">→</span>
          </label>
        </fieldset>
        {#if size > 1}<label class="entry-size">Число игроков <select bind:value={size} disabled={!!lockedSize || view.busy}>{#each [2, 3, 4] as count}<option value={count}>{count}</option>{/each}</select></label>{/if}
        <button class="entry-primary" disabled={view.busy} onclick={() => void changeStage('languages')}>Далее: языки →</button>
      {:else}
        <div class="entry-language-panel">
          <p>Пишите на родном языке. Задания и ответы будут на изучаемом.</p>
          <label>Родной язык <select bind:value={native} disabled={view.busy}>{#each gameState.languages as code}<option value={code}>{labels[code]}</option>{/each}</select></label>
          <label>Изучаемый язык <select bind:value={learning} disabled={view.busy}>{#each gameState.languages as code}<option value={code} disabled={code === native}>{labels[code]}</option>{/each}</select></label>
          {#if native === learning}<p class="entry-error" role="alert">Выберите два разных языка.</p>{/if}
          {#if gameState.languages.length < 2}<p class="entry-error" role="alert">Сервер не предоставил достаточно языков.</p>{/if}
          <button class="entry-primary" disabled={view.busy || native === learning || gameState.languages.length < 2 || !gameState.languages.includes(native) || !gameState.languages.includes(learning)} onclick={() => void game.completeEntrySetup(size, native, learning)}>Войти в Вавилон →</button>
        </div>
      {/if}
      {#if view.busy}<p class="entry-status" role="status">Ожидаем подтверждения сервера…</p>{/if}
      {#if view.error}<p class="entry-error" role="alert">{view.error}</p>{/if}
      {#if view.canRetry}<button class="entry-back" disabled={view.busy} onclick={() => void game.completeEntrySetup(size, native, learning, true)}>Повторить запрос</button>{/if}
      <button class="entry-back" disabled={view.busy} onclick={back}>← Назад</button>
    </div>
  </dialog>
</div>

{#snippet chosenLine()}
  <svg class="entry-choice-line" viewBox="0 0 600 110" preserveAspectRatio="none" aria-hidden="true"><path d="M18 2H551L597 55 551 108H18L2 92V18Z" fill="none" stroke="#087671" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>
{/snippet}
{#snippet people(group: boolean)}
  <svg class="entry-person" viewBox="0 0 76 76" fill="none" stroke="currentColor" stroke-width="4.5" aria-hidden="true">
    {#if group}
      <circle cx="25" cy="20" r="13"/><path d="M5 70V56a20 20 0 0 1 40 0v14M48 9a13 13 0 1 1 0 23M51 38a20 20 0 0 1 19 20v12"/>
    {:else}
      <circle cx="38" cy="19" r="14"/><path d="M13 71V59a25 25 0 0 1 50 0v12"/>
    {/if}
  </svg>
{/snippet}
