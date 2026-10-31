<script lang="ts">
  import { untrack } from 'svelte';
  import type { GameApp, BabylonPanel, BabylonView } from '../app/GameApp';
  import type { ItemId, Language, PartySize, Word } from '../../../shared/babylon/types';
  import { MARKET_ITEMS, MARKET_PEOPLE, MARKET_GOATS } from '../session/MarketSession';
  import LearningText from './LearningText.svelte';
  import { modal } from './modal';
  const { game, view, panel, target, wordSeed }: { game: GameApp; view: BabylonView; panel: BabylonPanel | null; target: string | null; wordSeed: string } = $props();
  const gameState = $derived(view.state);
  const actor = $derived([...MARKET_PEOPLE, ...MARKET_GOATS].find(a => a.id === target));
  const goat = $derived(MARKET_GOATS.find(a => a.id === target));
  const titles = { setup: 'Подготовка путешествия', languages: 'Ваши языки', intro: 'Добро пожаловать в Вавилон', task: 'Козы пастуха', inventory: 'Ваша сумка', stone: 'Высечь камень', words: 'Личный словарь', interaction: 'Взаимодействие', chat: 'Общение' };
  const labels: Record<Language, string> = { ru: 'Русский', en: 'English', es: 'Español' };
  const statuses = { sent: 'Отправлено', translating: 'Переводится', delivered: 'Доставлено', error: 'Ошибка доставки' };
  let stage = $state(1), size = $state<PartySize>(1), native = $state<Language>('ru'), learning = $state<Language>('en');
  let selected = $state<ItemId>('dates'), question = $state(''), message = $state('');
  let word = $state(''), translation = $state(''), note = $state(''), editId = $state<string | undefined>();
  let draft = $state<[number, number][][]>([]), drawing = $state(false), pendingStone = $state(false);
  let stoneRequestId: string | undefined;
  $effect(() => { if (gameState?.availableParty) size = gameState.availableParty.size; });
  $effect(() => { const current = panel; if (current === 'languages') { const pair = untrack(() => gameState?.profile); if (pair) { native = pair.native; learning = pair.learning; } } });
  $effect(() => { if (wordSeed) { word = wordSeed; translation = ''; note = ''; editId = undefined; } });
  $effect(() => { if (view.suggestion) translation = view.suggestion; });
  function point(event: PointerEvent): [number, number] { const r = (event.currentTarget as SVGSVGElement).getBoundingClientRect(); return [Math.round(Math.max(0, Math.min(320, (event.clientX - r.left) / r.width * 320)) * 100) / 100, Math.round(Math.max(0, Math.min(320, (event.clientY - r.top) / r.height * 320)) * 100) / 100]; }
  function begin(event: PointerEvent) { if (event.button !== 0 || view.busy || pendingStone || draft.length >= 64 || draft.reduce((n, s) => n + s.length, 0) >= 4096) return; drawing = true; (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId); draft = [...draft, [point(event)]]; }
  function move(event: PointerEvent) { if (!drawing || draft.at(-1)!.length >= 256 || draft.reduce((n, s) => n + s.length, 0) >= 4096) return; draft = [...draft.slice(0, -1), [...draft.at(-1)!, point(event)]]; }
  async function carve() { drawing = false; pendingStone = true; stoneRequestId ??= crypto.randomUUID(); if (await game.babylonAction({ type: 'carve', drawing: draft }, stoneRequestId)) { draft = []; pendingStone = false; stoneRequestId = undefined; } }
  function edit(entry: Word) { word = entry.word; translation = entry.translation; note = entry.note; editId = entry.id; }
  async function saveWord() { if (await game.babylonAction({ type: 'word-save', ...(editId ? { id: editId } : {}), word, translation, note })) { word = ''; translation = ''; note = ''; editId = undefined; } }
  async function close() { drawing = false; await game.closeBabylonPanel(); }
</script>

