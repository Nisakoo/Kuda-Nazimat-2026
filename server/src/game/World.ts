import type { Direction, Entity, Vector3 } from '../../../shared/world/types.ts';
import { avatarAssetId, type AvatarId } from '../../../shared/avatar/index.ts';
import type { ToolId } from '../../../shared/equipment/types.ts';
import type { GameMap } from '../world/GameMap.ts';
import type { WorldLife } from './WorldLife.ts';
import type { NpcDefinition } from '../world/npcContent.ts';
import { MOVEMENT, initialMotion, motionStatus, recoverMotion, stepMotion } from '../../../shared/movement/simulation.ts';
import type { MotionState, MovementEnvironment } from '../../../shared/movement/simulation.ts';

export interface WorldSettings {
  readonly speed: number;            // m/s
  readonly intentTimeoutMs: number;  // PROTO-008 §4
  readonly aoiRadius: number;        // m
  readonly interactTolerance: number;
}
export const DEFAULT_WORLD_SETTINGS: WorldSettings = { speed: MOVEMENT.walkSpeed, intentTimeoutMs: 250, aoiRadius: 64, interactTolerance: 0.5 };
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
  motion: MotionState;
  sprint: boolean;
  jumpId: number;
  avatarId: AvatarId | null;
  tool: ToolId | null;
}
export interface PlacedPlayer { readonly id: string; readonly name: string; readonly mapId: string; readonly position: Vector3; readonly rotationY: number }
/** OBS-003/005 hooks; the domain reports, the composition root logs. All optional. */
export interface WorldObserver {
  invariant?(name: string, fields: Record<string, unknown>): void;
  recovered?(playerId: string, reason: string): void;
  aoiTruncated?(playerId: string, candidates: number): void;
}
export type InteractionCheck = { readonly ok: true; readonly npc: NpcDefinition } | { readonly ok: false; readonly reason: 'not-found' | 'too-far' };

/** Authoritative headless world: players, NPCs, movement and visibility. Time arrives as arguments. */
export class World {
  private readonly players = new Map<string, Player>();
  private readonly resting = new Map<string, Pick<MotionState, 'stamina' | 'recoveryWait' | 'sprintBlocked' | 'releasedAfterExhaustion'>>();
  private readonly npcs: ReadonlyMap<string, NpcDefinition>;
  private ticks = 0;
  private readonly maps: ReadonlyMap<string, GameMap>;
  private readonly settings: WorldSettings;
  readonly life?: WorldLife;

  private readonly observer: WorldObserver;

  constructor(maps: ReadonlyMap<string, GameMap>, npcs: readonly NpcDefinition[], settings: WorldSettings = DEFAULT_WORLD_SETTINGS, observer: WorldObserver = {}, life?: WorldLife) {
    this.life = life;
    this.maps = maps;
    this.settings = settings;
    this.observer = observer;
    this.npcs = new Map(npcs.map((npc) => [npc.id, npc]));
  }

  get tick(): number { return this.ticks; }

  map(mapId: string): GameMap | undefined { return this.maps.get(mapId); }
  isSafeSupport(mapId: string, position: Vector3): boolean {
    const map = this.maps.get(mapId);
    return !!map?.isSafeSupport(position.x,position.z) && (!this.life || this.life.clearPots(mapId,position,position));
  }
  has(playerId: string): boolean { return this.players.has(playerId); }

  setAvatar(playerId: string, avatarId: AvatarId | null): void {
    const player = this.players.get(playerId);
    if (player) player.avatarId = avatarId;
  }

  setEquipment(playerId: string, tool: ToolId | null): void {
    const player = this.players.get(playerId);
    if (player) player.tool = tool;
  }

