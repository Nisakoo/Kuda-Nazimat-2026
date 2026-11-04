import type { NpcAttitude } from './ports.ts';

export type PlayerIntent = 'insult' | 'apology' | 'neutral';

const QUOTE_PATTERNS = [
  /["'«»“”„]/,
  /(?<!\p{L})(?:он|она|они|кто-то)\s+сказал[аи]?(?!\p{L})/iu,
  /(?<!\p{L})(?:he|she|they|someone)\s+said(?!\p{L})/iu,
  /(?<!\p{L})(?:él|ella|alguien)\s+dijo(?!\p{L})/iu,
  /(?<!\p{L})(?:цитата|цитирую|quote|quoting|cita)(?!\p{L})/iu,
];

const VOCABULARY_PATTERNS = [
  /(?<!\p{L})что\s+(?:значит|такое)(?!\p{L})/iu,
  /(?<!\p{L})what\s+does\b.*\bmean(?!\p{L})/iu,
  /(?<!\p{L})what\s+is\s+(?:a|an|the)\s+\p{L}+(?!\p{L})/iu,
  /(?<!\p{L})qu[ée]\s+significa(?!\p{L})/iu,
  /(?<!\p{L})qu[ée]\s+es\s+(?:un|una|el|la)(?!\p{L})/iu,
  /(?<!\p{L})meaning\s+of(?!\p{L})/iu,
  /(?<!\p{L})значение\s+слова(?!\p{L})/iu,
];

const THIRD_PARTY_PATTERNS = [
  /(?<!\p{L})(?:царь|король|стражник|сосед|правитель|купец|жрец|бог|навуходоносор)\s+(?:дурак|идиот|тупой|глупый|урод|плохой)(?!\p{L})/iu,
  /(?<!\p{L})(?:the\s+)?(?:king|guard|neighbor|merchant|priest|ruler|nebuchadnezzar)\s+is\s+(?:stupid|an\s+idiot|bad|evil|fool|useless)(?!\p{L})/iu,
  /(?<!\p{L})(?:el\s+)?(?:rey|guardia|vecino|comerciante|sacerdote)\s+es\s+(?:tonto|est[uú]pido|malo|in[uú]til)(?!\p{L})/iu,
];

const DIRECT_INSULT_PATTERNS = [
  // Russian
  /(?<!\p{L})(?:ты|вы)\s+(?:[а-яё-]+\s+)?(?:дурак|идиот|тупой|глупый|урод|тварь|мразь|олух|бесполезный|никчемный|мудак)(?!\p{L})/iu,
  /(?<!\p{L})(?:пошел\s+прочь|пошел\s+вон|заткнись|закрой\s+рот|отвали|исчезни)(?!\p{L})/iu,
  /^(?:дурак|идиот|тупой|урод|мразь|тварь|олух|заткнись)[!.?\s]*$/iu,
  // English
  /(?<!\p{L})you\s+(?:are\s+)?(?:a\s+|an\s+)?(?:stupid|idiot|fool|moron|bastard|jerk|useless|ugly|dumb|piece\s+of\s+trash)(?!\p{L})/iu,
  /(?<!\p{L})(?:shut\s+up|get\s+lost|piss\s+off|fuck\s+off|go\s+away)(?!\p{L})/iu,
  /^(?:stupid|idiot|fool|moron|shut\s+up)[!.?\s]*$/iu,
  // Spanish
  /(?<!\p{L})(?:(?:t[uú]|usted)\s+)?(?:eres\s+|es\s+)?(?:un\s+|una\s+)?(?:tonto|tonta|est[uú]pido|est[uú]pida|idiota|imb[eé]cil|in[uú]til)(?!\p{L})/iu,
  /(?<!\p{L})(?:c[aá]llate|vete\s+al\s+diablo|desaparece)(?!\p{L})/iu,
  /^(?:tonto|est[uú]pido|idiota|imb[eé]cil|c[aá]llate)[!.?\s]*$/iu,
];

const APOLOGY_PATTERNS = [
  // Russian
  /(?<!\p{L})(?:извини(?:те)?|прости(?:те)?|прошу\s+прощения|сожалею|виноват)(?!\p{L})/iu,
  // English
  /(?<!\p{L})(?:i\s+am\s+sorry|i'?m\s+sorry|sorry|i\s+apologize|my\s+apologies|forgive\s+me|pardon\s+me)(?!\p{L})/iu,
  // Spanish
  /(?<!\p{L})(?:lo\s+siento|disculpa(?:me)?|disculpe(?:me)?|perd[oó]n(?:ame)?|mis\s+disculpas)(?!\p{L})/iu,
];

export function classifyPlayerIntent(question: string): PlayerIntent {
  const trimmed = question.trim();
  if (!trimmed) return 'neutral';

  for (const pattern of QUOTE_PATTERNS) {
    if (pattern.test(trimmed)) return 'neutral';
  }

  for (const pattern of VOCABULARY_PATTERNS) {
    if (pattern.test(trimmed)) return 'neutral';
  }

  for (const pattern of THIRD_PARTY_PATTERNS) {
    if (pattern.test(trimmed)) return 'neutral';
  }

  for (const pattern of APOLOGY_PATTERNS) {
    if (pattern.test(trimmed)) return 'apology';
  }

  for (const pattern of DIRECT_INSULT_PATTERNS) {
    if (pattern.test(trimmed)) return 'insult';
  }

  return 'neutral';
}

export function transitionAttitude(
  current: NpcAttitude,
  intent: PlayerIntent | 'help_confirmed'
): NpcAttitude {
  if (intent === 'insult') {
    return 'displeased';
  }
  if (intent === 'apology') {
    if (current === 'displeased') {
      return 'ordinary';
    }
    return current;
  }
  if (intent === 'help_confirmed') {
    return 'friendly';
  }
  return current;
}
