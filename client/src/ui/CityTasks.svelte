<script lang="ts">
  import type { GameApp, BabylonView } from '../app/GameApp';
  import { CITY_RESIDENTS, CITY_LOCATIONS } from '../../../shared/city/catalogue';
  import LearningText from './LearningText.svelte';
  const { game, view, target = null }: { game: GameApp; view: BabylonView; target?: string | null } = $props();
  const city = $derived(view.state?.city);
  const active = $derived(city?.active);
  const available = $derived(city?.quests.filter(q => !target || q.giver === target) ?? []);
  const atTarget = $derived(!!active && !!target && (active.targets?.includes(target) ?? target === active.targetId));
  const language = $derived(view.state?.profile?.learning ?? 'ru');
  function giver(id: string) { const npc = CITY_RESIDENTS.find(n => n.id === id); const place = CITY_LOCATIONS.find(l => l.id === npc?.location); return `${npc?.name ?? id}${place ? ` · ${place.name[language]}` : ''}`; }
</script>

{#if city}
<section class="city-tasks" aria-label="Задания города">
  {#if !target}<h3>Городские задания</h3><p class="babel-muted">Четыре этапа путешествия · Завершено: {city.completed.length}</p>{/if}
  {#if active && (!target || atTarget)}
    <article class="city-active">
      <h3>{active.title}</h3><p>Шаг {active.step + 1} / {active.total} · {active.targets ? active.targets.map(giver).join(" / ") : giver(active.targetId)}</p>
      {#if active.clue}<p class="city-clue"><LearningText text={active.clue} learn={word => game.learnWord(word)}/></p>{:else}<p>{active.instruction}</p>{/if}
      {#if !active.canAct}<p class="babel-muted">Передайте подсказку напарникам в чате. Действие выполняют они.</p>{/if}
      {#if atTarget}
        <div class="city-choices">{#each active.options as option}<button class="secondary" disabled={view.busy || !active.canAct} onclick={() => void game.babylonAction({type:'city-step',questId:active.id,step:active.step,choice:option.id,targetId:target!})}>{option.label}</button>{/each}</div>
      {:else}<p class="babel-muted">Подойдите к жителю и нажмите E, чтобы выполнить действие.</p>{/if}
    </article>
  {/if}
  {#if !active}
    <ul>{#each available as quest}<li><strong>{quest.title}</strong><span>{giver(quest.giver)}</span>{#if target}<button disabled={view.busy || !view.state?.party?.started} onclick={() => void game.babylonAction({type:'city-start',questId:quest.id})}>Принять задание</button>{/if}</li>{/each}</ul>
    {#if !target}<p class="babel-muted">Задания принимаются у жителей. Найдите их район на карте.</p>{/if}
  {/if}
</section>
{/if}
<style>
  .city-tasks { margin-top: 20px; border-top: 1px solid #d9c6a4; padding-top: 12px; }
  .city-tasks h3 { margin: 6px 0; } ul { list-style: none; padding: 0; margin: 12px 0; }
  li { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 12px 0; border-bottom: 1px solid #d9c6a4; align-items: center; }
  li span { flex: 1; min-width: 140px; color: #6a6659; font-size: .9rem; }
  .city-active { padding: 12px; border: 1px solid #bcb58e; background: #eff0d8; border-radius: 4px; }
  .city-choices { display: flex; flex-wrap: wrap; gap: 8px; } .city-clue { line-height: 1.6; }
</style>
