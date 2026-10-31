<script lang="ts">
  import { onMount } from 'svelte';
  import { modal } from './modal';
  const { messages, error, canSend, send, close }: { messages: readonly { readonly id: string; readonly name: string; readonly text: string }[]; error: string | null; canSend: boolean; send: (text: string) => boolean; close: () => void } = $props();
  let text = $state('');
  let input: HTMLInputElement;
  let history: HTMLDivElement;
  onMount(() => input.focus());
  $effect(() => { if (messages.length && history) history.scrollTop = history.scrollHeight; });
</script>

<dialog use:modal class="dialog-panel" aria-labelledby="chat-title" oncancel={(event) => { event.preventDefault(); close(); }}>
  <div class="panel-top"><div><p class="eyebrow">Игроки на карте</p><h2 id="chat-title">Общение</h2></div><button class="icon-button" onclick={close} aria-label="Закрыть общение">✕</button></div>
  <p class="small subtle">Сообщения видны всем подключённым игрокам на текущей карте.</p>
  <div class="messages" aria-live="polite" bind:this={history}>{#each messages as message (message.id)}<p class="message"><span>{message.name}</span>{message.text}</p>{/each}</div>
  {#if error}<p class="capture-error" role="alert">{error}</p>{/if}
  <form onsubmit={(event) => { event.preventDefault(); if (send(text)) text = ''; input.focus(); }}>
    <label class="sr-only" for="chat-input">Сообщение игрокам</label>
    <div class="input-row"><input id="chat-input" bind:this={input} bind:value={text} maxlength="500" autocomplete="off" placeholder="Напишите сообщение…" /><button type="submit" disabled={!canSend || !text.trim()}>Отправить</button></div>
  </form>
  <p class="small subtle">Esc — закрыть. Движение продолжится после нажатия «Продолжить».</p>
</dialog>
