<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { AvatarId } from '../../../shared/avatar/types';
  import { AVATAR_IDS } from '../../../shared/avatar/types';
  import type { GameApp, AvatarView, AvatarPreview } from '../app/GameApp';
  import { modal } from './modal';
  import EntryChrome from './EntryChrome.svelte';
  import './avatar-selection.css';
  const { game, view, first }: { game: GameApp; view: AvatarView | null; first: boolean } = $props();
  let host: HTMLDivElement;
  let dialog: HTMLDialogElement;
  let initialFocusDone = false;
  let interacted = false;
  let preview: AvatarPreview | undefined;
  let selected = $state<AvatarId>('lukas');
  let loading = $state(true), previewError = $state<string | null>(null);
  let portraits = $state<Partial<Record<AvatarId, string>>>({});
  let dragX: number | null = null;
  let angle = $state(0);
  function turn(radians: number) { angle = (angle + radians * 180 / Math.PI + 360) % 360; preview?.rotate(radians); }
  $effect(() => { const id = selected; if (preview) { loading = true; previewError = null; preview.select(id); } });
  $effect(() => {
    if (loading || previewError || initialFocusDone) return;
    void tick().then(() => {
      if (initialFocusDone || interacted || !dialog?.open || !dialog.contains(document.activeElement)) return;
      initialFocusDone = true;
      host.focus();
    });
  });
  function startPreview() {
    preview?.dispose(); preview = undefined;
    loading = true; previewError = null; portraits = {}; angle = 0;
    try {
      preview = game.createAvatarPreview(host, { loaded: () => { loading = false; }, portrait: (id, url) => { portraits = { ...portraits, [id]: url }; }, error: (error) => { loading = false; previewError = error; } });
      preview.select(selected);
    } catch { loading = false; previewError = '3D-превью недоступно. Проверьте WebGL и аппаратное ускорение.'; }
  }
  onMount(() => { startPreview(); return () => { preview?.dispose(); preview = undefined; }; });
  function rotate(event: KeyboardEvent) { if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') { event.preventDefault(); turn(event.code === 'ArrowLeft' ? -.2 : .2); } }
  function begin(event: PointerEvent) { if (event.button !== 0) return; dragX = event.clientX; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }
  function move(event: PointerEvent) { if (dragX === null) return; turn((event.clientX - dragX) * .012); dragX = event.clientX; }
  function confirm() { if (!view?.busy && view?.state && !loading && !previewError) void game.saveAvatar(selected); }
</script>
<div class="avatar-backdrop">
  <dialog bind:this={dialog} use:modal class="avatar-dialog" aria-labelledby="avatar-title" onpointerdowncapture={() => { interacted = true; }} onkeydown={event => { interacted = true; const target = event.target as HTMLElement; if (event.code === 'Enter' && !event.isComposing && !event.repeat && (target === host || (target instanceof HTMLInputElement && target.name === 'avatar-choice'))) { event.preventDefault(); confirm(); } }} oncancel={event => { event.preventDefault(); game.closeAvatar(); }}>
    <EntryChrome openSettings={() => game.openSettings()} />
    <div class="avatar-dialog-body"><div class="avatar-tablet">
    <div class="avatar-ornament" aria-hidden="true"><span>◆</span><i>▽▽▽</i><i>▽▽▽</i><span>◆</span></div>
    <h1 id="avatar-title">Выберите свой облик</h1>
    <p class="avatar-subtitle">Все персонажи обладают одинаковыми возможностями</p>
    <form onsubmit={event => { event.preventDefault(); confirm(); }}>
      <div class="avatar-layout">
        <div class="avatar-stage">
          <div class="avatar-preview" bind:this={host} role="slider" tabindex="0" aria-label="Вращение персонажа" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(angle)} onkeydown={rotate} onpointerdown={begin} onpointermove={move} onpointerup={() => dragX = null} onpointercancel={() => dragX = null} onlostpointercapture={() => dragX = null}></div>
          <button type="button" class="avatar-turn left" aria-label="Повернуть персонажа влево" onclick={() => turn(-.3)}>⤺</button>
          <button type="button" class="avatar-turn right" aria-label="Повернуть персонажа вправо" onclick={() => turn(.3)}>⤻</button>
          {#if loading}<p class="avatar-loading" role="status">Загружаем модели…</p>{/if}
          {#if previewError}<p class="capture-error avatar-loading" role="alert">{previewError}</p>{/if}
        </div>
        <div class="avatar-options"><fieldset><legend class="sr-only">Облик персонажа</legend>
          {#each AVATAR_IDS as id, i}<label class="avatar-card" class:selected={selected === id}><input type="radio" name="avatar-choice" value={id} bind:group={selected} aria-label={`Облик ${i + 1}`} disabled={view?.busy}/>{#if portraits[id]}<img src={portraits[id]} alt=""/>{:else}<span class="avatar-placeholder" aria-hidden="true">◇</span>{/if}{#if selected === id}<span class="avatar-check" aria-hidden="true">✓</span>{/if}</label>{/each}
        </fieldset><p>Внешность можно изменить в настройках</p></div>
      </div>
      {#if previewError}<button type="button" class="secondary" disabled={view?.busy} onclick={startPreview}>Повторить загрузку моделей</button>{/if}
      {#if view?.error}<p class="capture-error" role="alert">{view.error}</p><button type="button" class="secondary" disabled={view.busy} onclick={() => game.openAvatar()}>Повторить загрузку</button>{/if}
      {#if view?.busy}<p class="avatar-status" role="status">Ожидаем подтверждения сервера…</p>{/if}
      <div class="avatar-bottom"><button type="button" class="avatar-back" onclick={() => game.closeAvatar()}>← Назад</button><button class="avatar-confirm" disabled={!view?.state || view.busy || loading || !!previewError}>{first ? 'Продолжить →' : 'Подтвердить →'}</button></div>
    </form>
    </div></div>
  </dialog>
</div>
