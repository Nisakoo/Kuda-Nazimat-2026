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
    return {
      ru: 'Это тестовая реплика торговца. Выберите предмет кнопкой покупки; разговор сам по себе не выдаёт предметы.',
      en: 'This is a test merchant reply. Use the purchase button to get an item; talking does not give you items.',
      es: 'Esta es una respuesta de prueba del comerciante. Usa el botón de compra para obtener un objeto; hablar no entrega objetos.',
    }[language];
  },
};
