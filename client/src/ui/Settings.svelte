<script lang="ts">
  import { untrack } from 'svelte';
  import type { ClientMode } from '../app/GameApp';
  import type { ClientConfig } from '../app/config';
  import { modal } from './modal';
  const { mode, config, error, volume, setVolume, apply, close, appearance }: { appearance?: () => void; mode: ClientMode; config: ClientConfig; error: string | null; volume: number; setVolume: (percent: number) => void; apply: (mode: ClientMode, server: string, map: string, radius: number, debug: boolean) => boolean; close: () => void } = $props();
  let selected = $state<ClientMode>(untrack(() => mode));
  let server = $state(untrack(() => config.serverUrl));
  let map = $state(untrack(() => config.mapId));
  let radius = $state(untrack(() => config.chunkRadius ?? 1));
  let debug = $state(untrack(() => config.debug));
</script>

<dialog use:modal class="panel settings-panel" aria-labelledby="settings-title" oncancel={(event) => { event.preventDefault(); close(); }}>
  <div class="panel-top"><h2 id="settings-title">Настройки</h2><button class="icon-button" onclick={close} aria-label="Закрыть настройки">✕</button></div>
  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); apply(selected, server, map, Number(radius), debug); }}>
    <label>Режим <select aria-label="Режим сессии" bind:value={selected}><option value="local">Локальная прогулка</option><option value="mock">Тестовый сетевой режим</option><option value="online">Локальный сервер</option></select></label>
    {#if selected === 'mock'}<p class="small subtle">Проверка клиента без сервера: участник и ответы имитируются. Сохранений и адаптивного ИИ здесь нет.</p>{/if}
    {#if selected === 'online'}<p class="small subtle">После применения настроек войдите в аккаунт. Демонстрационный вход по имени доступен отдельно. При смене сервера потребуется новый вход.</p>{/if}
    <label>Адрес сервера <input aria-label="Адрес сервера" bind:value={server} type="url" required /></label>
    <label>Карта <input aria-label="Карта" bind:value={map} list="available-maps" maxlength="80" required /></label>
    <datalist id="available-maps"><option value="market">Рынок Вавилона</option><option value="demo">Площадь открытий</option><option value="science">Сады науки</option></datalist>
    <label>Радиус загрузки <select aria-label="Радиус загрузки" bind:value={radius}><option value={0}>Текущая область</option><option value={1}>Ближайшие области</option><option value={2}>Расширенный обзор</option></select></label>
    <label>Громкость <input aria-label="Громкость" type="range" min="0" max="100" step="1" value={Math.round(volume * 100)} oninput={(event) => setVolume(Number(event.currentTarget.value))} /> <output>{Math.round(volume * 100)}%</output></label>
    <label class="debug-toggle"><input type="checkbox" bind:checked={debug} /> Диагностика</label>
    {#if error}<p role="alert" class="capture-error">{error}</p>{/if}
    {#if appearance}<button class="secondary" type="button" onclick={appearance}>Изменить облик персонажа</button>{/if}
    <button type="submit">Применить и открыть карту</button>
    <button class="secondary" type="button" onclick={close}>Отмена</button>
  </form>
</dialog>
