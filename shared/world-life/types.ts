import type { Vector3 } from '../world/types.ts';

export const WORLD_LIFE_VERSION = 1 as const;
export const WORLD_LIFE_EVENT = 'world-life' as const;
export const WORLD_LIFE_LIMITS = { packetBytes: 65536, templates: 64, instances: 128, routePoints: 16, pots: 16, apples: 24, birds: 24, cats: 3, pickupDistance: 2, placeDistance: 0.9, potRadius: 0.3, appleRadius: 0.15 } as const;
export type ObjectBehavior = 'static' | 'animated' | 'pushable' | 'pickup';
export interface ObjectTemplate {
  readonly id: string;
  /** Key in manifest.models. A template shares a model; it does not grant interaction rights. */
  readonly assetId: string;
  readonly behavior: ObjectBehavior;
  readonly animation: string;
}
export interface MovementZone { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }
export interface ObjectInstance {
  readonly id: string;
  readonly templateId: string;
  readonly position: Vector3;
  readonly rotationY: number;
  /** Required only for pushable instances. Full pot footprint must stay inside this rectangle. */
  readonly zone?: MovementZone;
}
export interface CatDefinition {
  readonly instanceId: string;
  readonly behavior: 'sleep' | 'walk' | 'wash';
  /** Closed route; each point is a foot/support position. Non-walking cats use one point. */
  readonly route: readonly Vector3[];
  readonly cycleMs: number;
  readonly pauseMs: number;
}
export interface SceneSchedule { readonly periodMs: number; readonly durationMs: number; readonly offsetMs: number }
export interface PackAnimalDefinition { readonly instanceId: string; readonly kind: 'camel' | 'mule'; readonly behavior: 'feed' | 'walk'; readonly route: readonly Vector3[]; readonly cycleMs: number }
export interface PerchedBird { readonly id: string; readonly position: Vector3; readonly rotationY: number }
export interface BirdState { readonly id: string; readonly startedMs: number | null; readonly landingMs: number | null; readonly yaw: number; readonly resumedFrom?: Vector3 }
export interface WorldLifeDefinition {
  readonly v: 1;
  readonly mapId: string;
  readonly seed: number;
  readonly templates: readonly ObjectTemplate[];
  readonly instances: readonly ObjectInstance[];
  readonly cats: readonly CatDefinition[];
  readonly perches?: readonly PerchedBird[];
  readonly packAnimals?: readonly PackAnimalDefinition[];
  readonly flock: { readonly assetId: string; readonly count: number; readonly route: readonly Vector3[]; readonly schedule: SceneSchedule };
  readonly wind: { readonly strength: number; readonly gustStrength: number; readonly schedule: SceneSchedule };
}
export interface PotState { readonly id: string; readonly position: Vector3 }
export type AppleState =
  | { readonly id: string; readonly mapId: string; readonly state: 'world'; readonly position: Vector3 }
  | { readonly id: string; readonly mapId: string; readonly state: 'held'; readonly holderId: string };
export type HandRequest = { readonly v: 1; readonly type: 'hand'; readonly requestId: string } & (
  | { readonly action: 'pickup'; readonly targetId: string }
  | { readonly action: 'place' }
);
export interface SceneSyncRequest { readonly v: 1; readonly type: 'scene-sync'; readonly requestId: string }
export type WorldLifeClientMessage = HandRequest | SceneSyncRequest;
export type HandErrorCode = 'INVALID' | 'VERSION' | 'UNAUTHORIZED' | 'NOT_READY' | 'FORBIDDEN' | 'NOT_FOUND' | 'TOO_FAR' | 'BLOCKED' | 'HANDS_FULL' | 'HANDS_EMPTY' | 'CONFLICT' | 'RATE_LIMIT' | 'UNAVAILABLE';
export type HandResultMessage = { readonly v: 1; readonly type: 'hand-result'; readonly requestId: string } & (
  | { readonly ok: true; readonly action: 'pickup' | 'place'; readonly apple: AppleState }
  | { readonly ok: false; readonly code: HandErrorCode; readonly message: string }
);
/** Full bounded map-local state, independent of AOI revisions. Held apples retain their home mapId. */
export interface SceneStateMessage {
  readonly v: 1;
  readonly type: 'scene-state';
  /** Unique server process/scene generation; revision resets only when this changes. */
  readonly sceneId: string;
  readonly revision: number;
  readonly serverTimeMs: number;
  readonly epochMs: number;
  readonly definition: WorldLifeDefinition;
  readonly pots: readonly PotState[];
  readonly birds?: readonly BirdState[];
  readonly apples: readonly AppleState[];
}
export type WorldLifeServerMessage = SceneStateMessage | HandResultMessage;
