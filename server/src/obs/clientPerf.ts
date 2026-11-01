import type { Clock } from '../common/time.ts';

export interface ClientPerf { readonly fps: number | null; readonly frameMs: number | null; readonly drawCalls: number | null; readonly map: string | null; readonly ageMs: number }

const STALE_MS = 30_000;

/** OBS-014: the last accepted `perf` report per player, in memory; older than 30 s counts as no data. */
export class ClientPerfStore {
  private readonly reports = new Map<string, Omit<ClientPerf, 'ageMs'> & { at: number }>();
  private readonly clock: Clock;
  constructor(clock: Clock) { this.clock = clock; }

  record(playerId: string, report: { fps?: unknown; frameMs?: unknown; drawCalls?: unknown; map?: unknown }): void {
    const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
    if (this.reports.size > 1000) this.prune();
    this.reports.set(playerId, { fps: number(report.fps), frameMs: number(report.frameMs), drawCalls: number(report.drawCalls), map: typeof report.map === 'string' ? report.map : null, at: this.clock.now() });
  }

  latest(playerId: string): ClientPerf | null {
    const report = this.reports.get(playerId);
    const ageMs = report ? this.clock.now() - report.at : Infinity;
    if (!report || ageMs > STALE_MS) return null;
    const { at: _at, ...values } = report;
    return { ...values, ageMs };
  }

  private prune(): void { const now = this.clock.now(); for (const [id, report] of this.reports) if (now - report.at > STALE_MS) this.reports.delete(id); }
}
