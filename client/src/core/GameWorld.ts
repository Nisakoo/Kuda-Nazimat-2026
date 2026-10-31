import { EntityManager } from './EntityManager';
import type { CommandResult, Entity, EntityId, GameCommand, MovementBounds, RejectionReason, WorldEvent, WorldSnapshot } from './types';
import type { Vector3 } from './types';

export class GameWorld {
  private entities: EntityManager;
  private tick = 0;
  private events: WorldEvent[] = [];

  private readonly bounds: MovementBounds | null;
  private movementGuard: ((position: Vector3) => boolean) | null = null;
  private surfaceHeight: ((x: number, z: number) => number) | null = null;
  setSurfaceHeight(height: (x: number, z: number) => number): void { this.surfaceHeight = height; }
  setMovementGuard(guard: (position: Vector3) => boolean): void { this.movementGuard = guard; }
  initializePosition(id: EntityId, position: Vector3): void {
    this.assertLocal();
    if (this.tick !== 0) throw new Error('Initial position must be set before simulation');
    const entity = this.entities.get(id);
    if (!entity?.transform) throw new Error('Missing player transform');
    this.entities.replace({ ...entity, transform: { ...entity.transform, position } });
  }

  constructor(readonly authority: 'local' | 'replica', entities: readonly Entity[] = [], bounds: MovementBounds | null = null) {
    if (bounds && (!Object.values(bounds).every(Number.isFinite) || bounds.minX > bounds.maxX || bounds.minZ > bounds.maxZ)) {
      throw new Error('Invalid movement bounds.');
    }
    this.bounds = bounds ? Object.freeze({ ...bounds }) : null;
    this.entities = new EntityManager(entities);
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
    this.events.push(Object.freeze({ type: 'entity-removed', entityId: id }));
    return true;
  }

  execute(actorId: EntityId, command: GameCommand): CommandResult {
    if (this.authority !== 'local') return this.reject(actorId, 'not-authoritative');
    const actor = this.entities.get(actorId);
    if (!actor) return this.reject(actorId, 'missing-entity');
    if (command.type === 'move') {
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
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) throw new Error('Step must be finite and positive.');
    // A replica never integrates player intentions or advances the authoritative tick locally.
    if (this.authority !== 'local') return;
    for (const entity of this.entities.all()) {
      if (!entity.transform || !entity.movement) continue;
      const { direction, speed } = entity.movement;
      const attempting = speed > 0 && (direction.x !== 0 || direction.z !== 0);
      const previous = entity.transform.position;
      const position = attempting ? {
        x: previous.x + direction.x * speed * deltaSeconds,
        y: previous.y,
        z: previous.z + direction.z * speed * deltaSeconds,
      } : { ...previous };
      if (attempting && this.bounds) {
        position.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, position.x));
        position.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, position.z));
      }
      if (attempting && ((this.movementGuard && !this.movementGuard(position)) || Math.abs((this.surfaceHeight?.(position.x, position.z) ?? previous.y) - previous.y) > .35)) { position.x = previous.x; position.z = previous.z; }
      if (attempting) position.y = (this.surfaceHeight?.(position.x, position.z) ?? previous.y);
      const moving = position.x !== previous.x || position.z !== previous.z;
      const animationName = moving ? 'walk' : 'idle';
      if (!moving && (!entity.animationState || entity.animationState.name === animationName)) continue;
      this.entities.replace({
        ...entity,
        transform: { position, rotationY: moving ? Math.atan2(direction.x, direction.z) : entity.transform.rotationY },
        ...(entity.animationState && { animationState: { name: animationName } }),
      });
      if (moving) this.events.push(Object.freeze({ type: 'entity-moved', entityId: entity.id, position: Object.freeze(position) }));
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
