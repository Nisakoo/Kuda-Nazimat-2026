import type { Entity } from '../core/types';
import { LocalSession } from './LocalSession';

export const MARKET_ITEMS = [
  { id: 'dates', name: 'Финики', seller: 'fruit-seller' },
  { id: 'red-fruit', name: 'Красные плоды', seller: 'fruit-seller' },
  { id: 'yellow-fruit', name: 'Жёлтые фрукты', seller: 'fruit-seller' },
  { id: 'water', name: 'Вода в кувшине', seller: 'potter' },
  { id: 'fabric', name: 'Бирюзовая ткань', seller: 'fabric-seller' },
] as const;
export type MarketItem = typeof MARKET_ITEMS[number]['id'];
export const MARKET_GOATS = [
  { id: 'white-goat', name: 'Белая коза', feature: 'Колокольчик на шее', food: 'dates', x: -5, z: -31 },
  { id: 'black-goat', name: 'Чёрная коза', feature: 'Длинные изогнутые рога', food: 'red-fruit', x: 4, z: -32 },
  { id: 'spotted-goat', name: 'Рыжая коза', feature: 'Пятнистая шерсть', food: 'yellow-fruit', x: -4, z: -37 },
  { id: 'kid-goat', name: 'Светло-серый козлёнок', feature: 'Маленький, без рогов', food: 'water', x: 4, z: -37 },
] as const;
export const MARKET_PEOPLE = [
  { id: 'fruit-seller', name: 'Торговец фруктами', x: -4.5, z: .5 },
  { id: 'fabric-seller', name: 'Торговка тканями', x: -3, z: -5.2 },
  { id: 'potter', name: 'Гончар', x: 4.6, z: -.5 },
  { id: 'shepherd', name: 'Пастух', x: -3, z: -26 },
] as const;
export type StonePoint = readonly [number, number];
export type Stone = readonly (readonly StonePoint[])[];
const copyStone = (stone: Stone): Stone => stone.map(stroke => stroke.map(point => [point[0], point[1]] as const));
export interface Word { readonly id: number; readonly word: string; readonly translation: string; readonly note: string }
let nextRun = 0;
export interface MarketState {
  readonly runId: number;
  readonly inventory: Readonly<Record<MarketItem, number>>;
  readonly selected: MarketItem | null;
  readonly fed: readonly string[];
  readonly completed: boolean;
  readonly seconds: number;
  readonly stones: readonly Stone[];
  readonly words: readonly Word[];
  readonly wordsAdded: number;
  readonly notice: string | null;
}
const actors: Entity[] = [...MARKET_PEOPLE, ...MARKET_GOATS].map(actor => ({
  id: actor.id, character: { kind: 'npc', name: actor.name },
  transform: { position: { x: actor.x, y: 0, z: actor.z }, rotationY: 0 },
  interactable: { radius: 2.7, label: 'Взаимодействовать' },
  // Their animated GLB visuals belong to streamed chunks, not persistent entities.
}));

/** Local UI/scenario fixture only. Never used by OnlineSession or persisted as server progress. */
export class MarketSession extends LocalSession {
  private readonly runId = ++nextRun;
  private inventory: Record<MarketItem, number> = { dates: 0, 'red-fruit': 0, 'yellow-fruit': 0, water: 0, fabric: 0 };
  private selected: MarketItem | null = null;
  private fed = new Set<string>();
  private seconds = 0;
  private started = false;
  private stones: Stone[] = [];
  private words: Word[] = [];
  private nextWord = 0;
  private notice: string | null = null;
  constructor() { super('local-player', [
    { id: 'local-player', character: { kind: 'player', name: 'Путник' }, transform: { position: { x: 0, y: 0, z: 8 }, rotationY: Math.PI }, movement: { direction: { x: 0, z: 0 }, speed: 3 }, renderable: { assetId: 'demo-player' }, animationState: { name: 'idle' } }, ...actors,
  ]); }
  beginTour(): void { this.started = true; }
  override update(delta: number): void { super.update(delta); if (this.started && this.fed.size < 4) this.seconds += delta; }
  get market(): MarketState { return { runId: this.runId, inventory: { ...this.inventory }, selected: this.selected, fed: [...this.fed], completed: this.fed.size === 4, seconds: Math.floor(this.seconds), stones: this.stones.map(copyStone), words: this.words.map(word => ({ ...word })), wordsAdded: this.nextWord, notice: this.notice }; }
  private near(id: string): boolean {
    const entities = this.getSnapshot().entities;
    const player = entities.find(e => e.id === this.playerId)?.transform?.position;
    const target = entities.find(e => e.id === id);
    const position = target?.transform?.position;
    return Boolean(player && position && target?.interactable && Math.hypot(player.x - position.x, player.z - position.z) <= target.interactable.radius);
  }
  buy(seller: string, id: MarketItem): void {
    const item = MARKET_ITEMS.find(item => item.id === id && item.seller === seller);
    if (!item || !this.near(seller)) { this.notice = 'Подойдите к нужному торговцу.'; return; }
    if (this.inventory[id] >= 8) { this.notice = 'В демо можно взять до 8 одинаковых предметов.'; return; }
    this.inventory[id]++; this.selected = id; this.notice = `${item.name} добавлены в локальный инвентарь.`;
  }
  select(id: MarketItem): void { if (this.inventory[id] > 0) { this.selected = id; this.notice = `Выбрано: ${MARKET_ITEMS.find(item => item.id === id)!.name}.`; } }
  feed(id: string): void {
    const goat = MARKET_GOATS.find(goat => goat.id === id);
    if (!goat || !this.near(id)) { this.notice = 'Подойдите к козе.'; return; }
    if (this.fed.has(id)) { this.notice = 'Эта коза уже накормлена.'; return; }
    if (!this.selected || !this.inventory[this.selected]) { this.notice = 'Сначала выберите предмет в инвентаре.'; return; }
    if (this.selected !== goat.food) { this.notice = 'Коза отказалась. Предмет остался у вас, штрафа нет.'; return; }
    this.inventory[this.selected]--; this.fed.add(id);
    if (this.inventory[this.selected] === 0) this.selected = null;
    this.notice = this.fed.size === 4 ? 'Спасибо! Все четыре козы накормлены. Локальный маршрут завершён.' : `${goat.name} поела. Накормлено ${this.fed.size} из 4.`;
  }
  carve(stone: Stone): boolean {
    const points = stone.reduce((count, stroke) => count + stroke.length, 0);
    if (this.stones.length >= 8 || !stone.length || stone.length > 64 || points === 0 || points > 4096 || stone.some(stroke => !stroke.length || stroke.length > 256 || stroke.some(point => point.length !== 2 || point.some(n => !Number.isFinite(n) || n < 0 || n > 320)))) { this.notice = 'Лимит демо: 8 камней, 64 штриха и 4096 точек на камень.'; return false; }
    this.stones.push(copyStone(stone)); this.notice = 'Камень высечен в локальной истории.'; return true;
  }
  saveWord(word: string, translation: string, note: string, id?: number): boolean {
    const value = { word: word.trim().slice(0, 80), translation: translation.trim().slice(0, 160), note: note.trim().slice(0, 240) };
    if (!value.word || !value.translation) return false;
    if (id !== undefined) { const index = this.words.findIndex(word => word.id === id); if (index < 0) return false; this.words[index] = { ...value, id }; }
    else { if (this.words.length >= 64) return false; this.words.push({ ...value, id: ++this.nextWord }); }
    return true;
  }
  removeWord(id: number): void { this.words = this.words.filter(word => word.id !== id); }
}
