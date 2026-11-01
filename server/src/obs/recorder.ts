import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { levelRank, type LogRecord, type LogSink } from '../common/logger.ts';

export interface RecorderOptions {
  readonly dir: string | null; readonly runId: string; readonly capacity?: number; readonly minIntervalMs?: number;
  readonly now?: () => number;
  /** Extra snapshot for the dump: metrics, seats, queue (OBS-004). Must contain no secrets or texts. */
  readonly snapshot?: () => unknown;
}

/** Key `info` events shown among the admin's last events (OBS-010). */
const KEY_EVENTS = new Set(['app.ready', 'game.seat.attach', 'game.seat.release', 'npc.responder.ready', 'language.ready', 'auth.operator.action', 'obs.incident.dumped']);

/**
 * OBS-004 flight recorder: the last N records of every level stay in memory and are written to
 * `incident-*.jsonl` on the first error, on an invariant violation and on request.
 */
export class FlightRecorder {
  readonly sink: LogSink;
  private readonly ring: (LogRecord | undefined)[];
  private next = 0;
  private lastDump = -Infinity;
  private suppressed = 0;
  private dumping = false;
  private readonly options: Required<Omit<RecorderOptions, 'snapshot'>> & Pick<RecorderOptions, 'snapshot'>;
  private readonly recent: LogRecord[] = [];

  constructor(options: RecorderOptions) {
    this.options = { capacity: 5000, minIntervalMs: 60_000, now: Date.now, ...options };
    this.ring = new Array(this.options.capacity);
    this.sink = (record) => this.record(record);
  }

  /** Last 20 events for the admin screen (OBS-010): warnings, errors and key `info` events. */
  warnings(): readonly LogRecord[] { return this.recent; }

  private record(record: LogRecord): void {
    this.ring[this.next] = record; this.next = (this.next + 1) % this.options.capacity;
    if (levelRank(record.level) >= levelRank('warn') || (record.level === 'info' && KEY_EVENTS.has(record.event))) { this.recent.push(record); if (this.recent.length > 20) this.recent.shift(); }
    if (levelRank(record.level) >= levelRank('error') && record.event !== 'obs.incident.dumped') this.dump(record.event, false);
  }

  /** Returns the file written, or null when rate-limited, disabled or failed. `force` skips the rate limit. */
  dump(reason: string, force = true): string | null {
    const now = this.options.now();
    if (!this.options.dir || this.dumping) return null;
    if (!force && now - this.lastDump < this.options.minIntervalMs) { this.suppressed++; return null; }
    this.dumping = true;
    try {
      const ordered = [...this.ring.slice(this.next), ...this.ring.slice(0, this.next)].filter((r): r is LogRecord => r !== undefined);
      let snapshot: unknown = null;
      try { snapshot = this.options.snapshot?.() ?? null; } catch { snapshot = { error: 'snapshot failed' }; }
      const header = { type: 'incident', reason, ts: new Date(now).toISOString(), runId: this.options.runId, suppressedSinceLast: this.suppressed, records: ordered.length };
      const file = join(this.options.dir, `incident-${new Date(now).toISOString().replace(/[:.]/g, '-')}-${this.options.runId}.jsonl`);
      mkdirSync(this.options.dir, { recursive: true });
      writeFileSync(file, [header, { type: 'snapshot', snapshot }, ...ordered].map((line) => JSON.stringify(line)).join('\n') + '\n');
      this.lastDump = now; this.suppressed = 0;
      return file;
    } catch { return null; }
    finally { this.dumping = false; }
  }
}
