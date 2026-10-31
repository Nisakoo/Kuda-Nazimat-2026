export interface FrameScheduler {
  request(callback: (timestampMs: number) => void): number;
  cancel(id: number): void;
}

export interface LoopCallbacks {
  /** Input is sampled and commands are formed before each simulation step. */
  beforeUpdate?(): void;
  update(deltaSeconds: number): void;
  /** Schedule map work without awaiting asynchronous loads inside a frame. */
  afterUpdate?(): void;
  render(alpha: number, elapsedSeconds: number): void;
  onError(error: unknown): void;
}

export interface LoopOptions {
  readonly stepSeconds?: number;
  readonly maxFrameSeconds?: number;
  readonly maxStepsPerFrame?: number;
}

/** Headless fixed-step loop; the browser scheduler is supplied by GameApp. */
export class GameLoop {
  private readonly stepSeconds: number;
  private readonly maxFrameSeconds: number;
  private readonly maxStepsPerFrame: number;
  private frameId: number | null = null;
  private lastTime: number | null = null;
  private accumulator = 0;
  private elapsed = 0;
  private running = false;
  private suspended = false;
  private disposed = false;

  constructor(
    private readonly scheduler: FrameScheduler,
    private readonly callbacks: LoopCallbacks,
    options: LoopOptions = {},
  ) {
    this.stepSeconds = options.stepSeconds ?? 1 / 60;
    this.maxFrameSeconds = options.maxFrameSeconds ?? 0.1;
    this.maxStepsPerFrame = options.maxStepsPerFrame ?? 5;
    if (!Number.isFinite(this.stepSeconds) || this.stepSeconds <= 0 ||
        !Number.isFinite(this.maxFrameSeconds) || this.maxFrameSeconds <= 0 ||
        !Number.isSafeInteger(this.maxStepsPerFrame) || this.maxStepsPerFrame <= 0) {
      throw new Error('Invalid GameLoop limits.');
    }
  }

  start(): void {
    if (this.disposed) throw new Error('GameLoop is disposed.');
    if (this.running) return;
    this.running = true;
    this.resetClock();
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.cancel();
    this.resetClock();
  }

  setSuspended(suspended: boolean): void {
    if (this.disposed || this.suspended === suspended) return;
    this.suspended = suspended;
    this.cancel();
    this.resetClock();
    this.schedule();
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
  }

  private readonly frame = (timestampMs: number): void => {
    this.frameId = null;
    if (!this.running || this.suspended || this.disposed) return;
    try {
      if (!Number.isFinite(timestampMs)) throw new Error('Frame timestamp must be finite.');
      const delta = this.lastTime === null ? 0
        : Math.min(Math.max(0, (timestampMs - this.lastTime) / 1000), this.maxFrameSeconds);
      this.lastTime = Math.max(this.lastTime ?? timestampMs, timestampMs);
      this.elapsed += delta;
      this.accumulator += delta;
      let steps = 0;
      while (this.accumulator + Number.EPSILON >= this.stepSeconds && steps < this.maxStepsPerFrame) {
        this.callbacks.beforeUpdate?.();
        if (!this.running || this.suspended || this.disposed) return;
        this.callbacks.update(this.stepSeconds);
        if (!this.running || this.suspended || this.disposed) return;
        this.callbacks.afterUpdate?.();
        this.accumulator = Math.max(0, this.accumulator - this.stepSeconds);
        steps++;
        if (!this.running || this.suspended || this.disposed) return;
      }
      // Drop excess full steps instead of repaying a long pause in future frames.
      this.accumulator %= this.stepSeconds;
      this.callbacks.render(this.accumulator / this.stepSeconds, this.elapsed);
      this.schedule();
    } catch (error) {
      this.stop();
      this.callbacks.onError(error);
    }
  };

  private schedule(): void {
    if (this.running && !this.suspended && !this.disposed && this.frameId === null) {
      this.frameId = this.scheduler.request(this.frame);
    }
  }

  private cancel(): void {
    if (this.frameId !== null) this.scheduler.cancel(this.frameId);
    this.frameId = null;
  }

  private resetClock(): void {
    this.lastTime = null;
    this.accumulator = 0;
  }
}
