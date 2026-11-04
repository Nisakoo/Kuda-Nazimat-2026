interface TimerExtension { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
type TimerGl = Pick<WebGL2RenderingContext, 'QUERY_RESULT_AVAILABLE' | 'QUERY_RESULT' | 'getParameter' | 'createQuery' | 'deleteQuery' | 'beginQuery' | 'endQuery' | 'getQueryParameter'> & { getExtension(name: string): unknown };

/** Optional GPU elapsed time. Never waits, and never substitutes CPU/fence time. */
export class GpuTimer {
  private extension: TimerExtension | null;
  private pending: { query: WebGLQuery; accept: (ms: number) => void }[] = [];
  private active: WebGLQuery | null = null;
  private lost = false;
  private disposed = false;
  private rejected = 0;
  constructor(private readonly gl: TimerGl) { this.extension = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null; }
  get stats() { return { status: this.disposed ? 'disposed' : this.lost ? 'context-lost' : this.extension ? 'available' : 'unavailable', queries: this.pending.length + Number(!!this.active), rejected: this.rejected }; }
  poll(): void {
    if (!this.extension || this.lost || this.disposed) return;
    if (this.gl.getParameter(this.extension.GPU_DISJOINT_EXT)) { this.rejected += this.pending.length; this.clear(); return; }
    // Availability is checked before reading a result, including when a later query is ready first.
    this.pending = this.pending.filter(item => {
      if (!this.gl.getQueryParameter(item.query, this.gl.QUERY_RESULT_AVAILABLE)) return true;
      const ns: unknown = this.gl.getQueryParameter(item.query, this.gl.QUERY_RESULT);
      this.gl.deleteQuery(item.query);
      if (typeof ns === 'number' && Number.isFinite(ns) && ns > 0) item.accept(ns / 1e6);
      else this.rejected++;
      return false;
    });
  }
  begin(): void {
    if (!this.extension || this.lost || this.disposed || this.active || this.pending.length >= 4) return;
    if (this.gl.getParameter(this.extension.GPU_DISJOINT_EXT)) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query); this.active = query;
  }
  end(accept: (ms: number) => void): void {
    if (!this.active || !this.extension) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push({ query: this.active, accept }); this.active = null;
  }
  contextLost(): void { this.lost = true; this.clear(); }
  contextRestored(): void { if (!this.disposed) { this.extension = this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null; this.lost = false; } }
  dispose(): void { if (!this.disposed) { this.clear(); this.disposed = true; } }
  private clear(): void {
    if (this.active) {
      if (!this.lost && this.extension) this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
      this.gl.deleteQuery(this.active); this.active = null;
    }
    for (const item of this.pending) this.gl.deleteQuery(item.query);
    this.pending = [];
  }
}
