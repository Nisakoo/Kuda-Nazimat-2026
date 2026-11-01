import type { Clock } from '../common/time.ts';

/** Fixed window counter per key; old keys are dropped lazily so memory stays bounded by active keys. */
export class WindowLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private readonly clock: Clock;
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(clock: Clock, limit: number, windowMs: number) { this.clock = clock; this.limit = limit; this.windowMs = windowMs; }

  /** Counts one hit; returns seconds to wait when over the limit, otherwise 0. */
  hit(key: string): number {
    const now = this.clock.now();
    if (this.windows.size > 10_000) for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
    let window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) { window = { start: now, count: 0 }; this.windows.set(key, window); }
    window.count++;
    return window.count > this.limit ? Math.ceil((window.start + this.windowMs - now) / 1000) : 0;
  }
}

/**
 * AUTH-013 per-name protection: `failures` failed attempts within `windowMs` lock the name for `lockMs`;
 * a second lock within `repeatWindowMs` lasts `repeatLockMs`. Success clears the failures.
 */
export class LoginLockout {
  private readonly state = new Map<string, { failures: number[]; lockedUntil: number; lastLockAt: number }>();
  private readonly clock: Clock;
  private readonly options: { failures: number; windowMs: number; lockMs: number; repeatWindowMs: number; repeatLockMs: number };
  constructor(clock: Clock, options = { failures: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000, repeatWindowMs: 60 * 60_000, repeatLockMs: 60 * 60_000 }) { this.clock = clock; this.options = options; }

  /** Seconds until the name may try again, 0 when it may. */
  retryAfter(key: string): number {
    const entry = this.state.get(key);
    const left = entry ? entry.lockedUntil - this.clock.now() : 0;
    return left > 0 ? Math.ceil(left / 1000) : 0;
  }

  /** Records a failure; returns true when this failure locked the name. */
  fail(key: string): boolean {
    const now = this.clock.now();
    const entry = this.state.get(key) ?? { failures: [], lockedUntil: 0, lastLockAt: -Infinity };
    entry.failures = entry.failures.filter((time) => now - time < this.options.windowMs);
    entry.failures.push(now);
    this.state.set(key, entry);
    if (entry.failures.length < this.options.failures) return false;
    const repeated = now - entry.lastLockAt < this.options.repeatWindowMs;
    entry.lockedUntil = now + (repeated ? this.options.repeatLockMs : this.options.lockMs);
    entry.lastLockAt = now; entry.failures = [];
    return true;
  }

  succeed(key: string): void { this.state.delete(key); }
  unlock(key: string): boolean { return this.state.delete(key); }
}
