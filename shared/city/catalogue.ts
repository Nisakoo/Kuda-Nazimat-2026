import type { Language } from '../babylon/types.ts';
export type Localized = Readonly<Record<Language, string>>;
export interface CityLocation { readonly id: string; readonly requirement: string; readonly wave: number; readonly x: number; readonly z: number; readonly name: Localized }
export interface CityResident { readonly id: string; readonly requirement: string; readonly location: string; readonly name: string; readonly role: string; readonly x: number; readonly z: number; readonly color: string; readonly hat: string; readonly child: boolean; readonly legacy: boolean; readonly topic: string; readonly persona: string }
// Coordinates use the existing authored world. Four waves are shipped together;
// discovery is personal, and the original tower facade stays closed.
export const CITY_BOUNDS = { minX: -74, maxX: 40, minZ: -80, maxZ: 48 } as const;
export const CITY_BASE_LOCATIONS: readonly CityLocation[] = [
  {
    "id": "gate",
    "requirement": "LOC-001",
    "wave": 1,
    "x": 0,
    "z": 32,
    "name": {
      "ru": "Ворота Иштар",
      "en": "Ishtar Gate",
      "es": "Puerta de Ishtar"
    }
  },
  {
    "id": "guest",
    "requirement": "LOC-002",
    "wave": 3,
    "x": 32,
    "z": 32,
    "name": {
      "ru": "Гостевой двор",
      "en": "Guest courtyard",
      "es": "Patio de huéspedes"
    }
  },
  {
    "id": "market",
    "requirement": "LOC-003",
    "wave": 1,
    "x": 0,
    "z": 0,
    "name": {
      "ru": "Рынок",
      "en": "Market",
      "es": "Mercado"
    }
  },
  {
    "id": "fountain",
    "requirement": "LOC-004",
    "wave": 2,
    "x": 0,
    "z": -32,
    "name": {
      "ru": "Площадь фонтана",
      "en": "Fountain square",
      "es": "Plaza de la fuente"
    }
  },
  {
    "id": "tower",
    "requirement": "LOC-005",
    "wave": 1,
    "x": -32,
    "z": 0,
    "name": {
      "ru": "Двор башни",
      "en": "Tower courtyard",
      "es": "Patio de la torre"
    }
  },
  {
    "id": "school",
    "requirement": "LOC-006",
    "wave": 3,
    "x": -32,
    "z": -64,
    "name": {
      "ru": "Школа писцов",
      "en": "Scribal school",
      "es": "Escuela de escribas"
    }
  },
  {
    "id": "pasture",
    "requirement": "LOC-007",
    "wave": 1,
    "x": 0,
    "z": -64,
    "name": {
      "ru": "Пастбище",
      "en": "Pasture",
      "es": "Pastizal"
    }
  },
  {
    "id": "garden",
    "requirement": "LOC-008",
    "wave": 2,
    "x": 32,
    "z": -32,
    "name": {
      "ru": "Огород",
      "en": "Vegetable garden",
      "es": "Huerto"
    }
  },
  {
    "id": "mill",
    "requirement": "LOC-009",
    "wave": 2,
    "x": -32,
    "z": 32,
    "name": {
      "ru": "Мельница",
      "en": "Mill",
      "es": "Molino"
    }
  },
  {
    "id": "bakery",
    "requirement": "LOC-010",
    "wave": 2,
    "x": 32,
    "z": 0,
    "name": {
      "ru": "Пекарня",
      "en": "Bakery",
      "es": "Panadería"
    }
  },
  {
    "id": "dye",
    "requirement": "LOC-011",
    "wave": 3,
    "x": -32,
    "z": -32,
    "name": {
      "ru": "Красильня",
      "en": "Dye workshop",
      "es": "Taller de tintes"
    }
  },
  {
    "id": "dock",
    "requirement": "LOC-012",
    "wave": 4,
    "x": -64,
    "z": 32,
    "name": {
      "ru": "Пристань Евфрата",
      "en": "Euphrates quay",
      "es": "Muelle del Éufrates"
    }
  },
  {
    "id": "homes",
    "requirement": "LOC-013",
    "wave": 3,
    "x": 32,
    "z": -64,
    "name": {
      "ru": "Жилой квартал",
      "en": "Residential quarter",
      "es": "Barrio residencial"
    }
  },
  {
    "id": "gardens",
    "requirement": "LOC-014",
    "wave": 4,
    "x": -64,
    "z": -64,
    "name": {
      "ru": "Висячие сады",
      "en": "Hanging Gardens",
      "es": "Jardines Colgantes"
    }
  },
  {
    "id": "palace",
    "requirement": "LOC-015",
    "wave": 4,
    "x": -64,
    "z": -32,
    "name": {
      "ru": "Дворец",
      "en": "Palace",
      "es": "Palacio"
    }
  }
];
export const CITY_AUTHORED_RESIDENTS: readonly CityResident[] = [
  {
    "id": "belu",
    "requirement": "CAST-101",
    "location": "gate",
    "name": "Белу",
    "role": "стражник ворот",
    "x": -3,
    "z": 37,
    "color": "#487e9b",
    "hat": "helmet",
    "child": false,
    "legacy": false,
    "topic": "приветствия, «стоп», «проходи», животные на воротах, направления.",
    "persona": "строгий, любит порядок, но добр к новичкам. простая; короткие команды, повторяет важное."
  },
  {
    "id": "zeria",
    "requirement": "CAST-102",
    "location": "gate",
    "name": "Зерия",
    "role": "сборщица пошлин",
    "x": 4,
    "z": 37,
    "color": "#e6d4b3",
    "hat": "wrap",
    "child": false,
    "legacy": false,
    "topic": "числа, «сколько», «платить», товары.",
    "persona": "деловитая, считает всё и всех. средняя; много чисел."
  },
  {
    "id": "herodotus",
    "requirement": "CAST-103",
    "location": "guest",
    "name": "Геродот",
    "role": "путешественник из Греции",
    "x": 29,
    "z": 36,
    "color": "#dcc9a0",
    "hat": "band",
    "child": false,
    "legacy": false,
    "topic": "страны, путешествия, «откуда ты», «расскажи».",
    "persona": "восторженный, любопытный, всё записывает, восхищается городом. сложная; длинные рассказы о путешествиях. Сам плохо знает местный язык — переспрашивает и благодарит за помощь."
  },
  {
    "id": "nanaya",
    "requirement": "CAST-104",
    "location": "guest",
    "name": "Нанайя",
    "role": "хозяйка гостевого двора",
    "x": 36,
    "z": 35,
    "color": "#8b647f",
    "hat": "wrap",
    "child": false,
    "legacy": false,
    "topic": "еда, посуда, «голодный», «угощайся».",
    "persona": "гостеприимная, говорливая, кормит всех. простая; тёплые бытовые фразы."
  },
  {
    "id": "haddad",
    "requirement": "CAST-105",
    "location": "guest",
    "name": "Хаддад",
    "role": "караванщик",
    "x": 37,
    "z": 29,
    "color": "#c49a59",
    "hat": "turban",
    "child": false,
    "legacy": false,
    "topic": "верблюд, дорога, пустыня, товары, «далеко».",
    "persona": "спокойный, немногословный, бывалый. средняя; рассказы о дорогах."
  },
  {
    "id": "fruit-seller",
    "requirement": "CAST-106",
    "location": "market",
    "name": "Торговец фруктами",
    "role": "торговец фруктами",
    "x": -4.5,
    "z": 0.5,
    "color": "#d6a64e",
    "hat": "wrap",
    "child": false,
    "legacy": true,
    "topic": "фрукты, цвета, числа, «сколько стоит», «дешевле».",
    "persona": "бойкий, весёлый, любит торговаться и шутить. простая; восклицания, числа, цены."
  },
  {
    "id": "fabric-seller",
    "requirement": "CAST-107",
    "location": "market",
    "name": "Торговка тканями",
    "role": "торговка тканями",
    "x": -3,
    "z": -5.2,
    "color": "#4b8b82",
    "hat": "wrap",
    "child": false,
    "legacy": true,
    "topic": "цвета, ткани, «светлый», «тёмный», узоры.",
    "persona": "тихая, внимательная к деталям. простая и медленная."
  },
  {
    "id": "potter",
    "requirement": "CAST-108",
    "location": "market",
    "name": "Гончар",
    "role": "гончар",
    "x": 4.6,
    "z": -0.5,
    "color": "#b96c49",
    "hat": "turban",
    "child": false,
    "legacy": true,
    "topic": "формы, размеры, «большой/маленький», «круглый», «высокий».",
    "persona": "гордится работой, хвастается каждым кувшином. средняя; описания форм и размеров."
  },
  {
    "id": "rimi",
    "requirement": "CAST-109",
    "location": "market",
    "name": "Рими",
    "role": "торговец специями",
    "x": 9,
    "z": 9,
    "color": "#9f5c70",
    "hat": "turban",
    "child": false,
    "legacy": false,
    "topic": "вкусы, запахи, «сладкий», «острый», «солёный».",
    "persona": "загадочный, любит предлагать попробовать. средняя; описания запахов и вкусов."
  },
  {
    "id": "ilta",
    "requirement": "CAST-110",
    "location": "fountain",
    "name": "Илта",
    "role": "девочка-водоноска",
    "x": -4,
    "z": -28,
    "color": "#68a5a0",
    "hat": "wrap",
    "child": true,
    "legacy": false,
    "topic": "вода, «полный», «пустой», направления, вопросы «где», «зачем».",
    "persona": "любопытная, задаёт вопросы игроку. простая; много вопросов."
  },
  {
    "id": "apil",
    "requirement": "CAST-111",
    "location": "fountain",
    "name": "Апиль",
    "role": "старик-сказочник",
    "x": 5,
    "z": -27,
    "color": "#d3c3a6",
    "hat": "band",
    "child": false,
    "legacy": false,
    "topic": "легенда, башня, «давным-давно», «смешались».",
    "persona": "мудрый, неторопливый, любит, когда его слушают. сложная; легенды и притчи."
  },
  {
    "id": "beltani",
    "requirement": "CAST-112",
    "location": "tower",
    "name": "Белтани",
    "role": "жрица-звездочёт",
    "x": -39,
    "z": 8,
    "color": "#334f83",
    "hat": "band",
    "child": false,
    "legacy": false,
    "topic": "небо, звёзды, луна, дни, месяцы, время, числа до 60.",
    "persona": "спокойная, задумчивая, говорит загадками. сложная."
  },
  {
    "id": "ishme",
    "requirement": "CAST-113",
    "location": "school",
    "name": "Ишме",
    "role": "писец-учитель",
    "x": -35,
    "z": -60,
    "color": "#c9ba98",
    "hat": "wrap",
    "child": false,
    "legacy": false,
    "topic": "буквы, числа, «писать», «читать», «правильно».",
    "persona": "строгий, но справедливый, любит загадки. средняя; чётко и правильно."
  },
  {
    "id": "lipit",
    "requirement": "CAST-114",
    "location": "pasture",
    "name": "Липит",
    "role": "ученик-сорванец",
    "x": 7,
    "z": -57.5,
    "color": "#b7774e",
    "hat": "cap",
    "child": true,
    "legacy": false,
    "topic": "игры, «скучно», «бежим», школьные предметы.",
    "persona": "озорной, вечно сбегает с уроков. простая; разговорные фразы."
  },
  {
    "id": "shepherd",
    "requirement": "CAST-115",
    "location": "pasture",
    "name": "Пастух",
    "role": "пастух",
    "x": -3,
    "z": -58,
    "color": "#d6a64e",
    "hat": "wrap",
    "child": false,
    "legacy": true,
    "topic": "животные, корм, приметы коз, «сколько», «где».",
    "persona": "добродушный, рассеянный, вечно теряет коз. простая."
  },
  {
    "id": "kuddu",
    "requirement": "CAST-116",
    "location": "garden",
    "name": "Кудду",
    "role": "садовник",
    "x": 29,
    "z": -27,
    "color": "#81905e",
    "hat": "straw",
    "child": false,
    "legacy": false,
    "topic": "овощи, «сажать», «поливать», «ряд», числа, цвета.",
    "persona": "ворчливый, но заботливый; разговаривает с растениями. средняя; ворчит, но подробно объясняет."
  },
  {
    "id": "shamhat",
    "requirement": "CAST-117",
    "location": "mill",
    "name": "Шамхат",
    "role": "мельничиха",
    "x": -35,
    "z": 37,
    "color": "#c7b692",
    "hat": "wrap",
    "child": false,
    "legacy": false,
    "topic": "зерно, мука, мешок, вес, «больше/меньше».",
    "persona": "энергичная, прямолинейная. простая."
  },
  {
    "id": "ibbi",
    "requirement": "CAST-118",
    "location": "bakery",
    "name": "Ибби",
    "role": "пекарь",
    "x": 29,
    "z": 5,
    "color": "#e8dabd",
    "hat": "cap",
    "child": false,
    "legacy": false,
    "topic": "хлеб, мука, мёд, финики, «горячий», глаголы готовки.",
    "persona": "шумный, весёлый, всё делает бегом. средняя; быстрая, много глаголов."
  },
  {
    "id": "nur-sin",
    "requirement": "CAST-119",
    "location": "dye",
    "name": "Нур-Син",
    "role": "красильщик",
    "x": -35,
    "z": -27,
    "color": "#5f8c98",
    "hat": "turban",
    "child": false,
    "legacy": false,
    "topic": "цвета, смешивание, «светлый», «тёмный», ткани.",
    "persona": "увлечённый, может говорить о цветах бесконечно. средняя."
  },
  {
    "id": "sharrum",
    "requirement": "CAST-120",
    "location": "dock",
    "name": "Шаррум",
    "role": "лодочник",
    "x": -63,
    "z": 37,
    "color": "#99785c",
    "hat": "band",
    "child": false,
    "legacy": false,
    "topic": "река, лодка, груз, «тяжёлый», «далеко/близко».",
    "persona": "неторопливый, любит байки о реке. средняя; истории."
  },
  {
    "id": "bau",
    "requirement": "CAST-121",
    "location": "dock",
    "name": "Бау",
    "role": "рыбачка",
    "x": -60,
    "z": 37,
    "color": "#729792",
    "hat": "wrap",
    "child": false,
    "legacy": false,
    "topic": "рыба, сеть, «большой/маленький», «поймать».",
    "persona": "весёлая, суеверная. простая."
  },
  {
    "id": "taram",
    "requirement": "CAST-122",
    "location": "homes",
    "name": "Тарам",
    "role": "хозяйка дома",
    "x": 29,
    "z": -59,
    "color": "#a46e83",
    "hat": "wrap",
    "child": false,
    "legacy": false,
    "topic": "семья, дом, комнаты, одежда.",
    "persona": "заботливая, немного тревожная. простая."
  },
  {
    "id": "enki",
    "requirement": "CAST-123",
    "location": "bakery",
    "name": "Энки",
    "role": "ребёнок",
    "x": 40,
    "z": 6,
    "color": "#4f8d91",
    "hat": "cap",
    "child": true,
    "legacy": false,
    "topic": "игры, предлоги места («за», «под», «рядом»), цвета одежды.",
    "persona": "играют в прятки, хихикают. простая; короткие фразы."
  },
  {
    "id": "niya",
    "requirement": "CAST-123",
    "location": "guest",
    "name": "Ния",
    "role": "ребёнок",
    "x": 24,
    "z": 37,
    "color": "#cc8c56",
    "hat": "wrap",
    "child": true,
    "legacy": false,
    "topic": "игры, предлоги места («за», «под», «рядом»), цвета одежды.",
    "persona": "играют в прятки, хихикают. простая; короткие фразы."
  },
  {
    "id": "nindada",
    "requirement": "CAST-124",
    "location": "gardens",
    "name": "Ниндада",
    "role": "садовница висячих садов",
    "x": -62.0625,
    "z": -57,
    "color": "#8fa576",
    "hat": "flowers",
    "child": false,
    "legacy": false,
    "topic": "растения, цветы, «выше/ниже», «солнце/тень».",
    "persona": "нежная, терпеливая. средняя."
  },
  {
    "id": "amytis",
    "requirement": "CAST-125",
    "location": "gardens",
    "name": "Царица Амитис",
    "role": "Царица Амитис",
    "x": -55.875,
    "z": -57,
    "color": "#ae718d",
    "hat": "crown",
    "child": false,
    "legacy": false,
    "topic": "горы, родина, «скучать», «красиво».",
    "persona": "задумчивая, скучает по родным горам. сложная."
  },
  {
    "id": "nebuchadnezzar",
    "requirement": "CAST-126",
    "location": "palace",
    "name": "Царь Навуходоносор II",
    "role": "Царь Навуходоносор II",
    "x": -60.0,
    "z": -27,
    "color": "#695c96",
    "hat": "crown",
    "child": false,
    "legacy": false,
    "topic": "Город и его жители",
    "persona": "Учебная реконструкция жителя Вавилона. Речь простая."
  }
];


