import { CITY_RESIDENTS, PASTURE_GOATS, PASTURE_ORIGIN } from '../../../shared/city/catalogue.ts';
import type { ItemId, Language } from '../../../shared/babylon/types.ts';
import type { NpcProfile } from '../contracts.ts';
export const ITEMS: Readonly<Record<ItemId, string>> = { dates: 'fruit-seller', 'red-fruit': 'fruit-seller', 'yellow-fruit': 'fruit-seller', water: 'potter', fabric: 'fabric-seller' };
export const GOATS = PASTURE_GOATS;
const CITY_NPCS = Object.fromEntries(CITY_RESIDENTS.filter(n => !n.legacy).map(n => [n.id, { id:n.id,name:n.name,topic:n.topic,persona:n.persona,greeting:`Добро пожаловать. Я ${n.name}.`,x:n.x,z:n.z }]));
export const NPCS: Readonly<Record<string, NpcProfile & { x: number; z: number }>> = {
  ...CITY_NPCS,
  'fruit-seller': { id: 'fruit-seller', name: 'Торговец фруктами', topic: 'Финики и фрукты', persona: 'Житель древнего Вавилона, учебная реконструкция', greeting: 'Добро пожаловать!', x: -4.5, z: .5 },
  'fabric-seller': { id: 'fabric-seller', name: 'Торговка тканями', topic: 'Ткани и узоры', persona: 'Жительница древнего Вавилона, учебная реконструкция', greeting: 'Рассмотри ткани.', x: -3, z: -5.2 },
  potter: { id: 'potter', name: 'Гончар', topic: 'Глиняная посуда и вода', persona: 'Житель древнего Вавилона, учебная реконструкция', greeting: 'Здесь есть вода в кувшине.', x: 4.6, z: -.5 },
  shepherd: { id: 'shepherd', name: 'Пастух', topic: 'Козы', persona: 'Житель древнего Вавилона, учебная реконструкция', greeting: 'Помоги накормить коз.', x: -3, z: PASTURE_ORIGIN.z + 6 },
};
// Public prompt-only projections. Keep UI labels and the canonical world content above unchanged.
const PROMPT_PROFILES: Readonly<Record<string, Readonly<Record<'en' | 'es', Omit<NpcProfile, 'id'>>>>> = {
  'fruit-seller': {
    en: { name: 'Fruit seller', topic: 'Dates and fruit', persona: 'I am a fruit seller. I sell dates and fruit.', greeting: 'Welcome!' },
    es: { name: 'Vendedor de fruta', topic: 'Dátiles y fruta', persona: 'Soy vendedor de fruta. Vendo dátiles y fruta.', greeting: '¡Bienvenido!' },
  },
  'fabric-seller': {
    en: { name: 'Fabric seller', topic: 'Cloth and patterns', persona: 'I am a fabric seller. I sell cloth. I know about patterns.', greeting: 'Look at the cloth.' },
    es: { name: 'Vendedora de telas', topic: 'Telas y diseños', persona: 'Soy vendedora de telas. Vendo telas. Conozco los diseños.', greeting: 'Mira las telas.' },
  },
  potter: {
    en: { name: 'Potter', topic: 'Clay pots and water', persona: 'I am a potter. I work with clay pots and water.', greeting: 'There is water in a jug.' },
    es: { name: 'Alfarero', topic: 'Vasijas de barro y agua', persona: 'Soy alfarero. Trabajo con vasijas de barro y agua.', greeting: 'Hay agua en una jarra.' },
  },
  shepherd: {
    en: { name: 'Shepherd', topic: 'Goats', persona: 'I am a shepherd. I care for goats.', greeting: 'Help feed the goats.' },
    es: { name: 'Pastor', topic: 'Cabras', persona: 'Soy pastor. Cuido las cabras.', greeting: 'Ayuda a alimentar a las cabras.' },
  },
};

export function localNpcPromptProfile(id: string, language: 'en' | 'es'): NpcProfile {
  const profile = PROMPT_PROFILES[id]?.[language];
  if (!profile) {
    const resident = CITY_RESIDENTS.find(npc => npc.id === id && !npc.legacy);
    if (!resident) throw new Error('Unknown Babylon NPC');
    // Preserve the authored city identity until a localized projection is authored.
    return { id, name: resident.name, topic: resident.topic, persona: resident.persona, greeting: language === 'en' ? 'Welcome!' : '¡Bienvenido!' };
  }
  return { id, ...profile, persona: `${profile.persona} ${language === 'en' ? 'I live in ancient Babylon.' : 'Vivo en la antigua Babilonia.'}` };
}

export const TASK_TITLE: Readonly<Record<Language, string>> = { ru: 'Козы пастуха', en: 'The Shepherd’s Goats', es: 'Las cabras del pastor' };
export const GUIDE: Record<Language, string> = {
  ru: 'Белая коза с колокольчиком — финики. Чёрная с длинными рогами — красные плоды. Рыжая пятнистая — жёлтые фрукты. Маленький серый козлёнок — вода в кувшине.',
  en: 'The white goat with a bell eats dates. The black goat with long horns eats red fruit. The spotted ginger goat eats yellow fruit. The little grey kid drinks water from a jug.',
  es: 'La cabra blanca con campana come dátiles. La cabra negra con cuernos largos come frutos rojos. La cabra rojiza con manchas come fruta amarilla. El cabrito gris pequeño bebe agua de una jarra.',
};
export function task(language: Language, size: number, role: number, started: boolean, completed: boolean): string {
  if (!started) return { ru: 'Ждём остальных участников задания.', en: 'Waiting for the other players.', es: 'Esperando a los demás jugadores.' }[language];
  if (completed) return { ru: 'Спасибо! Все четыре козы накормлены.', en: 'Thank you! All four goats have been fed.', es: '¡Gracias! Las cuatro cabras han comido.' }[language];
  if (size === 1) return { ru: 'Спроси пастуха о корме, купи предметы на рынке и накорми четырёх коз.', en: 'Ask the shepherd about food, buy supplies at the market and feed all four goats.', es: 'Pregunta al pastor por la comida, compra provisiones en el mercado y alimenta a las cuatro cabras.' }[language];
  if (role === 1) return { ru: 'Помоги напарникам накормить коз: объясни приметы и нужный корм. Только у тебя есть список.', en: 'Help your partners feed the goats: explain their features and food. Only you have the list.', es: 'Ayuda a tus compañeros a alimentar a las cabras: explica sus rasgos y su comida. Solo tú tienes la lista.' }[language];
  return { ru: 'Свяжись с игроком 1. Узнай нужный корм, купи его на рынке и накорми коз.', en: 'Contact player 1. Find out which food is needed, buy it at the market and feed the goats.', es: 'Contacta con el jugador 1. Averigua qué comida se necesita, cómprala en el mercado y alimenta a las cabras.' }[language];
}
