<script lang="ts">
  import { onMount, untrack } from 'svelte';
  type Drawing = readonly (readonly (readonly [number, number])[])[];
  const { strokes, label, drawing = false, carved = null, onbegin, onmove, onend }: {
    strokes: Drawing; label: string; drawing?: boolean; carved?: Drawing | null;
    onbegin?: (event: PointerEvent) => void; onmove?: (event: PointerEvent) => void; onend?: () => void;
  } = $props();
  const id = $props.id();
  let reducedMotion = $state(true);
  let finishing = $state(false);
  let chips = $state<{ id: number; x: number; y: number; dx: number; dy: number; size: number }[]>([]);
  let sequence = 0, lastEmission = -Infinity;
  let previousCarved: Drawing | null = untrack(() => carved);
  const visibleStrokes = $derived(finishing && carved ? carved : strokes);
  const tip = $derived(strokes.at(-1)?.at(-1));
  onMount(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { reducedMotion = preference.matches; if (reducedMotion) { chips = []; finishing = false; } };
    update(); preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  });
  function emit(x: number, y: number) {
    if (reducedMotion || performance.now() - lastEmission < 45) return;
    lastEmission = performance.now();
    const fresh = Array.from({ length: 3 }, (_, index) => {
      const serial = ++sequence;
      return { id: serial, x, y, dx: ((serial * 17) % 37) - 18, dy: -8 - ((serial * 13) % 23), size: 1.2 + index * .7 };
    });
    chips = [...chips.slice(-21), ...fresh];
  }
  $effect(() => {
    const current = tip;
    if (drawing && current) untrack(() => emit(current[0], current[1]));
  });
  $effect(() => {
    const accepted = carved;
    if (accepted && accepted !== previousCarved) {
      previousCarved = accepted;
      untrack(() => { finishing = !reducedMotion; });
    }
  });
  function begin(event: PointerEvent) { finishing = false; onbegin?.(event); }
  function points(stroke: readonly (readonly [number, number])[]) {
    const first = stroke[0];
    // A single chisel contact leaves a visible pit, without changing stored points.
    return stroke.length === 1 && first ? `${first[0]},${first[1]} ${first[0] + .01},${first[1]}` : stroke.map(point => point.join(',')).join(' ');
  }
</script>

<svg class="stone-surface" class:stone-canvas={!!onbegin} class:finishing viewBox="0 0 320 320" role="img" aria-label={label}
  onpointerdown={onbegin ? begin : undefined} onpointermove={onmove} onpointerup={onend} onpointercancel={onend} onlostpointercapture={onend}>
  <image class="stone-texture" href="/assets/ui/carving-stone.svg" width="320" height="320" aria-hidden="true"/>
  <defs>
    <clipPath id={`${id}-outline`}><path d="M17 3 91 0 163 4 238 1 305 9 318 29 315 112 320 184 315 295 299 316 223 320 151 316 67 320 12 308 1 281 5 199 0 120 4 24Z"/></clipPath>
    {#each visibleStrokes as stroke, index}<polyline id={`${id}-stroke-${index}`} points={points(stroke)} />{/each}
  </defs>
  <g class="engraving" clip-path={`url(#${id}-outline)`} aria-hidden="true">
    {#each visibleStrokes as _, index}
      <use href={`#${id}-stroke-${index}`} class="groove-light" transform="translate(1 1.2)"/>
      <use href={`#${id}-stroke-${index}`} class="groove-shadow"/>
      <use href={`#${id}-stroke-${index}`} class="groove-floor" transform="translate(.35 .4)"/>
    {/each}
  </g>
  <g class="stone-chips" aria-hidden="true">
    {#each chips as chip (chip.id)}
      <g transform={`translate(${chip.x} ${chip.y})`}><path class="stone-chip" d={`m0 ${-chip.size} ${chip.size} ${chip.size * .7} ${-chip.size * .3} ${chip.size} ${-chip.size * 1.4} ${-chip.size * .2}Z`}
        style:--dx={`${chip.dx}px`} style:--dy={`${chip.dy}px`} onanimationend={() => { chips = chips.filter(item => item.id !== chip.id); }}/></g>
    {/each}
  </g>
  {#if finishing}<rect class="stone-flash" x="10" y="10" width="300" height="300" rx="12" aria-hidden="true" onanimationend={() => finishing = false}/>{/if}
</svg>

<style>
  .stone-surface { display: block; width: 100%; aspect-ratio: 1; overflow: hidden; border: 0; border-radius: 0; background: transparent; filter: drop-shadow(0 3px 2px #4d392f38); }
  .stone-canvas { width: min(100%, 360px); max-height: none; margin: 18px auto; touch-action: none; cursor: crosshair; }
  .stone-texture, .engraving, .stone-chips, .stone-flash { pointer-events: none; }
  .engraving { fill: none; stroke-linecap: round; stroke-linejoin: bevel; }
  .groove-light { stroke: #f4dfb2; stroke-width: 5.6; stroke-opacity: .8; }
  .groove-shadow { stroke: #57442e; stroke-width: 4; }
  .groove-floor { stroke: #9c8058; stroke-width: 1.4; stroke-opacity: .8; }
  .stone-chip { fill: #e9d4ad; stroke: #8b7452; stroke-width: .35; transform-box: fill-box; transform-origin: center; animation: stone-chip .45s ease-out forwards; }
  .stone-flash { fill: #fff0ce; animation: stone-flash .65s ease-out forwards; }
  @keyframes stone-chip { from { opacity: .9; transform: translate(0, 0) rotate(0); } to { opacity: 0; transform: translate(var(--dx), var(--dy)) rotate(110deg); } }
  @keyframes stone-flash { from { opacity: .32; } to { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .stone-chip, .stone-flash { display: none; animation: none; } }
</style>
