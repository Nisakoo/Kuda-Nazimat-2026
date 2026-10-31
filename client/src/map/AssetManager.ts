import { AsyncLeaseCache } from '../shared/AsyncLeaseCache';
import type { Lease } from '../shared/AsyncLeaseCache';
import type { BudgetLease, WorldBudget } from './WorldBudget';
export type { AssetSize } from '../../../shared/map/manifest.ts';
import type { AssetSize } from '../../../shared/map/manifest.ts';
export interface HttpAccess { token(): string | null; unauthorized(): void }

export interface AssetSource {
  resolve(path: string, relativeTo?: string): string;
  load(url: string, signal: AbortSignal, maxBytes?: number): Promise<ArrayBuffer>;
}

/** Local HTTP only; renderer never owns transport or a bypass URL for online data. */
export class HttpAssetSource implements AssetSource {
  private readonly root: URL;
  constructor(root: string, private readonly access?: HttpAccess) {
    this.root = new URL(root.endsWith('/') ? root : root + '/');
    if (!['http:', 'https:'].includes(this.root.protocol) || this.root.username || this.root.password || this.root.search || this.root.hash) throw new Error('Invalid HTTP source');
  }
  resolve(path: string, relativeTo = this.root.href): string {
    const url = new URL(path, relativeTo);
    if (url.origin !== this.root.origin || !url.pathname.startsWith(this.root.pathname) || url.username || url.password || url.search || url.hash) {
      throw new Error('Asset URL is outside the configured local source.');
    }
    return url.href;
  }
  async load(url: string, signal: AbortSignal, maxBytes = 16 * 1024 * 1024): Promise<ArrayBuffer> {
    const token = this.access?.token();
    if (this.access && !token) throw new Error('Для загрузки мира требуется серверная сессия.');
    const response = await fetch(url, { signal, cache: 'no-store', credentials: 'omit', redirect: 'error', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (response.status === 401 || response.status === 403) this.access?.unauthorized();
    if (!response.ok) throw new Error(`Asset HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('Asset exceeds declared size'); }
    if (!response.body) return new ArrayBuffer(0);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new Error('Asset exceeds declared size'); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result.buffer;
  }
}

export class AssetManager {
  private readonly cache: AsyncLeaseCache<ArrayBuffer>;
  private readonly tickets = new WeakMap<ArrayBuffer, BudgetLease>();
  constructor(private readonly source: AssetSource, budget?: WorldBudget, sizes?: (url: string) => AssetSize | undefined) {
    this.cache = new AsyncLeaseCache(async (url, signal) => {
      const size = sizes?.(url);
      if (budget && !size) throw new Error('Unknown world resource size');
      const ticket = budget && size ? budget.reserve(url, size.bytes, size.memory) : undefined;
      try {
        const data = await source.load(url, signal, size?.bytes);
        if (size && data.byteLength !== size.bytes) throw new Error('Asset size does not match manifest');
        if (ticket) this.tickets.set(data, ticket);
        return data;
      } catch (error) { ticket?.release(); throw error; }
    }, (data) => { this.tickets.get(data)?.release(); this.tickets.delete(data); });
  }
  resolve(path: string, relativeTo?: string): string { return this.source.resolve(path, relativeTo); }
  acquire(path: string, signal?: AbortSignal): Promise<Lease<ArrayBuffer>> { return this.cache.acquire(this.resolve(path), signal); }
  get stats() { return this.cache.stats; }
  dispose(): void { this.cache.dispose(); }
}
