<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import './babylon-panels.css';
  import type { GameApp, BabylonPanel, BabylonView } from '../app/GameApp';
  import type { ItemId, Language, PartySize, Word } from '../../../shared/babylon/types';
  import { MARKET_ITEMS, MARKET_PEOPLE, MARKET_GOATS } from '../session/MarketSession';
  import LearningText from './LearningText.svelte';
  import { modal } from './modal';
  const { game, view, panel, target, wordSeed, navigation }: { game: GameApp; view: BabylonView; panel: BabylonPanel | null; target: string | null; wordSeed: string; navigation?: Snippet } = $props();
  const gameState = $derived(view.state);
  const actor = $derived([...MARKET_PEOPLE, ...MARKET_GOATS].find(a => a.id === target));
  const goat = $derived(MARKET_GOATS.find(a => a.id === target));
  const titles = { setup: 'Подготовка путешествия', languages: 'Ваши языки', intro: 'Добро пожаловать в Вавилон', task: 'Козы пастуха', inventory: 'Инвентарь', stone: 'Высечь камень', words: 'Мой словарь', interaction: 'Взаимодействие', chat: 'Чат с напарниками' };
  const labels: Record<Language, string> = { ru: 'Русский', en: 'English', es: 'Español' };
  const statuses = { sent: 'Отправлено', translating: 'Переводится', delivered: 'Доставлено', error: 'Ошибка доставки' };
  let stage = $state(1), size = $state<PartySize>(1), native = $state<Language>('ru'), learning = $state<Language>('en');
  let selected = $state<ItemId>('dates'), question = $state(''), message = $state('');
  let word = $state(''), translation = $state(''), note = $state(''), editId = $state<string | undefined>();
  let search = $state(''), selectedWordId = $state<string | undefined>(), wordForm = $state(false);
  const filteredWords = $derived((gameState?.words ?? []).filter(entry => `${entry.word} ${entry.translation} ${entry.note}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  const selectedWord = $derived(gameState?.words.find(entry => entry.id === selectedWordId) ?? filteredWords[0]);
  const chatEntries = $derived([...(gameState?.messages ?? []).map(message => ({ kind: 'message' as const, createdAt: message.createdAt, message })), ...(gameState?.stones ?? []).map(stone => ({ kind: 'stone' as const, createdAt: stone.createdAt, stone }))].sort((a, b) => a.createdAt - b.createdAt));
  let draft = $state<[number, number][][]>([]), drawing = $state(false), pendingStone = $state(false);
  let stoneRequestId: string | undefined;
  $effect(() => { if (gameState?.availableParty) size = gameState.availableParty.size; });
  $effect(() => { const current = panel; if (current === 'languages') { const pair = untrack(() => gameState?.profile); if (pair) { native = pair.native; learning = pair.learning; } } });
  $effect(() => { if (wordSeed) { word = wordSeed; translation = ''; note = ''; editId = undefined; wordForm = true; } });
  $effect(() => { if (view.suggestion) translation = view.suggestion; });
  function point(event: PointerEvent): [number, number] { const r = (event.currentTarget as SVGSVGElement).getBoundingClientRect(); return [Math.round(Math.max(0, Math.min(320, (event.clientX - r.left) / r.width * 320)) * 100) / 100, Math.round(Math.max(0, Math.min(320, (event.clientY - r.top) / r.height * 320)) * 100) / 100]; }
  function begin(event: PointerEvent) { if (event.button !== 0 || view.busy || pendingStone || draft.length >= 64 || draft.reduce((n, s) => n + s.length, 0) >= 4096) return; drawing = true; (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId); draft = [...draft, [point(event)]]; }
  function move(event: PointerEvent) { if (!drawing || draft.at(-1)!.length >= 256 || draft.reduce((n, s) => n + s.length, 0) >= 4096) return; draft = [...draft.slice(0, -1), [...draft.at(-1)!, point(event)]]; }
  async function carve() { drawing = false; pendingStone = true; stoneRequestId ??= crypto.randomUUID(); if (await game.babylonAction({ type: 'carve', drawing: draft }, stoneRequestId)) { draft = []; pendingStone = false; stoneRequestId = undefined; } }
  function edit(entry: Word) { word = entry.word; translation = entry.translation; note = entry.note; editId = entry.id; wordForm = true; }
  function addWord() { word = ''; translation = ''; note = ''; editId = undefined; wordForm = true; }
  async function saveWord() { if (await game.babylonAction({ type: 'word-save', ...(editId ? { id: editId } : {}), word, translation, note })) { word = ''; translation = ''; note = ''; editId = undefined; wordForm = false; } }
  async function close() { drawing = false; await game.closeBabylonPanel(); }
</script>

{#if panel}
<div class="modal-backdrop">
  <dialog use:modal class="panel market-panel babel-panel" aria-labelledby="babel-title" oncancel={event => { event.preventDefault(); void close(); }} onkeydown={event => { if (panel === 'inventory' && event.code === 'KeyI' && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey && !(event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) { event.preventDefault(); void close(); } }}>
    <div class="babel-content"><div class="panel-top"><h2 id="babel-title">{panel === 'interaction' ? actor?.name ?? titles.interaction : titles[panel]}</h2>{#if panel !== 'setup'}<button class="icon-button" aria-label="Закрыть окно" onclick={() => void close()}>✕</button>{/if}</div>
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
      <p class="babel-muted">Пишите на родном языке ({gameState.profile ? labels[gameState.profile.native] : ''}). Нажмите слово на изучаемом языке, чтобы добавить его в словарь.</p>
      <ol class="babel-chat" aria-label="История общения">{#each chatEntries as entry}{#if entry.kind === 'message'}{@const m = entry.message}<li class:outgoing={m.authorId === gameState.playerId}><span class="babel-avatar" aria-hidden="true">{m.authorName.slice(0, 1).toLocaleUpperCase()}</span><div class="babel-message"><strong>{m.authorId === gameState.playerId ? 'Вы' : m.authorName}</strong><div class="babel-bubble"><LearningText text={m.text} enabled={m.authorId !== gameState.playerId && m.language === gameState.profile?.learning} learn={word => game.learnWord(word)} />{#if m.authorId !== gameState.playerId && m.language === gameState.profile?.learning}<button class="babel-add-word" onclick={() => game.learnWord(m.text)}>+ В словарь</button>{/if}</div><small>{m.translated ? 'Машинный перевод · ' : ''}{statuses[m.status]}</small>{#if m.error}<p role="alert">{m.error}</p><button disabled={view.busy} onclick={() => void game.babylonAction({ type: 'chat', text: m.text }, m.id)}>Повторить отправку</button>{/if}</div></li>{:else}{@const stone = entry.stone}<li class:outgoing={stone.authorId === gameState.playerId}><span class="babel-avatar" aria-hidden="true">{stone.authorName.slice(0, 1).toLocaleUpperCase()}</span><div class="babel-message"><strong>{stone.authorId === gameState.playerId ? 'Вы' : stone.authorName}</strong><div class="babel-stone"><small>Рисунок на камне</small><svg viewBox="0 0 320 320" role="img" aria-label={`Камень от ${stone.authorName}`}>{#each stone.drawing as stroke}<polyline points={stroke.map(p => p.join(',')).join(' ')} fill="none" stroke="#65503c" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />{/each}</svg></div></div></li>{/if}{/each}</ol>
      <form class="babel-compose" onsubmit={event => { event.preventDefault(); void game.babylonAction({ type: 'chat', text: message }).then(ok => { if (ok) message = ''; }); }}><button type="button" class="secondary" onclick={() => game.openBabylonPanel('stone')}>Нарисовать камень</button><label>Сообщение <textarea placeholder="Напишите на родном языке…" aria-label="Сообщение группе" bind:value={message} maxlength="500" required></textarea></label><button disabled={view.busy || !message.trim() || !gameState.party?.started}>Отправить</button></form>
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
      {#if gameState.profile}<p class="babel-language-pair">{labels[gameState.profile.learning]} → {labels[gameState.profile.native]}</p>{/if}
      <div class="babel-word-toolbar"><label>Поиск <input type="search" bind:value={search} placeholder="Найти слово…" /></label><button type="button" disabled={view.busy || gameState.words.length >= 64} onclick={addWord}>＋ Добавить</button></div>
      <p class="babel-muted">Личный словарь: {gameState.words.length}/64. Предложенный перевод можно исправить.</p>
      <div class="babel-word-layout"><ul class="babel-word-list word-list" aria-label="Слова">{#each filteredWords as entry (entry.id)}<li><button type="button" class:active={selectedWord?.id === entry.id} onclick={() => { selectedWordId = entry.id; wordForm = false; }}><strong>{entry.word}</strong><span>{entry.translation}{#if entry.note}<small class="babel-word-note">{entry.note}</small>{/if}</span><span aria-hidden="true">›</span></button></li>{/each}</ul>
      <div class="babel-word-detail">{#if wordForm}<form onsubmit={event => { event.preventDefault(); void saveWord(); }}>
        <label>Слово или фраза <input aria-label="Слово" bind:value={word} maxlength="200" required /></label>
        <button type="button" class="secondary" disabled={view.busy || !word.trim()} onclick={() => void game.babylonAction({ type: 'suggest', word })}>Предложить перевод</button>
        {#if view.suggestion}<p class="small">Предложенный перевод — проверьте перед сохранением.</p>{/if}
        <label>Перевод <input aria-label="Перевод" bind:value={translation} maxlength="200" required /></label>
        <label>Заметка <textarea aria-label="Заметка" bind:value={note} maxlength="500"></textarea></label>
        <div class="babel-actions"><button disabled={view.busy || !word.trim() || !translation.trim() || (!editId && gameState.words.length >= 64)}>{editId ? 'Сохранить слово' : 'Добавить слово'}</button><button type="button" class="secondary" onclick={() => wordForm = false}>Отмена</button></div>
      </form>{:else if selectedWord}<h3>{selectedWord.word}</h3><p>{selectedWord.translation}</p><small>{labels[selectedWord.learning]} → {labels[selectedWord.native]}</small><h4>Моя заметка</h4><p class="babel-note">{selectedWord.note || 'Нет заметки'}</p><div class="babel-actions"><button class="secondary" onclick={() => edit(selectedWord)}>Изменить</button><button class="secondary" disabled={view.busy} onclick={() => void game.babylonAction({ type: 'word-delete', id: selectedWord.id })}>Удалить</button></div>{:else}<p class="babel-muted">Выберите слово или добавьте новое.</p>{/if}</div></div>
    {/if}
    {#if gameState && (panel === 'inventory' || (panel === 'interaction' && goat))}<section class="babel-inventory"><h3>{panel === 'inventory' ? 'Корм' : 'Выберите корм'}</h3><div class="babel-inventory-grid">{#each MARKET_ITEMS as item}<button class="secondary babel-item" class:selected={selected === item.id} disabled={!gameState.inventory[item.id]} onclick={() => selected = item.id}><span>{item.name} · {gameState.inventory[item.id]}</span></button>{/each}</div>{#if panel === 'inventory'}<p class="babel-muted">Сервер сообщает количество корма. Действие «Взять в руки» недоступно: сервер пока не предоставляет состояние рук и команду для него.</p>{/if}</section>{/if}
    {#if view.busy}<p role="status">Ожидаем подтверждения сервера…</p>{/if}
    {#if view.notice}<p role="status">{view.notice}</p>{/if}
    {#if view.error}<p class="capture-error" role="alert">{view.error}</p>{/if}
    {#if view.canRetry}<button class="secondary" disabled={view.busy} onclick={() => void game.retryBabylon()}>Повторить запрос</button>{/if}
    {#if panel === 'setup'}<button class="secondary" onclick={() => game.logout()}>Выйти из сессии</button>{/if}
    {#if panel !== 'setup'}<button class="secondary" disabled={panel === 'intro' && view.busy} onclick={() => void close()}>Закрыть</button>{/if}
    {#if panel === 'chat'}<p class="window-hint">Пишите на родном — читайте на изучаемом</p>{:else if panel !== 'setup'}<p class="window-hint">{panel === 'inventory' ? 'I / Esc' : 'Esc'} — закрыть</p>{/if}
    </div>
    {#if navigation && panel !== 'setup'}<div class="babel-navigation">{@render navigation()}</div>{/if}
  </dialog>
</div>
{/if}
