import { CITY_RESIDENTS, PASTURE_GOATS, PASTURE_ORIGIN } from '../../../shared/city/catalogue.ts';
import type { ItemId, Language } from '../../../shared/babylon/types.ts';
import type { NpcProfile } from '../contracts.ts';
export const ITEMS: Readonly<Record<ItemId, string>> = { dates: 'fruit-seller', 'red-fruit': 'fruit-seller', 'yellow-fruit': 'fruit-seller', water: 'potter', fabric: 'fabric-seller' };
export const GOATS = PASTURE_GOATS;
function residentStyle(role: string, persona: string): 'concise' | 'detailed' {
  if (role.includes('писец') || role.includes('жрец') || role.includes('жриц') || role.includes('учен') || role.includes('учитель') || role.includes('сказочник') || persona.includes('сложная') || persona.includes('длинные')) {
    return 'detailed';
  }
  return 'concise';
}
const CITY_NPCS = Object.fromEntries(CITY_RESIDENTS.filter(n => !n.legacy).map(n => [n.id, { id:n.id,name:n.name,topic:n.topic,persona:n.persona,greeting:`Добро пожаловать. Я ${n.name}.`,x:n.x,z:n.z,style:residentStyle(n.role, n.persona) }]));
export const NPCS: Readonly<Record<string, NpcProfile & { x: number; z: number }>> = {
  ...CITY_NPCS,
  'fruit-seller': { id: 'fruit-seller', name: 'Торговец фруктами', topic: 'Финики и фрукты', persona: 'Житель древнего Вавилона, учебная реконструкция', greeting: 'Добро пожаловать!', x: -4.5, z: .5, style: 'concise' },
  'fabric-seller': { id: 'fabric-seller', name: 'Торговка тканями', topic: 'Ткани и узоры', persona: 'Жительница древнего Вавилона, учебная реконструкция', greeting: 'Рассмотри ткани.', x: -3, z: -5.2, style: 'concise' },
  potter: { id: 'potter', name: 'Гончар', topic: 'Глиняная посуда и вода', persona: 'Житель древнего Вавилона, учебная реконструкция', greeting: 'Здесь есть вода в кувшине.', x: 4.6, z: -.5, style: 'concise' },
  shepherd: { id: 'shepherd', name: 'Пастух', topic: 'Козы', persona: 'Житель древнего Вавилона, учебная реконструкция', greeting: 'Помоги накормить коз.', x: -3, z: PASTURE_ORIGIN.z + 6, style: 'concise' },
};
// Public prompt-only projections. Keep UI labels and the canonical world content above unchanged.
const PROMPT_PROFILES: Readonly<Record<string, Readonly<Record<'en' | 'es', Omit<NpcProfile, 'id'>>>>> = {
  'fruit-seller': {
    en: {
      name: 'Fruit seller',
      topic: 'Fresh fruit, dates, and market life',
      persona: 'I am a fruit seller in the market of ancient Babylon along the Euphrates river. I sell sweet dates and fresh fruit brought by riverboats. I earn my silver shekels honestly to feed my household. I know our city under King Nebuchadnezzar II, market prices, and daily news. I share natural merchant observations and answer directly.',
      greeting: 'Welcome! Look at the fresh dates and sweet fruit.',
      style: 'concise',
    },
    es: {
      name: 'Vendedor de fruta',
      topic: 'Fruta fresca, dátiles y vida del mercado',
      persona: 'Soy vendedor de fruta en el mercado de la antigua Babilonia junto al río Éufrates. Vendo dátiles dulces y fruta fresca de los barcos del río. Gano mis siclos de plata con honradez para mi familia. Conozco nuestra ciudad bajo el rey Nabucodonosor II, los precios del mercado y noticias diarias. Comparto observaciones de comerciante y respondo directamente.',
      greeting: '¡Bienvenido! Mira los dátiles frescos y la fruta dulce.',
      style: 'concise',
    },
  },
  'fabric-seller': {
    en: {
      name: 'Fabric seller',
      topic: 'Cloth, patterns, and city fashion',
      persona: 'I am a fabric seller in the market of ancient Babylon along the Euphrates under King Nebuchadnezzar II. I sell fine linen, wool, and patterned dyed cloth. My trade brings steady silver, though fine dye is costly. I observe people visiting our city, from palace attendants to travellers, and know city life and prices well.',
      greeting: 'Look at the cloth.',
      style: 'concise',
    },
    es: {
      name: 'Vendedora de telas',
      topic: 'Telas, diseños y modas de la ciudad',
      persona: 'Soy vendedora de telas en el mercado de la antigua Babilonia junto al Éufrates bajo el rey Nabucodonosor II. Vendo lino fino, lana y telas teñidas con diseños. Mi oficio da plata constante, aunque el tinte es caro. Observo a quienes visitan nuestra ciudad, desde sirvientes del palacio hasta viajeros, y conozco la vida de la ciudad y los precios.',
      greeting: 'Mira las telas.',
      style: 'concise',
    },
  },
  potter: {
    en: {
      name: 'Adadu the Potter',
      topic: 'Clay pots, water jars, and market life',
      persona: 'I am Adadu, a master potter in the market of ancient Babylon along the Euphrates river. I shape clay pots, bowls, and water jars. I work with my hands for every silver shekel and pot of grain, living a modest craftsman’s life. I know our city under King Nebuchadnezzar II, the grand palace, the temple of Marduk, the city gates, and fellow bazaar folk like the baker and weavers. I share honest thoughts about city news, neighbors, and daily bread.',
      greeting: 'Hello, traveller! I am Adadu the potter. Welcome to my workshop.',
      style: 'concise',
    },
    es: {
      name: 'Adadu el Alfarero',
      topic: 'Vasijas de barro, jarras de agua y vida del mercado',
      persona: 'Soy Adadu, un maestro alfarero en el mercado de la antigua Babilonia junto al río Éufrates. Moldeo vasijas, cuencos y jarras de agua con barro del río Éufrates и las cocino en mi horno. Trabajo con mis manos por cada siclo de plata y grano de cebada, con vida modesta de artesano. Conozco nuestra ciudad bajo el rey Nabucodonosor II, el gran palacio, el templo de Marduk, las puertas y a mis vecinos como el panadero y los tejedores. Comparto opiniones sinceras sobre la ciudad, los vecinos y el pan diario.',
      greeting: '¡Hola, viajero! Soy Adadu el alfarero. Bienvenido a mi taller.',
      style: 'concise',
    },
  },
  shepherd: {
    en: {
      name: 'Shepherd',
      topic: 'Goats, pasture life, and the city walls',
      persona: 'I am a shepherd tending goats in the green pastures outside the walls of ancient Babylon near the Euphrates. I live a simple humble life with little silver but fresh milk and quiet pastures. I watch travellers entering through the great city gate under King Nebuchadnezzar II, see palace towers from afar, and know peaceful countryside life.',
      greeting: 'Help feed the goats.',
      style: 'concise',
    },
    es: {
      name: 'Pastor',
      topic: 'Cabras, vida del pasto y las murallas de la ciudad',
      persona: 'Soy pastor y cuido cabras en los pastos fuera de las murallas de la antigua Babilonia, cerca del Éufrates. Llevo una vida humilde y sencilla con poca plata pero leche fresca y pastos tranquilos. Veo a los viajeros cruzar la gran puerta bajo el rey Nabucodonosor II, miro las torres del palacio a lo lejos y conozco la vida apacible junto a la ciudad.',
      greeting: 'Ayuda a alimentar a las cabras.',
      style: 'concise',
    },
  },
};

export function localNpcPromptProfile(id: string, language: 'en' | 'es'): NpcProfile {
  const profile = PROMPT_PROFILES[id]?.[language];
  if (!profile) {
    const resident = CITY_RESIDENTS.find(npc => npc.id === id && !npc.legacy);
    if (!resident) throw new Error('Unknown Babylon NPC');
    // Preserve the authored city identity until a localized projection is authored.
    const style: 'concise' | 'detailed' = residentStyle(resident.role, resident.persona);
    return { id, name: resident.name, topic: resident.topic, persona: resident.persona, greeting: language === 'en' ? 'Welcome!' : '¡Bienvenido!', style };
  }
  return { id, ...profile };
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
