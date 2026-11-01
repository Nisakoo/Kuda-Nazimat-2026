import type { Summary } from './history.ts';

/** The OBS thresholds table: one source for health (OBS-010), charts (OBS-014), the report (OBS-017) and the load profile. */
export const THRESHOLDS = {
  tickP95Ms: 5, tickP95RedMs: 20, broadcastP95Ms: 120, serverErrors: 0, rttMs: 150, fps: 30, npcTimeoutShare: 0.25, logDropped: 0, eventLoopP99Ms: 50,
} as const;

export type Verdict = 'ok' | 'over' | 'nodata';
export interface ReportRow { readonly label: string; readonly value: string; readonly threshold: string; readonly verdict: Verdict }
export interface ReportHeader { readonly runIds: readonly string[]; readonly env: string | null; readonly from: number | null; readonly to: number | null; readonly peakPlayers: number | null }

const number = (value: number, unit = ''): string => (value === Infinity ? 'выше шкалы' : `${Number.isInteger(value) ? value : value.toFixed(1)}${unit}`);
/** Missing data is never «в норме» (OBS-017). */
function row(label: string, value: number | null, threshold: string, ok: (v: number) => boolean, format: (v: number) => string): ReportRow {
  return value === null ? { label, value: 'нет данных', threshold, verdict: 'nodata' } : { label, value: format(value), threshold, verdict: ok(value) ? 'ok' : 'over' };
}

export function reportRows(s: Summary): ReportRow[] {
  const t = THRESHOLDS; const ms = (v: number) => number(v, ' мс');
  return [
    row('p95 шага сервера', s.tick.p95, `≤ ${t.tickP95Ms} мс`, (v) => v <= t.tickP95Ms, ms),
    row('p95 интервала рассылки', s.broadcast.p95, `≤ ${t.broadcastP95Ms} мс`, (v) => v <= t.broadcastP95Ms, ms),
    row('Ошибки сервера (error, fatal)', s.errors, `${t.serverErrors}`, (v) => v <= t.serverErrors, (v) => number(v)),
    row('p95 ping (RTT)', s.rtt.p95, `≤ ${t.rttMs} мс`, (v) => v <= t.rttMs, ms),
    row('Минимальный FPS клиента (видимые вкладки)', s.fps.min, `≥ ${t.fps}`, (v) => v >= t.fps, (v) => number(v)),
    row('Доля таймаутов NPC', s.npc.timeoutShare, `≤ ${t.npcTimeoutShare * 100}%`, (v) => v <= t.npcTimeoutShare, (v) => `${Math.round(v * 100)}%`),
    row('Потерянные строки журнала', s.logDropped, `${t.logDropped}`, (v) => v <= t.logDropped, (v) => number(v)),
  ];
}

const VERDICT: Record<Verdict, string> = { ok: '✅ в норме', over: '❌ превышен', nodata: '— нет данных' };
const time = (ms: number | null): string => (ms === null ? '—' : new Date(ms).toISOString().replace('T', ' ').slice(0, 19));

/** Markdown table for the console, the load profile and the task evidence (OFFLINE-019). */
export function reportTable(summary: Summary, header: ReportHeader): string {
  const lines = [
    `Запуск: ${header.runIds.length ? header.runIds.join(', ') : '—'} · окружение: ${header.env ?? '—'}`,
    `Период (UTC): ${time(header.from)} — ${time(header.to)} · пик игроков: ${header.peakPlayers ?? 'нет данных'}`,
    '',
    '| Показатель | Значение | Порог | Итог |',
    '|---|---|---|---|',
    ...reportRows(summary).map((r) => `| ${r.label} | ${r.value} | ${r.threshold} | ${VERDICT[r.verdict]} |`),
  ];
  return `${lines.join('\n')}\n`;
}
