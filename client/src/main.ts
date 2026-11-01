import { mount, unmount } from 'svelte';
import { GameApp } from './app/GameApp';
import { parseConfig } from './app/config';
import { rememberConnection, restoreConnection } from './app/connectionPreference';
import App from './ui/App.svelte';
import './ui/global.css';
import './ui/controls.css';

const target = document.getElementById('app');
if (!target) throw new Error('Не найден контейнер приложения.');

let game: GameApp | null = null;
let startupError: string | null = null;
try {
  const response = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Ошибка загрузки настроек (${response.status}).`);
  const source = await response.json();
  let config = parseConfig(source, window.location.origin);
  const join = new URLSearchParams(window.location.search).get('join') === '1';
  try { if (join || (config.session === 'online' && source.serverUrl == null)) rememberConnection(config.serverUrl, window.localStorage);
    else config = restoreConnection(config, window.localStorage, window.location.origin); } catch { /* Browser storage can be disabled. */ }
  game = new GameApp(config);
  if (join) { game.requestJoinAfterLogin(); window.history.replaceState(null, '', window.location.pathname); }
} catch (error) {
  startupError = error instanceof Error ? error.message : 'Не удалось загрузить настройки клиента.';
}

const ui = mount(App, { target, props: { game, startupError } });
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game?.dispose();
    void unmount(ui);
  });
}