{#if panel}
<div class="modal-backdrop">
  <dialog use:modal class="panel market-panel babel-panel" aria-labelledby="babel-title" oncancel={event => { event.preventDefault(); void close(); }}>
    <div class="panel-top"><h2 id="babel-title">{panel === 'interaction' ? actor?.name ?? titles.interaction : titles[panel]}</h2>{#if panel !== 'setup'}<button class="icon-button" aria-label="Закрыть окно" onclick={() => void close()}>✕</button>{/if}</div>
    {#if gameState?.backend === 'test'}<p class="small capture-error">Тестовый переводчик и NPC. Сохранения и игровые действия выполняет настоящий сервер. Для чата доступны, например, «Привет», «Купи финики», «Дай воду серому козлёнку»; остальные фразы могут вернуть ошибку.</p>{/if}
    {#if !gameState}<p>Загружаем данные с сервера…</p>
    {:else if panel === 'setup' || panel === 'languages'}
      {#if panel === 'setup' && stage === 1}
        <p>Выберите число участников. Первый игрок задаёт режим группы; задание начинается, когда все роли заняты.</p>
        <label>Игроков <select aria-label="Число игроков" bind:value={size} disabled={!!gameState.availableParty}>{#each [1, 2, 3, 4] as count}<option value={count}>{count}</option>{/each}</select></label>
        {#if gameState.availableParty}<p>Группа ждёт участников: {gameState.availableParty.count}/{gameState.availableParty.size}.</p>{/if}
        <button onclick={() => stage = 2}>Далее: языки</button>
      {:else}
        <p>Пишите на родном языке. Задания, сообщения других игроков и ответы NPC будут на изучаемом.</p>
        <label>Родной язык <select aria-label="Родной язык" bind:value={native}>{#each gameState.languages as code}<option value={code}>{labels[code]}</option>{/each}</select></label>
        <label>Изучаемый язык <select aria-label="Изучаемый язык" bind:value={learning}>{#each gameState.languages as code}<option value={code} disabled={code === native}>{labels[code]}</option>{/each}</select></label>
        {#if native === learning}<p role="alert">Выберите два разных языка.</p>{/if}
        <button disabled={view.busy || native === learning || gameState.languages.length < 2} onclick={() => void game.babylonAction(panel === 'setup' ? { type: 'enroll', size, native, learning } : { type: 'languages', native, learning })}>{panel === 'setup' ? 'Войти в Вавилон' : 'Сохранить языки'}</button>
        {#if panel === 'setup'}<button class="secondary" onclick={() => stage = 1}>Назад к режиму</button>{/if}
      {/if}
    {:else if panel === 'intro'}
      <p>Вавилон — город смешавшихся языков. Жители учатся снова понимать друг друга. Вы пишете на родном языке, а сообщения напарников и ответы NPC читаете на изучаемом.</p>
      <p>Когда слов не хватает, нарисуйте камень: штрихи нельзя стереть, высеченный рисунок увидит вся группа. Личный словарь поможет сохранить слова и свои заметки.</p>
      <p>WASD — идти, мышь — обзор, E — взаимодействовать, Escape — меню. Покупки и кормление выполняются кнопками; текст собеседника не выдаёт предметы.</p>
      <p>Ваше задание и прогресс сохраняются на сервере. До начала ждём заполнения группы.</p>
    {:else if panel === 'task'}
      <p><LearningText text={gameState.task} learn={word => game.learnWord(word)} /></p>
      {#if gameState.goatGuide}<p><LearningText text={gameState.goatGuide} learn={word => game.learnWord(word)} /></p>{/if}
      <p>Игроки: {gameState.party?.count}/{gameState.party?.size} · Ваша роль: {gameState.party?.role} · Накормлено: {gameState.fed.length}/4</p>
      {#if gameState.party?.completed}<h3>Спасибо за помощь!</h3><p>Время: {gameState.party.seconds} с · Камни: {gameState.stones.length} · Слова в вашем словаре: {gameState.words.length}</p>{/if}
    {:else if panel === 'chat'}
      <p>Пишите на родном языке ({gameState.profile ? labels[gameState.profile.native] : ''}). Слова в переводах можно добавить в словарь.</p>
      <ol class="chat-messages" aria-label="История общения">{#each gameState.messages as m (`${m.authorId}:${m.id}`)}<li><strong>{m.authorName}</strong><p><LearningText text={m.text} enabled={m.authorId !== gameState.playerId && m.language === gameState.profile?.learning} learn={word => game.learnWord(word)} /></p><small>{m.translated ? 'Машинный перевод · ' : ''}{statuses[m.status]}</small>{#if m.error}<p role="alert">{m.error}</p><button disabled={view.busy} onclick={() => void game.babylonAction({ type: 'chat', text: m.text }, m.id)}>Повторить отправку</button>{/if}</li>{/each}</ol>
      <form onsubmit={event => { event.preventDefault(); void game.babylonAction({ type: 'chat', text: message }).then(ok => { if (ok) message = ''; }); }}><label>Сообщение <textarea aria-label="Сообщение группе" bind:value={message} maxlength="500" required></textarea></label><button disabled={view.busy || !message.trim() || !gameState.party?.started}>Отправить</button></form>
    {:else if panel === 'interaction'}
      {#if goat}<p>{goat.feature}. {gameState.fed.includes(goat.id) ? 'Уже накормлена.' : 'Выберите корм из сумки.'}</p><button disabled={view.busy || !gameState.inventory[selected] || gameState.fed.includes(goat.id)} onclick={() => void game.babylonAction({ type: 'feed', targetId: goat.id, item: selected })}>Дать выбранный корм</button>
      {:else}
        <div class="market-items">{#each MARKET_ITEMS.filter(item => item.seller === target) as item}<button disabled={view.busy} onclick={() => void game.babylonAction({ type: 'buy', targetId: target!, item: item.id })}>Купить: {item.name}</button>{/each}</div>
        <div class="dialog-history">{#each gameState.replies.filter(r => r.npcId === target) as r (r.id)}<p><strong>Вы:</strong> {r.question}</p><p><LearningText text={r.text} enabled={r.language === gameState.profile?.learning} learn={word => game.learnWord(word)} /></p>{/each}</div>
        <form onsubmit={event => { event.preventDefault(); void game.babylonAction({ type: 'npc', targetId: target!, text: question }).then(ok => { if (ok) question = ''; }); }}><label>Вопрос собеседнику <textarea aria-label="Вопрос NPC" bind:value={question} maxlength="500" required></textarea></label><button disabled={view.busy || !question.trim()}>Спросить</button></form>
      {/if}
    {:else if panel === 'stone'}
      <p>Штрихи нельзя стереть или отменить. Закрытие окна сохраняет черновик. После «Высечь» рисунок неизменен.</p>
      <svg class="stone-canvas" viewBox="0 0 320 320" role="img" aria-label="Камень для рисунка" onpointerdown={begin} onpointermove={move} onpointerup={() => drawing = false} onpointercancel={() => drawing = false} onlostpointercapture={() => drawing = false}>{#each draft as stroke}<polyline points={stroke.map(p => p.join(',')).join(' ')} fill="none" stroke="#65503c" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />{/each}</svg>
      <button disabled={view.busy || !draft.length || (!pendingStone && gameState.stones.length >= 8)} onclick={() => void carve()}>{pendingStone ? 'Повторить высечение' : 'Высечь'} · {gameState.stones.length}/8</button>
      <div class="stone-history">{#each gameState.stones as stone (`${stone.authorId}:${stone.id}`)}<figure><svg viewBox="0 0 320 320" role="img" aria-label={`Камень от ${stone.authorName}`}>{#each stone.drawing as stroke}<polyline points={stroke.map(p => p.join(',')).join(' ')} fill="none" stroke="#65503c" stroke-width="4" stroke-linecap="round" />{/each}</svg><figcaption>{stone.authorName}</figcaption></figure>{/each}</div>
    {:else if panel === 'words'}
      <p>Личный словарь: {gameState.words.length}/64. Предложенный перевод можно исправить.</p>
      <form onsubmit={event => { event.preventDefault(); void saveWord(); }}>
        <label>Слово или фраза <input aria-label="Слово" bind:value={word} maxlength="200" required /></label>
        <button type="button" class="secondary" disabled={view.busy || !word.trim()} onclick={() => void game.babylonAction({ type: 'suggest', word })}>Предложить перевод</button>
        {#if view.suggestion}<p class="small">Предложенный перевод — проверьте перед сохранением.</p>{/if}
        <label>Перевод <input aria-label="Перевод" bind:value={translation} maxlength="200" required /></label>
        <label>Заметка <textarea aria-label="Заметка" bind:value={note} maxlength="500"></textarea></label>
        <button disabled={view.busy || !word.trim() || !translation.trim()}>{editId ? 'Сохранить слово' : 'Добавить слово'}</button>
      </form>
      <ul class="word-list">{#each gameState.words as entry (entry.id)}<li><strong>{entry.word}</strong> — {entry.translation}<p>{entry.note}</p><small>{labels[entry.learning]} → {labels[entry.native]}</small><div><button class="secondary" onclick={() => edit(entry)}>Изменить</button><button class="secondary" disabled={view.busy} onclick={() => void game.babylonAction({ type: 'word-delete', id: entry.id })}>Удалить</button></div></li>{/each}</ul>
    {/if}
    {#if gameState && (panel === 'inventory' || (panel === 'interaction' && goat))}<div class="market-items">{#each MARKET_ITEMS as item}<button class="secondary" class:selected={selected === item.id} disabled={!gameState.inventory[item.id]} onclick={() => selected = item.id}>{item.name} · {gameState.inventory[item.id]}</button>{/each}</div>{/if}
    {#if view.busy}<p role="status">Ожидаем подтверждения сервера…</p>{/if}
    {#if view.notice}<p role="status">{view.notice}</p>{/if}
    {#if view.error}<p class="capture-error" role="alert">{view.error}</p>{/if}
    {#if view.canRetry}<button class="secondary" disabled={view.busy} onclick={() => void game.retryBabylon()}>Повторить запрос</button>{/if}
    {#if panel === 'setup'}<button class="secondary" onclick={() => game.logout()}>Выйти из сессии</button>{/if}
    {#if panel !== 'setup'}<button class="secondary" disabled={panel === 'intro' && view.busy} onclick={() => void close()}>Закрыть</button>{/if}
  </dialog>
</div>
{/if}
