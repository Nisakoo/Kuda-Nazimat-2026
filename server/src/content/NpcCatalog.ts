import type { Vector3 } from '../../../shared/world/types.ts';
import { NPC_LIMITS, type NpcDefinition } from '../world/npcContent.ts';

/**
 * ADMIN-SRV-001–004: the administrator's layer over contentDir/npcs.json. Pure: validation, merge and
 * diff; storage, journal and the live world are the caller's.
 */
export type NpcFields = Omit<NpcDefinition, 'id'>;
export type NpcField = keyof NpcFields;
export interface NpcOverride {
  readonly npcId: string;
  /** `content` stores changed fields of a file NPC; `admin` stores a created NPC whole. */
  readonly origin: 'content' | 'admin';
  readonly fields: Partial<NpcFields>;
  readonly enabled: boolean;
  readonly deletedAt: number | null;
  readonly updatedAt: number;
}
export interface NpcRecord {
  readonly id: string;
  readonly origin: 'content' | 'admin';
  readonly base: NpcDefinition | null;
  readonly npc: NpcDefinition;
  readonly enabled: boolean;
  readonly deleted: boolean;
  readonly deletedAt: number | null;
  /** No own model: the figure is part of a GLB chunk, so it cannot move or change appearance. */
  readonly embedded: boolean;
  readonly overridden: readonly NpcField[];
  readonly updatedAt: number | null;
}
/** Placement and appearance facts the catalog cannot know itself. */
export interface NpcContext {
  /** Surface height inside the map's chunks, otherwise null. */
  surface(mapId: string, x: number, z: number): number | null;
  readonly appearances: ReadonlySet<string>;
}
export class ContentError extends Error {
  readonly code: 'INVALID' | 'NOT_FOUND' | 'CONFLICT';
  constructor(code: ContentError['code'], message: string) { super(message); this.code = code; }
}

export const MAX_NPCS = 64;
export const DEFAULT_RADIUS = 2.5;
const TEXT = { name: NPC_LIMITS.name, topic: NPC_LIMITS.topic, persona: NPC_LIMITS.persona, greeting: NPC_LIMITS.greeting } as const;
const TEXT_FIELDS = ['name', 'topic', 'persona', 'greeting'] as const;
const EMBEDDED_FIELDS = [...TEXT_FIELDS, 'interactionRadius'] as const;
const ALL_FIELDS = [...EMBEDDED_FIELDS, 'mapId', 'position', 'rotationY', 'assetId'] as const;
const LABELS: Record<NpcField, string> = { name: 'Имя', topic: 'Тема', persona: 'Характер', greeting: 'Приветствие', interactionRadius: 'Радиус разговора', mapId: 'Карта', position: 'Позиция', rotationY: 'Поворот', assetId: 'Облик' };

const invalid = (message: string): never => { throw new ContentError('INVALID', message); };
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function text(field: keyof typeof TEXT, value: unknown): string {
  const max = TEXT[field];
  if (typeof value !== 'string' || /[\x00-\x1f\x7f-\x9f]/.test(value) || !value.trim() || value.trim().length > max) invalid(`${LABELS[field]}: от 1 до ${max} символов в одну строку.`);
  return (value as string).trim();
}
function finite(field: NpcField, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(`${LABELS[field]}: число от ${min} до ${max}.`);
  return value as number;
}

/** Editable fields of a record; `enabled` is always editable. */
export function editableFields(record: Pick<NpcRecord, 'embedded'>): readonly (NpcField | 'enabled')[] {
  return [...(record.embedded ? EMBEDDED_FIELDS : ALL_FIELDS), 'enabled'];
}

