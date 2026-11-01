<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { GameApp, MarketPanel } from '../app/GameApp';
  import { MARKET_GOATS, MARKET_ITEMS, MARKET_PEOPLE } from '../session/MarketSession';
  import type { MarketState, StonePoint, Word } from '../session/MarketSession';
  import { modal } from './modal';
  import { inventoryShortcut } from './inventoryShortcut';
  const { game, market, panel, target, navigation }: { game: GameApp; market: MarketState; panel: MarketPanel | null; target: string | null; navigation?: Snippet } = $props();
  const actor = $derived([...MARKET_PEOPLE, ...MARKET_GOATS].find(actor => actor.id === target));
  const goat = $derived(MARKET_GOATS.find(goat => goat.id === target));
  const titles = { intro: 'Добро пожаловать в Вавилон', task: 'Козы пастуха', inventory: 'Ваша сумка', stone: 'Высечь камень', words: 'Личный словарь', interaction: 'Взаимодействие', results: 'Спасибо за помощь!' };
  let draft = $state<StonePoint[][]>([]);
  let drawing = $state(false);
  let word = $state(''); let translation = $state(''); let note = $state(''); let editId = $state<number | undefined>(); let wordError = $state('');
  function edit(entry: Word) { word = entry.word; translation = entry.translation; note = entry.note; editId = entry.id; }
  function save() { if (game.marketSaveWord(word, translation, note, editId)) { word = ''; translation = ''; note = ''; editId = undefined; wordError = ''; } else wordError = 'Заполните слово и перевод. Лимит локального словаря — 64 записи.'; }
  function point(event: PointerEvent): StonePoint { const r = event.currentTarget instanceof SVGSVGElement ? event.currentTarget.getBoundingClientRect() : null; return r ? [Math.max(0, Math.min(320, (event.clientX-r.left)/r.width*320)), Math.max(0, Math.min(320, (event.clientY-r.top)/r.height*320))] : [0,0]; }
  function begin(event: PointerEvent) { if (event.button !== 0 || draft.length >= 64 || draft.reduce((n,s)=>n+s.length,0)>=4096) return; drawing = true; (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId); draft = [...draft, [point(event)]]; }
  function move(event: PointerEvent) { if (!drawing || draft.at(-1)!.length >= 256 || draft.reduce((n,s)=>n+s.length,0)>=4096) return; draft = [...draft.slice(0,-1), [...draft.at(-1)!, point(event)]]; }
</script>

