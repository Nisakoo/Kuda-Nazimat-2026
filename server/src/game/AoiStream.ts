import type { Entity } from '../../../shared/world/types.ts';

/** bytes: serialized size of the upserted entities, an estimate of the packet size for OBS (game.delta.large). */
export interface AoiDelta { readonly revision: number; readonly baseRevision: number; readonly upsert: Entity[]; readonly remove: string[]; readonly bytes: number }

/** Per-connection AOI stream: what the client last received and its revision (PROTO-008 §3). */
export class AoiStream {
  private sent = new Map<string, string>();
  private value = 0;

  get revision(): number { return this.value; }

  /** Full state for `joined`/`snapshot`; the next delta builds on it. */
  reset(entities: readonly Entity[]): void {
    this.sent = new Map(entities.map((entity) => [entity.id, JSON.stringify(entity)]));
  }

  /** Changed and new entities are sent whole; nothing changed means no packet. */
  diff(entities: readonly Entity[]): AoiDelta | null {
    const upsert: Entity[] = [];
    const next = new Map<string, string>();
    let bytes = 0;
    for (const entity of entities) {
      const encoded = JSON.stringify(entity);
      next.set(entity.id, encoded);
      if (this.sent.get(entity.id) !== encoded) { upsert.push(entity); bytes += encoded.length; }
    }
    const remove = [...this.sent.keys()].filter((id) => !next.has(id));
    if (upsert.length === 0 && remove.length === 0) return null;
    this.sent = next;
    const baseRevision = this.value;
    this.value++;
    return { revision: this.value, baseRevision, upsert, remove, bytes };
  }
}
