<script lang="ts">
  import { modal } from './modal';
  import { helpText } from './helpText';
  const { language = 'ru', close }: { language?: 'ru' | 'en' | 'es'; close: () => void } = $props();
  const copy = $derived(helpText[language]);
</script>

<dialog use:modal class="panel help-panel parchment" aria-labelledby="help-title" oncancel={(event) => { event.preventDefault(); close(); }} lang={language}>
  <div class="panel-top"><h2 id="help-title">{copy.title}</h2><button class="icon-button" aria-label={copy.close} onclick={close}>×</button></div>
  <div class="help-content">
    {#each copy.sections as section}<section><h3>{section[0]}</h3><p>{section[1]}</p></section>{/each}
    <section><h3>{copy.controls}</h3><dl>{#each copy.keys as key}<dt>{key[0]}</dt><dd>{key[1]}</dd>{/each}</dl></section>
  </div>
  <div class="window-actions"><button class="secondary" onclick={close}>{copy.back}</button></div>
</dialog>

<style>
  .help-panel { width: min(620px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); display: flex; flex-direction: column; }
  .help-content { overflow: auto; min-height: 0; padding-right: 8px; }
  section + section { border-top: 1px solid #d9c6a4; margin-top: 16px; padding-top: 12px; }
  h3 { margin: 0 0 6px; font-size: 1rem; }
  p { line-height: 1.5; margin: 0; }
  dl { display: grid; grid-template-columns: minmax(100px, .8fr) minmax(0, 1.2fr); gap: 8px 16px; }
  dt { font-weight: 700; } dd { margin: 0; overflow-wrap: anywhere; }
  .panel-top, .window-actions { flex-shrink: 0; }
</style>
