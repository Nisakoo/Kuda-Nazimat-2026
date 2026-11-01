<script lang="ts">
  import { tick } from 'svelte';
  import type { GameApp, BabylonView } from '../app/GameApp';
  import type { AvatarId } from '../../../shared/avatar/types';
  import ResidentWords from './ResidentWords.svelte';
  const { game, view, target, name, avatar }: { game: GameApp; view: BabylonView; target: string; name: string; avatar: AvatarId | null } = $props();
  let question = $state('');
  let pendingQuestion = $state('');
  let history: HTMLDivElement;
  const replies = $derived(view.state?.replies.filter(reply => reply.npcId === target) ?? []);
  const language = $derived(({ ru: 'Русский', en: 'English', es: 'Español' })[view.state?.profile?.learning ?? 'en']);
  const lastReply = $derived(replies.at(-1)?.id);
  $effect(() => { if (lastReply && history) history.scrollTop = history.scrollHeight; });
  async function send() {
    if (view.busy || !question.trim()) return;
    pendingQuestion = question;
    if (await game.babylonAction({ type: 'npc', targetId: target, text: question })) question = '';
    pendingQuestion = '';
    await tick();
    if (history) history.scrollTop = history.scrollHeight;
  }
</script>

<div class="resident-layout">
  <aside class="resident-portrait">
    <svg viewBox="0 0 100 110" role="img" aria-label={`Портрет: ${name}`}><rect width="100" height="110" rx="12" fill="#e8d8b9"/><path d="M13 110V85Q15 65 50 65Q85 65 87 85V110" fill="#287b73"/><path d="M33 64V48H67V64L50 80Z" fill="#be865a"/><ellipse cx="50" cy="39" rx="22" ry="27" fill="#d4a173"/><path d="M27 39V24Q50-2 73 24V39L64 23L36 23Z" fill="#594131"/><path d="M29 52Q50 73 71 52L66 72L50 82L34 72Z" fill="#594131"/><path d="M39 40h4m14 0h4" stroke="#49392b" stroke-width="3" stroke-linecap="round"/></svg>
    <strong>{name}</strong>
  </aside>
  <div class="resident-center">
    <div class="resident-history" bind:this={history} aria-label="Разговор с жителем" aria-live="polite">
      {#each replies as reply (reply.id)}
        <div class="resident-message outgoing"><small>Вы</small><p>{reply.question}</p></div>
        <div class="resident-message"><small>{name}<span>{({ ru: 'Русский', en: 'English', es: 'Español' })[reply.language]}</span></small><div class="resident-bubble"><ResidentWords text={reply.text} {game} {view} enabled={reply.language === view.state?.profile?.learning}/></div></div>
      {/each}
      {#if pendingQuestion}<div class="resident-message outgoing"><small>Вы</small><p>{pendingQuestion}</p></div><p role="status">Житель отвечает…</p>{:else if !replies.length}<p class="babel-muted">Начните разговор. Ответы появятся здесь на {language}.</p>{/if}
    </div>
    <form class="resident-compose" onsubmit={event => { event.preventDefault(); void send(); }}><label class="sr-only" for="resident-question">Вопрос NPC</label><textarea id="resident-question" aria-label="Вопрос NPC" placeholder="Спросить на родном языке…" bind:value={question} maxlength="500" required></textarea><button disabled={view.busy || !question.trim()}>Спросить</button></form>
  </div>
  <aside class="resident-portrait player-portrait"><img src={`/assets/ui/avatars/${avatar ?? 'lukas'}-portrait.png`} alt="Ваш персонаж" /><strong>Вы</strong></aside>
</div>
