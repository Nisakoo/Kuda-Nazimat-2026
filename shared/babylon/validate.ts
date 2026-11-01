import type { BabylonAction, BabylonRequest, Language, PartySize, Stone, ItemId } from './types.ts';
const idPattern = /^[A-Za-z0-9_.:-]{1,128}$/;
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ожидается объект');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Неизвестное поле');
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(value) || (!empty && !value.trim())) throw new Error('Неверный текст');
  return value.trim();
}
function id(value: unknown): string { if (typeof value !== 'string' || !idPattern.test(value)) throw new Error('Неверный ID'); return value; }
export function language(value: unknown): Language { if (value !== 'ru' && value !== 'en' && value !== 'es') throw new Error('Неподдерживаемый язык'); return value; }
function pair(a: Record<string, unknown>) { const native = language(a.native), learning = language(a.learning); if (native === learning) throw new Error('Языки должны отличаться'); return { native, learning }; }
function item(value: unknown): ItemId { if (typeof value !== 'string' || !['dates', 'red-fruit', 'yellow-fruit', 'water', 'fabric'].includes(value)) throw new Error('Неизвестный предмет'); return value as ItemId; }
export function stone(value: unknown): Stone {
  if (!Array.isArray(value) || !value.length || value.length > 64) throw new Error('Лимит штрихов');
  let points = 0;
  return value.map(stroke => {
    if (!Array.isArray(stroke) || !stroke.length || stroke.length > 256) throw new Error('Лимит точек штриха');
    points += stroke.length; if (points > 4096) throw new Error('Лимит точек камня');
    return stroke.map(point => {
      if (!Array.isArray(point) || point.length !== 2 || point.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 320)) throw new Error('Неверная точка');
      return [point[0] as number, point[1] as number] as const;
    });
  });
}
export function parseBabylonRequest(value: unknown): BabylonRequest {
  const packet = record(value); keys(packet, ['v', 'requestId', 'action']);
  if (packet.v !== 2) throw new Error('Нужен BABEL v2');
  const requestId = id(packet.requestId), a = record(packet.action);
  let action: BabylonAction;
  switch (a.type) {
    case 'state': case 'intro-seen': keys(a, ['type']); action = { type: a.type }; break;
    case 'enroll':
      keys(a, ['type', 'size', 'native', 'learning']);
      if (![1, 2, 3, 4].includes(a.size as number)) throw new Error('Неверный режим');
      action = { type: 'enroll', size: a.size as PartySize, ...pair(a) }; break;
    case 'languages': keys(a, ['type', 'native', 'learning']); action = { type: 'languages', ...pair(a) }; break;
    case 'buy': case 'feed': keys(a, ['type', 'item', 'targetId']); action = { type: a.type, item: item(a.item), targetId: id(a.targetId) }; break;
    case 'carve': keys(a, ['type', 'drawing']); action = { type: 'carve', drawing: stone(a.drawing) }; break;
    case 'word-save':
      keys(a, ['type', 'id', 'word', 'translation', 'note', 'example', 'exampleTranslation']);
      action = { type: 'word-save', ...(a.id === undefined ? {} : { id: id(a.id) }), word: text(a.word, 200), translation: text(a.translation, 200), note: text(a.note, 500, true), ...(a.example === undefined ? {} : { example: text(a.example, 500, true) }), ...(a.exampleTranslation === undefined ? {} : { exampleTranslation: text(a.exampleTranslation, 500, true) }) }; break;
    case 'word-learn':
      keys(a, ['type', 'id', 'learned']); if (typeof a.learned !== 'boolean') throw new Error('Неверный флаг');
      action = { type: 'word-learn', id: id(a.id), learned: a.learned }; break;
    case 'word-delete': keys(a, ['type', 'id']); action = { type: 'word-delete', id: id(a.id) }; break;
    case 'suggest': keys(a, ['type', 'word']); action = { type: 'suggest', word: text(a.word, 200) }; break;
    case 'chat': keys(a, ['type', 'text']); action = { type: 'chat', text: text(a.text, 500) }; break;
    case 'npc': keys(a, ['type', 'targetId', 'text']); action = { type: 'npc', targetId: id(a.targetId), text: text(a.text, 500) }; break;
    default: throw new Error('Неизвестное действие');
  }
  return { v: 2, requestId, action };
}

