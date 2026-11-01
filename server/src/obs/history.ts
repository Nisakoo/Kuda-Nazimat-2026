import { BROADCAST_MS_BUCKETS, FAST_MS_BUCKETS, MS_BUCKETS, RTT_MS_BUCKETS, quantile, type MetricsRegistry } from '../common/metrics.ts';

/**
 * OBS-013 metrics history: a frame every 10 s from the OBS-007 registry, kept in one ring of 1440 frames
 * (4 hours). Windows use bucket increments, never the cumulative `snapshot().p95`. Pure apart from the
 * injected registry and readers; the composition root owns the timer.
 */
export const HISTORY_STEP_MS = 10_000;
export const HISTORY_CAPACITY = 1440;

/** Gauges (value at the end of the frame) first, then counter increments during the frame. */
export const VALUE_NAMES = ['seated', 'connected', 'queued', 'running', 'rssBytes', 'heapBytes', 'diskFreeBytes',
  'errors', 'warnings', 'npcAccepted', 'npcCompleted', 'npcTimeouts', 'npcBusy', 'npcFailed', 'http5xx', 'dbErrors', 'logDropped'] as const;
export type ValueName = (typeof VALUE_NAMES)[number];
const GAUGES = 7;
const COUNTERS = VALUE_NAMES.slice(GAUGES) as readonly ValueName[];
const INDEX = Object.fromEntries(VALUE_NAMES.map((name, i) => [name, i])) as Record<ValueName, number>;

export const HISTOGRAMS = {
  tick: { metric: 'game_tick_duration_ms', buckets: FAST_MS_BUCKETS },
  broadcast: { metric: 'game_broadcast_interval_ms', buckets: BROADCAST_MS_BUCKETS },
  rtt: { metric: 'game_rtt_ms', buckets: RTT_MS_BUCKETS },
  npcFirst: { metric: 'npc_first_partial_ms', buckets: MS_BUCKETS },
  npcGeneration: { metric: 'npc_generation_ms', buckets: MS_BUCKETS },
} as const;
export type HistName = keyof typeof HISTOGRAMS;
const HIST_NAMES = Object.keys(HISTOGRAMS) as HistName[];
/** Each histogram occupies its bounds plus one overflow slot. */
const OFFSETS = {} as Record<HistName, number>;
let histLength = 0;
for (const name of HIST_NAMES) { OFFSETS[name] = histLength; histLength += HISTOGRAMS[name].buckets.length + 1; }

/** Per seated player: RTT median of the last minute, last visible FPS and frame time; no names. */
export interface PlayerSample { readonly playerId: string; readonly rttMs: number | null; readonly fps: number | null; readonly frameMs: number | null }

export interface Frame {
  readonly at: number;
  readonly spanMs: number;
  /** VALUE_NAMES order; NaN means no data. */
  readonly values: Float64Array;
  /** Bucket increments of every histogram, HISTOGRAMS order. */
  readonly hist: Uint32Array;
  readonly players: readonly PlayerSample[];
}

export interface HistorySource {
  readonly registry: MetricsRegistry;
  players(): readonly (PlayerSample & { readonly connected: boolean })[];
  diskFreeBytes?(): number | null;
  memory?(): { readonly rss: number; readonly heapUsed: number };
}

export const frameValue = (frame: Frame, name: ValueName): number | null => {
  const value = frame.values[INDEX[name]]!;
  return Number.isNaN(value) ? null : value;
};
export const frameHist = (frame: Frame, name: HistName): Uint32Array => frame.hist.subarray(OFFSETS[name], OFFSETS[name] + HISTOGRAMS[name].buckets.length + 1);

