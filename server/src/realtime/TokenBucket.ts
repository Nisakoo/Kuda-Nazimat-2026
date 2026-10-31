import type { Clock } from '../common/time.ts';

/** Rate limit: `ratePerSecond` refill, at most `burst` tokens. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly clock: Clock;
  private readonly ratePerSecond: number;
  private readonly burst: number;

  constructor(clock: Clock, ratePerSecond: number, burst: number) {
    this.clock = clock; this.ratePerSecond = ratePerSecond; this.burst = burst;
    this.tokens = burst;
    this.last = clock.now();
  }

  take(): boolean {
    const now = this.clock.now();
    this.tokens = Math.min(this.burst, this.tokens + (now - this.last) / 1000 * this.ratePerSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
