<script lang="ts">
  import { tick } from 'svelte';
  import './entry.css';
  import './hub.css';
  import type { AppSnapshot, GameApp, BabylonView } from '../app/GameApp';
  import { serverAddress } from '../app/serverAddress';
  import type { Language, PartySize } from '../../../shared/babylon/types';
  import { modal } from './modal';
  import EntryChrome from './EntryChrome.svelte';
  const { game, view, snapshot }: { game: GameApp; view: BabylonView; snapshot: AppSnapshot } = $props();
  const gameState = $derived(view.state);
  const stage = $derived(snapshot.entryStage ?? 'profile');
  let dialog: HTMLDialogElement;
  $effect(() => { const current = stage; void tick().then(() => { if (!dialog?.open) return; dialog.querySelector<HTMLElement>(current === 'mode' ? 'input:checked' : current === 'connect' ? 'input' : '.hub-profile button')?.focus(); }); });
  const labels = { ru: 'Русский', en: 'English', es: 'Español' };
  let native = $state<Language>('ru'), learning = $state<Language>('en');
  let initialized = false;
  $effect(() => { if (gameState?.profile && !initialized) { native = gameState.profile.native; learning = gameState.profile.learning; initialized = true; } });
  const dirty = $derived(!gameState?.profile || native !== gameState.profile.native || learning !== gameState.profile.learning);
  const ready = $derived(!!gameState?.profile && !dirty && !snapshot.avatarRequired && !view.busy);
  const creationBlocked = $derived(Boolean(!gameState?.party && gameState?.availableParty));
  let replacement = $state<{ partyId: string; size: PartySize } | null>(null);
  function create() {
    if (!ready || creationBlocked || replacement) return;
    const selectedSize = mode === 'solo' ? 1 : size;
    if (gameState?.party) replacement = { partyId: gameState.party.id, size: selectedSize };
    else void game.createEntryGame(selectedSize);
  }
  function cancelReplacement() { if (!view.busy) replacement = null; }
  let size = $state<PartySize>(2);
  let mode = $state<'solo' | 'friends'>('solo');
  let ip = $state(''), port = $state('8080'), addressError = $state<string | null>(null);
  $effect(() => { const url = new URL(game.config.serverUrl); ip = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname.replace(/^\[|\]$/g, ''); port = url.port || (url.protocol === 'https:' ? '443' : '80'); });
  let connecting = $state(false);
  let connectionAttempt = 0;
  async function connect() {
    if (connecting) return;
    const attempt = ++connectionAttempt;
    connecting = true; addressError = null;
    try {
      const address = serverAddress(ip, port, new URL(game.config.serverUrl).protocol);
      const current = new URL(game.config.serverUrl);
      if (current.hostname === 'localhost') current.hostname = '127.0.0.1';
      const equivalent = current.origin === address;
      if (equivalent && !ready) throw new Error('Вернитесь в профиль: подтвердите персонажа и сохраните изменения языков.');
      await game.connectEntryGame(equivalent ? game.config.serverUrl : address);
    } catch (error) { if (attempt === connectionAttempt && stage === 'connect') addressError = (error as Error).message; }
    finally { if (attempt === connectionAttempt) connecting = false; }
  }
  function clearAddressAttempt() { connectionAttempt++; connecting = false; addressError = null; }
  function back() { if (replacement) { cancelReplacement(); return; } if (!view.busy && stage !== 'profile') { clearAddressAttempt(); game.setEntryStage('profile'); } }
  function settings() { clearAddressAttempt(); game.openSettings(); }
