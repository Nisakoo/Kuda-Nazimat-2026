<script lang="ts">
  import Icon from './Icon.svelte';
  const { openSettings }: { openSettings: () => void } = $props();
</script>

<div class="entry-chrome">
  <button type="button" class="glass compact settings-button entry-settings" aria-label="Настройки" onclick={openSettings}><Icon name="settings" size={30}/></button>
</div>
