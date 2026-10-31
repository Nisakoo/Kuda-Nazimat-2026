export class ResourcePool<T extends { dispose(): void }> {
  private readonly entries = new Map<string, { resource: T; owners: number }>();

  acquire(key: string, create: () => T): T {
    let entry = this.entries.get(key);
    if (!entry) { entry = { resource: create(), owners: 0 }; this.entries.set(key, entry); }
    entry.owners++;
    return entry.resource;
  }

  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (--entry.owners === 0) { entry.resource.dispose(); this.entries.delete(key); }
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.resource.dispose();
    this.entries.clear();
  }
}