</script>
<div class="entry-backdrop">
  <dialog bind:this={dialog} use:modal class="entry-setup" aria-labelledby="hub-title" oncancel={event => { event.preventDefault(); back(); }} onkeydown={event => { if (stage === 'mode' && event.key === 'Enter' && !event.repeat && !event.isComposing && event.target instanceof HTMLInputElement && event.target.type === 'radio') { event.preventDefault(); create(); } }}>
    <EntryChrome openSettings={settings}/>
    <div class="entry-setup-body">
      {#if stage === 'mode'}
        <div class="entry-sign">
          <div class="entry-sign-heading"><p class="entry-eyebrow">Вавилон</p><h2 id="hub-title">Куда отправимся?</h2><div class="entry-divider" aria-hidden="true">△</div></div>
          <fieldset class="entry-choices" disabled={view.busy}>
            <legend>Выберите режим</legend>
            <label class="entry-choice" class:chosen={mode === 'solo'}><input type="radio" name="entry-mode" value="solo" bind:group={mode}/>{@render people(false)}{@render chosenLine()}<span><strong>Одному</strong><small>Город и его жители</small></span><span class="entry-choice-arrow" aria-hidden="true">→</span></label>
            <label class="entry-choice" class:chosen={mode === 'friends'}><input type="radio" name="entry-mode" value="friends" bind:group={mode}/>{@render people(true)}{@render chosenLine()}<span><strong>С друзьями</strong><small>Общее приключение</small></span><span class="entry-choice-arrow" aria-hidden="true">→</span></label>
          </fieldset>
          {#if mode === 'friends'}<label class="entry-size">Число игроков <select aria-label="Число игроков" bind:value={size} disabled={view.busy}><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option></select></label>{/if}
          {@render savedGame()}
          {@render errors()}
          <div class="entry-sign-actions"><button class="entry-back" disabled={view.busy} onclick={back}>← Назад</button><button class="entry-primary" disabled={!ready || creationBlocked} onclick={create}>Далее →</button></div>
        </div>
      {:else}
        <section class="hub-tablet">
          <p class="entry-eyebrow">Вавилон</p><h2 id="hub-title">{stage === 'connect' ? 'Подключиться к игре' : 'Личный кабинет'}</h2><div class="entry-divider" aria-hidden="true">△</div>
          {#if stage === 'connect'}
            <form class="entry-language-panel" onsubmit={event => { event.preventDefault(); void connect(); }}>
              <p>Укажите IP-адрес и порт, которые показаны на компьютере ведущего.</p>
              <label>IP-адрес <input aria-label="IP-адрес" bind:value={ip} required disabled={view.busy} placeholder="192.168.1.10" /></label>
              <label>Порт <input aria-label="Порт" bind:value={port} inputmode="numeric" required disabled={view.busy}/></label>
              {#if snapshot.avatarRequired || !gameState?.profile}<p>Для игры на этом сервере подтвердите персонажа и сохраните языки в профиле.</p>{/if}
              {#if addressError}<p role="alert" class="entry-error">{addressError}</p>{/if}
              {@render errors()}
              <div class="entry-sign-actions"><button type="button" class="entry-back" onclick={back}>← Назад</button><button class="entry-primary" disabled={view.busy || connecting}>{connecting ? 'Подключаемся…' : 'Подключиться'}</button></div>
            </form>
          {:else}
            <div class="hub-profile"><div><img class="hub-portrait" src={`/assets/ui/avatars/${snapshot.avatar?.state?.avatarId ?? 'lukas'}-portrait.png`} alt="Ваш персонаж"/><h3>{snapshot.authName || 'Игрок'}</h3><p>{snapshot.avatarRequired ? 'Выберите персонажа' : 'Персонаж готов к путешествию'}</p><button class="secondary" disabled={view.busy} onclick={() => game.openAvatar()}>Выбрать персонажа</button></div>
              <form class="entry-language-panel" onsubmit={event => { event.preventDefault(); void game.saveEntryLanguages(native, learning); }}>
                <label>Родной язык <select aria-label="Родной язык" bind:value={native} disabled={view.busy}>{#each gameState?.languages ?? [] as code}<option value={code}>{labels[code]}</option>{/each}</select></label>
                <label>Изучаемый язык <select aria-label="Изучаемый язык" bind:value={learning} disabled={view.busy}>{#each gameState?.languages ?? [] as code}<option value={code} disabled={code === native}>{labels[code]}</option>{/each}</select></label>
                {#if native === learning}<p class="entry-error">Выберите два разных языка.</p>{/if}
                <button class="secondary" disabled={view.busy || !dirty || native === learning || !gameState?.languages.includes(native) || !gameState?.languages.includes(learning)}>Сохранить профиль</button>
                {#if !dirty}<p class="hub-saved" role="status">Профиль сохранён</p>{/if}
              </form>
            </div>
            {@render savedGame()}
            {@render errors()}
            <div class="hub-actions"><button class="secondary" disabled={view.busy} onclick={() => game.logout()}>Выйти</button><button disabled={view.busy} onclick={() => game.setEntryStage('connect')}>Подключиться</button><button disabled={!ready} onclick={() => game.setEntryStage('mode')}>Создать игру</button></div>
          {/if}
        </section>
      {/if}
    </div>
  </dialog>
</div>

{#if replacement}
  <dialog use:modal class="panel replace-game" aria-labelledby="replace-game-title" oncancel={event => { event.preventDefault(); event.stopPropagation(); cancelReplacement(); }}>
    <h2 id="replace-game-title">Удалить текущую игру и создать новую?</h2>
    <p>Начнётся {replacement.size === 1 ? 'новая одиночная игра' : `новая игра с друзьями на ${replacement.size} игроков`}. Прогресс текущего приключения будет сброшен.</p>
    <p>Профиль, персонаж и личный словарь сохранятся. Если в старой игре есть другие участники, вы выйдете из группы, а их данные останутся.</p>
    {@render errors()}
    <div class="replace-game-actions">
      <button class="secondary" disabled={view.busy} onclick={cancelReplacement}>Отмена</button>
      <button disabled={!ready} onclick={() => { if (replacement) void game.createEntryGame(replacement.size, replacement.partyId); }}>{view.busy ? 'Создаём игру…' : 'Удалить и создать новую'}</button>
    </div>
  </dialog>
{/if}

<style>
  .replace-game { width: min(540px, calc(100vw - 32px)); max-height: calc(100svh - 32px); overflow: auto; padding: 24px; color: #073c48; background: #fbf1df; border: 1px solid #d6c6aa; border-radius: 12px; }
  .replace-game h2 { font-size: 24px; margin: 0 0 16px; }
  .replace-game p { line-height: 1.5; }
  .replace-game-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
  .replace-game-actions button { flex: 1 1 180px; }
  .replace-game::backdrop { background: #142f3499; }
</style>
{#snippet errors()}
  {#if !gameState}<p role="status">Загружаем профиль…</p>{/if}
  {#if view.busy}<p role="status">Ожидаем подтверждения сервера…</p>{/if}
  {#if view.error}<p role="alert" class="entry-error">{view.error}</p>{/if}
  {#if view.canRetry}<button type="button" class="secondary" disabled={view.busy} onclick={() => void game.retryEntryAction()}>Повторить запрос</button>{/if}
{/snippet}

{#snippet chosenLine()}
  <svg class="entry-choice-line" viewBox="0 0 600 110" preserveAspectRatio="none" aria-hidden="true"><path d="M18 2H551L597 55 551 108H18L2 92V18Z" fill="none" stroke="#087671" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>
{/snippet}
{#snippet people(group: boolean)}
  <svg class="entry-person" viewBox="0 0 76 76" fill="none" stroke="currentColor" stroke-width="4.5" aria-hidden="true">
    {#if group}<circle cx="25" cy="20" r="13"/><path d="M5 70V56a20 20 0 0 1 40 0v14M48 9a13 13 0 1 1 0 23M51 38a20 20 0 0 1 19 20v12"/>
    {:else}<circle cx="38" cy="19" r="14"/><path d="M13 71V59a25 25 0 0 1 50 0v12"/>{/if}
  </svg>
{/snippet}

{#snippet savedGame()}
  {#if gameState?.party}
    <section class="hub-saved-game" aria-label="Сохранённая игра">
      <h3>Ваша игра</h3>
      <p>{gameState.party.size === 1 ? 'Одиночная игра' : `Игра с друзьями · ${gameState.party.count} из ${gameState.party.size} игроков`}{gameState.party.completed ? ' · Задание завершено' : ''}. Прогресс сохранён.</p>
      {#if stage === 'mode'}<p>Можно продолжить игру или создать новую после подтверждения удаления текущего прогресса.</p>{/if}
      <button type="button" disabled={!ready} onclick={() => void game.connectEntryGame(game.config.serverUrl)}>Продолжить игру</button>
    </section>
  {:else if stage === 'mode' && gameState?.availableParty}
    <section class="hub-saved-game" aria-label="Доступная игра">
      <h3>На сервере уже ждёт группа</h3>
      <p>{gameState.availableParty.count} из {gameState.availableParty.size} игроков. Можно присоединиться к этой игре.</p>
      <button type="button" disabled={!ready} onclick={() => void game.connectEntryGame(game.config.serverUrl)}>Присоединиться к игре</button>
    </section>
  {/if}
{/snippet}
