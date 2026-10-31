import type { Direction, MotionStatus, Vector3 } from '../world/types.ts';
import type { CeilingVolume } from '../map/manifest.ts';
import { FOOTPRINT_HALF, intersectsRectangle } from '../map/walkability.ts';

export const MOVEMENT = Object.freeze({ walkSpeed: 3, sprintSpeed: 5, jumpSpeed: 5.4, gravity: 12, height: 1.8,
  maxStepUp: .35, staminaMax: 100, drain: 25, recovery: 20, recoveryDelay: 1, unlockAt: 20, substep: 1 / 120, maxDelta: 1 });
export interface MovementIntent { readonly direction: Direction; readonly sprint: boolean; readonly jumpId: number }
export interface MovementEnvironment {
  canTraverse(from: Vector3, to: Vector3): boolean;
  /** Static occupancy, independent of client readiness, for overlap recovery. */
  canOccupy(position: Vector3): boolean;
  canRecover(from: Vector3, to: Vector3): boolean;
  heightAt(x: number, z: number): number;
  readonly ceilings: readonly CeilingVolume[];
  ceilingsFor?(from: Vector3, to: Vector3): readonly CeilingVolume[];
  readonly spawn: Vector3;
}
export interface MotionState extends MotionStatus {
  readonly position: Vector3;
  readonly recoveryWait: number;
  readonly releasedAfterExhaustion: boolean;
  readonly safePosition: Vector3;
  readonly recoveryReason: 'nearby' | 'safe-position' | 'spawn' | 'forbidden-roof' | null;
}

export function initialMotion(position: Vector3): MotionState {
  return { position: { ...position }, grounded: true, phase: 'grounded', verticalVelocity: 0, locomotion: 'idle', stamina: 100,
    sprintBlocked: false, jumpAck: 0, recoveryWait: 0, releasedAfterExhaustion: false, safePosition: { ...position }, recoveryReason: null };
}
export function motionStatus(state: MotionState): MotionStatus {
  const { grounded, phase, verticalVelocity, locomotion, stamina, sprintBlocked, jumpAck } = state;
  return { grounded, phase, verticalVelocity, locomotion, stamina, sprintBlocked, jumpAck };
}
function overlapsXZ(position: Vector3, volume: CeilingVolume): boolean {
  return position.x + FOOTPRINT_HALF >= volume.minX && position.x - FOOTPRINT_HALF < volume.maxX
    && position.z + FOOTPRINT_HALF >= volume.minZ && position.z - FOOTPRINT_HALF < volume.maxZ;
}
export function isBodyClear(position: Vector3, ceilings: readonly CeilingVolume[]): boolean {
  return ceilings.every(v => !overlapsXZ(position, v) || position.y >= v.topY || position.y + MOVEMENT.height <= v.bottomY + 1e-8);
}
function fits(position: Vector3, env: MovementEnvironment): boolean {
  return env.canOccupy(position) && position.y >= env.heightAt(position.x, position.z) - 1e-8
    && isBodyClear(position, env.ceilingsFor?.(position, position) ?? env.ceilings);
}
function bodyPathClear(from: Vector3, to: Vector3, env: MovementEnvironment): boolean {
  return !(env.ceilingsFor?.(from, to) ?? env.ceilings).some(v => Math.min(from.y, to.y) < v.topY && Math.max(from.y, to.y) + MOVEMENT.height > v.bottomY + 1e-8
    && intersectsRectangle(from, to, { minX: v.minX - FOOTPRINT_HALF, maxX: v.maxX + FOOTPRINT_HALF, minZ: v.minZ - FOOTPRINT_HALF, maxZ: v.maxZ + FOOTPRINT_HALF }));
}

/** Recovery is bounded and constrained to the last safe side of an obstacle. */
export function recoverMotion(state: MotionState, env: MovementEnvironment): MotionState {
  if (fits(state.position, env)) return state;
  const anchor = fits(state.safePosition, env) ? state.safePosition : env.spawn;
  for (let ring = 1; ring <= 20; ring++) for (let sample = 0; sample < 32; sample++) {
    const angle = sample * Math.PI / 16;
    const x = state.position.x + Math.cos(angle) * ring * .025;
    const z = state.position.z + Math.sin(angle) * ring * .025;
    const candidate = { x, y: env.heightAt(x, z), z };
    if (fits(candidate, env) && env.canRecover(anchor, candidate) && bodyPathClear(anchor, candidate, env)) return { ...state, position: candidate, safePosition: candidate, grounded: true, phase: 'grounded', verticalVelocity: 0, recoveryReason: 'nearby' };
  }
  if (!fits(anchor, env)) throw new Error('No verified movement spawn');
  return { ...state, position: { ...anchor }, safePosition: { ...anchor }, grounded: true, phase: 'grounded', verticalVelocity: 0,
    recoveryReason: anchor === state.safePosition ? 'safe-position' : 'spawn' };
}

