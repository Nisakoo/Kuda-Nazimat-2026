import type { NpcProfile, SceneReset, SceneView, WorldContentPort } from '../contracts.ts';
import type { Clock } from '../common/time.ts';
import type { Logger } from '../common/logger.ts';
import type { NpcDefinition } from '../world/npcContent.ts';
import { ContentError, buildRecords, changes, editableFields, liveNpcs, nextOverride, validateCreate, validatePatch, type NpcContext, type NpcRecord } from './NpcCatalog.ts';
import type { AccountSession, AdminContentStore, JournalEntry, JournalFilter, JournalInput } from './ports.ts';

export interface ContentAdminDeps {
  readonly store: AdminContentStore;
  readonly world: WorldContentPort;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Player avatar asset IDs that every client can draw (ADMIN-SRV-002). */
  readonly avatarAssets: readonly string[];
  /** NPC IDs of the BABEL task (ADMIN-SRV-007). */
  readonly questNpcs: ReadonlySet<string>;
  /** ADMIN-SRV-005: aborts unfinished questions to a withdrawn NPC. */
  cancelNpc?(npcId: string): void;
  lockedUntil?(name: string): number | null;
  location?(accountId: string): { mapId: string } | null;
}
export interface NpcView {
  readonly id: string; readonly origin: 'content' | 'admin'; readonly embedded: boolean; readonly quest: boolean;
  readonly enabled: boolean; readonly deleted: boolean; readonly overridden: readonly string[]; readonly editable: readonly string[];
  readonly mapId: string; readonly name: string; readonly topic: string; readonly persona: string; readonly greeting: string;
  readonly position: NpcDefinition['position']; readonly rotationY: number; readonly interactionRadius: number; readonly assetId: string | null;
  readonly original: NpcDefinition | null; readonly updatedAt: number | null;
}
const ACCOUNT_HISTORY = 50;

export interface AccountAction { readonly action: string; readonly accountId: string | null; readonly name: string; readonly result: Record<string, number | boolean> }
/** ADMIN-SRV-009 journal entry of an AUTH-010 action; shared by the screen and the CLI. */
export function accountEntry(entry: AccountAction, at: number, ip: string | null): JournalInput {
  return { at, actor: 'admin', ip, targetType: 'account', targetId: entry.accountId ?? `name:${entry.name.toLowerCase()}`, action: `account.${entry.action}`, before: null, after: { name: entry.name, ...entry.result } };
}

/**
 * ADMIN-SRV-001–011 use cases: the NPC layer applied to the live world, the world-life scene,
 * the change journal and account views. HTTP checks access; this service checks content.
 */
