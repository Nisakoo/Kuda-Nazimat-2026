<script lang="ts">
  import './entry.css';
  const { pending, error, initialName, login, configure }: { pending: boolean; error: string | null; initialName: string; login: (name: string) => Promise<void>; configure?: () => void } = $props();
  let name = $state('');
  $effect(() => { name = initialName; });
</script>

<section class="entry-login" aria-labelledby="login-title">
  <div class="entry-ornament" aria-hidden="true"><span>◆</span><span>▲</span><span>◆</span></div>
  <p class="entry-eyebrow">Вавилон</p>
  <h1 id="login-title">Войти в город</h1>
  <div class="entry-divider" aria-hidden="true">△</div>
  <p>Введите имя, чтобы начать путешествие или вернуться к сохранённому месту.</p>
  <form class="entry-form" aria-busy={pending} onsubmit={(event) => { event.preventDefault(); if (!pending && name.trim()) void login(name); }}>
    <label for="player-name">Имя игрока</label>
    <input id="player-name" name="playerName" bind:value={name} maxlength="32" required autocomplete="off" spellcheck="false" aria-describedby="login-note" disabled={pending} />
    {#if error}<p class="entry-error" role="alert">{error}</p>{/if}
    <button class="entry-primary" type="submit" disabled={pending || !name.trim()}>{pending ? 'Входим…' : 'Начать путешествие →'}</button>
    {#if pending}<p role="status">Связываемся с локальным сервером…</p>{/if}
  </form>
  <p id="login-note" class="entry-note">Вход без пароля: любой участник может использовать это имя.</p>
  {#if configure}<button class="entry-link" type="button" onclick={configure}>Настроить подключение</button>{/if}
</section>
