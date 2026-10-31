import { AsyncLeaseCache } from '../shared/AsyncLeaseCache';
import type { Lease } from '../shared/AsyncLeaseCache';

export interface AssetSource {
  resolve(path: string, relativeTo?: string): string;
  load(url: string, signal: AbortSignal): Promise<ArrayBuffer>;
}

/** Local HTTP only; renderer never owns transport or a bypass URL for online data. */
export class HttpAssetSource implements AssetSource {
  private readonly root: URL;
  constructor(root: string) { this.root = new URL(root.endsWith('/') ? root : root + '/'); }
  resolve(path: string, relativeTo = this.root.href): string {
    const url = new URL(path, relativeTo);
    if (url.origin !== this.root.origin || !url.pathname.startsWith(this.root.pathname) || url.username || url.password || url.hash) {
      throw new Error('Asset URL is outside the configured local source.');
    }
    return url.href;
  }
  async load(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
    const response = await fetch(url, { signal, cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Asset HTTP ${response.status}`);
    return response.arrayBuffer();
  }
}

export class AssetManager {
  private readonly cache: AsyncLeaseCache<ArrayBuffer>;
  constructor(private readonly source: AssetSource) { this.cache = new AsyncLeaseCache((url, signal) => source.load(url, signal), () => {}); }
  resolve(path: string, relativeTo?: string): string { return this.source.resolve(path, relativeTo); }
  acquire(path: string, signal?: AbortSignal): Promise<Lease<ArrayBuffer>> { return this.cache.acquire(this.resolve(path), signal); }
  get stats() { return this.cache.stats; }
  dispose(): void { this.cache.dispose(); }
}