/** Merges overrides into the file NPCs; overrides that no longer fit the file are reported, not applied. */
export function buildRecords(base: readonly NpcDefinition[], overrides: readonly NpcOverride[]): { records: NpcRecord[]; orphaned: string[] } {
  const byId = new Map(overrides.map((o) => [o.npcId, o]));
  const records: NpcRecord[] = []; const orphaned: string[] = [];
  for (const npc of base) {
    const o = byId.get(npc.id);
    if (o?.origin === 'admin') orphaned.push(npc.id);
    const layer = o?.origin === 'content' ? o : undefined;
    const merged: NpcDefinition = { ...npc, ...layer?.fields, id: npc.id };
    records.push({
      id: npc.id, origin: 'content', base: npc, npc: merged, enabled: layer?.enabled ?? true, deleted: (layer?.deletedAt ?? null) !== null, deletedAt: layer?.deletedAt ?? null,
      embedded: !npc.assetId, overridden: ALL_FIELDS.filter((field) => !same(merged[field], npc[field])), updatedAt: layer?.updatedAt ?? null,
    });
  }
  const known = new Set(base.map((npc) => npc.id));
  for (const o of overrides) {
    if (known.has(o.npcId)) continue;
    const f = o.fields;
    if (o.origin !== 'admin' || !f.mapId || !f.name || !f.topic || !f.persona || !f.greeting || !f.position || f.rotationY === undefined || f.interactionRadius === undefined || !f.assetId) { orphaned.push(o.npcId); continue; }
    const npc: NpcDefinition = { id: o.npcId, mapId: f.mapId, name: f.name, topic: f.topic, persona: f.persona, greeting: f.greeting, position: f.position, rotationY: f.rotationY, interactionRadius: f.interactionRadius, assetId: f.assetId };
    records.push({ id: o.npcId, origin: 'admin', base: null, npc, enabled: o.enabled, deleted: o.deletedAt !== null, deletedAt: o.deletedAt, embedded: false, overridden: [], updatedAt: o.updatedAt });
  }
  return { records, orphaned };
}

/** NPCs that exist in the world: enabled and not deleted. */
export function liveNpcs(records: readonly NpcRecord[]): NpcDefinition[] {
  return records.filter((record) => record.enabled && !record.deleted).map((record) => record.npc);
}

function placement(input: Record<string, unknown>, mapId: string, current: Vector3 | null, context: NpcContext): Vector3 {
  const raw = input.position;
  if (raw === undefined) {
    if (!current || context.surface(mapId, current.x, current.z) === null) invalid('Позиция: укажите место на этой карте.');
    return current!;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((key) => !['x', 'y', 'z'].includes(key))) return invalid('Позиция: ожидается {x, z} и необязательный y.');
  const p = raw as Record<string, unknown>;
  const x = finite('position', p.x, -NPC_LIMITS.maxCoordinate, NPC_LIMITS.maxCoordinate);
  const z = finite('position', p.z, -NPC_LIMITS.maxCoordinate, NPC_LIMITS.maxCoordinate);
  const surface = context.surface(mapId, x, z);
  if (surface === null) invalid('Позиция вне чанков карты.');
  const y = p.y === undefined ? surface! : finite('position', p.y, -NPC_LIMITS.maxCoordinate, NPC_LIMITS.maxCoordinate);
  return { x, y, z };
}
function mapOf(value: unknown, maps: ReadonlySet<string>): string {
  if (typeof value !== 'string' || !maps.has(value)) invalid('Карта: неизвестная карта.');
  return value as string;
}

/** ADMIN-SRV-002: validated change of a record; throws ContentError on a forbidden or invalid field. */
export function validatePatch(record: NpcRecord, patch: Record<string, unknown>, context: NpcContext, maps: ReadonlySet<string>): { fields: Partial<NpcFields>; enabled?: boolean } {
  if (record.deleted) throw new ContentError('CONFLICT', 'Персонаж удалён: сначала восстановите его.');
  const allowed = editableFields(record);
  const keys = Object.keys(patch);
  if (!keys.length) invalid('Нет изменений.');
  for (const key of keys) if (!allowed.includes(key as NpcField)) invalid(record.embedded && (ALL_FIELDS as readonly string[]).includes(key)
    ? `${LABELS[key as NpcField]}: фигура этого персонажа нарисована в карте, её нельзя переместить или сменить облик.` : `Неизвестное поле: ${key}.`);
  const fields: { -readonly [K in NpcField]?: NpcFields[K] } = {};
  for (const field of TEXT_FIELDS) if (field in patch) fields[field] = text(field, patch[field]);
  if ('interactionRadius' in patch) fields.interactionRadius = finite('interactionRadius', patch.interactionRadius, 0, NPC_LIMITS.maxRadius);
  if ('rotationY' in patch) fields.rotationY = finite('rotationY', patch.rotationY, -NPC_LIMITS.maxCoordinate, NPC_LIMITS.maxCoordinate);
  if ('assetId' in patch) { if (typeof patch.assetId !== 'string' || !context.appearances.has(patch.assetId)) invalid('Облик: выберите облик из списка.'); fields.assetId = patch.assetId as string; }
  if ('mapId' in patch) fields.mapId = mapOf(patch.mapId, maps);
  if ('mapId' in patch || 'position' in patch) fields.position = placement(patch, fields.mapId ?? record.npc.mapId, 'position' in patch ? null : record.npc.position, context);
  let enabled: boolean | undefined;
  if ('enabled' in patch) { if (typeof patch.enabled !== 'boolean') invalid('Включён: true или false.'); enabled = patch.enabled as boolean; }
  return { fields, ...(enabled === undefined ? {} : { enabled }) };
}

