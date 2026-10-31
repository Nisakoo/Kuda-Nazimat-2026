/** Presentation only: metres/seconds, independent of authority and frame rate. */
export const CHARACTER_MOTION = Object.freeze({
  blendRate: 24,
  turnRate: 22,
  stride: 1.2,
  discontinuity: 1,
  maxDelta: .1,
  movingThreshold: .025,
  cameraReturnRate: 8,
});

export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

export function turnTowards(current: number, target: number, dt: number): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + difference * (1 - Math.exp(-CHARACTER_MOTION.turnRate * dt));
}

/** Two-link leg in the sagittal plane; the ankle counter-rotates to stay level. */
export function legAngles(forward: number, height: number): { hip: number; knee: number; ankle: number } {
  const length = .38;
  const reach = Math.min(length * 2 - .0001, Math.max(.05, Math.hypot(forward, height)));
  const bend = Math.acos(reach / (length * 2));
  const hip = Math.atan2(-forward, height) - bend;
  const knee = 2 * bend;
  return { hip, knee, ankle: -hip - knee };
}

/** The stance half moves backwards at constant speed, planting the world-space foot. */
export function footTarget(phase: number, weight: number, sprint = 0): { forward: number; lift: number } {
  const cycle = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
  const halfStride = (CHARACTER_MOTION.stride + .6 * sprint) / 4;
  if (cycle < .5) return { forward: halfStride * (1 - 4 * cycle) * weight, lift: 0 };
  const swing = (cycle - .5) * 2;
  const eased = swing * swing * (3 - 2 * swing);
  return { forward: halfStride * (-1 + 2 * eased) * weight, lift: Math.sin(swing * Math.PI) * (.13 + .05 * sprint) * weight };
}

export interface MovementPose { readonly sprint: number; readonly air: number; readonly falling: number; readonly takeoff: number; readonly landing: number }
export function approach(current: number, target: number, dt: number, duration: number): number {
  return current + Math.max(-dt / duration, Math.min(dt / duration, target - current));
}
