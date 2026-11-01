import type { Vector3 } from '../../../shared/world/types.ts';

/** REALTIME-010: minimum horizontal distance to any other player at the moment of appearance. */
export const SPAWN_CLEARANCE = 1.2;
const RINGS = [1.5, 3, 4.5] as const;
const DIRECTIONS = 8;

/** fallback: no free candidate existed and the base was used anyway (logged as game.spawn.fallback). */
export interface SpawnPlacement { readonly position: Vector3; readonly rotationY: number; readonly fallback?: true }

/** Deterministic candidates: the base itself, then 8 directions on each ring. */
export function spawnCandidates(base: Vector3): Vector3[] {
  const candidates = [base];
  for (const radius of RINGS) for (let k = 0; k < DIRECTIONS; k++) {
    const angle = (k * 2 * Math.PI) / DIRECTIONS;
    candidates.push({ x: base.x + Math.sin(angle) * radius, y: base.y, z: base.z + Math.cos(angle) * radius });
  }
  return candidates;
}

export function isFree(position: Vector3, others: readonly Vector3[]): boolean {
  return others.every((other) => Math.hypot(other.x - position.x, other.z - position.z) >= SPAWN_CLEARANCE);
}

/**
 * First free standable candidate around `base`, facing the base; the base itself faces π.
 * Without any free candidate the base is used, so a crowded map never blocks a join.
 */
export function chooseSpawn(base: Vector3, canStand: (x: number, z: number) => boolean, others: readonly Vector3[]): SpawnPlacement {
  for (const candidate of spawnCandidates(base)) {
    if (!canStand(candidate.x, candidate.z) || !isFree(candidate, others)) continue;
    const atBase = candidate === base;
    return { position: candidate, rotationY: atBase ? Math.PI : Math.atan2(base.x - candidate.x, base.z - candidate.z) };
  }
  return { position: base, rotationY: Math.PI, fallback: true };
}
