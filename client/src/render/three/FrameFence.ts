type FenceGl = Pick<WebGL2RenderingContext, 'ALREADY_SIGNALED' | 'CONDITION_SATISFIED' | 'TIMEOUT_EXPIRED' | 'SYNC_GPU_COMMANDS_COMPLETE' | 'clientWaitSync' | 'deleteSync' | 'fenceSync' | 'flush'>;

/** At most one submitted frame. Never wait for the GPU on the main thread. */
export class FrameFence {
  private fence: WebGLSync | null = null;
  private unavailable = false;
  private disposed = false;
  constructor(private readonly gl: FenceGl) {}
  get failed(): boolean { return this.unavailable && !this.disposed; }
  canSubmit(): boolean {
    if (this.unavailable || this.disposed) return false;
    if (!this.fence) return true;
    let status: number;
    try { status = this.gl.clientWaitSync(this.fence, 0, 0); }
    catch { this.clear(); this.unavailable = true; return false; }
    if (status === this.gl.TIMEOUT_EXPIRED) return false;
    this.clear();
    if (status === this.gl.ALREADY_SIGNALED || status === this.gl.CONDITION_SATISFIED) return true;
    this.unavailable = true; return false;
  }
  submitted(): void {
    if (this.unavailable || this.disposed || this.fence) throw new Error('Invalid GPU frame lifecycle');
    try {
      this.fence = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!this.fence) { this.unavailable = true; return; }
      this.gl.flush();
    } catch { this.clear(); this.unavailable = true; }
  }
  contextLost(): void { this.clear(); this.unavailable = true; }
  contextRestored(): void { if (!this.disposed) { this.clear(); this.unavailable = false; } }
  dispose(): void { if (!this.disposed) { this.clear(); this.disposed = true; } }
  private clear(): void { const fence = this.fence; this.fence = null; if (fence) { try { this.gl.deleteSync(fence); } catch { /* Context loss can invalidate the handle. */ } } }
}