/** Cumulative counter totals in COUNTERS order. */
function counterTotals(registry: MetricsRegistry): number[] {
  const outcomes = (outcome: string) => registry.value('npc_requests_total', { outcome });
  const all = registry.value('npc_requests_total');
  const busy = outcomes('player-busy') + outcomes('server-busy');
  const rejected = busy + outcomes('unavailable');
  return [
    registry.value('log_records_total', { level: 'error' }) + registry.value('log_records_total', { level: 'fatal' }),
    registry.value('log_records_total', { level: 'warn' }),
    all - rejected, outcomes('completed'), outcomes('timeout'), busy,
    all - outcomes('completed') - outcomes('timeout') - outcomes('cancelled') - busy,
    registry.total('http_requests_total', (labels) => Number(labels.status) >= 500),
    registry.value('db_errors_total'), registry.value('log_dropped_total'),
  ];
}
function histTotals(registry: MetricsRegistry): number[] {
  const totals = new Array<number>(histLength).fill(0);
  for (const name of HIST_NAMES) registry.histogramCounts(HISTOGRAMS[name].metric)?.counts.forEach((count, i) => { totals[OFFSETS[name] + i] = count; });
  return totals;
}

/** Seats are capped at 4 (SERVER-004 maxPlayers); each keeps RTT, FPS and frame time. */
const PLAYER_SLOTS = 4;
const ROW = VALUE_NAMES.length + histLength + PLAYER_SLOTS * 3;
/** Float32 storage rounds; two decimals are enough for ms and FPS. */
const round = (value: number): number | null => (Number.isNaN(value) ? null : Math.round(value * 100) / 100);

/**
 * Column storage keeps the 4-hour ring inside the 1 MB budget: one Float32Array for values, buckets and
 * player samples (NaN — no data), one Float64Array for times; Frame objects are built on read.
 */
export class MetricsHistory {
  private readonly source: HistorySource;
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly data: Float32Array;
  private readonly times: Float64Array;
  private readonly ids: (readonly string[])[];
  private head = 0;
  private size = 0;
  private previous: { at: number; counters: number[]; hist: number[] };

  constructor(source: HistorySource, options: { capacity?: number; now?: () => number } = {}) {
    this.source = source; this.capacity = options.capacity ?? HISTORY_CAPACITY; this.now = options.now ?? Date.now;
    this.data = new Float32Array(this.capacity * ROW).fill(NaN);
    this.times = new Float64Array(this.capacity * 2);
    this.ids = new Array(this.capacity).fill([]);
    this.previous = { at: this.now(), counters: counterTotals(source.registry), hist: histTotals(source.registry) };
  }

  /** Takes one frame: gauges now, increments since the previous frame. */
  sample(): Frame {
    const at = this.now(); const { registry } = this.source;
    const counters = counterTotals(registry); const hist = histTotals(registry);
    const players = this.source.players().slice(0, PLAYER_SLOTS);
    const values = new Float64Array(VALUE_NAMES.length).fill(NaN);
    const memory = this.source.memory?.() ?? null;
    const queue = (state: string) => registry.value('npc_queue', { state });
    const gauges: (number | null)[] = [players.length, players.filter((p) => p.connected).length, queue('queued'), queue('running'), memory?.rss ?? null, memory?.heapUsed ?? null, this.source.diskFreeBytes?.() ?? null];
    gauges.forEach((value, i) => { if (value !== null) values[i] = value; });
    COUNTERS.forEach((name, i) => { values[INDEX[name]] = Math.max(0, counters[i]! - this.previous.counters[i]!); });
    const histDelta = new Uint32Array(histLength);
    for (let i = 0; i < histLength; i++) histDelta[i] = Math.max(0, hist[i]! - this.previous.hist[i]!);
    const frame: Frame = { at, spanMs: at - this.previous.at, values, hist: histDelta, players: players.map(({ playerId, rttMs, fps, frameMs }) => ({ playerId, rttMs, fps, frameMs })) };
    this.previous = { at, counters, hist };
    this.store(frame);
    return frame;
  }

  private store(frame: Frame): void {
    const slot = (this.head + this.size) % this.capacity;
    if (this.size < this.capacity) this.size++; else this.head = (this.head + 1) % this.capacity;
    const base = slot * ROW;
    this.data.set(frame.values, base); this.data.set(frame.hist, base + VALUE_NAMES.length);
    const players = base + VALUE_NAMES.length + histLength;
    this.data.fill(NaN, players, base + ROW);
    frame.players.forEach((p, i) => { this.data[players + i * 3] = p.rttMs ?? NaN; this.data[players + i * 3 + 1] = p.fps ?? NaN; this.data[players + i * 3 + 2] = p.frameMs ?? NaN; });
    this.times[slot * 2] = frame.at; this.times[slot * 2 + 1] = frame.spanMs;
    this.ids[slot] = frame.players.map((p) => p.playerId);
  }