  add(player: PlacedPlayer): void {
    const map = this.maps.get(player.mapId)!;
    const support = this.isSafeSupport(player.mapId, player.position) ? player.position : map.spawn;
    const position = { ...support, y: map.heightAt(support.x, support.z) };
    const motion = { ...initialMotion(position), ...this.resting.get(player.id) };
    this.resting.delete(player.id);
    const p = { ...player, avatarId: null, tool: null, position, motion: { ...motion, safePosition: map.isSafeSupport(position.x, position.z) ? position : map.spawn }, sprint: false, jumpId: 0, intent: ZERO, intentAt: 0, applied: ZERO, prepared: new Set<string>(), lastSequence: 0, dirty: false };
    p.motion = recoverMotion(p.motion, this.environment(p));
    p.position = p.motion.position;
    this.players.set(player.id, p);
  }
  remove(playerId: string): void {
    const state = this.players.get(playerId)?.motion;
    if (state && state.stamina < 100) this.resting.set(playerId, { stamina: state.stamina, recoveryWait: state.recoveryWait, sprintBlocked: state.sprintBlocked, releasedAfterExhaustion: true });
    this.players.delete(playerId);
  }

  /** Where the player is now, or undefined if not in the world. */
  locate(playerId: string): PlacedPlayer | undefined {
    const p = this.players.get(playerId);
    return p && { id: p.id, name: p.name, mapId: p.mapId, position: p.position, rotationY: p.rotationY };
  }

  /** Current positions of every player on a map (REALTIME-010 spawn clearance). */
  playerPositions(mapId: string): Vector3[] {
    return [...this.players.values()].filter((p) => p.mapId === mapId).map((p) => p.position);
  }

  isGrounded(playerId: string): boolean { return this.players.get(playerId)?.motion.grounded === true; }

  placedPlayers(): readonly PlacedPlayer[] { return [...this.players.keys()].map(id => this.locate(id)!); }

  /** A new connection restarts sequence numbering and readiness (PROTO v3). */
  resetInput(playerId: string): void {
    const p = this.players.get(playerId);
    if (p) { p.intent = ZERO; p.sprint = false; p.jumpId = 0; p.motion = { ...p.motion, jumpAck: 0 }; p.applied = ZERO; p.prepared = new Set(); p.lastSequence = 0; }
  }

  /** Latest-intent input; stale sequences and unknown chunk IDs are ignored. */
  setIntent(playerId: string, sequence: number, direction: Direction, preparedChunks: readonly string[], now: number, sprint = false, jumpId = 0): void {
    const p = this.players.get(playerId);
    if (!p || sequence <= p.lastSequence) return;
    const map = this.maps.get(p.mapId)!;
    p.lastSequence = sequence;
    p.intent = direction;
    p.intentAt = now;
    p.sprint = sprint;
    p.jumpId = jumpId === 0 ? p.motion.jumpAck : Math.max(p.jumpId, jumpId);
    p.prepared = new Set(preparedChunks.filter((id) => map.hasChunk(id)));
  }

