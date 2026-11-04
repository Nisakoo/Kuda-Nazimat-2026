interface Sample { readonly at: number; readonly interval: number; readonly cpu: number; readonly submitted: boolean }
export interface FrameRatePoint { readonly at: number; readonly fps: number }
/** Bounded CPU cadence and actual submissions; never GPU display timing. */
export class FrameMetrics {
  private last: number | null = null;
  private lastSubmitted: number | null = null;
  private samples: Sample[] = [];
  private frames: { at: number; interval: number }[] = [];
  private rateHistory: FrameRatePoint[] = [];
  private bucketStart: number | null = null;
  private bucketSubmitted = 0;
  record(now: number, renderMs: number, submitted = true): void {
    this.bucketStart ??= now;
    if (this.last !== null && now > this.last) {
      if (submitted) this.bucketSubmitted++;
      this.samples.push({ at: now, interval: now - this.last, cpu: renderMs, submitted });
      if (this.samples.length > 600) this.samples.shift();
    }
    const bucketMs = now - this.bucketStart;
    if (bucketMs >= 1000) {
      this.rateHistory.push({ at: now, fps: this.bucketSubmitted * 1000 / bucketMs });
      if (this.rateHistory.length > 60) this.rateHistory.shift();
      this.bucketStart = now; this.bucketSubmitted = 0;
    }
    while (this.rateHistory.length && this.rateHistory[0]!.at < now - 60000) this.rateHistory.shift();
    if (submitted) {
      if (this.lastSubmitted !== null && now > this.lastSubmitted) this.frames.push({ at: now, interval: now - this.lastSubmitted });
      this.lastSubmitted = now;
    }
    const first = this.samples[0]?.at ?? now;
    while (this.frames.length && this.frames[0]!.at < first) this.frames.shift();
    this.last = now;
  }
  get history(): readonly FrameRatePoint[] { return this.rateHistory.slice(); }
  reset(): void { this.last = this.lastSubmitted = this.bucketStart = null; this.samples = []; this.frames = []; this.rateHistory = []; this.bucketSubmitted = 0; }
  get stats() {
    const duration = this.samples.reduce((sum, s) => sum + s.interval, 0);
    const submitted = this.samples.filter(s => s.submitted).length;
    const sorted = this.frames.map(s => s.interval);
    const pending = (this.last ?? 0) - (this.lastSubmitted ?? this.last ?? 0);
    if (pending > 0) sorted.push(pending);
    sorted.sort((a, b) => a - b);
    return {
      fps: duration ? submitted * 1000 / duration : 0,
      loopFps: duration ? this.samples.length * 1000 / duration : 0,
      frameMs: submitted ? duration / submitted : 0,
      p95: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? 0,
      renderMs: this.samples.length ? this.samples.reduce((sum, s) => sum + s.cpu, 0) / this.samples.length : 0,
      skipped: this.samples.length - submitted,
    };
  }
}