{#if panel}
  <div class="modal-backdrop">
    <dialog use:modal class="panel market-panel" aria-labelledby="market-title" onkeydown={event => inventoryShortcut(event, panel, () => game.closeMarketPanel())} oncancel={(event) => { event.preventDefault(); drawing = false; game.closeMarketPanel(); }}>
      <div class="panel-top"><div><p class="eyebrow">Рынок Вавилона · локальное демо</p><h2 id="market-title">{panel === 'interaction' ? actor?.name ?? titles.interaction : titles[panel]}</h2></div><button class="icon-button" aria-label="Закрыть окно рынка" onclick={() => { drawing = false; game.closeMarketPanel(); }}>✕</button></div>
      {#if panel === 'intro'}
        <p>Вы — путник в городе, где смешались языки. На рынке продают фрукты, ткани и глиняную посуду. За лестницей пасутся козы.</p>
        <p>Пройдите локальный маршрут покупателя: расспросите пастуха, возьмите корм у торговцев и накормите четыре козы. <kbd>E</kbd> — взаимодействие. Предмет выбирается в сумке.</p>
        <p>Камень помогает объяснить мысль рисунком, словарь — запомнить новые слова. Оба доступны из меню.</p>
        <p class="capture-error">Это проверка клиента: ответы подготовлены, покупки бесплатны, данные живут только до перезапуска сцены. Перевод, совместные роли и сохранение потребуют сервера.</p>
      {:else if panel === 'task'}
        <p>Накормлено <strong>{market.fed.length} из 4</strong>. Пастух ждёт за лестницей, дальше между домами. Он расскажет, какой корм нужен.</p>
        <ol><li>Поговорите с пастухом у загона.</li><li>Возьмите финики, красные и жёлтые плоды у торговца фруктами; воду — у гончара.</li><li>Выберите предмет в сумке и подойдите к козе. Нажмите E, затем «Дать выбранный корм».</li></ol>
        <p>Неверный корм остаётся у вас. Ткань можно купить, но козы её не едят.</p>
      {:else if panel === 'inventory'}
        <p>Выберите, что предложить козе. В демо покупки бесплатны.</p>
      {:else if panel === 'interaction'}
        {#if target === 'shepherd'}
          <p>«Привет, путник! Помоги накормить моих коз. Узнавай их по приметам, а не по имени».</p>
          <ul class="goat-list">{#each MARKET_GOATS as animal}<li><strong>{animal.name}</strong> — {animal.feature.toLowerCase()}. Корм: {MARKET_ITEMS.find(item => item.id === animal.food)?.name.toLowerCase()}.</li>{/each}</ul>
          <p class="small subtle">Подготовленная реплика локального пастуха. В совместном задании список будет доступен отдельной роли.</p>
        {:else if goat}
          <p>{goat.feature}. {market.fed.includes(goat.id) ? 'Уже сыта.' : 'Коза ждёт угощение.'}</p>
          <p>Выбрано: <strong>{MARKET_ITEMS.find(item => item.id === market.selected)?.name ?? 'ничего'}</strong>.</p>
          <button disabled={market.fed.includes(goat.id) || !market.selected} onclick={() => game.marketFeed()}>Дать выбранный корм</button>
        {:else}
          <p>{target === 'fruit-seller' ? '«Свежие плоды, сладкие финики! Выбирай, что взять с собой».' : target === 'potter' ? '«В этих кувшинах вода останется прохладной. Бери один для дороги».' : '«Охра и бирюза — цвета нашего города. Посмотри, какие ткани!»'}</p>
          <div class="market-items">{#each MARKET_ITEMS.filter(item => item.seller === target) as item}<button class="secondary" onclick={() => game.marketBuy(item.id)}>Взять: {item.name}</button>{/each}</div>
          <p class="small subtle">Подготовленная реплика. Предмет выдаётся только кнопкой.</p>
        {/if}
      {:else if panel === 'stone'}
        <p>Рисуйте мышью. Штрихи нельзя стереть; закрытие окна сохраняет черновик. После высечения рисунок неизменен.</p>
        <svg class="stone-canvas" viewBox="0 0 320 320" role="img" aria-label="Камень для рисунка" onpointerdown={begin} onpointermove={move} onpointerup={() => drawing = false} onpointercancel={() => drawing = false} onlostpointercapture={() => drawing = false}>
          {#each draft as stroke}<polyline points={stroke.map(p=>p.join(',')).join(' ')} fill="none" stroke="#65503c" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />{/each}
        </svg>
        <button disabled={!draft.length || market.stones.length >= 8} onclick={() => { if (game.marketCarve(draft)) draft = []; }}>Высечь · {market.stones.length}/8</button>
        <div class="stone-history">{#each market.stones as stone, index}<figure><svg viewBox="0 0 320 320" role="img" aria-label={`Высеченный камень ${index+1}`}>{#each stone as stroke}<polyline points={stroke.map(p=>p.join(',')).join(' ')} fill="none" stroke="#65503c" stroke-width="4" stroke-linecap="round" />{/each}</svg><figcaption>Камень {index+1}</figcaption></figure>{/each}</div>
      {:else if panel === 'words'}
        <p>Запишите слово на изучаемом языке и свой перевод. Автоматический перевод здесь не подключён.</p>
        <form class="settings-form" onsubmit={event => { event.preventDefault(); save(); }}>
          <label>Слово <input bind:value={word} maxlength="80" required /></label><label>Перевод <input bind:value={translation} maxlength="160" required /></label><label>Заметка <input bind:value={note} maxlength="240" /></label>
          <button type="submit">{editId === undefined ? 'Добавить слово' : 'Сохранить слово'}</button>
        </form>
        {#if wordError}<p role="alert">{wordError}</p>{/if}
        <ul class="word-list">{#each market.words as entry}<li><strong>{entry.word}</strong> — {entry.translation}<p>{entry.note}</p><div class="market-items"><button class="secondary" onclick={() => edit(entry)}>Изменить</button><button class="secondary" onclick={() => game.marketRemoveWord(entry.id)}>Удалить</button></div></li>{/each}</ul>
      {:else if panel === 'results'}
        <p>«Спасибо, путник! Все четыре козы сыты».</p><dl class="market-results"><dt>Время прогулки</dt><dd>{Math.floor(market.seconds/60)} мин {market.seconds%60} с</dd><dt>Высечено камней</dt><dd>{market.stones.length}</dd><dt>Добавлено слов</dt><dd>{market.wordsAdded}</dd></dl>
        <p class="small subtle">Итоги локального маршрута. Прогресс не отправлялся на сервер.</p>
      {/if}
      {#if panel === 'inventory' || (panel === 'interaction' && goat)}
        <div class="market-items">{#each MARKET_ITEMS as item}<button class="secondary" class:selected={market.selected === item.id} disabled={!market.inventory[item.id]} onclick={() => game.marketSelect(item.id)}>{item.name} · {market.inventory[item.id]}</button>{/each}</div>
      {/if}
      {#if market.notice}<p class="market-notice" role="status">{market.notice}</p>{/if}
      <p class="small subtle">Только локальный стенд · без серверного сохранения</p>
      <button class="secondary" onclick={() => game.closeMarketPanel()}>Закрыть</button>
      {#if navigation}<div class="market-navigation">{@render navigation()}</div>{/if}
    </dialog>
  </div>
{/if}

<style>
  .market-navigation { position: sticky; bottom: 0; background: #fafaf2; padding-top: 8px; z-index: 1; }
</style>
