/**
 * Player fact extraction:
 * "Рассказ игрока можно запомнить только как «игрок сказал», но не как доказанный факт мира или знания NPC."
 */
export function extractPlayerFact(question: string): string | null {
  const trimmed = question.trim();
  if (!trimmed || trimmed.length > 500) return null;

  // Name
  const nameMatch = /(?:меня\s+зовут|my\s+name\s+is|me\s+llamo)\s+([A-Za-zА-Яа-яЁё]+)/iu.exec(trimmed);
  if (nameMatch) {
    return `Traveler said their name is ${nameMatch[1]}`;
  }
  // Origin
  const originMatch = /(?:я\s+из|я\s+пришел\s+из|i\s+am\s+from|i\s+come\s+from|vengo\s+de|soy\s+de)\s+([A-Za-zА-Яа-яЁё\s]{2,30})/iu.exec(trimmed);
  if (originMatch) {
    return `Traveler said they come from ${originMatch[1].trim()}`;
  }
  // Seeking
  const seekMatch = /(?:я\s+ищу|i\s+am\s+looking\s+for|i\s+seek|busco)\s+([A-Za-zА-Яа-яЁё\s]{2,30})/iu.exec(trimmed);
  if (seekMatch) {
    return `Traveler said they are looking for ${seekMatch[1].trim()}`;
  }
  return null;
}
