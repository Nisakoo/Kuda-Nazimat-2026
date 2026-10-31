import type { Direction, EntityId, Vector3 } from '../../../shared/world/types.ts';
export type { EntityId, Vector3, Direction, Transform, Movement, Renderable, Interactable, Character, AnimationState, Entity, WorldSnapshot } from '../../../shared/world/types.ts';
export interface MovementBounds { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }

/** Client-side intentions, not the still-undecided network protocol. */
export type GameCommand =
  | { readonly type: 'move'; readonly direction: Direction }
  | { readonly type: 'interact'; readonly targetId: EntityId };

export type RejectionReason = 'missing-entity' | 'missing-component' | 'invalid-direction'
  | 'out-of-range' | 'invalid-target' | 'not-authoritative';

export type WorldEvent =
  | { readonly type: 'entity-created' | 'entity-removed'; readonly entityId: EntityId }
  | { readonly type: 'entity-moved'; readonly entityId: EntityId; readonly position: Vector3 }
  | { readonly type: 'interacted'; readonly actorId: EntityId; readonly targetId: EntityId }
  | { readonly type: 'command-rejected'; readonly actorId: EntityId; readonly reason: RejectionReason }
  | { readonly type: 'state-replaced'; readonly tick: number };

export type CommandResult = { readonly ok: true } | { readonly ok: false; readonly reason: RejectionReason };
