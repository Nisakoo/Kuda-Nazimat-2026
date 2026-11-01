/** Injected wall clock in Unix ms, plus elapsed time unaffected by wall-clock changes. */
export interface Clock { now(): number; monotonicNow?(): number }

export type TimerHandle = { readonly __timer: unique symbol };
/** One-shot timers; the only scheduling services need. */
export interface Scheduler {
  setTimeout(callback: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export const systemClock: Clock = { now: () => Date.now(), monotonicNow: () => performance.now() };
export const systemScheduler: Scheduler = {
  setTimeout: (callback, ms) => setTimeout(callback, ms) as unknown as TimerHandle,
  clearTimeout: (handle) => clearTimeout(handle as unknown as NodeJS.Timeout),
};
