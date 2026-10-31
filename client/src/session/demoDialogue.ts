import { DEMO_NPCS } from '../shared/demo';

export interface DialogMessage { readonly author: 'player' | 'npc'; readonly text: string }
export interface DemoDialog {
  readonly npcId: string;
  readonly name: string;
  readonly topic: string;
  readonly questions: readonly string[];
  readonly messages: readonly DialogMessage[];
}

export function openDemoDialog(npcId: string): DemoDialog | null {
  const npc = DEMO_NPCS.find((item) => item.id === npcId);
  if (!npc) return null;
  const history = npcId === 'history-guide';
  return {
    npcId, name: npc.name, topic: npc.topic,
    questions: history ? ['Что такое исторический источник?', 'Зачем сравнивать источники?']
      : ['Почему небо голубое?', 'Как проверить гипотезу?'],
    messages: [{ author: 'npc', text: history
      ? 'Привет! Я Лея. Изучаю, как мы узнаём о прошлом. Спроси меня об исторических источниках.'
      : 'Привет! Я Марк. Мне нравится искать объяснения привычным вещам. Обсудим небо или научные опыты?' }],
  };
}

export function answerDemoDialog(dialog: DemoDialog, input: string): DemoDialog {
  const text = input.trim().slice(0, 240);
  if (!text) return dialog;
  const question = text.toLocaleLowerCase('ru');
  let answer: string;
  if (dialog.npcId === 'history-guide') {
    answer = question.includes('сравн') || question.includes('зачем')
      ? 'Один источник может быть неполным или отражать взгляд автора. Сравнивая независимые свидетельства, мы проверяем детали и замечаем противоречия.'
      : question.includes('источник') || question.includes('прошл')
        ? 'Исторический источник — свидетельство прошлого: письмо, фотография, предмет или устный рассказ. Важно выяснить, кто, когда и зачем его создал.'
        : 'В этой демонстрации я отвечаю на два подготовленных вопроса об исторических источниках. Выбери вопрос ниже — и обсудим его.';
  } else {
    answer = question.includes('гипотез') || question.includes('провер') || question.includes('опыт')
      ? 'Сформулируй проверяемое предположение, придумай опыт и сравни результат с ожидаемым. Меняй один фактор за раз и повтори опыт, чтобы проверить устойчивость результата.'
      : question.includes('небо') || question.includes('голуб')
        ? 'Молекулы воздуха рассеивают короткие волны видимого света сильнее длинных. Поэтому рассеянный дневной свет кажется нам преимущественно голубым.'
        : 'Для этой демонстрации подготовлены вопросы о голубом небе и проверке гипотез. Выбери один из них ниже.';
  }
  return { ...dialog, messages: [...dialog.messages.slice(-18), { author: 'player', text }, { author: 'npc', text: answer }] };
}
