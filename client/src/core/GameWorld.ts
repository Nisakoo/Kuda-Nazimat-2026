import { EntityManager } from './EntityManager';
import type { CommandResult, Entity, EntityId, GameCommand, MovementBounds, RejectionReason, WorldEvent, WorldSnapshot } from './types';
import type { Vector3 } from './types';
import { MOVEMENT, initialMotion, motionStatus, stepMotion } from '../../../shared/movement/simulation.ts';
import type { MotionState } from '../../../shared/movement/simulation.ts';
import type { CeilingVolume } from '../../../shared/map/manifest.ts';

export class GameWorld {
  private entities: EntityManager;
  private tick = 0;
  private events: WorldEvent[] = [];

  private readonly bounds: MovementBounds | null;
  private movementGuard: ((position: Vector3) => boolean) | null = null;
  private surfaceHeight: ((x: number, z: number) => number) | null = null;
  private pathGuard: ((from: Vector3, to: Vector3) => boolean) | null = null;
  private ceilings: readonly CeilingVolume[] = [];
  private ceilingsFor: ((from: Vector3, to: Vector3) => readonly CeilingVolume[]) | undefined;
  private readonly motion = new Map<EntityId, MotionState>();
  private readonly controls = new Map<EntityId, { sprint: boolean; jumpId: number }>();
  setCeilings(ceilings: readonly CeilingVolume[], query?: (from: Vector3, to: Vector3) => readonly CeilingVolume[]): void { this.ceilings = ceilings; this.ceilingsFor = query; }
  setSurfaceHeight(height: (x: number, z: number) => number): void { this.surfaceHeight = height; }
  setMovementGuard(guard: (position: Vector3) => boolean, path?: (from: Vector3, to: Vector3) => boolean): void { this.movementGuard = guard; this.pathGuard = path ?? null; }
  initializePosition(id: EntityId, position: Vector3): void {
    this.assertLocal();
    if (this.tick !== 0) throw new Error('Initial position must be set before simulation');
    const entity = this.entities.get(id);
    if (!entity?.transform) throw new Error('Missing player transform');
    this.entities.replace({ ...entity, transform: { ...entity.transform, position } });
    this.motion.set(id, initialMotion(position));
  }

  constructor(readonly authority: 'local' | 'replica', entities: readonly Entity[] = [], bounds: MovementBounds | null = null) {
    if (bounds && (!Object.values(bounds).every(Number.isFinite) || bounds.minX > bounds.maxX || bounds.minZ > bounds.maxZ)) {
      throw new Error('Invalid movement bounds.');
    }
    this.bounds = bounds ? Object.freeze({ ...bounds }) : null;
    this.entities = new EntityManager(entities);
    if (authority === 'local') for (const entity of entities) if (entity.transform && entity.character?.kind === 'player') {
      const motion = initialMotion(entity.transform.position); this.motion.set(entity.id, motion);
      this.entities.replace({ ...entity, motion: motionStatus(motion) });
    }
  }

  getSnapshot(): WorldSnapshot {
    return Object.freeze({ tick: this.tick, entities: this.entities.all() });
  }

  create(entity: Entity): void {
    this.assertLocal();
    this.entities.create(entity);
    this.events.push(Object.freeze({ type: 'entity-created', entityId: entity.id }));
  }

  remove(id: EntityId): boolean {
    this.assertLocal();
    if (!this.entities.remove(id)) return false;
    this.motion.delete(id); this.controls.delete(id);
    this.events.push(Object.freeze({ type: 'entity-removed', entityId: id }));
    return true;
  }

