import type { Clock } from '../common/time.ts';
import type { Logger } from '../common/logger.ts';
import { MetricsRegistry, type Metrics } from '../common/metrics.ts';
import type { NpcDefinition } from '../world/npcContent.ts';
import type { NpcAction, NpcChange, NpcRecord, NpcStore } from './ports.ts';

/** What the catalogue needs from a map to validate a move (GameMap satisfies it). */
export interface NpcMap { isSafeSupport(x: number, z: number): boolean; heightAt(x: number, z: number): number }
/** Author of a change (CONTENT-010); `seed` for npcs.json. */
export interface Actor { readonly id: string | null; readonly name: string; readonly ip: string | null }
export type ContentErrorCode = 'INVALID' | 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT';
export class ContentError extends Error {
  readonly code: ContentErrorCode;
  /** CONTENT-011: the current record on a revision conflict. */
  readonly current: NpcRecord | undefined;
  constructor(code: ContentErrorCode, message: string, current?: NpcRecord) { super(message); this.code = code; this.current = current; }
}
export interface BehaviourPatch { readonly persona?: unknown; readonly topic?: unknown; readonly greeting?: unknown; readonly interactionRadius?: unknown }

export const MAP_FIGURE_MESSAGE = 'Фигура нарисована в модели карты — нужна поддержка клиента.';
export const BABEL_MESSAGE = 'От этого NPC зависит задание BABEL: выключение и удаление пока запрещены.';
const SEED: Actor = { id: null, name: 'seed', ip: null };
const NPC_CLEARANCE = 1.2;
const TEXT = { persona: 500, topic: 80, greeting: 500 } as const;

/**
 * CONTENT: the single source of NPC data. Every change is committed with its change-log entry, then
 * replaces the in-memory copy, so the world, NPC dialogue and BABEL see it on their next read.
 */
export class NpcCatalog {
  private readonly records = new Map<string, NpcRecord>();
  private activeCache: NpcDefinition[] = [];
  private readonly store: NpcStore;
  private readonly maps: (mapId: string) => NpcMap | undefined;
  private readonly clock: Clock;
  private readonly log: Logger | undefined;
  private readonly babelRequired: ReadonlySet<string>;
  private readonly mapFiguresFromServer: boolean;
  private readonly changesTotal;

  constructor(deps: { store: NpcStore; maps: (mapId: string) => NpcMap | undefined; clock: Clock; babelRequired: ReadonlySet<string>; mapFiguresFromServer: boolean; logger?: Logger; metrics?: Metrics }) {
    this.store = deps.store; this.maps = deps.maps; this.clock = deps.clock; this.log = deps.logger;
    this.babelRequired = deps.babelRequired; this.mapFiguresFromServer = deps.mapFiguresFromServer;
    const metrics = deps.metrics ?? new MetricsRegistry();
    this.changesTotal = metrics.counter('content_npc_changes_total', 'Изменения каталога NPC по действию');
    metrics.gauge('game_npcs', 'NPC каталога по состоянию', () => (['active', 'disabled', 'deleted'] as const).map((state) => ({ labels: { state }, value: [...this.records.values()].filter((r) => r.state === state).length })));
    for (const record of this.store.all()) this.records.set(record.definition.id, record);
    this.refresh();
  }

  /** CONTENT-002: ids missing from the database are added; existing rows are never overwritten by the file. */
  seed(definitions: readonly NpcDefinition[]): void {
    for (const definition of definitions) {
      if (this.records.has(definition.id)) continue;
      const record: NpcRecord = { definition: { ...definition, figure: definition.figure ?? (definition.assetId ? 'entity' : 'map') }, state: 'active', revision: 1, updatedAt: this.clock.now(), updatedBy: SEED.name };
      this.commit(record, 'seed', SEED, { created: { from: null, to: definition.id } });
    }
  }