/** Validate the server boundary before its state reaches UI code. */
export function parseBabylonResult(value: unknown): import('./types.ts').BabylonResult {
  const result = record(value), state = record(result.state);
  if (result.v !== 2 || state.v !== 2) throw new Error('Неверная версия ответа');
  id(result.requestId); id(state.playerId);
  const array = (value: unknown, max: number): unknown[] => { if (!Array.isArray(value) || value.length > max) throw new Error('Неверный список'); return value; };
  const number = (value: unknown, max = Number.MAX_SAFE_INTEGER) => { if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) throw new Error('Неверное число'); };
  const bool = (value: unknown) => { if (typeof value !== 'boolean') throw new Error('Неверный флаг'); };
  if (!['test', 'local'].includes(String(state.backend))) throw new Error('Неизвестный backend');
  array(state.languages, 3).forEach(language); bool(state.introSeen);
  if (state.profile !== null) pair(record(state.profile));
  const memberNames = new Map<string, string>();
  if (state.party !== null) {
    const p = record(state.party); id(p.id); number(p.size, 4); number(p.count, 4); number(p.role, 4); number(p.seconds); bool(p.started); bool(p.completed);
    for (const raw of array(p.members, 4)) { const m = record(raw); id(m.id); text(m.name, 32); number(m.role, 4); memberNames.set(m.id as string, m.name as string); }
  }
  const positionIds = new Set<string>();
  for (const raw of array(state.partyPositions, 4)) {
    const position = record(raw); keys(position, ['id', 'name', 'x', 'z']);
    const playerId = id(position.id); text(position.name, 32);
    if (playerId === state.playerId || positionIds.has(playerId) || !memberNames.has(state.playerId as string) || memberNames.get(playerId) !== position.name) throw new Error('Позиция не принадлежит участнику задания');
    for (const coordinate of [position.x, position.z]) if (typeof coordinate !== 'number' || !Number.isFinite(coordinate) || Math.abs(coordinate) > 1_000_000) throw new Error('Неверная позиция участника');
    positionIds.add(playerId);
  }
  if (state.availableParty !== null) { const p = record(state.availableParty); number(p.size, 4); number(p.count, 4); }
  text(state.task, 2000, true); text(state.taskTitle, 200, true); if (state.goatGuide !== null) text(state.goatGuide, 2000);
  if (state.taskTarget !== null) { const target = record(state.taskTarget); keys(target, ['x', 'z']); for (const coordinate of [target.x, target.z]) if (typeof coordinate !== 'number' || !Number.isFinite(coordinate) || Math.abs(coordinate) > 1000000) throw new Error('Неверная цель'); }
  const inventory = record(state.inventory); keys(inventory, ['dates', 'red-fruit', 'yellow-fruit', 'water', 'fabric']);
  for (const name of ['dates', 'red-fruit', 'yellow-fruit', 'water', 'fabric']) number(inventory[name], 8);
  array(state.fed, 4).forEach(id);
  for (const raw of array(state.words, 64)) { const w = record(raw); id(w.id); pair(w); text(w.word, 200); text(w.translation, 200); text(w.note, 500, true); bool(w.learned); text(w.example, 500, true); text(w.exampleTranslation, 500, true); }
  for (const raw of array(state.stones, 8)) { const s = record(raw); id(s.id); id(s.authorId); text(s.authorName, 32); number(s.createdAt); stone(s.drawing); }
  for (const raw of array(state.messages, 200)) {
    const m = record(raw); id(m.id); id(m.authorId); text(m.authorName, 32); text(m.text, 4000); language(m.language); bool(m.translated); number(m.createdAt);
    if (!['sent', 'translating', 'delivered', 'error'].includes(String(m.status))) throw new Error('Неверный статус');
    if (m.error !== undefined) text(m.error, 500);
  }
  for (const raw of array(state.replies, 50)) { const r = record(raw); id(r.id); id(r.npcId); text(r.question, 500); text(r.text, 4000); language(r.language); }
  if (result.notice !== undefined) text(result.notice, 500);
  if (result.suggestion !== undefined) text(result.suggestion, 200);
  return result as unknown as import('./types.ts').BabylonResult;
}
