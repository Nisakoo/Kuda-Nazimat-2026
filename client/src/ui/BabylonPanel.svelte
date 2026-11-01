<script lang="ts">
  import { requestId } from '../shared/requestId';
  import { tick, untrack, type Snippet } from 'svelte';
  import './babylon-panels.css';
  import type { GameApp, BabylonPanel, BabylonView, EquipmentView } from '../app/GameApp';
  import type { ToolId } from '../../../shared/equipment/types';
  import ToolIllustration from './ToolIllustration.svelte';
  import Icon from './Icon.svelte';
  import StoneSurface from './StoneSurface.svelte';
  import type { ItemId, Language, PartySize, Word } from '../../../shared/babylon/types';
  import { MARKET_ITEMS, MARKET_PEOPLE, MARKET_GOATS } from '../session/MarketSession';
  import ResidentChat from './ResidentChat.svelte';
  import LearningText from './LearningText.svelte';
  import { modal } from './modal';
  import { inventoryShortcut } from './inventoryShortcut';
  const { game, view, panel, target, wordSeed, navigation, equipment, avatarId = null }: { game: GameApp; view: BabylonView; panel: BabylonPanel | null; target: string | null; wordSeed: string; navigation?: Snippet; equipment?: EquipmentView | null; avatarId?: import('../../../shared/avatar/types').AvatarId | null } = $props();
  const gameState = $derived(view.state);
  const suggestion = $derived(view.suggestion);
  const gameAvatar = $derived(view.state ? avatarId : null);
  const actor = $derived([...MARKET_PEOPLE, ...MARKET_GOATS].find(a => a.id === target));
  const goat = $derived(MARKET_GOATS.find(a => a.id === target));
  const titles = { setup: 'Подготовка путешествия', languages: 'Ваши языки', intro: 'Добро пожаловать в Вавилон', task: 'Козы пастуха', inventory: 'Инвентарь', stone: 'Высечь камень', words: 'Мой словарь', interaction: 'Взаимодействие', chat: 'Чат с напарниками' };
  const labels: Record<Language, string> = { ru: 'Русский', en: 'English', es: 'Español' };
  const statuses = { sent: 'Отправлено', translating: 'Переводится', delivered: 'Доставлено', error: 'Ошибка доставки' };
  let stage = $state(1), size = $state<PartySize>(1), native = $state<Language>('ru'), learning = $state<Language>('en');
  let selected = $state<ItemId>('dates'), message = $state('');
  let word = $state(''), translation = $state(''), note = $state(''), example = $state(''), exampleTranslation = $state(''), editId = $state<string | undefined>();
  let search = $state(''), selectedWordId = $state<string | undefined>(), wordForm = $state(false), learnedFilter = $state(false);
  let selectedTool = $state<ToolId>('bag');
  let detailNote = $state(''), detailExample = $state(''), detailTranslation = $state('');
  const itemsInTool = $derived(MARKET_ITEMS.filter(item => (selectedTool === 'jug' ? item.id === 'water' : item.id !== 'water') && (gameState?.inventory[item.id] ?? 0) > 0));
  const learnedCount = $derived((gameState?.words ?? []).filter(entry => entry.learned).length);
  const filteredWords = $derived((gameState?.words ?? []).filter(entry => entry.learned === learnedFilter && `${entry.word} ${entry.translation} ${entry.note} ${entry.example}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  const selectedWord = $derived(filteredWords.find(entry => entry.id === selectedWordId) ?? filteredWords[0]);
  const selectedDetailId = $derived(selectedWord?.id);
  const participants = $derived((gameState?.party?.members ?? []).filter(member => member.id !== gameState?.playerId).map(member => member.name));
  const chatEntries = $derived([...(gameState?.messages ?? []).map(message => ({ kind: 'message' as const, createdAt: message.createdAt, message })), ...(gameState?.stones ?? []).map(stone => ({ kind: 'stone' as const, createdAt: stone.createdAt, stone }))].sort((a, b) => a.createdAt - b.createdAt));
  let draft = $state<[number, number][][]>([]), drawing = $state(false), pendingStone = $state(false);
  let stoneRequestId: string | undefined;
  let carved = $state<readonly (readonly (readonly [number, number])[])[] | null>(null);
  let appliedWordSeed = '';
  $effect(() => { if (gameState?.availableParty) size = gameState.availableParty.size; });
  $effect(() => { const current = panel; if (current === 'languages') { const pair = untrack(() => gameState?.profile); if (pair) { native = pair.native; learning = pair.learning; } } });
  $effect(() => {
    const seed = wordSeed;
    if (panel !== 'words' || !seed) { appliedWordSeed = ''; return; }
    if (seed === appliedWordSeed) return;
    appliedWordSeed = seed;
    const existing = untrack(() => gameState?.words.find(entry => entry.word.normalize('NFC').toLocaleLowerCase() === seed.normalize('NFC').toLocaleLowerCase()));
    if (existing) { selectedWordId = existing.id; learnedFilter = existing.learned; search = ''; wordForm = false; return; }
    word = seed; translation = ''; note = ''; example = ''; exampleTranslation = ''; editId = undefined; wordForm = true;
  });
  $effect(() => { if (suggestion && !untrack(() => translation.trim())) translation = suggestion; });
  $effect(() => {
    const id = selectedDetailId;
    untrack(() => {
      const entry = selectedWord;
      if (id && entry?.id === id) { detailNote = entry.note; detailExample = entry.example; detailTranslation = entry.exampleTranslation; }
    });
  });
  function point(event: PointerEvent): [number, number] { const r = (event.currentTarget as SVGSVGElement).getBoundingClientRect(); return [Math.round(Math.max(0, Math.min(320, (event.clientX - r.left) / r.width * 320)) * 100) / 100, Math.round(Math.max(0, Math.min(320, (event.clientY - r.top) / r.height * 320)) * 100) / 100]; }
  function begin(event: PointerEvent) { if (event.button !== 0 || view.busy || pendingStone || draft.length >= 64 || draft.reduce((n, s) => n + s.length, 0) >= 4096) return; drawing = true; (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId); draft = [...draft, [point(event)]]; }
  function move(event: PointerEvent) { if (!drawing || draft.at(-1)!.length >= 256 || draft.reduce((n, s) => n + s.length, 0) >= 4096) return; draft = [...draft.slice(0, -1), [...draft.at(-1)!, point(event)]]; }
  async function carve() { drawing = false; pendingStone = true; stoneRequestId ??= requestId(); if (await game.babylonAction({ type: 'carve', drawing: draft }, stoneRequestId)) { carved = draft; draft = []; pendingStone = false; stoneRequestId = undefined; } }
  function edit(entry: Word) { word = entry.word; translation = entry.translation; note = entry.note; example = entry.example; exampleTranslation = entry.exampleTranslation; editId = entry.id; wordForm = true; }
  function addWord() { word = ''; translation = ''; note = ''; example = ''; exampleTranslation = ''; editId = undefined; wordForm = true; }
  async function saveWord() {
    const savedId = editId;
    if (!await game.babylonAction({ type: 'word-save', ...(savedId ? { id: savedId } : {}), word, translation, note, example, exampleTranslation })) return;
    await tick();
    // The ID effect does not rerun for a confirmed edit of the same selected word.
    if (savedId && selectedDetailId === savedId) {
      const confirmed = gameState?.words.find(entry => entry.id === savedId);
      if (confirmed) { detailNote = confirmed.note; detailExample = confirmed.example; detailTranslation = confirmed.exampleTranslation; }
    }
    word = ''; translation = ''; note = ''; example = ''; exampleTranslation = ''; editId = undefined; wordForm = false;
  }
  async function learnSelected() {
    const entry = selectedWord;
    if (!entry || view.busy) return;
    if (detailNote !== entry.note || detailExample !== entry.example || detailTranslation !== entry.exampleTranslation) {
      const saved = await game.babylonAction({ type: 'word-save', id: entry.id, word: entry.word, translation: entry.translation, note: detailNote, example: detailExample, exampleTranslation: detailTranslation });
      if (!saved) return;
    }
    await game.babylonAction({ type: 'word-learn', id: entry.id, learned: !entry.learned });
  }
  async function close() { drawing = false; await game.closeBabylonPanel(); }
</script>

{#if panel}
<div class="modal-backdrop">
  <dialog use:modal class="panel market-panel babel-panel" aria-labelledby="babel-title" oncancel={event => { event.preventDefault(); void close(); }} onkeydown={event => inventoryShortcut(event, panel, () => { void close(); })}>
    <div class="babel-content"><div class="panel-top"><h2 id="babel-title">{panel === 'interaction' ? goat ? actor?.name ?? titles.interaction : 'Разговор с жителем' : titles[panel]}</h2>{#if panel !== 'setup'}<button class="icon-button" aria-label="Закрыть окно" onclick={() => void close()}>✕</button>{/if}</div>
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

      <p>Ваше задание и прогресс сохраняются на сервере. До начала ждём заполнения группы.</p>
    {:else if panel === 'task'}
      <p><LearningText text={gameState.task} learn={word => game.learnWord(word)} /></p>
      {#if gameState.goatGuide}<p><LearningText text={gameState.goatGuide} learn={word => game.learnWord(word)} /></p>{/if}
      <p>Игроки: {gameState.party?.count}/{gameState.party?.size} · Ваша роль: {gameState.party?.role} · Накормлено: {gameState.fed.length}/4</p>
      {#if gameState.party?.completed}<h3>Спасибо за помощь!</h3><p>Время: {gameState.party.seconds} с · Камни: {gameState.stones.length} · Слова в вашем словаре: {gameState.words.length}</p>{/if}
    {:else if panel === 'chat'}
      <p class="babel-muted babel-participants">Участники задания · {participants.length ? `${participants.join(', ')} и вы` : gameState.party ? 'вы' : 'ещё нет участников'}</p>
      <ol class="babel-chat" aria-label="История общения">{#each chatEntries as entry}{#if entry.kind === 'message'}{@const m = entry.message}<li class:outgoing={m.authorId === gameState.playerId}><span class="babel-avatar" aria-hidden="true">{m.authorName.slice(0, 1).toLocaleUpperCase()}</span><div class="babel-message"><strong>{m.authorId === gameState.playerId ? 'Вы' : m.authorName}</strong><div class="babel-bubble"><LearningText text={m.text} enabled={m.authorId !== gameState.playerId && m.language === gameState.profile?.learning} learn={word => game.learnWord(word)} />{#if m.authorId !== gameState.playerId && m.language === gameState.profile?.learning}<button class="babel-add-word babel-action-icon" onclick={() => game.learnWord(m.text)}><Icon name="plus" size={18}/> В словарь</button>{/if}</div><small>{m.translated ? 'Машинный перевод · ' : ''}{statuses[m.status]}{#if m.authorId === gameState.playerId && m.status === 'delivered'} ✓{/if}</small>{#if m.error}<p role="alert">{m.error}</p><button disabled={view.busy} onclick={() => void game.babylonAction({ type: 'chat', text: m.text }, m.id)}>Повторить отправку</button>{/if}</div></li>{:else}{@const stone = entry.stone}<li class:outgoing={stone.authorId === gameState.playerId}><span class="babel-avatar" aria-hidden="true">{stone.authorName.slice(0, 1).toLocaleUpperCase()}</span><div class="babel-message"><strong>{stone.authorId === gameState.playerId ? 'Вы' : stone.authorName}</strong><div class="babel-stone"><small>Рисунок на камне</small><StoneSurface strokes={stone.drawing} label={`Камень от ${stone.authorName}`} /></div></div></li>{/if}{/each}</ol>
      <form class="babel-compose" onsubmit={event => { event.preventDefault(); void game.babylonAction({ type: 'chat', text: message }).then(ok => { if (ok) message = ''; }); }}><button type="button" class="secondary babel-action-icon" onclick={() => game.openBabylonPanel('stone')}><Icon name="pencil" size={20}/> Нарисовать камень</button><label>Сообщение <textarea placeholder="Напишите на родном языке…" aria-label="Сообщение группе" bind:value={message} maxlength="500" required></textarea></label><button disabled={view.busy || !message.trim() || !gameState.party?.started}>Отправить</button></form>
    {:else if panel === 'inventory'}
      <section class="babel-tools" aria-label="Инструменты">
        <h3 class="babel-section-title">Инструменты</h3>
        <div class="babel-tools-layout"><div class="babel-tool-cards">
          {#each [{ id: 'bag' as const, name: 'Сумка' }, { id: 'jug' as const, name: 'Кувшин' }] as tool}
            <button type="button" class="babel-tool-card" class:selected={selectedTool === tool.id} aria-pressed={selectedTool === tool.id} onclick={() => selectedTool = tool.id}><ToolIllustration tool={tool.id} /><span>{tool.name}</span></button>
          {/each}
        </div><div class="babel-tool-detail"><h3>{selectedTool === 'bag' ? 'Сумка' : 'Кувшин'}</h3><p>{selectedTool === 'bag' ? 'Для переноски предметов задания' : 'Для переноски воды'}</p>
          {#if equipment?.state}<button disabled={equipment.busy} onclick={() => void game.equipTool(equipment.state?.tool === selectedTool ? null : selectedTool)}>{equipment.state.tool === selectedTool ? 'Убрать из рук' : 'Взять в руки'}</button><p class="babel-held">В руках: {equipment.state.tool === 'bag' ? 'Сумка' : equipment.state.tool === 'jug' ? 'Кувшин' : 'ничего'}</p>
          {:else}<p role="status">Состояние рук не загружено.</p>{/if}
          {#if equipment?.busy}<p role="status">Ожидаем подтверждения сервера…</p>{/if}{#if equipment?.error}<p role="alert" class="capture-error">{equipment.error}</p>{/if}
        </div></div>
        <h3 class="babel-section-title">Предметы внутри</h3><div class="babel-tool-contents">{#each itemsInTool as item}<div class="babel-content-cell"><strong>{item.name}</strong><span>× {gameState.inventory[item.id]}</span></div>{/each}{#if itemsInTool.length === 0}<div class="babel-empty-cells" aria-hidden="true"><span></span><span></span><span></span></div><p class="babel-muted">Пока пусто</p>{/if}</div>
      </section>
    {:else if panel === 'interaction'}
      {#if goat}<p>{goat.feature}. {gameState.fed.includes(goat.id) ? 'Уже накормлена.' : 'Выберите корм из сумки.'}</p><button disabled={view.busy || !gameState.inventory[selected] || gameState.fed.includes(goat.id)} onclick={() => void game.babylonAction({ type: 'feed', targetId: goat.id, item: selected })}>Дать выбранный корм</button>
      {:else}
        <div class="market-items">{#each MARKET_ITEMS.filter(item => item.seller === target) as item}<button disabled={view.busy} onclick={() => void game.babylonAction({ type: 'buy', targetId: target!, item: item.id })}>Купить: {item.name}</button>{/each}</div>
        {#key target}<ResidentChat {game} {view} target={target!} name={actor?.name ?? 'Житель'} avatar={gameAvatar} />{/key}
      {/if}
    {:else if panel === 'stone'}
      <p>Штрихи нельзя стереть или отменить. Закрытие окна сохраняет черновик. После «Высечь» рисунок неизменен.</p>
      <StoneSurface strokes={draft} label="Камень для рисунка" {drawing} {carved} onbegin={begin} onmove={move} onend={() => drawing = false} />
      <button disabled={view.busy || !draft.length || (!pendingStone && gameState.stones.length >= 8)} onclick={() => void carve()}>{pendingStone ? 'Повторить высечение' : 'Высечь'} · {gameState.stones.length}/8</button>
      <div class="stone-history">{#each gameState.stones as stone (`${stone.authorId}:${stone.id}`)}<figure><StoneSurface strokes={stone.drawing} label={`Камень от ${stone.authorName}`} /><figcaption>{stone.authorName}</figcaption></figure>{/each}</div>
    {:else if panel === 'words'}
      {#if gameState.profile}<p class="babel-language-pair">{labels[gameState.profile.learning]} → {labels[gameState.profile.native]}</p>{/if}
      <div class="babel-word-toolbar"><label>Поиск <input type="search" bind:value={search} placeholder="Найти слово…" /></label><button type="button" class="babel-action-icon" disabled={view.busy || gameState.words.length >= 64} onclick={addWord}><Icon name="plus" size={20}/> Добавить</button></div>
      <div class="babel-word-tabs" role="group" aria-label="Статус словаря"><button type="button" class:active={!learnedFilter} aria-pressed={!learnedFilter} onclick={() => { learnedFilter = false; wordForm = false; }}>Учу · {gameState.words.length - learnedCount}</button><button type="button" class:active={learnedFilter} aria-pressed={learnedFilter} onclick={() => { learnedFilter = true; wordForm = false; }}>Выучено · {learnedCount}</button></div>
      <div class="babel-word-layout"><ul class="babel-word-list word-list" aria-label="Слова">{#each filteredWords as entry (entry.id)}<li><button type="button" class:active={selectedWord?.id === entry.id} onclick={() => { selectedWordId = entry.id; wordForm = false; }}><strong>{entry.word}</strong><span>{entry.translation}{#if entry.note}<small class="babel-word-note">{entry.note}</small>{/if}</span><span aria-hidden="true">›</span></button></li>{/each}</ul>
      <div class="babel-word-detail">{#if wordForm}<form onsubmit={event => { event.preventDefault(); void saveWord(); }}>
        <label>Слово или фраза <input aria-label="Слово" bind:value={word} maxlength="200" required /></label>
        <button type="button" class="secondary" disabled={view.busy || !word.trim()} onclick={() => void game.babylonAction({ type: 'suggest', word })}>Предложить перевод</button>
        {#if view.suggestion}<p class="small">Предложенный перевод — проверьте перед сохранением.</p>{/if}
        <label>Перевод <input aria-label="Перевод" bind:value={translation} maxlength="200" required /></label>
        <label>Пример <textarea aria-label="Пример" bind:value={example} maxlength="500"></textarea></label>
        <label>Перевод примера <textarea aria-label="Перевод примера" bind:value={exampleTranslation} maxlength="500"></textarea></label>
        <label>Заметка <textarea aria-label="Заметка" bind:value={note} maxlength="500"></textarea></label>
        <div class="babel-actions"><button disabled={view.busy || !word.trim() || !translation.trim() || (!editId && gameState.words.length >= 64)}>{editId ? 'Сохранить слово' : 'Добавить слово'}</button><button type="button" class="secondary" onclick={() => wordForm = false}>Отмена</button></div>
      </form>{:else if selectedWord}<h3>{selectedWord.word}</h3><p>{selectedWord.translation}</p>
        <form onsubmit={event => { event.preventDefault(); void game.babylonAction({ type: 'word-save', id: selectedWord.id, word: selectedWord.word, translation: selectedWord.translation, note: detailNote, example: detailExample, exampleTranslation: detailTranslation }); }}>
          <label>Пример <input aria-label="Пример" bind:value={detailExample} maxlength="500" placeholder="Добавьте пример" /></label><label>Перевод примера <input aria-label="Перевод примера" bind:value={detailTranslation} maxlength="500" placeholder="Добавьте перевод" /></label><label>Моя заметка <input aria-label="Моя заметка" bind:value={detailNote} maxlength="500" placeholder="Добавьте заметку" /></label>
          <button type="submit" class="secondary" disabled={view.busy || (detailNote === selectedWord.note && detailExample === selectedWord.example && detailTranslation === selectedWord.exampleTranslation)}>Сохранить заметку и пример</button>
        </form>
        <div class="babel-actions babel-word-actions"><button disabled={view.busy} onclick={() => void learnSelected()}>{selectedWord.learned ? 'Вернуть в «Учу»' : 'Запомнил'}</button><button class="secondary babel-action-icon" onclick={() => edit(selectedWord)}><Icon name="pencil" size={20}/> Изменить</button><button class="secondary babel-action-icon" disabled={view.busy} onclick={() => void game.babylonAction({ type: 'word-delete', id: selectedWord.id })}><Icon name="trash" size={20}/> Удалить</button></div>{:else}<p class="babel-muted">{search ? 'Ничего не найдено.' : 'Здесь пока нет слов. Добавьте новое.'}</p>{/if}</div></div>
    {/if}
    {#if gameState && panel === 'interaction' && goat}<section class="babel-inventory"><h3>Выберите корм</h3><div class="babel-inventory-grid">{#each MARKET_ITEMS as item}<button class="secondary babel-item" class:selected={selected === item.id} disabled={!gameState.inventory[item.id]} onclick={() => selected = item.id}><span>{item.name} · {gameState.inventory[item.id]}</span></button>{/each}</div></section>{/if}
    {#if view.busy}<p role="status">Ожидаем подтверждения сервера…</p>{/if}
    {#if view.notice}<p role="status">{view.notice}</p>{/if}
    {#if view.error}<p class="capture-error" role="alert">{view.error}</p>{/if}
    {#if view.canRetry}<button class="secondary" disabled={view.busy} onclick={() => void game.retryBabylon()}>Повторить запрос</button>{/if}
    {#if panel === 'setup'}<button class="secondary" onclick={() => game.logout()}>Выйти из сессии</button>{/if}
    </div>
    {#if panel !== 'setup'}<div class="babel-footer"><button class="secondary" disabled={panel === 'intro' && view.busy} onclick={() => void close()}>Закрыть</button></div>{/if}
    {#if navigation && panel !== 'setup'}<div class="babel-navigation">{@render navigation()}</div>{/if}
  </dialog>
</div>
{/if}
