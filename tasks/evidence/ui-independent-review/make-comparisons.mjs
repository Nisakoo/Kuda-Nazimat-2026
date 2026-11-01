import { writeFile } from 'node:fs/promises';
const ref = '../../../specs/images/';
const entry = '../ui-redesign-2026-07-02/real-entry/';
const old = '../ui-redesign-2026-07-02/';
const models = '../avatar-models-2026-07-02/';
const pairs = [
 ['FRESH R-01 · production index-Bb8RXsDf · settings covered',ref+'autorize.png','fresh-static/login-390x844.png'],
 ['FRESH R-03 · production · visible gear inert outside native modal',ref+'track.png','fresh-static/mode-390x844.png'],
 ['FRESH · 640×480 mode initial and actual Tab scroll', 'fresh-static/mode-640x480.png','fresh-static/mode-after-tabs-640x480.png'],
 ['Вход · сохранённый real server · не fresh reviewer',ref+'autorize.png',entry+'login-1622x970.png'],
 ['Режим · сохранённый real server · guest',ref+'track.png',entry+'mode-1622x970.png'],
 ['R-01 · перекрыта шестерёнка на 390×844',ref+'autorize.png',entry+'login-390x844.png'],
 ['R-02 · логотип/настройки отсутствуют · ИСТОРИЧЕСКИЙ кадр',ref+'oblik_page.png',old+'avatar-1622.png'],
 ['H-01 · горизонтальное обрезание · ИСТОРИЧЕСКИЙ кадр',ref+'oblik_page.png',old+'avatar-390.png'],
 ...['lukas','nic','dan','ksu'].map(id=>['Облик '+id+' · отдельная финальная GLB сцена, НЕ текущий UI',ref+id+'.png',models+id+'-full.png'])
];
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
let html='<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Независимая проверка: предварительные пары</title><style>body{font:16px system-ui;background:#f7f3ea;color:#163d45;margin:0;padding:24px}h1{font-size:26px}section{border-top:2px solid #b18d55;padding-top:20px;margin:30px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;min-width:0}img{width:100%;height:auto;max-height:850px;object-fit:contain;background:#e8e5dd}figcaption{overflow-wrap:anywhere;font-size:13px;margin:8px 0}a{color:#00676c}@media(max-width:650px){body{padding:12px}.pair{grid-template-columns:1fr}}</style><h1>Предварительные парные сравнения</h1><p>Слева — референс. Справа — исходный сохранённый кадр. Изображения не изменены. Это не свежая independent production проверка.</p><p><a href="preliminary-report.md">Предварительный отчёт с ограничениями</a></p>';
for(const [title,a,b] of pairs) html+=`<section><h2>${esc(title)}</h2><div class="pair"><figure><img src="${esc(a)}" alt="Референс"><figcaption>Референс: <a href="${esc(a)}">${esc(a)}</a></figcaption></figure><figure><img src="${esc(b)}" alt="Сохранённый кадр"><figcaption>Факт: <a href="${esc(b)}">${esc(b)}</a></figcaption></figure></div></section>`;
html+='<section><h2>16 просмотренных real-entry кадров</h2><div class="pair">';
for(const screen of ['login','registration','mode','languages']) for(const size of ['1622x970','1280x800','390x844','640x480']) {const p=entry+screen+'-'+size+'.png';html+=`<figure><img src="${p}" alt="${screen} ${size}"><figcaption><a href="${p}">${p}</a></figcaption></figure>`;}
html+='</div></section></html>';
await writeFile(new URL('./comparisons.html',import.meta.url),html);
