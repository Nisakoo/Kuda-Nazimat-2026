<script lang="ts">
  import { onMount } from 'svelte';
  import type { DemoDialog } from '../session/demoDialogue';
  import { modal } from './modal';
  const { dialog, send, close, pending = false, error = null }: { dialog: DemoDialog; send: (text: string) => void; close: () => void; pending?: boolean; error?: string | null } = $props();
  let text = $state('');
  let input: HTMLInputElement;
  let history: HTMLDivElement;
  onMount(() => { input.focus(); });
  $effect(() => { if (dialog.messages.length && history) history.scrollTop = history.scrollHeight; });
  function submit() { send(text); text = ''; input.focus(); }
</script>

<dialog use:modal class="dialog-panel" aria-labelledby="dialog-title" oncancel={(event) => { event.preventDefault(); close(); }}>
  <div class="panel-top"><div><p class="eyebrow">{dialog.topic} · {dialog.source === 'server' ? 'Ответы сервера' : dialog.source === 'mock' ? 'Тестовый обмен' : 'Демонстрационный диалог'}</p><h2 id="dialog-title">{dialog.name}</h2></div><button class="icon-button" onclick={close} aria-label="Закрыть диалог">✕</button></div>
  <p class="subtle small">{dialog.source === 'server' ? 'Ответы приходят от локального сервера.' : dialog.source === 'mock' ? 'Тестовый транспорт имитирует ответы. Это не адаптивный ИИ.' : 'Ответы заранее подготовлены для локального демо.'}</p>
  <div class="messages" bind:this={history} aria-live="polite">
    {#each dialog.messages as message, index (index)}
      <p class:player-message={message.author === 'player'} class="message"><span>{message.author === 'player' ? 'Вы' : dialog.name}</span>{message.text}</p>
    {/each}
  </div>
  {#if pending}<p class="small subtle">Ожидаем ответ…</p>{/if}
  {#if error}<p class="capture-error" role="alert">{error}</p>{/if}
  <div class="questions">{#each dialog.questions as question}<button class="question" onclick={() => send(question)}>{question}</button>{/each}</div>
  <form onsubmit={(event) => { event.preventDefault(); submit(); }}>
    <label class="sr-only" for="question-input">Ваш вопрос</label>
    <div class="input-row"><input id="question-input" bind:this={input} bind:value={text} maxlength="240" placeholder="Напишите вопрос…" autocomplete="off" /><button type="submit" disabled={pending || !text.trim()}>Отправить</button></div>
  </form>
  <p class="small subtle">Esc — закрыть диалог. Затем нажмите «Продолжить», чтобы захватить мышь.</p>
</dialog>
