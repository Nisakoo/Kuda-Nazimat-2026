<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { MapPlayer } from '../app/GameApp';
  import { modal } from './modal';
  const { player, market, close, navigation }: { player: MapPlayer | null; market: boolean; close: () => void; navigation: Snippet } = $props();
  let zoom = $state(1);
  let center = $state({ x: 0, z: -16 });
  const bounds = $derived({ x: center.x - 28 / zoom, z: center.z - 31 / zoom, w: 56 / zoom, h: 62 / zoom });
  function centerPlayer() { if (player) center = { x: player.x, z: player.z }; }
</script>
<dialog use:modal class="map-dialog parchment" aria-labelledby="map-title" oncancel={(event) => { event.preventDefault(); close(); }}>
  <div class="panel-top"><div><h2 id="map-title">Карта Вавилона</h2><p>Рынок и окрестности</p></div><button class="icon-button" aria-label="Закрыть" onclick={close}>×</button></div>
  {#if market}
    <div class="map-frame">
      <svg class="world-map" viewBox={`${bounds.x} ${bounds.z} ${bounds.w} ${bounds.h}`} role="img" aria-label="Схема рынка и положение игрока">
        <defs><pattern id="map-tiles" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#eddbb8"/><path d="M0 0H4V4" fill="none" stroke="#dfc89e" stroke-width=".12"/></pattern></defs>
        <rect x="-1024" y="-1024" width="2048" height="2048" fill="#d6d7af"/>
        <path d="M-8 18V-24H8V18ZM-20-4H20V8H-20Z" fill="url(#map-tiles)"/>
        <rect x="-10" y="-41" width="20" height="14" rx="1" fill="#b6c38e" stroke="#98734e" stroke-width=".5" stroke-dasharray="1 .4"/>
        {#each [-20, 12] as x}{#each [-22, -12, 2] as z}<path d={`M${x} ${z}h8v8h-8Z`} fill="#b9996c"/><rect {x} y={z-1} width="8" height="7" fill="#f5e5c1" stroke="#ccb28b" stroke-width=".3"/>{/each}{/each}
        {#each [[-7, 0], [-6, -6], [4, -1]] as [x,z], i}<rect {x} y={z} width="3" height="2" fill={i===1?'#d88a4d':'#3b9997'} stroke="#8d6b47" stroke-width=".2"/>{/each}
        <text x="0" y="-34" class="map-label">Загон</text><text x="0" y="5" class="map-label">Рынок</text>
        {#if player}
          <g transform={`translate(${player.x},${player.z})`}><path d="M0-2.1-1-1.1H1Z" transform={`rotate(${player.yaw * 180 / Math.PI + 180})`} fill="#086e70"/><circle r=".9" fill="#168c91" stroke="#fffaf0" stroke-width=".3"/><text y="3" class="map-label">Вы</text></g>
        {/if}
      </svg>
      <span class="map-north" aria-label="Север">С<br/>▲</span>
    </div>
    <p class="map-disclaimer">Схема текущего рынка · {player?.authoritative ? 'Позиция с сервера' : 'Локальная демонстрация'}. Метки напарников и цели недоступны в текущем контракте.</p>
  {:else}<p>Схема доступна для рыночной области. Для этой карты иллюстрация ещё не подготовлена.</p>{/if}
  <div class="map-controls"><p><span class="map-dot"></span> Вы <span class="map-dot partner"></span> Напарник <span class="map-diamond">◆</span> Задание</p><button class="secondary" disabled={!player || !market} onclick={centerPlayer}>⌖ К игроку</button><button class="secondary" aria-label="Уменьшить карту" disabled={zoom <= .5 || !market} onclick={() => zoom = Math.max(.5, zoom - .25)}>−</button><button class="secondary" aria-label="Увеличить карту" disabled={zoom >= 3 || !market} onclick={() => zoom = Math.min(3, zoom + .25)}>+</button></div>
  <p class="window-hint">Esc — закрыть</p>
  {@render navigation()}
</dialog>
