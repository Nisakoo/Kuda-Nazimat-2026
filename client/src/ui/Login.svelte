<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { AuthAction, AuthMode } from '../app/GameApp';
  import './entry.css';
  const { pending, error, initialName, changeRequired, discoverMode, login }: {
    pending: boolean; error: string | null; initialName: string; changeRequired: boolean;
    discoverMode: (signal: AbortSignal) => Promise<AuthMode>;
    login: (name: string, action: AuthAction | 'guest', password: string, next: string) => Promise<void>;
  } = $props();
  let mode = $state<AuthMode | null>(null), modeError = $state(false), loading = $state(true);
  let controller: AbortController | null = null;
  let change = $state(false), newPassword = $state('');
  $effect(() => { if (changeRequired) change = true; });
  async function discover() {
    controller?.abort(); const current = new AbortController(); controller = current; mode = null; modeError = false; loading = true;
    const timer = setTimeout(() => current.abort(), 10000);
    try { const result = await discoverMode(current.signal); if (controller === current) mode = result; }
    catch { if (controller === current) modeError = true; }
    finally { clearTimeout(timer); if (controller === current) { controller = null; loading = false; } }
  }
  onMount(() => { void discover(); return () => { controller?.abort(); controller = null; }; });
  let name = $state('');
  let password = $state('');
  let showPassword = $state(false);
  let tab = $state<'login' | 'register'>('login');
  let loginTab: HTMLButtonElement;
  let registerTab: HTMLButtonElement;
  $effect(() => { name = initialName; });
  async function changeTab(next: 'login' | 'register', focus = false) {
    if (pending) return;
    tab = next; password = ''; newPassword = ''; change = false; showPassword = false;
    if (focus) { await tick(); (next === 'login' ? loginTab : registerTab)?.focus(); }
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending || !name.trim() || !password) return;
    const secret = password, next = newPassword;
    password = ''; newPassword = ''; showPassword = false;
    void login(name, change ? 'password' : tab, secret, next);
  }
</script>

<div class="entry-login-screen">
  <section class="entry-login" aria-labelledby="login-title">
    <div class="entry-ornament" aria-hidden="true">
      <span class="entry-gem"></span>
      <svg class="entry-seal" viewBox="0 0 44 50" fill="none"><path d="M23 17 6 36m17-19 4 22" stroke="#b98537" stroke-width="6" stroke-linecap="round"/><circle cx="24" cy="12" r="8" fill="#d6a14e" stroke="#b47c32" stroke-width="3"/><circle cx="24" cy="12" r="3" fill="#f3d295"/><circle cx="6" cy="37" r="4" fill="#c18a3b"/><circle cx="28" cy="41" r="4" fill="#c18a3b"/></svg>
      <span class="entry-gem"></span>
    </div>
    <p class="entry-eyebrow">Вавилон</p>
    <h1 id="login-title">{tab === 'login' ? 'Войти в город' : 'Создать героя'}</h1>
    <div class="entry-divider" aria-hidden="true">△</div>
    {#if loading}<p role="status">Получаем способы входа…</p>{/if}
    {#if modeError}<p class="entry-error" role="alert">Не удалось получить способы входа. Проверьте сервер и повторите.</p><button type="button" onclick={() => void discover()}>Повторить</button>{/if}
    <div class="entry-auth-tabs" role="tablist" tabindex="-1" aria-label="Способ входа" onkeydown={(event) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        void changeTab(event.key === 'Home' ? 'login' : event.key === 'End' ? 'register' : tab === 'login' ? 'register' : 'login', true);
      }
    }}>
      <button bind:this={loginTab} id="login-tab" type="button" role="tab" aria-selected={tab === 'login'} aria-controls="auth-form" tabindex={tab === 'login' ? 0 : -1} disabled={pending} onclick={() => void changeTab('login')}>Вход</button>
      <button bind:this={registerTab} id="register-tab" type="button" role="tab" aria-selected={tab === 'register'} aria-controls="auth-form" tabindex={tab === 'register' ? 0 : -1} disabled={pending} onclick={() => void changeTab('register')}>Регистрация</button>
    </div>
    <div id="auth-form" role="tabpanel" tabindex="-1" aria-labelledby={tab === 'login' ? 'login-tab' : 'register-tab'}>
    <form class="entry-form" aria-busy={pending} onsubmit={submit}>
      <label for="player-name">Имя игрока</label>
      <input id="player-name" name="playerName" bind:value={name} placeholder="Ваше имя" maxlength="32" required autocomplete="username" spellcheck="false" disabled={pending} />
      <label class="entry-password-label" for="player-password">{change ? 'Текущий или временный пароль' : 'Пароль'}</label>
      <div class="entry-password">
        <input id="player-password" name="password" type={showPassword ? 'text' : 'password'} bind:value={password} required autocomplete={tab === 'login' ? 'current-password' : 'new-password'} disabled={pending} />
        <button type="button" class="entry-eye" aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={showPassword} disabled={pending} onclick={() => showPassword = !showPassword}>
          <svg viewBox="0 0 32 28" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M2 14S8 4 16 4s14 10 14 10-6 10-14 10S2 14 2 14Z"/><circle cx="16" cy="14" r="4"/>{#if showPassword}<path d="m4 2 24 24"/>{/if}</svg>
        </button>
      </div>
      {#if change}<label for="new-password">Новый пароль</label><input id="new-password" type="password" bind:value={newPassword} autocomplete="new-password" required disabled={pending} />{/if}
      {#if error}<p class="entry-error" role="alert">{error}</p>{/if}
      <button class="entry-primary" type="submit" disabled={!mode || pending || !name.trim() || !password || (change && !newPassword)}>{pending ? 'Связываемся с сервером…' : change ? 'Сменить пароль' : tab === 'login' ? 'Начать путешествие →' : 'Зарегистрироваться →'}</button>
      {#if pending}<p role="status">Ожидаем ответа локального сервера…</p>{/if}
    </form>
    {#if mode}<button type="button" class="entry-demo-link" disabled={pending} onclick={() => { change = !change; password = ''; newPassword = ''; }}>{change ? 'Вернуться ко входу' : 'Сменить пароль'}</button>{/if}
    </div>
  </section>
</div>
{#if mode && (mode.guest || mode.dev)}<aside class="entry-demo entry-demo-footer" aria-label="Демонстрационный вход">
  {#if mode.guest}<button class="entry-demo-link" type="button" disabled={pending || !name.trim()} onclick={() => { password = ''; newPassword = ''; showPassword = false; void login(name, 'guest', '', ''); }}>Демонстрационный вход по имени</button>
  <p id="login-note" class="entry-note">Без пароля и регистрации. Любой участник может использовать это имя.</p>{/if}
  {#if mode.dev}<button class="entry-demo-link" type="button" disabled={pending} onclick={() => { password = ''; newPassword = ''; void login(name, 'dev', '', ''); }}>Вход разработчика</button>{/if}
</aside>{/if}
