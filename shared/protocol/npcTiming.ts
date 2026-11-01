/** Public NPC timing only. No model/runtime paths or server options cross this boundary. */
export const NPC_TIMING = { defaultMs: 30000, minMs: 1, maxMs: 300000, deliveryGraceMs: 2000 } as const;
export interface GameRuntimeConfig { readonly npcTimeoutMs: number }

export function validNpcTimeoutMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= NPC_TIMING.minMs && value <= NPC_TIMING.maxMs;
}
export function npcRequestWaitMs(timeoutMs: number): number {
  if (!validNpcTimeoutMs(timeoutMs)) throw new Error('Invalid NPC timeout');
  return timeoutMs + NPC_TIMING.deliveryGraceMs;
}
export function parseGameRuntimeConfig(raw: unknown): GameRuntimeConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid runtime configuration');
  const value = raw as Record<string, unknown>;
  if (Reflect.ownKeys(value).length !== 1 || !Object.hasOwn(value, 'npcTimeoutMs') || !validNpcTimeoutMs(value.npcTimeoutMs)) {
    throw new Error('Invalid runtime configuration');
  }
  return Object.freeze({ npcTimeoutMs: value.npcTimeoutMs });
}
