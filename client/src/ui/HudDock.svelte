<script lang="ts">
  import type { HudPanel } from '../app/GameApp';
  import Icon from './Icon.svelte';
  const { active, select }: { active: HudPanel | null; select: (panel: HudPanel) => void } = $props();
  const buttons = [{ id: 'inventory', label: 'Инвентарь' }, { id: 'map', label: 'Карта' }, { id: 'words', label: 'Словарь' }, { id: 'chat', label: 'Чат' }] as const;
</script>
<nav class="hud-dock parchment" aria-label="Игровые окна">
  {#each buttons as button}
    <button class:chosen={active === button.id} aria-pressed={active === button.id} onclick={() => select(button.id)}><Icon name={button.id}/><span>{button.label}</span></button>
  {/each}
</nav>
