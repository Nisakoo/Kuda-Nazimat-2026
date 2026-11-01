/** Wire-level entity shapes shared by client and server (PROTO v3). */
export type EntityId = string;

export interface Vector3 { readonly x: number; readonly y: number; readonly z: number }
export interface Direction { readonly x: number; readonly z: number }
export interface Transform { readonly position: Vector3; readonly rotationY: number }
export interface Movement { readonly direction: Direction; readonly speed: number }
export interface Renderable { readonly assetId: string }
export interface Interactable { readonly radius: number; readonly label: string }
export interface Character { readonly kind: 'player' | 'npc'; readonly name: string }
export interface AnimationState { readonly name: string }
export interface MotionStatus {
  readonly grounded: boolean;
  readonly phase: 'grounded' | 'rising' | 'falling';
  readonly verticalVelocity: number;
  readonly locomotion: 'idle' | 'walk' | 'sprint';
  readonly stamina: number;
  readonly sprintBlocked: boolean;
  readonly jumpAck: number;
}

export interface Entity {
  readonly id: EntityId;
  readonly transform?: Transform;
  readonly movement?: Movement;
  readonly renderable?: Renderable;
  readonly interactable?: Interactable;
  readonly character?: Character;
  readonly animationState?: AnimationState;
  readonly motion?: MotionStatus;
  readonly equipment?: { readonly tool: import('../equipment/types.ts').ToolId };
}

export interface WorldSnapshot {
  readonly tick: number;
  readonly entities: readonly Entity[];
}
