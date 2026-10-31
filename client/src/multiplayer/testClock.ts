import type { Clock } from './NetworkAdapter';

/** Deterministic scheduler used only by tests. */
export class TestClock implements Clock {
  private time = 1000000;
  private next = 0;
  private readonly jobs = new Map<number, { time: number; callback(): void }>();
  now(): number { return this.time; }
  set(callback: () => void, delay: number): number { const id = ++this.next; this.jobs.set(id, { time: this.time + delay, callback }); return id; }
  clear(id: number): void { this.jobs.delete(id); }
  get pending(): number { return this.jobs.size; }
  advance(milliseconds: number): void {
    const target = this.time + milliseconds;
    for (let count = 0; count < 10000; count++) {
      const next = [...this.jobs].sort((a, b) => a[1].time - b[1].time)[0];
      if (!next || next[1].time > target) { this.time = target; return; }
      this.time = next[1].time; this.jobs.delete(next[0]); next[1].callback();
    }
    throw new Error('Runaway test scheduler');
  }
}
