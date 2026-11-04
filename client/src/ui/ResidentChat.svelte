<script lang="ts">
  import { tick, onDestroy } from 'svelte';
  import type { GameApp, BabylonView } from '../app/GameApp';
  import type { AvatarId } from '../../../shared/avatar/types';
  import ResidentWords from './ResidentWords.svelte';
  const { game, view, target, name, avatar }: { game: GameApp; view: BabylonView; target: string; name: string; avatar: AvatarId | null } = $props();
  let question = $state('');
  let pendingQuestion = $state('');
  let history: HTMLDivElement;

  let streamingReplyId = $state<string | null>(null);
  let revealedChars = $state<number>(0);
  let streamTimer: ReturnType<typeof setTimeout> | null = null;

  const replies = $derived(view.state?.replies.filter(reply => reply.npcId === target) ?? []);
  const lastReply = $derived(replies.at(-1));

  let initialized = false;
  const seenReplyIds = new Set<string>();

  function startTyping(id: string, fullText: string) {
    if (streamTimer) clearTimeout(streamTimer);
    streamingReplyId = id;
    revealedChars = 0;

    function step() {
      if (streamingReplyId !== id) return;
      revealedChars = Math.min(fullText.length, revealedChars + Math.max(2, Math.floor(fullText.length / 30)));
      if (history) history.scrollTop = history.scrollHeight;
      if (revealedChars < fullText.length) {
        streamTimer = setTimeout(step, 20);
      } else {
        streamingReplyId = null;
        streamTimer = null;
      }
    }
    step();
  }

  $effect(() => {
    if (!initialized) {
      for (const r of replies) { seenReplyIds.add(r.id); }
      initialized = true;
      return;
    }
    if (lastReply && !seenReplyIds.has(lastReply.id)) {
      seenReplyIds.add(lastReply.id);
      startTyping(lastReply.id, lastReply.text);
    }
  });

  onDestroy(() => {
    if (streamTimer) clearTimeout(streamTimer);
  });

  $effect(() => { if ((lastReply || pendingQuestion) && history) history.scrollTop = history.scrollHeight; });

  async function send() {
    if (view.busy || !question.trim()) return;
    pendingQuestion = question;
    const q = question;
    question = '';
    if (await game.babylonAction({ type: 'npc', targetId: target, text: q })) {
      // Sent successfully
    }
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
        <div class="resident-message">
          <small>{name}<span>{({ ru: 'Русский', en: 'English', es: 'Español' })[reply.language]}</span></small>
          <div class="resident-bubble">
            {#if streamingReplyId === reply.id}
              <ResidentWords text={reply.text.slice(0, revealedChars)} {game} {view} enabled={false}/>
              <span class="typing-cursor" aria-hidden="true">▍</span>
            {:else}
              <ResidentWords text={reply.text} {game} {view} enabled={reply.language === view.state?.profile?.learning}/>
            {/if}
          </div>
        </div>
      {/each}
      {#if pendingQuestion}
        <div class="resident-message outgoing"><small>Вы</small><p>{pendingQuestion}</p></div>
        <div class="resident-message">
          <small>{name}<span>{({ ru: 'Русский', en: 'English', es: 'Español' })[view.state?.profile?.learning ?? 'en']}</span></small>
          <div class="resident-bubble typing-bubble" role="status" aria-label="Житель отвечает…">
            <span class="typing-dots"><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span></span>
            <span class="typing-text">Житель отвечает…</span>
          </div>
        </div>
      {/if}
    </div>
    <form class="resident-compose" onsubmit={event => { event.preventDefault(); void send(); }}><label class="sr-only" for="resident-question">Вопрос NPC</label><textarea id="resident-question" aria-label="Вопрос NPC" placeholder="Спросить на родном языке…" bind:value={question} maxlength="500" required></textarea><button disabled={view.busy || !question.trim()}>Спросить</button></form>
  </div>
  <aside class="resident-portrait player-portrait"><img src={`/assets/ui/avatars/${avatar ?? 'lukas'}-portrait.png`} alt="Ваш персонаж" /><strong>Вы</strong></aside>
</div>
