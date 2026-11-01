import type { Scheduler, TimerHandle } from '../common/time.ts';

/**
 * PROTO-007: at most one npc-partial per interval for one question; the newest text replaces an unsent one,
 * an unchanged text is not resent and nothing leaves after stop(). seq starts at 1 and only grows.
 */
export class PartialThrottle {
  private seq = 0;
  private sent = '';
  private pending: string | null = null;
  private timer: TimerHandle | null = null;
  private stopped = false;
  private readonly scheduler: Scheduler;
  private readonly intervalMs: number;
  private readonly emit: (seq: number, text: string) => void;

  constructor(scheduler: Scheduler, intervalMs: number, emit: (seq: number, text: string) => void) {
    this.scheduler = scheduler; this.intervalMs = intervalMs; this.emit = emit;
  }

  push(text: string): void {
    if (this.stopped || text === this.sent) return;
    this.pending = text;
    if (!this.timer) this.flush();
  }

  stop(): void {
    this.stopped = true; this.pending = null;
    if (this.timer) { this.scheduler.clearTimeout(this.timer); this.timer = null; }
  }

  private flush(): void {
    this.timer = null;
    if (this.stopped || this.pending === null) return;
    this.sent = this.pending; this.pending = null;
    this.emit(++this.seq, this.sent);
    this.timer = this.scheduler.setTimeout(() => this.flush(), this.intervalMs);
  }
}
