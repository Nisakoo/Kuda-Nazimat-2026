export type EntityId = string;

export interface Vector3 { readonly x: number; readonly y: number; readonly z: number }
export interface Direction { readonly x: number; readonly z: number }
export interface Transform { readonly position: Vector3; readonly rotationY: number }
export interface Movement { readonly direction: Direction; readonly speed: number }
export interface Renderable { readonly assetId: string }
export interface Interactable { readonly radius: number; readonly label: string }
export interface Character { readonly kind: 'player' | 'npc'; readonly name: string }
export interface AnimationState { readonly name: string }
export interface MovementBounds { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }

export interface Entity {
  readonly id: EntityId;
  readonly transform?: Transform;
  readonly movement?: Movement;
  readonly renderable?: Renderable;
  readonly interactable?: Interactable;
  readonly character?: Character;
  readonly animationState?: AnimationState;
}

export interface WorldSnapshot {
  readonly tick: number;
  readonly entities: readonly Entity[];
}

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