/** Pure deterministic MOVE simulation; caller owns time, authorization, map access and lifecycle. */
export function stepMotion(previous: MotionState, intent: MovementIntent, dt: number, env: MovementEnvironment, walkSpeed: number = MOVEMENT.walkSpeed): MotionState {
  if (!Number.isFinite(dt) || dt <= 0 || dt > MOVEMENT.maxDelta) throw new Error('Movement step must be in (0, 1]');
  const state = recoverMotion(previous, env);
  let position = state.position; let velocity = state.verticalVelocity; let grounded = state.grounded;
  let stamina = state.stamina; let blocked = state.sprintBlocked; let released = state.releasedAfterExhaustion;
  let wait = state.recoveryWait; let safe = state.safePosition;
  let recoveryReason = state.recoveryReason;
  let ack = state.jumpAck;
  if (intent.jumpId > ack) { ack = intent.jumpId; if (grounded) { velocity = MOVEMENT.jumpSpeed; grounded = false; } }
  if (blocked && !intent.sprint) released = true;
  if (blocked && released && stamina >= MOVEMENT.unlockAt && !intent.sprint) { blocked = false; released = false; }
  const length = Math.hypot(intent.direction.x, intent.direction.z);
  const divisor = Math.max(1, length);
  const direction = { x: intent.direction.x / divisor, z: intent.direction.z / divisor };
  let remaining = dt; let locomotion: MotionStatus['locomotion'] = 'idle';
  while (remaining > 1e-10) {
    const sprint = intent.sprint && !blocked && stamina > 1e-9 && length > 0;
    const h = Math.min(remaining, MOVEMENT.substep, sprint ? stamina / MOVEMENT.drain : Infinity);
    const speed = sprint ? MOVEMENT.sprintSpeed : walkSpeed;
    const before = position;
    const dx = direction.x * speed * h; const dz = direction.z * speed * h;
    for (const [mx, mz] of [[dx, dz], [dx, 0], [0, dz]] as const) {
      if (mx === 0 && mz === 0) continue;
      const x = position.x + mx; const z = position.z + mz;
      const support = env.heightAt(x, z);
      if (support > position.y + (grounded ? MOVEMENT.maxStepUp : 0) + 1e-8) continue;
      const highestEdge = Math.max(...[-FOOTPRINT_HALF, FOOTPRINT_HALF].flatMap(ox => [-FOOTPRINT_HALF, FOOTPRINT_HALF].map(oz => env.heightAt(x + ox, z + oz))));
      if (highestEdge > position.y + (grounded ? MOVEMENT.maxStepUp : 0) + 1e-8) continue;
      const candidate = { x, y: grounded && support >= position.y - MOVEMENT.maxStepUp ? support : position.y, z };
      if (!env.canTraverse(position, candidate)) continue;
      if (!bodyPathClear(position, candidate, env)) continue;
      position = candidate;
      if (grounded && support < before.y - MOVEMENT.maxStepUp) grounded = false;
      break;
    }
    const moving = position.x !== before.x || position.z !== before.z;
    locomotion = moving ? sprint ? 'sprint' : 'walk' : 'idle';
    if (sprint && moving) {
      stamina = Math.max(0, stamina - MOVEMENT.drain * h); wait = MOVEMENT.recoveryDelay;
      if (stamina < 1e-8) { stamina = 0; blocked = true; released = false; locomotion = 'walk'; }
    } else {
      const restoreTime = Math.max(0, h - wait); wait = Math.max(0, wait - h);
      stamina = Math.min(MOVEMENT.staminaMax, stamina + restoreTime * MOVEMENT.recovery);
    }
    if (!grounded) {
      let y = position.y + velocity * h - .5 * MOVEMENT.gravity * h * h;
      let nextVelocity = Math.max(-100, velocity - MOVEMENT.gravity * h);
      const peakTime = Math.max(0, Math.min(h, velocity / MOVEMENT.gravity));
      const peakY = position.y + velocity * peakTime - .5 * MOVEMENT.gravity * peakTime * peakTime;
      for (const volume of env.ceilingsFor?.(position, position) ?? env.ceilings) if (overlapsXZ(position, volume) && position.y + MOVEMENT.height <= volume.bottomY + 1e-8 && peakY + MOVEMENT.height > volume.bottomY) {
        y = volume.bottomY - MOVEMENT.height; nextVelocity = 0;
      }
      // Roof tops are not new floors. An unexpected fall onto one restores verified support,
      // including thin roofs that a fast falling step would otherwise tunnel through.
      if ((env.ceilingsFor?.(position, position) ?? env.ceilings).some(v => overlapsXZ(position, v) && position.y >= v.topY && y < v.topY)) {
        position = { ...safe }; y = position.y; nextVelocity = 0; grounded = true; locomotion = 'idle'; recoveryReason = 'forbidden-roof';
      }
      const support = env.heightAt(position.x, position.z);
      if (nextVelocity <= 0 && y <= support) { y = support; nextVelocity = 0; grounded = true; }
      position = { ...position, y }; velocity = nextVelocity;
    }
    if (grounded) safe = { ...position };
    remaining -= h;
  }
  if (blocked && released && stamina >= MOVEMENT.unlockAt && !intent.sprint) { blocked = false; released = false; }
  return { ...state, position, verticalVelocity: velocity, grounded, phase: grounded ? 'grounded' : velocity > 0 ? 'rising' : 'falling',
    locomotion, stamina, sprintBlocked: blocked, jumpAck: ack, recoveryWait: wait, releasedAfterExhaustion: released, safePosition: safe, recoveryReason };
}
