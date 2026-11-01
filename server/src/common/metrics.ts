/**
 * OBS-007 metrics port and in-process registry: counters, gauges and fixed-bucket histograms,
 * O(1) updates, no dependencies. Labels are small fixed sets (route, code, outcome) — never IDs or texts.
 */
export type Labels = Readonly<Record<string, string>>;
export interface Counter { inc(labels?: Labels, by?: number): void }
export interface Gauge { set(value: number, labels?: Labels): void }
export interface Histogram { observe(value: number, labels?: Labels): void }
export interface Metrics {
  counter(name: string, help: string): Counter;
  gauge(name: string, help: string, collect?: () => number | readonly { labels: Labels; value: number }[]): Gauge;
  histogram(name: string, help: string, buckets: readonly number[]): Histogram;
}

export const MS_BUCKETS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000] as const;
export const FAST_MS_BUCKETS = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100] as const;
/** Bounds contain the OBS thresholds (broadcast 120 ms, RTT 150 ms), so a threshold check never depends on rounding. */
export const BROADCAST_MS_BUCKETS = [50, 80, 100, 110, 120, 150, 200, 300, 500, 1000, 2000] as const;
export const RTT_MS_BUCKETS = [5, 10, 20, 50, 100, 150, 200, 300, 500, 1000, 2000, 5000] as const;
export const FPS_BUCKETS = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120, 240, 1000] as const;

interface Series { labels: Labels; value: number; counts?: number[]; sum?: number }
interface Family { name: string; help: string; type: 'counter' | 'gauge' | 'histogram'; buckets?: readonly number[]; series: Map<string, Series>; collect?: () => number | readonly { labels: Labels; value: number }[] }

const key = (labels: Labels): string => Object.keys(labels).sort().map((k) => `${k}=${labels[k]}`).join(',');

export class MetricsRegistry implements Metrics {
  private readonly families = new Map<string, Family>();

  private family(name: string, help: string, type: Family['type'], buckets?: readonly number[], collect?: Family['collect']): Family {
    const existing = this.families.get(name);
    if (existing) { if (existing.type !== type) throw new Error(`Метрика ${name} уже объявлена как ${existing.type}`); return existing; }
    const family: Family = { name, help, type, series: new Map(), ...(buckets ? { buckets } : {}), ...(collect ? { collect } : {}) };
    this.families.set(name, family);
    return family;
  }
  private series(family: Family, labels: Labels): Series {
    const id = key(labels); let series = family.series.get(id);
    if (!series) { series = { labels, value: 0, ...(family.buckets ? { counts: family.buckets.map(() => 0), sum: 0 } : {}) }; family.series.set(id, series); }
    return series;
  }

  counter(name: string, help: string): Counter {
    const family = this.family(name, help, 'counter');
    return { inc: (labels = {}, by = 1) => { this.series(family, labels).value += by; } };
  }
  gauge(name: string, help: string, collect?: Family['collect']): Gauge {
    const family = this.family(name, help, 'gauge', undefined, collect);
    return { set: (value, labels = {}) => { this.series(family, labels).value = value; } };
  }
  histogram(name: string, help: string, buckets: readonly number[]): Histogram {
    const family = this.family(name, help, 'histogram', buckets);
    return {
      observe: (value, labels = {}) => {
        const series = this.series(family, labels);
        series.value++; series.sum! += value;
        for (let i = 0; i < buckets.length; i++) if (value <= buckets[i]!) { series.counts![i]!++; break; }
      },
    };
  }

  private collected(family: Family): Series[] {
    if (family.collect) {
      const value = family.collect();
      return typeof value === 'number' ? [{ labels: {}, value }] : value.map((entry) => ({ labels: entry.labels, value: entry.value }));
    }
    return [...family.series.values()];
  }

  /** JSON snapshot for the operator screen and incident dumps; histograms report count, sum and p50/p95. */
  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const family of this.families.values()) {
      result[family.name] = this.collected(family).map((series) => family.type !== 'histogram'
        ? { labels: series.labels, value: series.value }
        : { labels: series.labels, count: series.value, sum: series.sum, p50: quantile(family.buckets!, series.counts!, series.value, 0.5), p95: quantile(family.buckets!, series.counts!, series.value, 0.95) });
    }
    return result;
  }

  /** Current total of a counter or gauge across label sets matching `filter`. */
  value(name: string, filter: Labels = {}): number {
    const family = this.families.get(name); if (!family) return 0;
    return this.collected(family).filter((s) => Object.entries(filter).every(([k, v]) => s.labels[k] === v)).reduce((sum, s) => sum + s.value, 0);
  }

  has(name: string): boolean { return this.families.has(name); }

  /** Total of a counter or gauge over label sets accepted by `match` (e.g. HTTP statuses ≥ 500). */
  total(name: string, match: (labels: Labels) => boolean): number {
    const family = this.families.get(name); if (!family) return 0;
    return this.collected(family).filter((s) => match(s.labels)).reduce((sum, s) => sum + s.value, 0);
  }

  /** Bucket counts of a histogram summed over label sets matching `filter`; the last element counts values above every bound. */
  histogramCounts(name: string, filter: Labels = {}): { readonly buckets: readonly number[]; readonly counts: number[] } | null {
    const family = this.families.get(name); if (!family || family.type !== 'histogram') return null;
    const counts = new Array<number>(family.buckets!.length + 1).fill(0);
    for (const series of family.series.values()) {
      if (!Object.entries(filter).every(([k, v]) => series.labels[k] === v)) continue;
      let inBuckets = 0;
      series.counts!.forEach((count, i) => { counts[i]! += count; inBuckets += count; });
      counts[counts.length - 1]! += series.value - inBuckets;
    }
    return { buckets: family.buckets!, counts };
  }
}

/** Upper bucket bound containing the quantile; null without observations. */
export function quantile(buckets: readonly number[], counts: readonly number[], total: number, q: number): number | null {
  if (!total) return null;
  let seen = 0;
  for (let i = 0; i < buckets.length; i++) { seen += counts[i]!; if (seen >= q * total) return buckets[i]!; }
  return Infinity;
}