  /** Active NPCs as the world sees them; assetId of a map figure is hidden until the client draws it. */
  active(): readonly NpcDefinition[] { return this.activeCache; }
  get(id: string): NpcDefinition | undefined { return this.activeCache.find((npc) => npc.id === id); }
  record(id: string): NpcRecord | undefined { return this.records.get(id); }
  list(includeDeleted = false): NpcRecord[] { return [...this.records.values()].filter((r) => includeDeleted || r.state !== 'deleted'); }
  changes(npcId: string | null, limit = 50): NpcChange[] { return this.store.changes(npcId, Math.max(1, Math.min(200, limit))); }

  /** Why move/disable/delete are refused for this NPC (CONTENT-009); behaviour edits are always allowed. */
  restrictions(id: string): { mapFigure: boolean; babelRequired: boolean } {
    const record = this.records.get(id);
    return { mapFigure: record?.definition.figure === 'map' && !this.mapFiguresFromServer, babelRequired: this.babelRequired.has(id) };
  }

  /** CONTENT-005: persona, topic, greeting, interactionRadius. */
  update(id: string, revision: unknown, patch: BehaviourPatch, actor: Actor): NpcRecord {
    const record = this.editable(id, revision, 'update');
    const keys = Object.keys(patch) as (keyof BehaviourPatch)[];
    if (!keys.length || keys.some((key) => !['persona', 'topic', 'greeting', 'interactionRadius'].includes(key))) this.reject(id, 'update', 'INVALID', 'Можно менять только персону, тему, приветствие и радиус разговора.');
    const next: Record<string, unknown> = {};
    for (const key of keys) {
      const value = patch[key];
      if (key === 'interactionRadius') {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.5 || value > 10) this.reject(id, 'update', 'INVALID', 'Радиус разговора — число от 0,5 до 10 м.');
        next[key] = value;
      } else {
        const text = typeof value === 'string' ? value.trim() : '';
        const control = key === 'topic' ? /[\x00-\x1f\x7f-\x9f]/ : /[\x00-\x09\x0b-\x1f\x7f-\x9f]/;
        if (!text || text.length > TEXT[key] || control.test(text)) this.reject(id, 'update', 'INVALID', `Поле «${{ persona: 'персона', topic: 'тема', greeting: 'приветствие' }[key]}» — от 1 до ${TEXT[key]} символов без управляющих символов.`);
        next[key] = text;
      }
    }
    return this.change(record, 'update', actor, { ...record.definition, ...next } as NpcRecord['definition'], record.state);
  }

  /** CONTENT-006: same map, standable point with the shared walkability rule, 1.2 m from other NPCs. */
  move(id: string, revision: unknown, target: { x?: unknown; z?: unknown; rotationY?: unknown }, actor: Actor): NpcRecord {
    const record = this.editable(id, revision, 'move');
    this.forbidMapFigure(record, 'move');
    const { x, z } = target;
    const rotationY = target.rotationY ?? record.definition.rotationY;
    if (typeof x !== 'number' || typeof z !== 'number' || typeof rotationY !== 'number' || ![x, z, rotationY].every(Number.isFinite) || Math.abs(rotationY) > 1e6) this.reject(id, 'move', 'INVALID', 'Укажите числа x, z и при желании поворот.');
    const map = this.maps(record.definition.mapId);
    if (!map || !map.isSafeSupport(x as number, z as number)) this.reject(id, 'move', 'INVALID', 'Точка непроходима или вне карты.');
    const close = this.activeCache.some((npc) => npc.id !== id && npc.mapId === record.definition.mapId && Math.hypot(npc.position.x - (x as number), npc.position.z - (z as number)) < NPC_CLEARANCE);
    if (close) this.reject(id, 'move', 'INVALID', 'Слишком близко к другому NPC.');
    const position = { x: x as number, y: map!.heightAt(x as number, z as number), z: z as number };
    return this.change(record, 'move', actor, { ...record.definition, position, rotationY: rotationY as number }, record.state);
  }

  /** CONTENT-007. */
  setEnabled(id: string, revision: unknown, enabled: boolean, actor: Actor): NpcRecord {
    const action = enabled ? 'enable' : 'disable';
    const record = this.editable(id, revision, action);
    this.forbidMapFigure(record, action);
    if (!enabled) this.forbidBabel(record, action);
    if (record.state === (enabled ? 'active' : 'disabled')) return record;
    return this.change(record, action, actor, record.definition, enabled ? 'active' : 'disabled');
  }

  /** CONTENT-008: soft delete; the row and its log stay, the id is never reused. */
  remove(id: string, revision: unknown, actor: Actor): NpcRecord {
    const record = this.editable(id, revision, 'delete');
    this.forbidMapFigure(record, 'delete');
    this.forbidBabel(record, 'delete');
    return this.change(record, 'delete', actor, record.definition, 'deleted');
  }

  private editable(id: string, revision: unknown, action: NpcAction): NpcRecord {
    const record = this.records.get(id);
    if (!record || record.state === 'deleted') this.reject(id, action, 'NOT_FOUND', 'NPC не найден.');
    if (revision !== record!.revision) {
      this.log?.info('content.npc.rejected', 'Изменение NPC отклонено', { npcId: id, action, reason: 'CONFLICT', expected: revision, revision: record!.revision });
      throw new ContentError('CONFLICT', `NPC уже изменил ${record!.updatedBy}. Перечитайте данные и повторите.`, record);
    }
    return record!;
  }
  private forbidMapFigure(record: NpcRecord, action: NpcAction): void {
    if (this.restrictions(record.definition.id).mapFigure) this.reject(record.definition.id, action, 'FORBIDDEN', MAP_FIGURE_MESSAGE);
  }
  private forbidBabel(record: NpcRecord, action: NpcAction): void {
    if (this.babelRequired.has(record.definition.id)) this.reject(record.definition.id, action, 'FORBIDDEN', BABEL_MESSAGE);
  }
  private reject(npcId: string, action: NpcAction, code: ContentErrorCode, message: string): never {
    this.log?.info('content.npc.rejected', 'Изменение NPC отклонено', { npcId, action, reason: code, message });
    throw new ContentError(code, message);
  }

  private change(record: NpcRecord, action: NpcAction, actor: Actor, definition: NpcRecord['definition'], state: NpcRecord['state']): NpcRecord {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of ['persona', 'topic', 'greeting', 'interactionRadius', 'position', 'rotationY'] as const) {
      if (JSON.stringify(record.definition[key]) !== JSON.stringify(definition[key])) changes[key] = { from: record.definition[key], to: definition[key] };
    }
    if (record.state !== state) changes.state = { from: record.state, to: state };
    if (!Object.keys(changes).length) return record;
    return this.commit({ definition, state, revision: record.revision + 1, updatedAt: this.clock.now(), updatedBy: actor.name }, action, actor, changes);
  }

  private commit(record: NpcRecord, action: NpcAction, actor: Actor, changes: NpcChange['changes']): NpcRecord {
    this.store.save(record, { npcId: record.definition.id, at: record.updatedAt, action, actorId: actor.id, actorName: actor.name, ip: actor.ip, revision: record.revision, changes });
    this.records.set(record.definition.id, record);
    this.refresh();
    this.changesTotal.inc({ action });
    this.log?.info('content.npc.changed', 'NPC изменён', { npcId: record.definition.id, action, fields: Object.keys(changes), revision: record.revision, actorId: actor.id, actorName: actor.name, ip: actor.ip });
    return record;
  }

  private refresh(): void {
    this.activeCache = [...this.records.values()].filter((r) => r.state === 'active').map(({ definition }) => {
      if (definition.figure !== 'map' || this.mapFiguresFromServer) return definition;
      const { assetId: _hidden, ...rest } = definition;
      return rest;
    });
  }
}
