<script lang="ts">
  const { name, size = 28 }: { name: 'inventory' | 'map' | 'words' | 'chat' | 'settings' | 'globe' | 'logo' | 'plus' | 'pencil' | 'trash' | 'center'; size?: number } = $props();
</script>
<svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'inventory'}<path d="M10 9V5h12v4M9 10h14l3 17H6l3-17ZM12 5V3h8v2" />
  {:else if name === 'map'}<path d="m3 7 8-3 10 4 8-3v22l-8 3-10-4-8 3V7Zm8-3v22m10-18v22" /><path d="M18 11c0-5 7-5 7 0 0 2-3.5 6-3.5 6S18 13 18 11Z" />
  {:else if name === 'words'}<path d="M16 7C12 3 7 3 2 5v23c5-2 10-2 14 1 4-3 9-3 14-1V5c-5-2-10-2-14 2Zm0 0v22" />
  {:else if name === 'chat'}<path d="M7 25 3 30l1-10A13 13 0 1 1 7 25Z" /><path d="M9 15h1m5 0h1m5 0h1" />
  {:else if name === 'globe'}<circle cx="16" cy="16" r="13"/><ellipse cx="16" cy="16" rx="6" ry="13"/><path d="M3 16h26M6 8c6 4 14 4 20 0M6 24c6-4 14-4 20 0"/>
  {:else if name === 'plus'}<path d="M16 6v20M6 16h20" />
  {:else if name === 'pencil'}<path d="m6 22-1 5 5-1L26 10l-4-4L6 22Zm13-13 4 4M5 27l5-1" />
  {:else if name === 'trash'}<path d="M6 9h20M12 9V6h8v3m-12 0 1 18h14l1-18M13 13v10m6-10v10" />
  {:else if name === 'center'}<circle cx="16" cy="16" r="9"/><circle cx="16" cy="16" r="3"/><path d="M16 2v6m0 16v6M2 16h6m16 0h6" />
  {:else if name === 'settings'}<path d="M26.08 13.07 28.81 13.76 28.81 18.24 26.08 18.93 25.20 21.06 26.64 23.48 23.48 26.64 21.06 25.20 18.93 26.08 18.24 28.81 13.76 28.81 13.07 26.08 10.94 25.20 8.52 26.64 5.36 23.48 6.80 21.06 5.92 18.93 3.19 18.24 3.19 13.76 5.92 13.07 6.80 10.94 5.36 8.52 8.52 5.36 10.94 6.80 13.07 5.92 13.76 3.19 18.24 3.19 18.93 5.92 21.06 6.80 23.48 5.36 26.64 8.52 25.20 10.94Z"/><circle cx="16" cy="16" r="5"/>
  {:else}<path d="M11 5h10M6 15h20M1 25h30" />{/if}
</svg>
