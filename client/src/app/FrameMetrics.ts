/** Bounded frame samples; no clock, engine or UI dependencies. */
export class FrameMetrics {
  private last: number | null = null;
  private intervals: number[] = [];
  private rendering: number[] = [];
  record(now: number, renderMs: number): void {
    if (this.last !== null && now > this.last) {
      this.intervals.push(now - this.last); this.rendering.push(renderMs);
      if (this.intervals.length > 600) { this.intervals.shift(); this.rendering.shift(); }
    }
    this.last = now;
  }
  reset(): void { this.last = null; this.intervals = []; this.rendering = []; }
  get stats() {
    const count = this.intervals.length;
    const average = count ? this.intervals.reduce((sum, n) => sum + n, 0) / count : 0;
    const sorted = [...this.intervals].sort((a, b) => a - b);
    return { fps: average ? 1000 / average : 0, frameMs: average, p95: sorted[Math.max(0, Math.ceil(count * 0.95) - 1)] ?? 0, renderMs: count ? this.rendering.reduce((sum, n) => sum + n, 0) / count : 0 };
  }
}
