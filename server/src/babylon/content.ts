import type { ItemId, Language } from '../../../shared/babylon/types.ts';
export const ITEMS: Readonly<Record<ItemId, string>> = { dates: 'fruit-seller', 'red-fruit': 'fruit-seller', 'yellow-fruit': 'fruit-seller', water: 'potter', fabric: 'fabric-seller' };
export const GOATS = [
  { id: 'white-goat', food: 'dates', x: -5, z: -31 },
  { id: 'black-goat', food: 'red-fruit', x: 4, z: -32 },
  { id: 'spotted-goat', food: 'yellow-fruit', x: -4, z: -37 },
  { id: 'kid-goat', food: 'water', x: 4, z: -37 },
] as const;
/** CONTENT-009: NPCs the task cannot work without — merchants of the items and the shepherd's list. */
export const BABEL_NPC_IDS: ReadonlySet<string> = new Set([...Object.values(ITEMS), 'shepherd']);
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
