<script lang="ts">
  import type { ToolId } from '../../../shared/equipment/types';
  let { tool }: { tool: ToolId } = $props();
</script>
<svg viewBox="0 0 150 135" class="tool-illustration" aria-hidden="true">
  <ellipse cx="75" cy="121" rx="49" ry="7" fill="#876949" opacity=".16" />
  {#if tool === 'bag'}
    <path d="M42 44 93 14 104 17 128 98 Q129 109 118 109 L106 102 96 35 51 55" fill="none" stroke="#6e4727" stroke-width="9" stroke-linejoin="round" />
    <path d="M31 88 46 57 72 43 99 51 116 92 109 114 87 124 52 122 33 111 25 99Z" fill="#a78052" stroke="#927047" stroke-width="2" />
    <path d="M46 57 72 43 65 70 38 77Z" fill="#c39d69"/><path d="M72 43 99 51 104 77 65 70Z" fill="#b58c5a"/><path d="M38 77 65 70 61 102 25 99Z" fill="#b38a58"/><path d="M65 70 104 77 92 101 61 102Z" fill="#c6a16e"/><path d="M25 99 61 102 52 122 33 111Z" fill="#8e6b43"/><path d="M61 102 92 101 87 124 52 122Z" fill="#ad895a"/><path d="M104 77 116 92 109 114 87 124 92 101Z" fill="#967148"/>
    <path d="M49 56 43 76 38 108" fill="none" stroke="#76502d" stroke-width="8" stroke-linecap="round" />
  {:else}
    <path d="M99 37 Q131 24 130 54 Q129 70 111 78" fill="none" stroke="#9b402d" stroke-width="10" /><path d="M100 37 Q127 29 124 50 Q123 60 111 66" fill="none" stroke="#df7751" stroke-width="4" />
    <path d="M57 30 Q48 45 39 58 L31 81 37 106 54 121 89 124 109 108 116 82 109 57 94 39 93 29Z" fill="#b94e36" stroke="#a33c29" stroke-width="2" />
    <path d="M57 30 75 35 93 29 99 46 75 52 49 46Z" fill="#cc6144"/><path d="M49 46 75 52 66 74 38 62Z" fill="#d56b4c"/><path d="M75 52 99 46 111 62 96 75 66 74Z" fill="#c5593d"/><path d="M38 62 66 74 62 98 31 81Z" fill="#c1583d"/><path d="M66 74 96 75 101 99 62 98Z" fill="#cf6244"/><path d="M96 75 111 62 116 82 109 108 101 99Z" fill="#ad442f"/><path d="M31 81 62 98 54 121 37 106Z" fill="#a64430"/><path d="M62 98 101 99 89 124 54 121Z" fill="#b34a31"/>
    <ellipse cx="75" cy="28" rx="22" ry="9" fill="#e17958"/><ellipse cx="75" cy="27" rx="16" ry="5" fill="#843522" />
  {/if}
</svg>