/** ADMIN-SRV-003: a new NPC with an appearance from the closed list. */
export function validateCreate(input: Record<string, unknown>, taken: ReadonlySet<string>, context: NpcContext, maps: ReadonlySet<string>): NpcDefinition {
  const known = ['id', 'mapId', 'name', 'topic', 'persona', 'greeting', 'position', 'rotationY', 'interactionRadius', 'assetId'];
  for (const key of Object.keys(input)) if (!known.includes(key)) invalid(`Неизвестное поле: ${key}.`);
  const id = input.id;
  if (typeof id !== 'string' || !NPC_LIMITS.id.test(id)) invalid('Идентификатор: латиница, цифры, «-» и «_», до 80 символов.');
  if (taken.has(id as string)) throw new ContentError('CONFLICT', 'Персонаж с таким идентификатором уже есть.');
  if (taken.size >= MAX_NPCS) throw new ContentError('CONFLICT', `Персонажей не может быть больше ${MAX_NPCS}.`);
  const mapId = mapOf(input.mapId, maps);
  if (typeof input.assetId !== 'string' || !context.appearances.has(input.assetId)) invalid('Облик: выберите облик из списка.');
  return {
    id: id as string, mapId, name: text('name', input.name), topic: text('topic', input.topic), persona: text('persona', input.persona), greeting: text('greeting', input.greeting),
    position: placement(input, mapId, null, context),
    rotationY: input.rotationY === undefined ? 0 : finite('rotationY', input.rotationY, -NPC_LIMITS.maxCoordinate, NPC_LIMITS.maxCoordinate),
    interactionRadius: input.interactionRadius === undefined ? DEFAULT_RADIUS : finite('interactionRadius', input.interactionRadius, 0, NPC_LIMITS.maxRadius),
    assetId: input.assetId as string,
  };
}

/** The stored layer after a change: only fields that differ from the file for a file NPC. */
export function nextOverride(record: NpcRecord, change: { fields?: Partial<NpcFields>; enabled?: boolean; deletedAt?: number | null }, now: number): NpcOverride | null {
  const npc: NpcDefinition = { ...record.npc, ...change.fields };
  const enabled = change.enabled ?? record.enabled;
  const deletedAt = change.deletedAt !== undefined ? change.deletedAt : record.deletedAt;
  if (record.origin === 'admin') {
    const { id: _id, ...fields } = npc;
    return { npcId: record.id, origin: 'admin', fields, enabled, deletedAt, updatedAt: now };
  }
  const fields: { -readonly [K in NpcField]?: NpcFields[K] } = {};
  for (const field of ALL_FIELDS) if (!same(npc[field], record.base![field])) (fields as Record<string, unknown>)[field] = npc[field];
  if (!Object.keys(fields).length && enabled && deletedAt === null) return null;
  return { npcId: record.id, origin: 'content', fields, enabled, deletedAt, updatedAt: now };
}

/** Journal values: only what changed, including the on/off and deleted state. */
export function changes(before: NpcRecord | null, after: NpcRecord | null): { before: Record<string, unknown> | null; after: Record<string, unknown> | null; fields: string[] } {
  const view = (r: NpcRecord | null): Record<string, unknown> => r ? { ...r.npc, enabled: r.enabled, deleted: r.deleted } : {};
  const a = view(before); const b = view(after);
  const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => key !== 'id' && !same(a[key], b[key]));
  const pick = (source: Record<string, unknown>, r: NpcRecord | null) => r ? Object.fromEntries(fields.filter((key) => key in source).map((key) => [key, source[key]])) : null;
  return { before: pick(a, before), after: pick(b, after), fields };
}
