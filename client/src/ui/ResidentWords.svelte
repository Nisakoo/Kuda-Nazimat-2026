<script lang="ts">
  import { tick } from 'svelte';
  import type { GameApp, BabylonView } from '../app/GameApp';
  const { text, game, view, enabled = true }: { text: string; game: GameApp; view: BabylonView; enabled?: boolean } = $props();
  const normalize = (word: string) => word.normalize('NFC').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLocaleLowerCase();
  const parts = $derived(text.split(/([\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*)/u));
  const words = $derived(view.state?.words ?? []);
  let selected = $state<number | null>(null);
  let translation = $state('');
  let loading = $state(false);
  let failed = $state(false);
  let root: HTMLSpanElement;
  let opener: HTMLButtonElement | null = null;
  let revision = 0;
  const known = (part: string) => words.find(word => normalize(word.word) === normalize(part));
  const hasKnown = $derived(parts.some(part => !!known(part)));
  function close(restore = false) { revision++; selected = null; loading = false; if (restore) opener?.focus(); }
  async function select(index: number, event: MouseEvent) {
    if (view.busy) return;
    opener = event.currentTarget as HTMLButtonElement;
    selected = index; translation = known(parts[index]!)?.translation ?? ''; failed = false;
    const current = ++revision;
    if (known(parts[index]!)) return;
    loading = true;
    const ok = await game.babylonAction({ type: 'suggest', word: parts[index]! });
    await tick();
    if (revision !== current) return;
    loading = false; failed = !ok;
    if (ok && !translation.trim()) translation = view.suggestion ?? '';
  }
  async function save() {
    const word = parts[selected!];
    if (!word || !translation.trim() || view.busy) return;
    await game.babylonAction({ type: 'word-save', word, translation, note: '' });
  }
</script>

<svelte:document onpointerdown={event => { if (selected !== null && !root?.contains(event.target as Node)) close(); }} onkeydown={event => { if (selected !== null && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); } }}/>
<span class="resident-words" bind:this={root}>{#each parts as part, index}{#if enabled && /^[\p{L}\p{N}]/u.test(part)}<span class="resident-word-wrap"><button type="button" class="resident-word" class:known={!!known(part)} class:selected={selected === index} aria-label={`Слово: ${part}`} aria-expanded={selected === index} onclick={event => void select(index, event)}>{part}</button>{#if selected === index}<span class="resident-word-card" role="dialog" aria-label={`Слово: ${part}`}><strong>{part}</strong>{#if known(part)}<span>{known(part)?.translation}</span><span class="babel-muted">В словаре</span><button type="button" onclick={() => game.learnWord(part)}>Открыть в словаре</button>{:else}<label>Предложенный перевод<input aria-label="Перевод слова" bind:value={translation} maxlength="200" /></label>{#if loading}<span role="status">Ищем перевод…</span>{/if}{#if failed}<span role="status">Введите перевод вручную или повторите запрос.</span>{/if}<button type="button" disabled={view.busy || !translation.trim()} onclick={() => void save()}>Добавить в словарь</button>{/if}</span>{/if}</span>{:else}{part}{/if}{/each}</span>
{#if enabled && hasKnown}<small class="resident-word-help">Подчёркнутые слова уже в словаре</small>{/if}