  /** The i-th oldest frame. */
  private read(i: number): Frame {
    const slot = (this.head + i) % this.capacity; const base = slot * ROW;
    const players = base + VALUE_NAMES.length + histLength;
    return {
      at: this.times[slot * 2]!, spanMs: this.times[slot * 2 + 1]!,
      values: Float64Array.from(this.data.subarray(base, base + VALUE_NAMES.length)),
      hist: Uint32Array.from(this.data.subarray(base + VALUE_NAMES.length, players)),
      players: this.ids[slot]!.map((playerId, k) => ({ playerId, rttMs: round(this.data[players + k * 3]!), fps: round(this.data[players + k * 3 + 1]!), frameMs: round(this.data[players + k * 3 + 2]!) })),
    };
  }

  frames(): Frame[] { return Array.from({ length: this.size }, (_, i) => this.read(i)); }

  /** Frames that ended within the last `ms`. */
  window(ms: number, at = this.now()): Frame[] {
    let first = this.size;
    while (first > 0 && this.times[((this.head + first - 1) % this.capacity) * 2]! > at - ms) first--;
    return Array.from({ length: this.size - first }, (_, i) => this.read(first + i));
  }

  /** Heap estimate for the OBS-013 1 MB budget: both buffers plus the player id lists. */
  approxBytes(): number {
    return this.data.byteLength + this.times.byteLength + this.ids.reduce((sum, list) => sum + 16 + list.length * 8, 0);
  }
}

/** Joins frames into one: gauge peaks (free disk — minimum), summed increments, the last player samples. */
export function mergeFrames(frames: readonly Frame[]): Frame | null {
  if (!frames.length) return null;
  const values = new Float64Array(VALUE_NAMES.length).fill(NaN);
  const hist = new Uint32Array(histLength);
  for (const frame of frames) {
    VALUE_NAMES.forEach((name, i) => {
      const value = frame.values[i]!; if (Number.isNaN(value)) return;
      const current = values[i]!;
      values[i] = Number.isNaN(current) ? value : i >= GAUGES ? current + value : name === 'diskFreeBytes' ? Math.min(current, value) : Math.max(current, value);
    });
    for (let i = 0; i < histLength; i++) hist[i]! += frame.hist[i]!;
  }
  const last = frames.at(-1)!;
  return { at: last.at, spanMs: frames.reduce((sum, frame) => sum + frame.spanMs, 0), values, hist, players: last.players };
}

/** JSON form of a frame for `metrics.minute` (OBS-015); `null` for missing values. */
export function frameToJson(frame: Frame): Record<string, unknown> {
  return {
    at: frame.at, spanMs: frame.spanMs,
    values: Object.fromEntries(VALUE_NAMES.map((name) => [name, frameValue(frame, name)])),
    hist: Object.fromEntries(HIST_NAMES.map((name) => [name, Array.from(frameHist(frame, name))])),
    players: frame.players,
  };
}

/** Inverse of frameToJson for the report CLI; unknown or broken records yield null. */
export function frameFromJson(raw: unknown): Frame | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as { at?: unknown; spanMs?: unknown; values?: Record<string, unknown>; hist?: Record<string, unknown>; players?: unknown };
  if (typeof record.at !== 'number' || typeof record.spanMs !== 'number' || !record.values || !record.hist) return null;
  const values = new Float64Array(VALUE_NAMES.length).fill(NaN);
  VALUE_NAMES.forEach((name, i) => { const value = record.values![name]; if (typeof value === 'number' && Number.isFinite(value)) values[i] = value; });
  const hist = new Uint32Array(histLength);
  for (const name of HIST_NAMES) {
    const counts = record.hist[name];
    if (Array.isArray(counts) && counts.length === HISTOGRAMS[name].buckets.length + 1) counts.forEach((count, i) => { hist[OFFSETS[name] + i] = Number(count) || 0; });
  }
  const players = Array.isArray(record.players) ? record.players.filter((p): p is PlayerSample => !!p && typeof (p as PlayerSample).playerId === 'string') : [];
  return { at: record.at, spanMs: record.spanMs, values, hist, players };
}

