import type { Entity, EntityId } from './types';

function finite(...values: number[]): void {
  if (!values.every(Number.isFinite)) throw new Error('Components must contain finite numbers.');
}

/** Copies and freezes component data so callers cannot mutate a world through a snapshot. */
function copyEntity(entity: Entity): Entity {
  if (!entity.id.trim()) throw new Error('Entity ID must not be empty.');
  if (entity.transform) {
    const { position, rotationY } = entity.transform;
    finite(position.x, position.y, position.z, rotationY);
  }
  if (entity.movement) {
    finite(entity.movement.speed, entity.movement.direction.x, entity.movement.direction.z);
    if (entity.movement.speed < 0 || Math.hypot(entity.movement.direction.x, entity.movement.direction.z) > 1 + 1e-12) {
      throw new Error('Movement requires a nonnegative speed and direction length at most one.');
    }
  }
  if (entity.interactable) {
    finite(entity.interactable.radius);
    if (entity.interactable.radius < 0) throw new Error('Interaction radius must be nonnegative.');
  }
  if (entity.motion) finite(entity.motion.stamina, entity.motion.verticalVelocity, entity.motion.jumpAck);
  return Object.freeze({
    id: entity.id,
    ...(entity.transform && { transform: Object.freeze({
      position: Object.freeze({ ...entity.transform.position }), rotationY: entity.transform.rotationY,
    }) }),
    ...(entity.movement && { movement: Object.freeze({
      direction: Object.freeze({ ...entity.movement.direction }), speed: entity.movement.speed,
    }) }),
    ...(entity.renderable && { renderable: Object.freeze({ ...entity.renderable }) }),
    ...(entity.interactable && { interactable: Object.freeze({ ...entity.interactable }) }),
    ...(entity.character && { character: Object.freeze({ ...entity.character }) }),
    ...(entity.animationState && { animationState: Object.freeze({ ...entity.animationState }) }),
    ...(entity.motion && { motion: Object.freeze({ ...entity.motion }) }),
  });
}

export class EntityManager {
  private readonly entities = new Map<EntityId, Entity>();

  constructor(entities: readonly Entity[] = []) {
    for (const entity of entities) this.create(entity);
  }

  create(entity: Entity): void {
    if (this.entities.has(entity.id)) throw new Error(`Duplicate entity ID: ${entity.id}`);
    this.entities.set(entity.id, copyEntity(entity));
  }

  get(id: EntityId): Entity | undefined { return this.entities.get(id); }

  replace(entity: Entity): boolean {
    if (!this.entities.has(entity.id)) return false;
    this.entities.set(entity.id, copyEntity(entity));
    return true;
  }

  remove(id: EntityId): boolean { return this.entities.delete(id); }

  all(): readonly Entity[] { return Object.freeze([...this.entities.values()]); }
}
