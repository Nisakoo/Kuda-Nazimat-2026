<script lang="ts">
  const { text, learn, enabled = true }: { text: string; learn: (word: string) => void; enabled?: boolean } = $props();
</script>
<span class="learning-text">{#each text.split(/(\s+)/) as part}{#if enabled && /[\p{L}\p{N}]/u.test(part)}<button type="button" class="word-link" aria-label={`Запомнить ${part}`} onclick={() => learn(part)}>{part}</button>{:else}{part}{/if}{/each}</span>
