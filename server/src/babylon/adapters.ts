import type { LanguagePort } from './ports.ts';
import { testLanguagePort } from './TestLanguagePort.ts';

type Factory = (options: Record<string, unknown>) => LanguagePort;
const adapters: Readonly<Record<string, Factory>> = {
  test(options) {
    if (Object.keys(options).length) throw new Error(`Неизвестный language.options.${Object.keys(options)[0]}`);
    return testLanguagePort;
  },
};

/** Registry of LanguagePort backends, mirroring npc/adapters for NpcResponder. */
export function createLanguagePort(name: string, options: Record<string, unknown>): LanguagePort {
  const factory = Object.hasOwn(adapters, name) ? adapters[name] : undefined;
  if (!factory) throw new Error(`Неизвестный language.adapter: ${name}`);
  return factory(options);
}

/** Same languages and mode, but every call fails: used when the backend did not start. */
export function unavailableLanguagePort(port: LanguagePort): LanguagePort {
  const fail = async (): Promise<never> => { throw new Error('LanguagePort недоступен'); };
  return { mode: port.mode, languages: port.languages, start: async () => {}, stop: () => port.stop(), translate: fail, answer: fail };
}
