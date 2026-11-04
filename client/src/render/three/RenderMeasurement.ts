import { GpuTimer } from './GpuTimer';

export interface RenderSample {
  readonly at: number;
  submitted: boolean;
  cpu: Record<string, number>;
  calls: number;
  triangles: number;
  gpuMs: number | null;
  shadowEnabled: boolean;
  cpuShadowMs: number | null;
  shadowCalls: number | null;
  shadowTriangles: number | null;
  gpuShadowMs: number | null;
  gpuMainMs: number | null;
}

/** Opt-in, bounded capture, owned by a single renderer. No engine objects escape. */
export class RenderMeasurement {
  readonly gpu: GpuTimer;
  private samples: RenderSample[] = [];
  private current: RenderSample | null = null;
  private last = 0;
  private dropped = 0;
  constructor(gl: ConstructorParameters<typeof GpuTimer>[0], readonly passes = false) { this.gpu = new GpuTimer(gl); }
  begin(): void {
    this.gpu.poll();
    this.last = performance.now();
    this.current = { at: this.last, submitted: false, cpu: {}, calls: 0, triangles: 0, gpuMs: null,
      shadowEnabled: false, cpuShadowMs: null, shadowCalls: null, shadowTriangles: null, gpuShadowMs: null, gpuMainMs: null };
  }
  startGpu(): void { if (!this.passes) this.gpu.begin(); }
  beginShadow(enabled: boolean): void {
    if (!this.current) return;
    this.current.shadowEnabled = enabled;
    if (this.passes && enabled) this.gpu.begin();
  }
  endShadow(cpuMs: number, calls: number, triangles: number): void {
    const sample = this.current;
    if (!sample) return;
    sample.cpuShadowMs = cpuMs; sample.shadowCalls = calls; sample.shadowTriangles = triangles;
    if (this.passes) {
      if (sample.shadowEnabled) this.gpu.end(ms => { if (sample.submitted) sample.gpuShadowMs = ms; });
      this.gpu.begin();
    }
  }
  phase(name: string): void {
    const now = performance.now();
    if (this.current) this.current.cpu[name] = now - this.last;
    this.last = now;
  }
  finish(submitted: boolean, calls = 0, triangles = 0): void {
    const sample = this.current;
    if (!sample) return;
    sample.submitted = submitted; sample.calls = calls; sample.triangles = triangles;
    this.gpu.end(ms => { if (submitted) { if (this.passes) sample.gpuMainMs = ms; else sample.gpuMs = ms; } });
    // Keep the original recording intact when full; do not shift on every frame.
    if (this.samples.length < 12000) this.samples.push(sample); else this.dropped++;
    this.current = null;
  }
  read() { return { scope: this.passes ? 'shadow-and-main-excluding-preparation' : 'whole-render', samples: this.samples.map(sample => ({ ...sample, cpu: { ...sample.cpu } })), dropped: this.dropped, gpu: this.gpu.stats }; }
  dispose(): void { this.gpu.dispose(); this.samples = []; this.current = null; }
}