/** Authored poses are independent of the 32 m streaming grid. */
export const CITY_LAYOUT: Readonly<Record<string, readonly [number, number, number, number]>> = {
  gate: [-1, -1, -.035, .91], guest: [-6, -2, -.12, .76],
  fountain: [-2, 1, .16, .92], school: [1, 1, -.11, .89],
  garden: [-6, 1, -.08, .78], mill: [1, -1, .18, .90],
  bakery: [-6, 2, -.16, .78], dye: [1, -1, .13, .93],
  homes: [-7, 2, .10, .72], dock: [0, -1, -.08, .88],
  gardens: [1, 2, .09, .88], palace: [1, 0, -.07, .90],
};
export function cityLocal(id: string, x: number, z: number): { x: number; z: number } {
  const [dx, dz, angle, scale] = CITY_LAYOUT[id] ?? [0, 0, 0, 1];
  return { x: dx + scale * (x * Math.cos(angle) - z * Math.sin(angle)), z: dz + scale * (x * Math.sin(angle) + z * Math.cos(angle)) };
}
export const CITY_LOCATIONS: readonly CityLocation[] = CITY_BASE_LOCATIONS.map(place => {
  const point = cityLocal(place.id, 0, 0); return { ...place, x: place.x + point.x, z: place.z + point.z };
});
export const CITY_RESIDENTS: readonly CityResident[] = CITY_AUTHORED_RESIDENTS.map(resident => {
  const place = CITY_BASE_LOCATIONS.find(p => Math.abs(resident.x - p.x) < 16 && Math.abs(resident.z - p.z) < 16);
  if (!place || resident.legacy) return resident;
  const point = cityLocal(place.id, resident.x - place.x, resident.z - place.z);
  return { ...resident, x: place.x + point.x, z: place.z + point.z };
});

