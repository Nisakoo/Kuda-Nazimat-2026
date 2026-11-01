<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { MapPlayer, MapPeer } from '../app/GameApp';
  import { MARKET_MAP_BUILDINGS, MARKET_MAP_PALMS } from '../shared/marketMap.generated';
  import { modal } from './modal';
  import Icon from './Icon.svelte';
  const { player, peers, goal, market, simulated, close, navigation }: { player: MapPlayer | null; peers: readonly MapPeer[]; goal: { x: number; z: number } | null; market: boolean; simulated: boolean; close: () => void; navigation: Snippet } = $props();
  let zoom = $state(1);
  function project(x: number, z: number) { return { x: (x-z)*.8660254, z: (x+z)*.5 }; }
  function facing(yaw: number) { return Math.atan2(.8660254*(Math.sin(yaw)-Math.cos(yaw)), -.5*(Math.sin(yaw)+Math.cos(yaw))) * 180 / Math.PI; }
  // Bounds cover the authored courtyard, market and pen with padding.
  let center = $state({ x: -5.2, z: -8 });
  let mapAspect = $state(2);
  const bounds = $derived.by(() => {
    const height = 56 / zoom;
    const width = Math.max(112, 56 * mapAspect) / zoom;
    return { x: center.x - width / 2, z: center.z - height / 2, w: width, h: height };
  });
  function measureMap(node: SVGSVGElement) {
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.height > 0) mapAspect = entry.contentRect.width / entry.contentRect.height;
    });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }
  let mapFrame = $state<HTMLDivElement>();
  function centerPlayer() {
    if (player) {
      center = project(player.x, player.z);
      if (mapFrame) centerScroll(mapFrame);
    }
  }
  // The horizontal scroll starts at the same projected center as the viewBox.
  function centerScroll(node: HTMLElement) { node.scrollLeft = (node.scrollWidth - node.clientWidth) / 2; }
  function roofPoints(b: { x: number; z: number; width: number; depth: number; height: number }, elevation = 0) {
    return ([[-1,-1], [1,-1], [1,1], [-1,1]] as const).map(([x,z]) => {
      const p = project(b.x + x * b.width / 2, b.z + z * b.depth / 2);
      return `${p.x},${p.z - elevation}`;
    });
  }
