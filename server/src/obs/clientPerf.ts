/** A `perf` report as accepted by OBS-011, with the server receipt time. */
export interface PerfReport { readonly fps: number; readonly visible: boolean; readonly frameMs?: number; readonly drawCalls?: number }
export interface PerfView { readonly fps: number | null; readonly frameMs: number | null; readonly drawCalls: number | null; readonly visible: boolean | null; readonly reportAgeSeconds: number | null }

/** Visible-tab values older than this are «нет данных» (OBS-010). */
export const PERF_STALE_MS = 30_000;
const NONE: PerfView = { fps: null, frameMs: null, drawCalls: null, visible: null, reportAgeSeconds: null };

/**
 * Last client report per player (OBS-010/011). A hidden tab updates only `visible` and the receipt time,
 * so its FPS never reaches thresholds or charts. Players without a seat are pruned by the caller.
 */
export class ClientPerf {
  private readonly last = new Map<string, { at: number; visible: boolean; shown?: { at: number; report: PerfReport } }>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }

  record(playerId: string, report: PerfReport): void {
    const at = this.now(); const previous = this.last.get(playerId);
    this.last.set(playerId, { at, visible: report.visible, ...(report.visible ? { shown: { at, report } } : previous?.shown ? { shown: previous.shown } : {}) });
  }

  view(playerId: string): PerfView {
    const entry = this.last.get(playerId); if (!entry) return NONE;
    const now = this.now();
    const fresh = entry.visible && entry.shown && now - entry.shown.at <= PERF_STALE_MS ? entry.shown.report : null;
    return { fps: fresh?.fps ?? null, frameMs: fresh?.frameMs ?? null, drawCalls: fresh?.drawCalls ?? null, visible: entry.visible, reportAgeSeconds: Math.floor((now - entry.at) / 1000) };
  }

  /** Drops reports of players who left their seat («до отключения»). */
  retain(playerIds: ReadonlySet<string>): void { for (const id of this.last.keys()) if (!playerIds.has(id)) this.last.delete(id); }
}
