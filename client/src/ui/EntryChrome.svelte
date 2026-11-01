<script lang="ts">
  import Icon from './Icon.svelte';
  const { openSettings }: { openSettings: () => void } = $props();
</script>

<div class="entry-chrome">
  <a class="brand entry-brand" href="./" aria-label="Вавилон — главная"><Icon name="logo" size={44}/> Вавилон</a>
  <button type="button" class="glass compact settings-button entry-settings" aria-label="Настройки" onclick={openSettings}><Icon name="settings" size={30}/></button>
</div>