/** Clockwise outline. The final western edges follow the Euphrates instead of a wall. */
export const CITY_OUTLINE: readonly (readonly [number, number])[] = [
  [-69,-74],[-52,-78],[-34,-74],[-18,-78],[-1,-76],[15,-78],[28,-73],
  [37,-62],[33,-49],[39,-35],[34,-19],[38,-5],[33,10],[38,25],[29,41],
  [13,45],[6,46],[-7,46],[-25,42],[-43,47],[-60,41],
  [-70,32],[-72,12],[-68,-8],[-71,-29],[-68,-51],
];
export const CITY_RIVER_BANK = [CITY_OUTLINE[0]!, ...CITY_OUTLINE.slice(21).reverse()];
export function insideCity(x: number, z: number): boolean {
  let inside = false;
  for (let i=0,j=CITY_OUTLINE.length-1;i<CITY_OUTLINE.length;j=i++) {
    const a=CITY_OUTLINE[i]!, b=CITY_OUTLINE[j]!;
    if ((a[1]>z)!==(b[1]>z) && x < (b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}
export function cityBoundaryDistance(x: number,z: number): number {
  return Math.min(...CITY_OUTLINE.map((a,i)=>{
    const b=CITY_OUTLINE[(i+1)%CITY_OUTLINE.length]!,dx=b[0]-a[0],dz=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
    return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);
  }));
}
/** Shared street centre lines; endpoints meet at chunk seams, intermediate bends vary. */
export function cityStreets(id: string): readonly (readonly {x:number;z:number}[])[] {
  const bank=['gardens','palace','dock'].includes(id)||id.startsWith('lane-'), x=bank?4:0;
  const centre=cityLocal(id,x,2), west=cityLocal(id,-5,3), east=cityLocal(id,6,0);
  const north=cityLocal(id,id==='fountain'?6:x,-8), south=cityLocal(id,x-2,9);
  return [
    [{x:-16,z:0},west,centre,east,{x:16,z:0}],
    [{x,z:-16},north,centre,south,{x,z:16}],
  ];
}

export const PASTURE_ORIGIN = { x: 0, z: -64 } as const;
export const PASTURE_GOATS = [
  { id: 'white-goat', food: 'dates', x: -5, z: PASTURE_ORIGIN.z + 1 },
  { id: 'black-goat', food: 'red-fruit', x: 4, z: PASTURE_ORIGIN.z },
  { id: 'spotted-goat', food: 'yellow-fruit', x: -4, z: PASTURE_ORIGIN.z - 5 },
  { id: 'kid-goat', food: 'water', x: 4, z: PASTURE_ORIGIN.z - 5 },
] as const;
