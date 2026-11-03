import type { Vector3 } from '../world/types.ts';
export const SHOTGUN = { capacity: 6, cooldown: .7, reload: 2.4, range: 35, pellets: 8, maxProps: 12, maxShots: 12, eyeHeight: 1.45 } as const;
export type ShotgunAction = { readonly v: 1; readonly type: 'shotgun'; readonly requestId: string; readonly action: 'fire' | 'reload'; readonly yaw: number; readonly pitch: number };
export interface ShotgunProp { readonly id: string; readonly kind: 'crate' | 'barrel' | 'jar'; readonly position: Vector3; readonly rotation: number }
export interface Shot { readonly id: number; readonly playerId: string; readonly origin: Vector3; readonly yaw: number; readonly pitch: number }
export interface WeaponState { readonly playerId: string; readonly ammo: number; readonly reloadLeft: number; readonly shotId: number }
export interface ShotgunState { readonly v: 1; readonly type: 'shotgun-state'; readonly sceneId: string; readonly mapId: string; readonly revision: number; readonly props: readonly ShotgunProp[]; readonly weapons: readonly WeaponState[]; readonly shots: readonly Shot[] }
export function pelletDirection(yaw: number, pitch: number, pellet: number): Vector3 {
  const angle = pellet * 2.399963229728653;
  const spread = pellet === 0 ? 0 : .035 * Math.sqrt(pellet / 7);
  const y = yaw + Math.cos(angle) * spread, p = pitch + Math.sin(angle) * spread;
  return { x: -Math.sin(y) * Math.cos(p), y: -Math.sin(p), z: -Math.cos(y) * Math.cos(p) };
}
