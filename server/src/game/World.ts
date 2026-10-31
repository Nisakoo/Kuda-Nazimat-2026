import type { Direction, Entity, Vector3 } from '../../../shared/world/types.ts';
import type { GameMap } from '../world/GameMap.ts';
import type { NpcDefinition } from '../world/npcContent.ts';

export interface WorldSettings {
  readonly speed: number;            // m/s
  readonly intentTimeoutMs: number;  // PROTO-008 §4
  readonly aoiRadius: number;        // m
  readonly interactTolerance: number;
}
export const DEFAULT_WORLD_SETTINGS: WorldSettings = { speed: 3, intentTimeoutMs: 250, aoiRadius: 64, interactTolerance: 0.5 };
const MAX_AOI = 256;
const ZERO: Direction = { x: 0, z: 0 };

interface Player {
  readonly id: string;
  readonly name: string;
  readonly mapId: string;
  position: Vector3;
  rotationY: number;
  intent: Direction;
  intentAt: number;
  applied: Direction;
  prepared: ReadonlySet<string>;
  lastSequence: number;
  dirty: boolean;
}
export interface PlacedPlayer { readonly id: string; readonly name: string; readonly mapId: string; readonly position: Vector3; readonly rotationY: number }
export type InteractionCheck = { readonly ok: true; readonly npc: NpcDefinition } | { readonly ok: false; readonly reason: 'not-found' | 'too-far' };

/** Authoritative headless world: players, NPCs, movement and visibility. Time arrives as arguments. */
export class World {
  private readonly players = new Map<string, Player>();
  private readonly npcs: ReadonlyMap<string, NpcDefinition>;
  private ticks = 0;
  private readonly maps: ReadonlyMap<string, GameMap>;
  private readonly settings: WorldSettings;

  constructor(maps: ReadonlyMap<string, GameMap>, npcs: readonly NpcDefinition[], settings: WorldSettings = DEFAULT_WORLD_SETTINGS) {
    this.maps = maps;
    this.settings = settings;
    this.npcs = new Map(npcs.map((npc) => [npc.id, npc]));
  }

  get tick(): number { return this.ticks; }

  map(mapId: string): GameMap | undefined { return this.maps.get(mapId); }
  has(playerId: string): boolean { return this.players.has(playerId); }

  add(player: PlacedPlayer): void {
    this.players.set(player.id, { ...player, intent: ZERO, intentAt: 0, applied: ZERO, prepared: new Set(), lastSequence: 0, dirty: false });
  }
  remove(playerId: string): void { this.players.delete(playerId); }

  /** Where the player is now, or undefined if not in the world. */
  locate(playerId: string): PlacedPlayer | undefined {
    const p = this.players.get(playerId);
    return p && { id: p.id, name: p.name, mapId: p.mapId, position: p.position, rotationY: p.rotationY };
  }

  /** A new connection restarts sequence numbering and readiness (PROTO v1). */
  resetInput(playerId: string): void {
    const p = this.players.get(playerId);
    if (p) { p.intent = ZERO; p.applied = ZERO; p.prepared = new Set(); p.lastSequence = 0; }
  }

  /** Latest-intent input; stale sequences and unknown chunk IDs are ignored. */
  setIntent(playerId: string, sequence: number, direction: Direction, preparedChunks: readonly string[], now: number): void {
    const p = this.players.get(playerId);
    if (!p || sequence <= p.lastSequence) return;
    const map = this.maps.get(p.mapId)!;
    p.lastSequence = sequence;
    p.intent = direction;
    p.intentAt = now;
    p.prepared = new Set(preparedChunks.filter((id) => map.hasChunk(id)));
  }

  step(deltaSeconds: number, now: number): void {
    this.ticks++;
    for (const p of this.players.values()) this.move(p, deltaSeconds, now);
  }