  execute(actorId: EntityId, command: GameCommand): CommandResult {
    if (this.authority !== 'local') return this.reject(actorId, 'not-authoritative');
    const actor = this.entities.get(actorId);
    if (!actor) return this.reject(actorId, 'missing-entity');
    if (command.type === 'clear-input') {
      this.controls.set(actorId, { sprint: false, jumpId: this.motion.get(actorId)?.jumpAck ?? 0 });
      if (actor.movement) this.entities.replace({ ...actor, movement: { ...actor.movement, direction: { x: 0, z: 0 } } });
    } else if (command.type === 'sprint' || command.type === 'jump') {
      if (!actor.movement || !actor.transform) return this.reject(actorId, 'missing-component');
      const controls = this.controls.get(actorId) ?? { sprint: false, jumpId: 0 };
      this.controls.set(actorId, command.type === 'sprint' ? { ...controls, sprint: command.held } : { ...controls, jumpId: controls.jumpId + 1 });
    } else if (command.type === 'move') {
      if (!actor.movement || !actor.transform) return this.reject(actorId, 'missing-component');
      const { x, z } = command.direction;
      if (!Number.isFinite(x) || !Number.isFinite(z)) return this.reject(actorId, 'invalid-direction');
      const divisor = Math.max(1, Math.hypot(x, z));
      this.entities.replace({ ...actor, movement: { ...actor.movement, direction: { x: x / divisor, z: z / divisor } } });
    } else {
      const target = this.entities.get(command.targetId);
      if (target?.id === actorId) return this.reject(actorId, 'invalid-target');
      if (!target) return this.reject(actorId, 'missing-entity');
      if (!actor.transform || !target.transform || !target.interactable) return this.reject(actorId, 'missing-component');
      const a = actor.transform.position;
      const b = target.transform.position;
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > target.interactable.radius) {
        return this.reject(actorId, 'out-of-range');
      }
      this.events.push(Object.freeze({ type: 'interacted', actorId, targetId: target.id }));
    }
    return { ok: true };
  }

  step(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || deltaSeconds > MOVEMENT.maxDelta) throw new Error('Step must be in (0, 1].');
    // A replica never integrates player intentions or advances the authoritative tick locally.
    if (this.authority !== 'local') return;
    for (const entity of this.entities.all()) {
      if (!entity.transform || !entity.movement) continue;
      const { direction, speed } = entity.movement;
      const previous = entity.transform.position;
      const state = this.motion.get(entity.id) ?? initialMotion(previous);
      const controls = this.controls.get(entity.id) ?? { sprint: false, jumpId: 0 };
      const canOccupy = (p: Vector3) => (!this.bounds || (p.x >= this.bounds.minX - 1e-8 && p.x <= this.bounds.maxX + 1e-8 && p.z >= this.bounds.minZ - 1e-8 && p.z <= this.bounds.maxZ + 1e-8)) && (!this.movementGuard || this.movementGuard(p));
      const trace = (a: Vector3, b: Vector3) => canOccupy(b) && (!this.pathGuard || this.pathGuard(a, b));
      const next = stepMotion(state, { direction, sprint: controls.sprint, jumpId: controls.jumpId }, deltaSeconds, {
        canTraverse: trace, canOccupy, canRecover: trace,
        heightAt: this.surfaceHeight ?? (() => state.safePosition.y), ceilings: this.ceilings, ...(this.ceilingsFor && { ceilingsFor: this.ceilingsFor }), spawn: state.safePosition,
      }, speed);
      let position = next.position;
      if (this.bounds) position = { ...position, x: Math.max(this.bounds.minX, Math.min(this.bounds.maxX, position.x)), z: Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, position.z)) };
      this.motion.set(entity.id, { ...next, position });
      const dx = position.x - previous.x; const dz = position.z - previous.z;
      const moving = dx !== 0 || dz !== 0;
      this.entities.replace({
        ...entity, transform: { position, rotationY: moving ? Math.atan2(dx, dz) : entity.transform.rotationY },
        ...(entity.character?.kind === 'player' && { motion: motionStatus(next) }),
        ...(entity.animationState && { animationState: { name: next.grounded ? next.locomotion : next.phase } }),
      });
      if (moving || position.y !== previous.y) this.events.push(Object.freeze({ type: 'entity-moved', entityId: entity.id, position: Object.freeze(position) }));
    }
    this.tick++;
  }

  /** A neutral in-process state boundary. Wire validation/versioning belongs to NET/PROTO. */
  applySnapshot(snapshot: WorldSnapshot): void {
    if (this.authority !== 'replica') throw new Error('Authoritative snapshots require a replica.');
    if (!Number.isSafeInteger(snapshot.tick) || snapshot.tick < 0) throw new Error('Invalid snapshot tick.');
    const replacement = new EntityManager(snapshot.entities);
    this.entities = replacement;
    this.tick = snapshot.tick;
    this.events.push(Object.freeze({ type: 'state-replaced', tick: this.tick }));
  }

  drainEvents(): readonly WorldEvent[] {
    const events = Object.freeze(this.events);
    this.events = [];
    return events;
  }

  private reject(actorId: EntityId, reason: RejectionReason): CommandResult {
    this.events.push(Object.freeze({ type: 'command-rejected', actorId, reason }));
    return { ok: false, reason };
  }

  private assertLocal(): void {
    if (this.authority !== 'local') throw new Error('Replica entities can only change through authoritative state.');
  }
}
