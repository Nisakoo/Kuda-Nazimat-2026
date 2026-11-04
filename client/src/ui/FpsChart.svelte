<script lang="ts">
  import type { FrameRatePoint } from '../app/FrameMetrics';
  const { history }: { history: readonly FrameRatePoint[] } = $props();
  const latest = $derived(history.at(-1));
  const ceiling = $derived(Math.max(60, Math.ceil(Math.max(0, ...history.map(point => point.fps)) / 30) * 30));
  const x = (at: number) => 314 - ((latest?.at ?? at) - at) / 60000 * 286;
  const y = (fps: number) => 74 - fps / ceiling * 64;
  const points = $derived(history.map(point => `${x(point.at).toFixed(1)},${y(point.fps).toFixed(1)}`).join(' '));
  const area = $derived(history.length ? `M${x(history[0]!.at).toFixed(1)},74 L${points.replaceAll(' ', ' L')} L314,74 Z` : '');
</script>

<figure class="fps-chart">
  <figcaption><span>FPS <small>· последняя минута</small></span><strong>{latest ? latest.fps.toFixed(0) : '—'}</strong></figcaption>
  <svg viewBox="0 0 320 94" role="img" aria-label="График FPS за последние 60 секунд" data-samples={history.length} data-latest-fps={latest?.fps}>
    <title>{latest ? `Частота отправленных кадров: ${latest.fps.toFixed(1)} FPS. Шкала от 0 до ${ceiling} FPS.` : 'Собираем данные о частоте отправленных кадров.'}</title>
    {#each [0, 30, 60] as tick}
      <line x1="28" y1={y(tick)} x2="314" y2={y(tick)} class="grid"/>
      <text x="22" y={y(tick) + 3} text-anchor="end">{tick}</text>
    {/each}
    {#if ceiling > 60}<text x="22" y="13" text-anchor="end">{ceiling}</text>{/if}
    {#if history.length}
      <path d={area} class="area"/>
      <polyline {points}/>
      <circle cx="314" cy={y(latest!.fps)} r="2.5"/>
    {:else}<text x="171" y="45" text-anchor="middle">Собираем данные…</text>{/if}
    <text x="28" y="90">−60 с</text><text x="314" y="90" text-anchor="end">сейчас</text>
  </svg>
</figure>

<style>
  .fps-chart { width: min(320px, 100%); margin: 8px 0 0; padding-top: 7px; border-top: 1px solid #617b7c40; color: #324c4e; }
  figcaption { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  small { color: #617b7c; font-size: 10px; }
  strong { font-size: 15px; font-variant-numeric: tabular-nums; }
  svg { display: block; width: 100%; height: auto; overflow: visible; }
  text { fill: #526c6d; font-size: 9px; font-family: inherit; }
  .grid { stroke: #617b7c35; stroke-width: 1; stroke-dasharray: 3 3; }
  .area { fill: #078c8818; }
  polyline { fill: none; stroke: #078c88; stroke-width: 1.8; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
  circle { fill: #078c88; }
</style>
