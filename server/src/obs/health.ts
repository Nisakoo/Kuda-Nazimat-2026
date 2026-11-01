import type { PlayerPresence } from '../contracts.ts';
import { THRESHOLDS as T } from './thresholds.ts';

/** A seated player with the per-minute values OBS-010 judges; FPS is null without a fresh visible report. */
export type HealthPlayer = Pick<PlayerPresence, 'name' | 'reconnects' | 'rttMs'> & { readonly fps?: number | null };

/** OBS-010 inputs, taken from the history windows (OBS-013); every value may be missing early after start. */
export interface HealthInputs {
  readonly tickP95Ms: number | null; readonly broadcastP95Ms: number | null; readonly eventLoopP99Ms: number | null;
  readonly npcReady: boolean; readonly languageReady: boolean;
  /** Share of NPC/language requests that timed out in the last 5 minutes, null without requests. */
  readonly timeoutShare: number | null;
  readonly dbErrors5m: number; readonly logDropped5m: number;
  readonly diskFreeBytes: number | null;
  readonly players: readonly HealthPlayer[];
}
export type HealthLevel = 'green' | 'yellow' | 'red';
export interface Health { readonly level: HealthLevel; readonly reasons: readonly { readonly level: Exclude<HealthLevel, 'green'>; readonly text: string }[] }

const GB = 1024 ** 3;
const ms = (value: number): string => (value === Infinity ? 'выше шкалы' : `${Math.round(value * 10) / 10} мс`);

/** Pure rules of OBS-010; thresholds come from the shared table and are tuned after OFFLINE-017 measurements. */
export function evaluateHealth(input: HealthInputs): Health {
  const reasons: { level: 'yellow' | 'red'; text: string }[] = [];
  const add = (level: 'yellow' | 'red', text: string) => reasons.push({ level, text });
  if (input.tickP95Ms !== null && input.tickP95Ms > T.tickP95RedMs) add('red', `Сервер не успевает считать мир (шаг ${ms(input.tickP95Ms)})`);
  else if (input.tickP95Ms !== null && input.tickP95Ms > T.tickP95Ms) add('yellow', `Сервер считает мир медленнее нормы (шаг ${ms(input.tickP95Ms)})`);
  if (input.broadcastP95Ms !== null && input.broadcastP95Ms > T.broadcastP95Ms) add('yellow', `Обновления игрокам идут с задержкой (${ms(input.broadcastP95Ms)})`);
  if (input.eventLoopP99Ms !== null && input.eventLoopP99Ms > T.eventLoopP99Ms) add('yellow', `Сервер перегружен (задержка ${input.eventLoopP99Ms} мс)`);
  if (!input.npcReady) add('yellow', 'Персонажи (NPC) недоступны');
  if (!input.languageReady) add('yellow', 'Переводчик недоступен');
  if (input.timeoutShare !== null && input.timeoutShare > T.npcTimeoutShare) add('yellow', `NPC часто не успевают ответить (${Math.round(input.timeoutShare * 100)}% за 5 мин)`);
  if (input.dbErrors5m > 0) add('red', 'Ошибки записи в базу данных — прогресс может не сохраняться');
  if (input.diskFreeBytes !== null && input.diskFreeBytes < 0.2 * GB) add('red', 'На диске почти нет места');
  else if (input.diskFreeBytes !== null && input.diskFreeBytes < GB) add('yellow', 'На диске меньше 1 ГБ свободного места');
  if (input.logDropped5m > T.logDropped) add('yellow', 'Часть журнала не записана');
  for (const player of input.players) {
    if (player.reconnects >= 3) add('yellow', `Нестабильная связь у игрока ${player.name} (${player.reconnects} переподключения за 10 мин)`);
    if (player.rttMs !== null && player.rttMs > T.rttMs) add('yellow', `Медленная сеть у игрока ${player.name} (ping ${Math.round(player.rttMs)} мс)`);
    if (player.fps !== undefined && player.fps !== null && player.fps < T.fps) add('yellow', `У игрока ${player.name} тормозит картинка (${Math.round(player.fps)} FPS)`);
  }
  return { level: reasons.some((r) => r.level === 'red') ? 'red' : reasons.length ? 'yellow' : 'green', reasons };
}
