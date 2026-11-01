import type { PlayerPresence } from '../contracts.ts';

/** OBS-010 inputs, collected by the composition root; every value may be missing early after start. */
export interface HealthInputs {
  readonly tickP95Ms: number | null; readonly broadcastP95Ms: number | null; readonly eventLoopP99Ms: number | null;
  readonly npcReady: boolean; readonly languageReady: boolean;
  /** Share of NPC/language requests that timed out in the last 5 minutes, null without requests. */
  readonly timeoutShare: number | null;
  readonly dbErrors5m: number; readonly logDropped5m: number;
  readonly diskFreeBytes: number | null;
  readonly players: readonly PlayerPresence[];
}
export type HealthLevel = 'green' | 'yellow' | 'red';
export interface Health { readonly level: HealthLevel; readonly reasons: readonly { readonly level: Exclude<HealthLevel, 'green'>; readonly text: string }[] }

const GB = 1024 ** 3;

/** Pure rules of OBS-010; thresholds come from the spec and are tuned after OFFLINE-017 measurements. */
export function evaluateHealth(input: HealthInputs): Health {
  const reasons: { level: 'yellow' | 'red'; text: string }[] = [];
  const add = (level: 'yellow' | 'red', text: string) => reasons.push({ level, text });
  if (input.tickP95Ms !== null && input.tickP95Ms > 20) add('red', `Сервер не успевает считать мир (шаг ${input.tickP95Ms} мс)`);
  else if (input.tickP95Ms !== null && input.tickP95Ms > 5) add('yellow', `Сервер считает мир медленнее нормы (шаг ${input.tickP95Ms} мс)`);
  if (input.broadcastP95Ms !== null && input.broadcastP95Ms > 120) add('yellow', `Обновления игрокам идут с задержкой (${Math.round(input.broadcastP95Ms)} мс)`);
  if (input.eventLoopP99Ms !== null && input.eventLoopP99Ms > 50) add('yellow', `Сервер перегружен (задержка ${input.eventLoopP99Ms} мс)`);
  if (!input.npcReady) add('yellow', 'Персонажи (NPC) недоступны');
  if (!input.languageReady) add('yellow', 'Переводчик недоступен');
  if (input.timeoutShare !== null && input.timeoutShare > 0.25) add('yellow', `NPC часто не успевают ответить (${Math.round(input.timeoutShare * 100)}% за 5 мин)`);
  if (input.dbErrors5m > 0) add('red', 'Ошибки записи в базу данных — прогресс может не сохраняться');
  if (input.diskFreeBytes !== null && input.diskFreeBytes < 0.2 * GB) add('red', 'На диске почти нет места');
  else if (input.diskFreeBytes !== null && input.diskFreeBytes < GB) add('yellow', 'На диске меньше 1 ГБ свободного места');
  if (input.logDropped5m > 0) add('yellow', 'Часть журнала не записана');
  for (const player of input.players) if (player.reconnects >= 3) add('yellow', `Нестабильная связь у игрока ${player.name} (${player.reconnects} переподключения за 10 мин)`);
  return { level: reasons.some((r) => r.level === 'red') ? 'red' : reasons.length ? 'yellow' : 'green', reasons };
}

/** Five-minute deltas of monotonic counters, sampled periodically. */
export class CounterWindow {
  private readonly samples: { at: number; values: Record<string, number> }[] = [];
  private readonly windowMs: number;
  constructor(windowMs = 5 * 60_000) { this.windowMs = windowMs; }
  sample(at: number, values: Record<string, number>): void {
    this.samples.push({ at, values });
    while (this.samples.length > 1 && at - this.samples[1]!.at >= this.windowMs) this.samples.shift();
  }
  delta(name: string): number {
    const first = this.samples[0]; const last = this.samples.at(-1);
    return first && last ? (last.values[name] ?? 0) - (first.values[name] ?? 0) : 0;
  }
}