</script>
<dialog use:modal class="map-dialog parchment" aria-labelledby="map-title" oncancel={(event) => { event.preventDefault(); close(); }}>
  <div class="panel-top"><div><h2 id="map-title">Карта Вавилона</h2><p>Рынок и окрестности</p></div><button class="icon-button" aria-label="Закрыть" onclick={close}>×</button></div>
  {#if market}
    <div class="map-viewport">
    <!-- svelte-ignore a11y_no_noninteractive_tabindex: keyboard users must be able to scroll the map. -->
    <div class="map-frame" bind:this={mapFrame} use:centerScroll tabindex="0" role="region" aria-label="Карта: прокрутите по горизонтали для просмотра">
      <svg class="world-map" use:measureMap viewBox={`${bounds.x} ${bounds.z} ${bounds.w} ${bounds.h}`} role="img" aria-label="Схема рынка и положение игрока">
        <defs>
          <pattern id="map-tiles" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="#e1caa1"/><path d="M0 0H2V2" fill="none" stroke="#cfb48d" stroke-width=".075"/></pattern>
          <pattern id="map-fields" width="5" height="4" patternUnits="userSpaceOnUse"><rect width="5" height="4" fill="#c5c59a"/><path d="m1 1 .4-.5m2 2 .4-.7" stroke="#9ca77b" stroke-width=".1"/></pattern>
          <linearGradient id="map-roof" x2=".9" y2="1"><stop stop-color="#fff0cd"/><stop offset="1" stop-color="#d8bb90"/></linearGradient>
          <filter id="map-shadow" x="-30%" y="-30%" width="170%" height="170%"><feDropShadow dx=".65" dy="1" stdDeviation=".5" flood-color="#796445" flood-opacity=".25"/></filter>
        </defs>
        <rect x="-1024" y="-1024" width="2048" height="2048" fill="url(#map-fields)"/>
        <g transform="matrix(.8660254 .5 -.8660254 .5 0 0)">
        <path d="M-16 16V-16H16V16ZM-2-16V-26H2V-16Z" fill="url(#map-tiles)"/>
        <rect x="-48" y="-16" width="32" height="32" fill="#d4bf96" stroke="#b69c72" stroke-width=".4"/>
        <path d="M-32 15V-11M-32 9H-16" stroke="#f0dbb3" stroke-width="3" fill="none"/>
        <rect x="-10" y="-42" width="20" height="16" rx=".5" fill="#b1bb86" stroke="#94734f" stroke-width=".4" stroke-dasharray=".8 .35"/>
        <path d="M-2-26H2" stroke="#d7d6ab" stroke-width="1"/>

        {#each [{x:-4.8,z:2,color:'#c9974f'},{x:-4.8,z:-4.6,color:'#b67e59'},{x:4.9,z:1,color:'#609d94'}] as stall}
          <g filter="url(#map-shadow)"><rect x={stall.x-1.7} y={stall.z-1} width="3.4" height="2" rx=".1" fill={stall.color} stroke="#e8d4ac" stroke-width=".2"/><path d={`M${stall.x-.8} ${stall.z-1}v2m1 0v-2`} stroke="#efdbb5" stroke-width=".3"/></g>
        {/each}
        </g>
        <!-- Footprints and heights are the same authored data used by the world generator. -->
        {#each MARKET_MAP_BUILDINGS as b}
          {@const base = roofPoints(b)}
          {@const roof = roofPoints(b, b.height * .65)}
          <g filter="url(#map-shadow)">
            <polygon points={`${roof[0]} ${roof[3]} ${base[3]} ${base[0]}`} fill="#c5a37a"/>
            <polygon points={`${roof[3]} ${roof[2]} ${base[2]} ${base[3]}`} fill="#ab8965"/>
            <polygon points={roof.join(' ')} fill="url(#map-roof)" stroke="#fff0d0" stroke-width=".35"/>
            <polygon points={roof.join(' ')} fill="none" stroke="#b89970" stroke-width=".16" stroke-dasharray="1.4 .15"/>
          </g>
        {/each}
        <!-- The five tier dimensions and center match main-building in generate-market-models.mjs. -->
        {#each [{width:14,depth:10,base:0,height:4.4},{width:10.8,depth:7.6,base:4.4,height:3},{width:7.9,depth:5.5,base:7.4,height:2.6},{width:5.3,depth:3.7,base:10,height:2.2},{width:2.8,depth:2.5,base:12.2,height:2.6}] as tier}
          {@const building = { ...tier, x: -32, z: -6 }}
          {@const base = roofPoints(building, tier.base * .65)}
          {@const roof = roofPoints(building, (tier.base + tier.height) * .65)}
          <g filter="url(#map-shadow)"><polygon points={`${roof[0]} ${roof[3]} ${base[3]} ${base[0]}`} fill="#c5a37a"/><polygon points={`${roof[3]} ${roof[2]} ${base[2]} ${base[3]}`} fill="#ab8965"/><polygon points={roof.join(' ')} fill="url(#map-roof)" stroke="#fff0d0" stroke-width=".28"/></g>
        {/each}
        <!-- Courtyard palms are authored at local (-9,10) and (6,-.2), in chunk (-1,0). -->
        {#each [...MARKET_MAP_PALMS, {x:-41,z:10}, {x:-26,z:-.2}] as tree}
          {@const p = project(tree.x, tree.z)}
          <g transform={`translate(${p.x},${p.z})`} filter="url(#map-shadow)">
            <path d="M-.32 0 .18-3.5 .55-3.5 .32 0Z" fill="#956e49" stroke="#765738" stroke-width=".12"/>
            <g transform="translate(.35,-3.5)">{#each [0,60,120,180,240,300] as angle}<path transform={`rotate(${angle})`} d="M0 0Q-1.3-1.6 0-2.7Q.9-1.5 0 0" fill={angle % 120 ? '#7d9161' : '#9aaa72'} stroke="#637d51" stroke-width=".08"/>{/each}<circle r=".26" fill="#79603f"/></g>
          </g>
        {/each}
        <!-- Presentation offsets keep labels clear of the usual task goal and spawn markers.
             They move only the text, not the underlying landmark or marker coordinates. -->
        <text x={project(0,-36).x - .87} y={project(0,-36).z - 4.5} class="map-label">Загон</text><text x={project(0,11).x - 9.8} y={project(0,11).z - 3.5} class="map-label">Рынок</text><text x={project(-32,3).x} y={project(-32,3).z} class="map-label">Двор башни</text>
        {#if goal}<g transform={`translate(${project(goal.x,goal.z).x},${project(goal.x,goal.z).z})`}><path d="M0-2 1.7 0 0 2-1.7 0Z" fill="#086e70" stroke="#fff4d5" stroke-width=".4"/><title>Текущее задание</title></g>{/if}
        {#each peers as peer (peer.id)}<g transform={`translate(${project(peer.x,peer.z).x},${project(peer.x,peer.z).z})`}><circle r="1.25" fill="#bd6c50" stroke="#fff9e6" stroke-width=".35"/><text y="3.6" class="map-label">{peer.name}</text><title>Напарник: {peer.name}</title></g>{/each}
        {#if player}<g transform={`translate(${project(player.x,player.z).x},${project(player.x,player.z).z})`}><path d="M0-2.8-1.2-1.3H1.2Z" transform={`rotate(${facing(player.yaw)})`} fill="#086e70"/><circle r="1.25" fill="#168c91" stroke="#fffaf0" stroke-width=".35"/><text y="3.6" class="map-label">Вы</text></g>{/if}
      </svg>
    </div>
      <span class="map-north" aria-label="Север, вверх и вправо">С<br/>↗</span>
    </div>
    <p class="map-disclaimer">Схема реальных областей · {simulated ? 'Тестовые сетевые данные, не сервер' : player?.authoritative ? 'Позиции с сервера' : 'Локальная демонстрация'}. Показаны только участники вашего задания.</p>
  {:else}<p>Схема доступна для рыночной области. Для этой карты иллюстрация ещё не подготовлена.</p>{/if}
  <div class="map-controls"><p><span class="map-dot"></span> Вы <span class="map-dot partner"></span> Напарник <span class="map-diamond">◆</span> Задание</p><button class="secondary" disabled={!player || !market} onclick={centerPlayer}><Icon name="center" size={20}/> К игроку</button><button class="secondary" aria-label="Уменьшить карту" disabled={zoom <= .5 || !market} onclick={() => zoom = Math.max(.5, zoom - .25)}>−</button><button class="secondary" aria-label="Увеличить карту" disabled={zoom >= 3 || !market} onclick={() => zoom = Math.min(3, zoom + .25)}>+</button></div>
  <p class="window-hint">Esc — закрыть</p>
  {@render navigation()}
</dialog>

<style>
  .map-viewport { position: relative; }
  .map-north { pointer-events: none; }
  .world-map :global(.map-label) { font-size: 2.7px; stroke-width: .8px; }
  /* Keep the authored map legible on narrow screens without changing world projection. */
  @media (max-width: 600px) {
    .map-frame { overflow-x: auto; overscroll-behavior-x: contain; }
    .map-viewport .map-frame .world-map { width: 600px; height: auto; aspect-ratio: 124 / 74; max-width: none; }
    .world-map :global(.map-label) { font-size: 3.2px; stroke-width: .9px; }
  }
  .map-controls button :global(svg) { vertical-align: middle; }
</style>
