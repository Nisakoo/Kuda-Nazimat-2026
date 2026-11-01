import type { NpcDefinition } from '../world/npcContent.ts';

export type NpcState = 'active' | 'disabled' | 'deleted';
/** CONTENT-001: the stored NPC; `definition` keeps the same shape as npcs.json. */
export interface NpcRecord {
  readonly definition: NpcDefinition & { readonly figure: 'entity' | 'map' };
  readonly state: NpcState;
  readonly revision: number;
  readonly updatedAt: number;
  readonly updatedBy: string;
}
export type NpcAction = 'seed' | 'update' | 'move' | 'disable' | 'enable' | 'delete';
/** CONTENT-010: who changed what; `changes` is `{field: {from, to}}`. */
export interface NpcChange {
  readonly npcId: string; readonly at: number; readonly action: NpcAction;
  readonly actorId: string | null; readonly actorName: string; readonly ip: string | null;
  readonly revision: number; readonly changes: Readonly<Record<string, { readonly from: unknown; readonly to: unknown }>>;
}
export interface NpcStore {
  all(): NpcRecord[];
  /** Writes the record and its change in one transaction; keeps at most 10 000 changes. */
  save(record: NpcRecord, change: NpcChange): void;
  changes(npcId: string | null, limit: number): NpcChange[];
}
