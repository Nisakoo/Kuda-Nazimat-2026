import type { Vector3 } from '../world/types.ts';
import type { CatDefinition, SceneSchedule } from './types.ts';

/** A deterministic loop in server scene time. Callers estimate current serverTimeMs from the latest sample. */
export function schedulePhase(elapsedMs: number, schedule: SceneSchedule): { active: boolean; phase: number } {
  const local = ((elapsedMs - schedule.offsetMs) % schedule.periodMs + schedule.periodMs) % schedule.periodMs;
  return { active: local < schedule.durationMs, phase: Math.min(1, local / schedule.durationMs) };
}
export function routePosition(route: readonly Vector3[], phase: number, closed = false): Vector3 {
  if (!route.length) throw new Error('Empty scene route');
  if (route.length === 1) return { ...route[0]! };
  const segments = closed ? route.length : route.length - 1;
  const scaled = Math.min(1, Math.max(0, phase)) * segments;
  const index = Math.min(segments - 1, Math.floor(scaled)); const t = scaled - index;
  const a = route[index]!; const b = route[(index + 1) % route.length]!;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}
export function catPosition(cat: CatDefinition, elapsedMs: number): Vector3 {
  if (cat.behavior !== 'walk') return { ...cat.route[0]! };
  const local = ((elapsedMs % cat.cycleMs) + cat.cycleMs) % cat.cycleMs;
  return routePosition(cat.route, Math.max(0, local - cat.pauseMs) / (cat.cycleMs - cat.pauseMs), true);
}
