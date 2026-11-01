import { CITY_LOCATIONS, CITY_RESIDENTS } from '../../../shared/city/catalogue.ts';
import type { LanguagePort } from './ports.ts';
import { GUIDE } from './content.ts';
/** Explicit fixture backend. Unknown phrases fail instead of echoing the source as a translation. */
export const testLanguagePort: LanguagePort = {
  mode: 'test', languages: ['ru', 'en', 'es'],
  async start() {},
  async stop() {},
  async translate(text, source, target, signal) {
    if (signal.aborted) throw new Error('Cancelled');
    if (source === target) return text;
    const phrases = [
      ...CITY_LOCATIONS.map(place => place.name),
      { ru: 'Купи финики', en: 'Buy dates', es: 'Compra dátiles' },
      { ru: 'Привет', en: 'Hello', es: 'Hola' },
      { ru: 'коза', en: 'goat', es: 'cabra' },
      { ru: 'финики', en: 'dates', es: 'dátiles' },
      { ru: 'вода', en: 'water', es: 'agua' },
      { ru: 'колокольчик', en: 'bell', es: 'campana' },
      { ru: 'Дай воду серому козлёнку', en: 'Give water to the grey kid', es: 'Dale agua al cabrito gris' },
    ];
    const phrase = phrases.find(row => row[source].toLocaleLowerCase() === text.trim().toLocaleLowerCase());
    if (!phrase) throw new Error('В тестовом переводчике нет этой фразы');
    return phrase[target];
  },
  async answer(npc, _question, language, _history, signal) {
    if (signal.aborted) throw new Error('Cancelled');
    if (npc.id === 'shepherd') return GUIDE[language];
    const resident = CITY_RESIDENTS.find(person => person.id === npc.id && !person.legacy);
    if (resident) {
      const place = CITY_LOCATIONS.find(place => place.id === resident.location)!;
      const repeat = _history.length > 0;
      return {
        ru: `${repeat ? 'Рад снова вас видеть.' : 'Добро пожаловать.'} Я ${resident.name}. Моё место — ${place.name.ru}. Здесь можно взять задание и познакомиться с жизнью города. Это подготовленная учебная реплика.`,
        en: `${repeat ? 'Welcome back.' : 'Welcome.'} I am ${resident.name}. You can find me at the ${place.name.en.toLocaleLowerCase()}. Ask about my task to learn about life in the city. This is a prepared learning reply.`,
        es: `${repeat ? 'Bienvenido de nuevo.' : 'Bienvenido.'} Soy ${resident.name}. Mi lugar es ${place.name.es.toLocaleLowerCase()}. Pide una tarea para conocer la vida de la ciudad. Esta es una respuesta educativa preparada.`,
      }[language];
    }
    return {
      ru: 'Это тестовая реплика торговца. Выберите предмет кнопкой покупки; разговор сам по себе не выдаёт предметы.',
      en: 'This is a test merchant reply. Use the purchase button to get an item; talking does not give you items.',
      es: 'Esta es una respuesta de prueba del comerciante. Usa el botón de compra para obtener un objeto; hablar no entrega objetos.',
    }[language];
  },
};