  step(deltaSeconds: number, now: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || deltaSeconds > 1) throw new Error('Invalid world step');
    this.ticks++;
    for (const p of this.players.values()) this.move(p, deltaSeconds, now);
    // Released seats retain only stamina debt, for at most the remaining recovery interval.
    for (const [id, state] of this.resting) {
      const stamina = Math.min(MOVEMENT.staminaMax, state.stamina + Math.max(0, deltaSeconds - state.recoveryWait) * MOVEMENT.recovery);
      if (stamina === 100) this.resting.delete(id);
      else this.resting.set(id, { ...state, stamina, recoveryWait: Math.max(0, state.recoveryWait - deltaSeconds) });
    }
  }

  private move(p: Player, dt: number, now: number): void {
    const stale = now - p.intentAt > this.settings.intentTimeoutMs;
    const previous = p.position;
    const previousRecovery = p.motion.recoveryReason;
    const intent = { direction: stale ? ZERO : p.intent, sprint: !stale && p.sprint, jumpId: stale ? p.motion.jumpAck : p.jumpId };
    let next = stepMotion(p.motion, intent, dt, this.environment(p), this.settings.speed);
    if (this.life && finite(next.position) && !this.life.tryPush(this.locate(p.id)!, next.position, this.placedPlayers(), p.prepared, p.motion.grounded && next.grounded)) {
      next = stepMotion(p.motion, intent, dt, this.environment(p, true), this.settings.speed);
    }
    p.motion = next;
    if (!finite(p.motion.position) || !Number.isFinite(p.motion.verticalVelocity)) {
      // OBS-005: a non-finite body never reaches the AOI or SQLite; it returns to its last safe support.
      this.observer.invariant?.('player.position.finite', { playerId: p.id, mapId: p.mapId });
      const map = this.maps.get(p.mapId)!;
      const safe = finite(p.motion.safePosition) ? p.motion.safePosition : map.spawn;
      p.motion = { ...initialMotion(safe), stamina: Number.isFinite(p.motion.stamina) ? p.motion.stamina : MOVEMENT.staminaMax, jumpAck: p.motion.jumpAck };
    }
    if (p.motion.recoveryReason && p.motion.recoveryReason !== previousRecovery) this.observer.recovered?.(p.id, p.motion.recoveryReason);
    p.position = p.motion.position;
    const dx = p.position.x - previous.x; const dz = p.position.z - previous.z;
    const speed = p.motion.locomotion === 'sprint' ? MOVEMENT.sprintSpeed : this.settings.speed;
    const divisor = Math.max(speed * dt, Math.hypot(dx, dz));
    p.applied = { x: dx / divisor, z: dz / divisor };
    if (dx !== 0 || dz !== 0) p.rotationY = Math.atan2(dx, dz);
    if (dx !== 0 || dz !== 0 || p.position.y !== previous.y) p.dirty = true;
  }

  private environment(p: Player, dynamic = false): MovementEnvironment {
    const map = this.maps.get(p.mapId)!;
    const clear = (a: Vector3, b: Vector3) => !dynamic || !this.life || this.life.clearPots(p.mapId,a,b);
    return { canTraverse: (a, b) => map.canTraverse(a, b, p.prepared) && clear(a,b), canOccupy: (v) => map.isWalkable(v.x, v.z) && clear(v,v),
      canRecover: (a, b) => map.canTraverse(a, b), heightAt: (x, z) => map.heightAt(x, z), ceilings: map.manifest.ceilingVolumes ?? [], ceilingsFor: (a, b) => map.ceilingsFor(a, b), spawn: map.spawn };
  }

  movementDiagnostic(playerId: string): MotionState['recoveryReason'] { return this.players.get(playerId)?.motion.recoveryReason ?? null; }

  /** Persist a verified support, never an unfinished airborne Y. */
  savedLocation(playerId: string): PlacedPlayer | undefined {
    const p = this.players.get(playerId); const placed = this.locate(playerId);
    return p && placed ? { ...placed, position: p.motion.safePosition } : undefined;
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
    if (near.length > MAX_AOI - 1) this.observer.aoiTruncated?.(playerId, near.length + 1);
    return [this.playerEntity(self), ...near.slice(0, MAX_AOI - 1).map((item) => item.entity)];
  }

  private playerEntity(p: Player): Entity {
    return {
      id: p.id,
      character: { kind: 'player', name: p.name },
      transform: { position: p.position, rotationY: p.rotationY },
      movement: { direction: p.applied, speed: p.motion.locomotion === 'sprint' ? MOVEMENT.sprintSpeed : this.settings.speed },
      motion: motionStatus(p.motion),
      renderable: { assetId: p.avatarId ? avatarAssetId(p.avatarId) : 'demo-player' },
      ...(p.tool === null ? {} : { equipment: { tool: p.tool } }),
      animationState: { name: p.motion.grounded ? p.motion.locomotion : p.motion.phase },
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

const finite = (v: Vector3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
