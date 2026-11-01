<script lang="ts">
  import { tick } from 'svelte';
  import './entry.css';
  const { pending, error, initialName, login, loginPassword, register, configure }: {
    pending: boolean; error: string | null; initialName: string;
    login: (name: string) => Promise<void>;
    loginPassword: (name: string, password: string) => Promise<void>;
    register: (name: string, password: string) => Promise<void>;
    configure?: () => void;
  } = $props();
  let name = $state('');
  let password = $state('');
  let showPassword = $state(false);
  let tab = $state<'login' | 'register'>('login');
  let loginTab: HTMLButtonElement;
  let registerTab: HTMLButtonElement;
  $effect(() => { name = initialName; });
  async function changeTab(next: 'login' | 'register', focus = false) {
    if (pending) return;
    tab = next; password = ''; showPassword = false;
    if (focus) { await tick(); (next === 'login' ? loginTab : registerTab)?.focus(); }
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending || !name.trim() || !password) return;
    const secret = password;
    password = ''; showPassword = false;
    const action = tab === 'login' ? loginPassword : register;
    void action(name, secret);
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
      <label class="entry-password-label" for="player-password">Пароль</label>
      <div class="entry-password">
        <input id="player-password" name="password" type={showPassword ? 'text' : 'password'} bind:value={password} required autocomplete={tab === 'login' ? 'current-password' : 'new-password'} disabled={pending} />
        <button type="button" class="entry-eye" aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={showPassword} disabled={pending} onclick={() => showPassword = !showPassword}>
          <svg viewBox="0 0 32 28" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M2 14S8 4 16 4s14 10 14 10-6 10-14 10S2 14 2 14Z"/><circle cx="16" cy="14" r="4"/>{#if showPassword}<path d="m4 2 24 24"/>{/if}</svg>
        </button>
      </div>
      {#if error}<p class="entry-error" role="alert">{error}</p>{/if}
      <button class="entry-primary" type="submit" disabled={pending || !name.trim() || !password}>{pending ? 'Связываемся с сервером…' : tab === 'login' ? 'Начать путешествие →' : 'Зарегистрироваться →'}</button>
      {#if pending}<p role="status">Ожидаем ответа локального сервера…</p>{/if}
    </form>
    </div>
    {#if configure}<button class="entry-link" type="button" onclick={configure}>Настроить подключение</button>{/if}
  </section>
</div>
<aside class="entry-demo entry-demo-footer" aria-label="Демонстрационный вход">
  <button class="entry-demo-link" type="button" disabled={pending || !name.trim()} onclick={() => { password = ''; showPassword = false; void login(name); }}>Демонстрационный вход по имени</button>
  <p id="login-note" class="entry-note">Без пароля и регистрации. Любой участник может использовать это имя.</p>
</aside>
