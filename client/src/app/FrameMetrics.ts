interface Sample { readonly at: number; readonly interval: number; readonly cpu: number; readonly submitted: boolean }
/** Bounded CPU cadence and actual submissions; never GPU display timing. */
export class FrameMetrics {
  private last: number | null = null;
  private lastSubmitted: number | null = null;
  private samples: Sample[] = [];
  private frames: { at: number; interval: number }[] = [];
  record(now: number, renderMs: number, submitted = true): void {
    if (this.last !== null && now > this.last) {
      this.samples.push({ at: now, interval: now - this.last, cpu: renderMs, submitted });
      if (this.samples.length > 600) this.samples.shift();
    }
    if (submitted) {
      if (this.lastSubmitted !== null && now > this.lastSubmitted) this.frames.push({ at: now, interval: now - this.lastSubmitted });
      this.lastSubmitted = now;
    }
    const first = this.samples[0]?.at ?? now;
    while (this.frames.length && this.frames[0]!.at < first) this.frames.shift();
    this.last = now;
  }
  reset(): void { this.last = this.lastSubmitted = null; this.samples = []; this.frames = []; }
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
