/** Wall clock in Unix ms; injected so services and tests control time. */
export interface Clock { now(): number }

export type TimerHandle = { readonly __timer: unique symbol };
/** One-shot timers; the only scheduling services need. */
export interface Scheduler {
  setTimeout(callback: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export const systemClock: Clock = { now: () => Date.now() };
export const systemScheduler: Scheduler = {
  setTimeout: (callback, ms) => setTimeout(callback, ms) as unknown as TimerHandle,
  clearTimeout: (handle) => clearTimeout(handle as unknown as NodeJS.Timeout),
};