export interface Summary {
  readonly from: number | null; readonly to: number | null; readonly frames: number;
  readonly seatedPeak: number | null; readonly connectedPeak: number | null;
  readonly tick: { readonly p50: number | null; readonly p95: number | null; readonly max: number | null };
  readonly broadcast: { readonly p95: number | null; readonly max: number | null };
  readonly rtt: { readonly p50: number | null; readonly p95: number | null; readonly max: number | null };
  /** Visible tabs only (OBS-011). */
  readonly fps: { readonly min: number | null; readonly p50: number | null };
  readonly npc: {
    readonly accepted: number | null; readonly completed: number | null; readonly timeouts: number | null; readonly busy: number | null; readonly failed: number | null;
    readonly timeoutShare: number | null; readonly firstPartialP95: number | null; readonly generationP95: number | null; readonly queuedPeak: number | null;
  };
  readonly errors: number | null; readonly warnings: number | null; readonly http5xx: number | null; readonly dbErrors: number | null; readonly logDropped: number | null;
  readonly rssPeak: number | null; readonly heapPeak: number | null; readonly diskFreeMin: number | null;
}

/** Upper bound of the highest non-empty bucket; Infinity when only the overflow slot holds values. */
function histMax(buckets: readonly number[], counts: ArrayLike<number>): number | null {
  for (let i = counts.length - 1; i >= 0; i--) if (counts[i]) return i < buckets.length ? buckets[i]! : Infinity;
  return null;
}
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b); const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** One summary for status windows, `metrics.minute`, the report and the load profile (OBS-013, 017). */
export function summarize(frames: readonly Frame[]): Summary {
  const merged = mergeFrames(frames);
  const value = (name: ValueName) => merged ? frameValue(merged, name) : null;
  const counts = (name: HistName) => merged ? frameHist(merged, name) : new Uint32Array(HISTOGRAMS[name].buckets.length + 1);
  const q = (name: HistName, p: number) => { const c = counts(name); return quantile(HISTOGRAMS[name].buckets, Array.from(c), c.reduce((s, n) => s + n, 0), p); };
  const max = (name: HistName) => histMax(HISTOGRAMS[name].buckets, counts(name));
  const fps = frames.flatMap((frame) => frame.players.map((p) => p.fps).filter((v): v is number => v !== null));
  const accepted = value('npcAccepted'); const timeouts = value('npcTimeouts');
  return {
    from: frames[0] ? frames[0].at - frames[0].spanMs : null, to: frames.at(-1)?.at ?? null, frames: frames.length,
    seatedPeak: value('seated'), connectedPeak: value('connected'),
    tick: { p50: q('tick', 0.5), p95: q('tick', 0.95), max: max('tick') },
    broadcast: { p95: q('broadcast', 0.95), max: max('broadcast') },
    rtt: { p50: q('rtt', 0.5), p95: q('rtt', 0.95), max: max('rtt') },
    fps: { min: fps.length ? Math.min(...fps) : null, p50: median(fps) },
    npc: {
      accepted, completed: value('npcCompleted'), timeouts, busy: value('npcBusy'), failed: value('npcFailed'),
      timeoutShare: accepted ? (timeouts ?? 0) / accepted : null, firstPartialP95: q('npcFirst', 0.95), generationP95: q('npcGeneration', 0.95), queuedPeak: value('queued'),
    },
    errors: value('errors'), warnings: value('warnings'), http5xx: value('http5xx'), dbErrors: value('dbErrors'), logDropped: value('logDropped'),
    rssPeak: value('rssBytes'), heapPeak: value('heapBytes'), diskFreeMin: value('diskFreeBytes'),
  };
}

