<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { MapPlayer, MapPeer } from '../app/GameApp';
  import { MARKET_MAP_BUILDINGS, MARKET_MAP_PALMS } from '../shared/marketMap.generated';
  import { modal } from './modal';
  const { player, peers, goal, market, simulated, close, navigation }: { player: MapPlayer | null; peers: readonly MapPeer[]; goal: { x: number; z: number } | null; market: boolean; simulated: boolean; close: () => void; navigation: Snippet } = $props();
  let zoom = $state(1);
  function project(x: number, z: number) { return { x: (x-z)*.8660254, z: (x+z)*.5 }; }
  function facing(yaw: number) { return Math.atan2(.8660254*(Math.sin(yaw)-Math.cos(yaw)), -.5*(Math.sin(yaw)+Math.cos(yaw))) * 180 / Math.PI; }
  let center = $state({ x: 3.46, z: -12 });
  const bounds = $derived({ x: center.x - 62 / zoom, z: center.z - 37 / zoom, w: 124 / zoom, h: 74 / zoom });
  function centerPlayer() { if (player) center = project(player.x, player.z); }
</script>
<dialog use:modal class="map-dialog parchment" aria-labelledby="map-title" oncancel={(event) => { event.preventDefault(); close(); }}>
  <div class="panel-top"><div><h2 id="map-title">Карта Вавилона</h2><p>Рынок и окрестности</p></div><button class="icon-button" aria-label="Закрыть" onclick={close}>×</button></div>
  {#if market}
    <div class="map-frame">
      <svg class="world-map" viewBox={`${bounds.x} ${bounds.z} ${bounds.w} ${bounds.h}`} role="img" aria-label="Схема рынка и положение игрока">
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
        <rect x="-39" y="-13" width="14" height="8" fill="url(#map-roof)" stroke="#a88b63" stroke-width=".5" filter="url(#map-shadow)"/>
        <path d="M-40-13H-24M-40-11H-24M-40-9H-24M-40-7H-24" stroke="#bd9d6e" stroke-width=".5"/>
        <rect x="-10" y="-42" width="20" height="16" rx=".5" fill="#b1bb86" stroke="#94734f" stroke-width=".4" stroke-dasharray=".8 .35"/>
        <path d="M-2-26H2" stroke="#d7d6ab" stroke-width="1"/>
        {#each MARKET_MAP_BUILDINGS as b}
          <g filter="url(#map-shadow)">
            <rect x={b.x-b.width/2+.3} y={b.z-b.depth/2+.7} width={b.width} height={b.depth} fill="#b99a73"/>
            <rect x={b.x-b.width/2} y={b.z-b.depth/2} width={b.width} height={b.depth} fill="url(#map-roof)" stroke="#f7e6bf" stroke-width=".4"/>
            <rect x={b.x-b.width/2+.6} y={b.z-b.depth/2+.6} width={b.width-1.2} height={b.depth-1.2} fill="#d7ba90" stroke="#bf9d71" stroke-width=".15"/>
            <path d={`M${b.x-.4} ${b.z+b.depth/2}h.8`} stroke="#7a6149" stroke-width=".4"/>
          </g>
        {/each}
        {#each [{x:-4.8,z:2,color:'#c9974f'},{x:-4.8,z:-4.6,color:'#b67e59'},{x:4.9,z:1,color:'#609d94'}] as stall}
          <g filter="url(#map-shadow)"><rect x={stall.x-1.7} y={stall.z-1} width="3.4" height="2" rx=".1" fill={stall.color} stroke="#e8d4ac" stroke-width=".2"/><path d={`M${stall.x-.8} ${stall.z-1}v2m1 0v-2`} stroke="#efdbb5" stroke-width=".3"/></g>
        {/each}
        {#each MARKET_MAP_PALMS as tree}
          <g transform={`translate(${tree.x},${tree.z})`} filter="url(#map-shadow)"><circle r=".3" fill="#866343"/>{#each [0,60,120,180,240,300] as angle}<path transform={`rotate(${angle})`} d="M0 0Q-1.3-1.6 0-2.7Q.9-1.5 0 0" fill="#7d9161" stroke="#637d51" stroke-width=".08"/>{/each}</g>
        {/each}
        </g>
        <text x={project(0,-36).x} y={project(0,-36).z} class="map-label">Загон</text><text x={project(0,11).x} y={project(0,11).z} class="map-label">Рынок</text><text x={project(-32,3).x} y={project(-32,3).z} class="map-label">Двор башни</text>
        {#if goal}<g transform={`translate(${project(goal.x,goal.z).x},${project(goal.x,goal.z).z})`}><path d="M0-1.5 1.3 0 0 1.5-1.3 0Z" fill="#086e70" stroke="#fff4d5" stroke-width=".35"/><title>Текущее задание</title></g>{/if}
        {#each peers as peer (peer.id)}<g transform={`translate(${project(peer.x,peer.z).x},${project(peer.x,peer.z).z})`}><circle r=".9" fill="#bd6c50" stroke="#fff9e6" stroke-width=".3"/><text y="2.6" class="map-label">{peer.name}</text><title>Напарник: {peer.name}</title></g>{/each}
        {#if player}<g transform={`translate(${project(player.x,player.z).x},${project(player.x,player.z).z})`}><path d="M0-2.1-1-1.1H1Z" transform={`rotate(${facing(player.yaw)})`} fill="#086e70"/><circle r=".9" fill="#168c91" stroke="#fffaf0" stroke-width=".3"/><text y="3" class="map-label">Вы</text></g>{/if}
      </svg>
      <span class="map-north" aria-label="Север, вверх и вправо">С<br/>↗</span>
    </div>
    <p class="map-disclaimer">Схема реальных областей · {simulated ? 'Тестовые сетевые данные, не сервер' : player?.authoritative ? 'Позиции с сервера' : 'Локальная демонстрация'}. Показаны только участники вашего задания.</p>
  {:else}<p>Схема доступна для рыночной области. Для этой карты иллюстрация ещё не подготовлена.</p>{/if}
  <div class="map-controls"><p><span class="map-dot"></span> Вы <span class="map-dot partner"></span> Напарник <span class="map-diamond">◆</span> Задание</p><button class="secondary" disabled={!player || !market} onclick={centerPlayer}>⌖ К игроку</button><button class="secondary" aria-label="Уменьшить карту" disabled={zoom <= .5 || !market} onclick={() => zoom = Math.max(.5, zoom - .25)}>−</button><button class="secondary" aria-label="Увеличить карту" disabled={zoom >= 3 || !market} onclick={() => zoom = Math.min(3, zoom + .25)}>+</button></div>
  <p class="window-hint">Esc — закрыть</p>
  {@render navigation()}
</dialog>