  private move(p: Player, dt: number, now: number): void {
    const intent = now - p.intentAt > this.settings.intentTimeoutMs ? ZERO : p.intent;
    const length = Math.hypot(intent.x, intent.z);
    if (length === 0) { p.applied = ZERO; return; }
    const scale = Math.min(1, length) / length;
    const step = this.settings.speed * dt;
    const dx = intent.x * scale * step;
    const dz = intent.z * scale * step;
    // Full step, then slide along one axis (REALTIME-003).
    for (const [mx, mz] of [[dx, dz], [dx, 0], [0, dz]] as const) {
      if (mx === 0 && mz === 0) continue;
      const x = p.position.x + mx; const z = p.position.z + mz;
      if (!this.canStand(p, x, z)) continue;
      p.position = { x, y: p.position.y, z };
      p.rotationY = Math.atan2(mx, mz);
      p.applied = { x: mx / step, z: mz / step };
      p.dirty = true;
      return;
    }
    p.applied = ZERO;
  }

  private canStand(p: Player, x: number, z: number): boolean {
    const map = this.maps.get(p.mapId)!;
    if (!map.isWalkable(x, z)) return false;
    const chunks = map.footprintChunkIds(x, z);
    return chunks !== null && chunks.every((id) => p.prepared.has(id));
  }

  /** In v1 only NPCs are interactable. */
  checkInteraction(playerId: string, targetId: string): InteractionCheck {
    const p = this.players.get(playerId);
    const npc = this.npcs.get(targetId);
    if (!p || !npc || npc.mapId !== p.mapId) return { ok: false, reason: 'not-found' };
    const distance = Math.hypot(p.position.x - npc.position.x, p.position.y - npc.position.y, p.position.z - npc.position.z);
    return distance <= npc.interactionRadius + this.settings.interactTolerance ? { ok: true, npc } : { ok: false, reason: 'too-far' };
  }

  /** Positions changed since the last call, for periodic persistence. */
  takeDirty(): PlacedPlayer[] {
    const result: PlacedPlayer[] = [];
    for (const p of this.players.values()) if (p.dirty) { p.dirty = false; result.push(this.locate(p.id)!); }
    return result;
  }

  /** Area of interest: self plus nearest entities of the same map within aoiRadius (REALTIME-005). */
  aoi(playerId: string): Entity[] {
    const self = this.players.get(playerId);
    if (!self) return [];
    const near: { distance: number; entity: Entity }[] = [];
    const consider = (position: Vector3, entity: () => Entity): void => {
      const distance = Math.hypot(position.x - self.position.x, position.z - self.position.z);
      if (distance <= this.settings.aoiRadius) near.push({ distance, entity: entity() });
    };
    for (const p of this.players.values()) if (p.mapId === self.mapId && p !== self) consider(p.position, () => this.playerEntity(p));
    for (const npc of this.npcs.values()) if (npc.mapId === self.mapId) consider(npc.position, () => npcEntity(npc));
    near.sort((a, b) => a.distance - b.distance);
    return [this.playerEntity(self), ...near.slice(0, MAX_AOI - 1).map((item) => item.entity)];
  }

  private playerEntity(p: Player): Entity {
    return {
      id: p.id,
      character: { kind: 'player', name: p.name },
      transform: { position: p.position, rotationY: p.rotationY },
      movement: { direction: p.applied, speed: this.settings.speed },
      renderable: { assetId: 'demo-player' },
      animationState: { name: 'idle' },
    };
  }
}

/** Market NPCs have no assetId: their figures are drawn by the chunk GLB, so no renderable (SERVER-WORLD-008). */
function npcEntity(npc: NpcDefinition): Entity {
  return {
    id: npc.id,
    character: { kind: 'npc', name: npc.name },
    transform: { position: npc.position, rotationY: npc.rotationY },
    interactable: { radius: npc.interactionRadius, label: npc.topic },
    ...(npc.assetId ? { renderable: { assetId: npc.assetId } } : {}),
    animationState: { name: 'idle' },
  };
}
