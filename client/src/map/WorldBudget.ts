export interface BudgetLease { release(): void }
interface Allocation { readonly bytes: number; readonly memory: number; owners: number }
export class BudgetExhausted extends Error { constructor() { super('World budget exhausted'); this.name = 'BudgetExhausted'; } }

/** Shared resource accounting and an emergency payload-memory cap; chunks are selected by radius. */
export class WorldBudget {
  private readonly allocations = new Map<string, Allocation>();
  private peakBytes = 0;
  private peakMemory = 0;
  private releases = 0;
  private readonly emptyListeners = new Set<() => void>();
  whenEmpty(): Promise<void> { return this.allocations.size === 0 ? Promise.resolve() : new Promise((resolve) => this.emptyListeners.add(resolve)); }
  get epoch(): number { return this.releases; }
  constructor(readonly memoryLimit = 128 * 1024 * 1024) {
    if (!Number.isSafeInteger(memoryLimit) || memoryLimit <= 0) throw new Error('Invalid world budget');
  }
  get stats() {
    const values = [...this.allocations.values()];
    return { bytes: values.reduce((sum, value) => sum + value.bytes, 0), memory: values.reduce((sum, value) => sum + value.memory, 0), memoryLimit: this.memoryLimit, peakBytes: this.peakBytes, peakMemory: this.peakMemory, resources: values.length };
  }
  reserve(key: string, bytes: number, memory: number): BudgetLease {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(memory) || memory < bytes) throw new Error('Invalid resource size');
    let allocation = this.allocations.get(key);
    if (allocation && (allocation.bytes !== bytes || allocation.memory !== memory)) throw new Error('Conflicting resource size');
    if (!allocation) {
      const current = this.stats;
      if (current.memory + memory > this.memoryLimit) throw new BudgetExhausted();
      allocation = { bytes, memory, owners: 0 };
      this.allocations.set(key, allocation);
      this.peakBytes = Math.max(this.peakBytes, current.bytes + bytes);
      this.peakMemory = Math.max(this.peakMemory, current.memory + memory);
    }
    allocation.owners++;
    let active = true;
    return { release: () => {
      if (!active) return;
      active = false;
      if (--allocation.owners === 0) {
        this.allocations.delete(key); this.releases++;
        if (this.allocations.size === 0) { for (const listener of this.emptyListeners) listener(); this.emptyListeners.clear(); }
      }
    } };
  }
  reserveAll(resources: readonly { key: string; bytes: number; memory: number }[]): BudgetLease {
    const unique = new Map<string, { key: string; bytes: number; memory: number }>();
    for (const resource of resources) {
      const duplicate = unique.get(resource.key) ?? this.allocations.get(resource.key);
      if (!Number.isSafeInteger(resource.bytes) || resource.bytes < 0 || !Number.isSafeInteger(resource.memory) || resource.memory < resource.bytes || (duplicate && (duplicate.bytes !== resource.bytes || duplicate.memory !== resource.memory))) throw new Error('Invalid or conflicting resource size');
      unique.set(resource.key, resource);
    }
    const extra = [...unique.values()].filter((resource) => !this.allocations.has(resource.key));
    const current = this.stats;
    if (current.memory + extra.reduce((sum, resource) => sum + resource.memory, 0) > this.memoryLimit) throw new BudgetExhausted();
    const leases: BudgetLease[] = [];
    try { for (const resource of unique.values()) leases.push(this.reserve(resource.key, resource.bytes, resource.memory)); }
    catch (error) { for (const lease of leases) lease.release(); throw error; }
    return { release: () => { for (const lease of leases) lease.release(); } };
  }
}
