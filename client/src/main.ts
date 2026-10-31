import { mount, unmount } from 'svelte';
import { GameApp } from './app/GameApp';
import { parseConfig } from './app/config';
import App from './ui/App.svelte';
import './ui/global.css';

const target = document.getElementById('app');
if (!target) throw new Error('Не найден контейнер приложения.');

let game: GameApp | null = null;
let startupError: string | null = null;
try {
  const response = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Ошибка загрузки настроек (${response.status}).`);
  game = new GameApp(parseConfig(await response.json(), window.location.origin));
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
