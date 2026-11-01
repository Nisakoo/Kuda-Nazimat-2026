import { CITY_LOCATIONS, CITY_RESIDENTS } from '../../../shared/city/catalogue.ts';
import type { CityState } from '../../../shared/city/types.ts';
import type { Profile, Party, BabylonLocation } from '../babylon/ports.ts';
import { CITY_QUESTS } from './quests.ts';
export class CityError extends Error {}
const deny = (message: string): never => { throw new CityError(message); };
function target(id: string) { return CITY_RESIDENTS.find(n => n.id === id) ?? deny('Неизвестный житель.'); }
export function discoverCity(profile: Profile, location: BabylonLocation | null): boolean {
  if (location?.mapId !== 'market') return false;
  const discovered = profile.discovered ?? [];
  const distance = (place: {x:number;z:number}) => Math.hypot(location.position.x-place.x, location.position.z-place.z);
  const place = [...CITY_LOCATIONS].filter(l => distance(l)<19).sort((a,b)=>distance(a)-distance(b))[0];
  if (!place || discovered.includes(place.id)) return false;
  profile.discovered = [...discovered, place.id]; return true;
}
export function cityView(profile: Profile | null, party: Party | null, role: number): CityState {
  const language = profile?.learning ?? 'ru', progress = party?.city;
  const completed = [...(progress?.completed ?? []), ...(party?.fed.length === 4 ? ['QUEST-001'] : [])];
  const quest = CITY_QUESTS.find(q => q.id === progress?.active), step = quest?.steps[progress?.step ?? 0];
  const candidates = step?.candidates?.filter(id => !progress?.visited?.includes(id));
  const npc = step ? target(candidates?.[0] ?? step.target) : null;
  const canAct = Boolean(party?.startedAt !== null && party && (party.size === 1 || role !== 1));
  return {
    discovered: profile?.discovered ?? [], completed,
    quests: CITY_QUESTS.filter(q => !completed.includes(q.id)).map(q => ({ id:q.id,title:q.title[language],giver:q.giver,wave:q.wave })),
    active: quest && step && npc ? {
      id: quest.id,title:quest.title[language],step:progress!.step,total:quest.steps.length,targetId:npc.id,
      ...(candidates ? { targets:candidates } : {}),
      target: step.hidden || candidates ? null : { x:npc.x,z:npc.z },
      clue: party?.size === 1 || role === 1 ? step.clue[language] : null,
      instruction: {ru:'Обсудите подсказку с напарником и выполните действие рядом с жителем.',en:'Discuss the clue with your teammate and act near the resident.',es:'Comenta la pista con tu compañero y actúa cerca del habitante.'}[language],
      canAct, options: step.choices.map((label,index) => ({id:String(index),label:label[language]})),
    } : null,
  };
}
export function cityAction(party: Party, role: number, action: { type:'city-start'; questId:string } | { type:'city-step'; questId:string; step:number; choice:string; targetId:string }, near: (target:{x:number;z:number})=>void): string {
  if (party.startedAt === null) deny('Дождитесь остальных участников.');
  const quest = CITY_QUESTS.find(q => q.id === action.questId) ?? deny('Неизвестное задание.');
  const progress = party.city ??= { active:null,step:0,completed:[] };
  if (action.type === 'city-start') {
    if (progress.active) deny('Сначала завершите текущее городское задание.');
    if (progress.completed.includes(quest.id)) deny('Задание уже завершено.');
    near(target(quest.giver)); progress.active = quest.id; progress.step = 0; progress.visited = [];
    return 'Задание принято. Подробности доступны в задачах.';
  }
  if (progress.active !== quest.id || progress.step !== action.step) deny('Шаг уже изменился. Обновите задание.');
  if (party.size > 1 && role === 1) deny('Ваша роль — объяснять подсказку напарникам.');
  const step = quest.steps[progress.step] ?? deny('Задание завершено.');
  if (step.candidates ? !step.candidates.includes(action.targetId) || progress.visited?.includes(action.targetId) : action.targetId !== step.target) deny('Выберите другого жителя или ещё не посещённое место.');
  near(target(action.targetId));
  if (action.choice !== String(step.correct)) return 'Попробуйте ещё раз: обсудите описание с напарником. Прогресс не изменён.';
  if (step.candidates) (progress.visited ??= []).push(action.targetId);
  progress.step++;
  if (progress.step === quest.steps.length) { progress.completed.push(quest.id);progress.active=null;progress.step=0;return 'Задание выполнено. Спасибо за помощь!'; }
  return 'Готово. Следующий шаг появился в задачах.';
}
