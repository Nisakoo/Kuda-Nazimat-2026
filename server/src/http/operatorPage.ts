import { readFileSync } from 'node:fs';

// Server-owned offline UI, shipped with the sources; no client build or runtime dependency.
// Only authored assets are embedded. API values are rendered with textContent in the browser.
const asset = (name: string): string => readFileSync(new URL(`./operator/${name}`, import.meta.url), 'utf8');
export const OPERATOR_PAGE = asset('index.html')
  .replace('/* OPERATOR_STYLE */', () => asset('style.css'))
  .replace('/* OPERATOR_SCRIPT */', () => asset('app.js'));