export function createContentAdmin(deps: ContentAdminDeps) {
  const { store, world, clock } = deps;
  const log = deps.logger.child('admin');
  const appearances = new Set([...world.baseNpcs.flatMap((npc) => npc.assetId ? [npc.assetId] : []), ...deps.avatarAssets]);
  const maps = new Set(world.maps().map((map) => map.mapId));
  const context: NpcContext = { surface: (mapId, x, z) => world.surface(mapId, x, z), appearances };
  let records = new Map<string, NpcRecord>();

  const view = (r: NpcRecord): NpcView => ({
    id: r.id, origin: r.origin, embedded: r.embedded, quest: deps.questNpcs.has(r.id), enabled: r.enabled, deleted: r.deleted,
    overridden: r.overridden, editable: r.deleted ? [] : editableFields(r),
    mapId: r.npc.mapId, name: r.npc.name, topic: r.npc.topic, persona: r.npc.persona, greeting: r.npc.greeting,
    position: r.npc.position, rotationY: r.npc.rotationY, interactionRadius: r.npc.interactionRadius, assetId: r.npc.assetId ?? null,
    original: r.base, updatedAt: r.updatedAt,
  });
  const record = (id: string): NpcRecord => records.get(id) ?? (() => { throw new ContentError('NOT_FOUND', 'Персонаж не найден.'); })();

  /** Rebuilds from storage and replaces the world NPCs; questions to NPCs that left are cancelled. */
  function reload(): void {
    const before = new Set(liveNpcs([...records.values()]).map((npc) => npc.id));
    const built = buildRecords(world.baseNpcs, store.overrides());
    records = new Map(built.records.map((r) => [r.id, r]));
    const live = liveNpcs(built.records);
    world.setNpcs(live);
    const now = new Set(live.map((npc) => npc.id));
    for (const id of before) if (!now.has(id)) deps.cancelNpc?.(id);
  }
  function change(r: NpcRecord, next: ReturnType<typeof nextOverride>, action: string, ip: string | null): NpcView {
    const preview = buildRecords(world.baseNpcs.filter((npc) => npc.id === r.id), next ? [next] : []).records.find((x) => x.id === r.id) ?? null;
    const diff = changes(r, preview);
    if (!diff.fields.length) return view(r);
    store.saveNpc(r.id, next, { at: clock.now(), actor: 'admin', ip, targetType: 'npc', targetId: r.id, action, before: diff.before, after: diff.after });
    log.info('admin.change', 'Администратор изменил персонажа', { action, targetType: 'npc', targetId: r.id, fields: diff.fields });
    reload();
    return view(record(r.id));
  }

  return {
    /** Startup: orphaned edits are reported, NPCs from the file get their seed entry once, the layer goes live. */
    start(): void {
      const built = buildRecords(world.baseNpcs, store.overrides());
      for (const id of built.orphaned) log.warn('admin.npc.orphaned', 'Правка персонажа не применена: его нет в npcs.json или идентификатор занят', { targetId: id });
      const at = clock.now();
      store.seed(world.baseNpcs.map((npc): JournalInput => ({ at, actor: 'seed', ip: null, targetType: 'npc', targetId: npc.id, action: 'npc.seed', before: null, after: { ...npc } })));
      reload();
    },

    list(filter: { map?: string; q?: string; deleted?: boolean } = {}) {
      const all = [...records.values()];
      const q = filter.q?.trim().toLowerCase();
      const shown = all.filter((r) => (filter.deleted || !r.deleted) && (!filter.map || r.npc.mapId === filter.map)
        && (!q || [r.id, r.npc.name, r.npc.topic].some((value) => value.toLowerCase().includes(q))));
      return { npcs: shown.map(view), total: all.length, maps: [...maps].map((mapId) => ({ mapId })), appearances: [...appearances] };
    },
    get(id: string) {
      return { npc: view(record(id)), history: store.journal({ target: 'npc', id, order: 'desc', offset: 0, limit: 50 }).entries };
    },
    create(input: Record<string, unknown>, ip: string | null): NpcView {
      const npc = validateCreate(input, new Set(records.keys()), context, maps);
      const { id: _id, ...fields } = npc;
      const now = clock.now();
      store.saveNpc(npc.id, { npcId: npc.id, origin: 'admin', fields, enabled: true, deletedAt: null, updatedAt: now },
        { at: now, actor: 'admin', ip, targetType: 'npc', targetId: npc.id, action: 'npc.create', before: null, after: { ...npc } });
      log.info('admin.change', 'Администратор создал персонажа', { action: 'npc.create', targetType: 'npc', targetId: npc.id, fields: Object.keys(fields) });
      reload();
      return view(record(npc.id));
    },
    update(id: string, patch: Record<string, unknown>, ip: string | null): NpcView {
      const r = record(id);
      const { fields, enabled } = validatePatch(r, patch, context, maps);
      const action = Object.keys(fields).length ? 'npc.update' : enabled ? 'npc.enable' : 'npc.disable';
      return change(r, nextOverride(r, { fields, ...(enabled === undefined ? {} : { enabled }) }, clock.now()), action, ip);
    },
    remove(id: string, ip: string | null): NpcView {
      const r = record(id);
      if (r.deleted) throw new ContentError('CONFLICT', 'Персонаж уже удалён.');
      return change(r, nextOverride(r, { deletedAt: clock.now() }, clock.now()), 'npc.delete', ip);
    },
    restore(id: string, ip: string | null): NpcView {
      const r = record(id);
      if (!r.deleted) throw new ContentError('CONFLICT', 'Персонаж не удалён.');
      return change(r, nextOverride(r, { deletedAt: null }, clock.now()), 'npc.restore', ip);
    },
    reset(id: string, ip: string | null): NpcView {
      const r = record(id);
      if (r.origin === 'admin') throw new ContentError('CONFLICT', 'Созданного администратором персонажа нельзя сбросить: исходника нет.');
      return change(r, null, 'npc.reset', ip);
    },

    world(): { maps: { mapId: string; chunks: number; npcs: number; scene: SceneView | null }[] } {
      return { maps: world.maps().map((map) => ({ ...map, scene: world.scene(map.mapId) })) };
    },
    resetScene(mapId: string, ip: string | null): SceneReset & { mapId: string } {
      if (!maps.has(mapId)) throw new ContentError('NOT_FOUND', 'Карта не найдена.');
      const result = world.resetScene(mapId);
      if (!result) throw new ContentError('CONFLICT', 'На этой карте нет живой сцены.');
      store.append({ at: clock.now(), actor: 'admin', ip, targetType: 'world', targetId: mapId, action: 'world.reset-scene', before: null, after: { reset: result.reset, skipped: result.skipped } });
      log.info('admin.change', 'Администратор сбросил сцену', { action: 'world.reset-scene', targetType: 'world', targetId: mapId, fields: [] });
      return { mapId, ...result };
    },

    journal(filter: JournalFilter): { entries: JournalEntry[]; total: number } { return store.journal(filter); },
    /** AUTH-010 actions from the screen and the CLI (ADMIN-SRV-010); the temporary password never arrives here. */
    audit(entry: AccountAction, ip: string | null = null): void {
      store.append(accountEntry(entry, clock.now(), ip));
      log.info('admin.change', 'Действие администратора с аккаунтом', { action: `account.${entry.action}`, targetType: 'account', targetId: entry.accountId, fields: [] });
    },

    accounts(query: string) {
      return store.searchAccounts(query.trim(), clock.now()).map(({ accountId, ...account }) => ({
        ...account, lockedUntil: deps.lockedUntil?.(account.name) ?? null, mapId: deps.location?.(accountId)?.mapId ?? null,
      }));
    },
    account(name: string) {
      const now = clock.now();
      const found = store.account(name.trim().toLowerCase(), now);
      if (!found) throw new ContentError('NOT_FOUND', 'Аккаунт не найден.');
      const { accountId, ...account } = found;
      const sessions = store.sessions(accountId, ACCOUNT_HISTORY);
      const login = (s: AccountSession) => ({ at: s.createdAt, action: 'login', actor: 'player', result: s.revokedAt !== null ? `revoked:${s.revokeReason ?? 'unknown'}` : s.expiresAt <= now ? 'expired' : 'active' });
      const actions = store.journal({ target: 'account', id: accountId, order: 'desc', offset: 0, limit: ACCOUNT_HISTORY }).entries
        .map((e) => ({ at: e.at, action: e.action, actor: e.actor, result: e.after ? Object.entries(e.after).filter(([key]) => key !== 'name').map(([key, value]) => `${key}:${String(value)}`).join(',') : '' }));
      return {
        ...account, lockedUntil: deps.lockedUntil?.(account.name) ?? null, mapId: deps.location?.(accountId)?.mapId ?? null,
        sessions: sessions.filter((s) => s.revokedAt === null && s.expiresAt > now).map((s) => ({ createdAt: s.createdAt, expiresAt: s.expiresAt, ip: s.ip })),
        history: [...sessions.map(login), ...actions].sort((a, b) => b.at - a.at).slice(0, ACCOUNT_HISTORY),
      };
    },

    /** ADMIN-SRV-007: the live NPC for BABEL; null when disabled or deleted, undefined when the world has no such NPC. */
    babylonNpc(id: string): { profile: NpcProfile; mapId: string; x: number; z: number } | null | undefined {
      const r = records.get(id);
      if (!r) return undefined;
      if (!r.enabled || r.deleted) return null;
      const { name, topic, persona, greeting } = r.npc;
      return { profile: { id, name, topic, persona, greeting }, mapId: r.npc.mapId, x: r.npc.position.x, z: r.npc.position.z };
    },
  };
}
export type ContentAdmin = ReturnType<typeof createContentAdmin>;
