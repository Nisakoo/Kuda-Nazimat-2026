import type { NpcOverride } from './NpcCatalog.ts';

/** ADMIN-SRV-009: the administrator behind a change; `accountId`/`name` are absent for the console. */
export interface Who { readonly ip: string | null; readonly accountId?: string | null; readonly name?: string | null }
export type JournalTarget = 'npc' | 'world' | 'account';
export type JournalActor = 'admin' | 'seed' | 'system';
/** ADMIN-SRV-009: one change; values never contain OBS-006 data. */
export interface JournalInput {
  readonly at: number; readonly actor: JournalActor; readonly ip: string | null;
  readonly actorAccountId?: string | null; readonly actorName?: string | null;
  readonly targetType: JournalTarget; readonly targetId: string; readonly action: string;
  readonly before: Record<string, unknown> | null; readonly after: Record<string, unknown> | null;
}
export interface JournalEntry extends JournalInput { readonly id: number; readonly actorAccountId: string | null; readonly actorName: string | null }
export interface JournalFilter {
  readonly target?: JournalTarget; readonly id?: string; readonly action?: string;
  readonly from?: number; readonly to?: number; readonly q?: string;
  readonly order: 'asc' | 'desc'; readonly offset: number; readonly limit: number;
}
export interface AccountSummary {
  readonly accountId: string; readonly name: string; readonly role: 'player' | 'admin'; readonly createdAt: number; readonly hasPassword: boolean; readonly mustChangePassword: boolean;
  readonly activeSessions: number; readonly lastLoginAt: number | null;
}
export interface AccountSession { readonly createdAt: number; readonly expiresAt: number; readonly ip: string | null; readonly revokedAt: number | null; readonly revokeReason: string | null }

/** Durable side of the content administration; every change and its journal entry commit together. */
export interface AdminContentStore {
  overrides(): NpcOverride[];
  /** Writes the NPC layer (null removes it) and the journal entry in one transaction. */
  saveNpc(npcId: string, override: NpcOverride | null, entry: JournalInput): void;
  append(entry: JournalInput): void;
  /** ADMIN-SRV-014: durable counters, independent of journal retention; reset is also a change. */
  revisions(): Map<string, number>;
  /** `npc.seed` entries for NPC IDs that have none yet; returns how many were written. */
  seed(entries: readonly JournalInput[]): number;
  journal(filter: JournalFilter): { entries: JournalEntry[]; total: number };
  searchAccounts(query: string, now: number): AccountSummary[];
  account(nameKey: string, now: number): AccountSummary | null;
  /** Newest first, at most `limit`, including revoked and expired sessions still kept by AUTH pruning. */
  sessions(accountId: string, limit: number): AccountSession[];
}
