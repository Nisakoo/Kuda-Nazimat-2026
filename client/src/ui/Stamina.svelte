<script lang="ts">
  let { value, blocked }: { value: number; blocked: boolean } = $props();
  const percent = $derived(Math.max(0, Math.min(100, Math.round(value))));
</script>

<div class="stamina parchment" class:low={percent <= 20} class:blocked class:empty={percent === 0}>
  <span class="stamina-label" id="stamina-label">Выносливость</span>
  <div class="stamina-ring" role="progressbar" aria-labelledby="stamina-label" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}>
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
      <circle class="stamina-track" cx="28" cy="28" r="25" />
      <circle class="stamina-arc" cx="28" cy="28" r="25" pathLength="100" stroke-dasharray="100 100" stroke-dashoffset={100 - percent} transform="rotate(-90 28 28)" />
    </svg>
    <span class="stamina-number" aria-hidden="true">{percent}%</span>
  </div>
  {#if blocked}<span class="stamina-recovery">↻ Восстановление</span>{/if}
</div>
