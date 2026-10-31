import type { NpcResponder, NpcAnswerRequest } from '../NpcResponder.ts';
import type { Clock, Scheduler } from '../../common/time.ts';

function reply(request: NpcAnswerRequest): string {
  const { npc, history, question } = request;
  const previous = history.at(-1);
  const topic = `${npc.topic} ${npc.name} ${npc.persona}`.toLowerCase();
  const explanations = /коз|пастух|пастбищ/.test(topic) ? [
    'Смотри внимательно: белая коза с колокольчиком любит финики, чёрная с рогами — красные плоды. Рыжей пятнистой дай жёлтые плоды, серому козлёнку — воду.',
    'Начни с примет животного. У серого козлёнка корм — вода. Запомни пару: серый — вода, и не перепутаешь его с рыжей козой, которой нужны жёлтые плоды.',
    'Я различаю коз по шерсти, рогам и колокольчику. Белой несу финики, чёрной — красные плоды, рыжей — жёлтые, а серому малышу — воду.',
  ] : /глин|гончар|керамик/.test(topic) ? [
    'Хороший горшок начинается с глины. Сперва придай ей форму, потом высуши и обожги. Спешка здесь только трещины делает.',
    'Запомни порядок, ученик: форма, сушка, обжиг. Огонь закрепляет работу, но сырой горшок его не выдержит.',
    'Глина мягкая, пока влажная. Сушкой убираем воду, обжигом делаем сосуд прочнее. Вот и всё ремесло — да руки нужны терпеливые.',
  ] : /фрукт|финик/.test(topic) ? [
    'Подходи! Финики растут на пальмах. Сладкие плоды удобно сушить и хранить для дальней дороги.',
    'Попробуй запомнить так: пальма даёт финики, солнце помогает их высушить, а торговец везёт их на рынок.',
    'Угощайся рассказом о финиках: сушёные плоды легче хранить и перевозить. Потому их так ценят на нашем рынке!',
  ] : /ткан|узор/.test(topic) ? [
    'Рассмотри ткань не спеша. Продольные нити — основа, поперечные — уток. Их переплетение создаёт полотно.',
    'Каждая нить проходит между другими. Меняя цвет нитей и порядок переплетения, мастер получает узор.',
    'Узор складывается постепенно, ряд за рядом. Основа держит ткань, а уток соединяет её нити.',
  ] : /наук/.test(topic) ? [
    'Наблюдение помогает поставить вопрос, а опыт — проверить предположение. Сравни результат до и после изменения одного условия.',
    'Чтобы сравнение было честным, меняй одно условие за раз. Остальные условия опыта сохраняй одинаковыми.',
    'Запиши своё предположение, проверь его опытом и сравни наблюдение с ожиданием. Ошибка тоже помогает учиться.',
  ] : [
    `Изучая тему «${npc.topic}», начни с источника: кто его создал, когда и для чего? Так легче понять рассказ о прошлом.`,
    `В теме «${npc.topic}» полезно сравнивать свидетельства. Два источника могут описывать одно событие с разных сторон.`,
    `Для темы «${npc.topic}» отделяй наблюдение от предположения: что известно из источника, а что мы только объясняем?`,
  ];
  let index = history.length % explanations.length;
  // The six-entry context saturates; still alternate repeated answers after that point.
  if (previous?.question === question && previous.answer.includes(explanations[index]!)) index = (index + 1) % explanations.length;
  return `${previous ? `В прошлый раз ты спрашивал: “${previous.question}”.` : npc.greeting} ${explanations[index]}`;
}
export function scripted(options: Record<string, unknown>, deps: { clock: Clock; scheduler: Scheduler }): NpcResponder {
  for (const key of Object.keys(options)) if (!['delayMs', 'failEvery'].includes(key)) throw new Error(`Неизвестный npc.options.${key}`);
  const delayMs = options.delayMs ?? 300; const failEvery = options.failEvery ?? 0;
  for (const [key, value] of Object.entries({ delayMs, failEvery })) if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 2147483647) throw new Error(`Неверный npc.options.${key}`);
  let running = false; let calls = 0;
  const cancel = new Set<() => void>();
  return {
    async start() { running = true; },
    async stop() { running = false; for (const stop of [...cancel]) stop(); },
    answer(request, signal) {
      if (!running || signal.aborted || request.deadlineAt <= deps.clock.now()) return Promise.reject(new Error('Unavailable'));
      const call = ++calls;
      return new Promise((resolve, reject) => {
        const remaining = request.deadlineAt - deps.clock.now();
        const timer = deps.scheduler.setTimeout(() => {
          cleanup();
          if (deps.clock.now() >= request.deadlineAt || (Number(failEvery) > 0 && call % Number(failEvery) === 0)) reject(new Error('Unavailable'));
          else resolve({ text: reply(request) });
        }, Math.min(Number(delayMs), remaining));
        const abort = () => { cleanup(); reject(new Error('Aborted')); };
        const cleanup = () => { deps.scheduler.clearTimeout(timer); signal.removeEventListener('abort', abort); cancel.delete(abort); };
        cancel.add(abort); signal.addEventListener('abort', abort, { once: true });
      });
    },
  };
}
