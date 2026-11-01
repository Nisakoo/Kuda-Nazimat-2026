import type { Vector3 } from '../../../shared/world/types.ts';

export interface NpcDefinition {
  readonly id: string;
  readonly mapId: string;
  readonly name: string;
  readonly topic: string;
  readonly persona: string;
  readonly greeting: string;
  readonly position: Vector3;
  readonly rotationY: number;
  readonly interactionRadius: number;
  /** Optional: market NPCs are drawn by the chunk GLB. */
  readonly assetId?: string;
  /** CONTENT-002: `map` when the figure is part of the map model; defaults by assetId. */
  readonly figure?: 'entity' | 'map';
}

/** CONTENT-004: current active NPCs; the editable catalogue implements it, a plain list is static. */
export interface NpcSource { active(): readonly NpcDefinition[]; get(id: string): NpcDefinition | undefined }

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const FIELDS = ['id', 'mapId', 'name', 'topic', 'persona', 'greeting', 'position', 'rotationY', 'interactionRadius', 'assetId', 'figure'];

function fail(index: number, field: string): never { throw new Error(`npcs.json[${index}].${field}: некорректное значение`); }
function text(value: unknown, index: number, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(index, field);
  return value;
}
function finite(value: unknown, index: number, field: string, min = -1e6, max = 1e6): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(index, field);
  return value;
}

/** SERVER-WORLD-008: strict parse of NPC content; map-dependent checks happen in the loader. */
export function parseNpcContent(raw: unknown): NpcDefinition[] {
  if (!Array.isArray(raw)) throw new Error('npcs.json должен быть массивом');
  const seen = new Set<string>();
  return raw.map((item, index): NpcDefinition => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(index, '*');
    const value = item as Record<string, unknown>;
    for (const key of Object.keys(value)) if (!FIELDS.includes(key)) fail(index, key);
    const id = text(value.id, index, 'id', 80); if (!ID.test(id) || seen.has(id)) fail(index, 'id'); seen.add(id);
    const assetId = value.assetId === undefined ? undefined : text(value.assetId, index, 'assetId', 80);
    if (assetId !== undefined && !ID.test(assetId)) fail(index, 'assetId');
    if (value.figure !== undefined && value.figure !== 'entity' && value.figure !== 'map') fail(index, 'figure');
    const position = value.position as Record<string, unknown> | undefined;
    if (!position || typeof position !== 'object') fail(index, 'position');
    return {
      id, ...(assetId ? { assetId } : {}), figure: (value.figure as 'entity' | 'map' | undefined) ?? (assetId ? 'entity' : 'map'),
      mapId: text(value.mapId, index, 'mapId', 80),
      name: text(value.name, index, 'name', 80),
      topic: text(value.topic, index, 'topic', 80),
      persona: text(value.persona, index, 'persona', 500),
      greeting: text(value.greeting, index, 'greeting', 500),
      position: { x: finite(position.x, index, 'position.x'), y: finite(position.y, index, 'position.y'), z: finite(position.z, index, 'position.z') },
      rotationY: finite(value.rotationY, index, 'rotationY'),
      interactionRadius: finite(value.interactionRadius, index, 'interactionRadius', 0, 20),
    };
  });
}
