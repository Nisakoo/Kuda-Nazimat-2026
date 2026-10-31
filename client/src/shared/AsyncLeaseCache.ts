export interface Lease<T> { readonly value: T; release(): void }
interface Entry<T> { readonly controller: AbortController; promise: Promise<T>; users: number; value?: T }

export function abortError(): Error { return new DOMException('Operation cancelled', 'AbortError'); }

/** Pending requests and live owners share one resource. Zero owners always evicts. */
export class AsyncLeaseCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private disposed = false;
  constructor(private readonly load: (key: string, signal: AbortSignal) => Promise<T>, private readonly destroy: (value: T) => void) {}

  acquire(key: string, signal?: AbortSignal): Promise<Lease<T>> {
    if (this.disposed || signal?.aborted) return Promise.reject(abortError());
    let entry = this.entries.get(key);
    if (!entry) {
      const controller = new AbortController();
      const created: Entry<T> = { controller, users: 0, promise: Promise.resolve(undefined as T) };
      created.promise = Promise.resolve().then(() => this.load(key, controller.signal)).then((value) => {
        if (controller.signal.aborted || this.disposed || created.users === 0) { this.destroy(value); throw abortError(); }
        created.value = value;
        return value;
      });
      entry = created;
      this.entries.set(key, entry);
    }
    const owner = entry;
    owner.users++;
    return new Promise((resolve, reject) => {
      let active = true;
      const release = () => {
        if (!active) return;
        active = false;
        signal?.removeEventListener('abort', cancel);
        owner.controller.signal.removeEventListener('abort', cancel);
        if (--owner.users === 0 && this.entries.get(key) === owner) {
          this.entries.delete(key);
          owner.controller.abort();
          if (owner.value !== undefined) { this.destroy(owner.value); delete owner.value; }
        }
      };
      const cancel = () => { release(); reject(abortError()); };
      signal?.addEventListener('abort', cancel, { once: true });
      owner.controller.signal.addEventListener('abort', cancel, { once: true });
      owner.promise.then((value) => {
        if (!active) return;
        signal?.removeEventListener('abort', cancel);
        owner.controller.signal.removeEventListener('abort', cancel);
        resolve({ value, release });
      }, (error: unknown) => { if (active) { release(); reject(error); } });
    });
  }

  get stats() { return { resources: this.entries.size, loading: [...this.entries.values()].filter((entry) => entry.value === undefined).length, owners: [...this.entries.values()].reduce((sum, entry) => sum + entry.users, 0) }; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) {
      entry.controller.abort();
      if (entry.value !== undefined) { this.destroy(entry.value); delete entry.value; }
    }
    this.entries.clear();
  }
}
