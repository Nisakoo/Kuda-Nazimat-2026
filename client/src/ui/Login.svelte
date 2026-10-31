<script lang="ts">
  import { untrack } from 'svelte';
  const { pending, error, initialName, login }: { pending: boolean; error: string | null; initialName: string; login: (name: string) => Promise<void> } = $props();
  let name = $state(untrack(() => initialName));
</script>

<section class="welcome glass login-panel" aria-labelledby="login-title">
  <p class="eyebrow">Локальный сервер · Вавилон</p>
  <h1 id="login-title">Войти в мир</h1>
  <p class="description">Выберите имя. Чтобы продолжить с сохранённого места, войдите под тем же именем.</p>
  <form class="settings-form" aria-busy={pending} onsubmit={(event) => { event.preventDefault(); void login(name); }}>
    <label for="player-name">Имя игрока</label>
    <input id="player-name" name="playerName" bind:value={name} maxlength="32" required autocomplete="off" spellcheck="false" aria-describedby="login-note" disabled={pending} />
    {#if error}<p class="capture-error" role="alert">{error}</p>{/if}
    <button type="submit" disabled={pending || !name.trim()}>{pending ? 'Входим…' : 'Войти'}</button>
    {#if pending}<p class="small subtle" role="status">Связываемся с локальным сервером…</p>{/if}
  </form>
  <p id="login-note" class="small subtle">Демонстрационный вход без пароля: любой участник может использовать это имя. Для другого сервера откройте настройки.</p>
</section>
