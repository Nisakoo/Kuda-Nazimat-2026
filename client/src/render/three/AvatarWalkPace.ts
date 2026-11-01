import { Vector3 } from 'three';
import type { Object3D } from 'three';
import { isAvatarId } from '../../../../shared/avatar/index.ts';

/** Safety cap covers 5 m/s sprint plus the existing 1.5× observed-speed guard. */
export const AVATAR_WALK_MAX_PACE = 16;
export interface AvatarWalkPacing {
  /** Source-space cycle displacement. Runtime forward scale is applied by pace(). */
  readonly cycleMetres: number;
  readonly duration: number;
  pace(speed: number): number;
}

/** Only the original, closed-ID avatar rig opts into metadata-aware walk pacing. */
export function avatarWalkPacing(root: Object3D, duration: number | undefined): AvatarWalkPacing | undefined {
  if (duration === undefined || !Number.isFinite(duration) || duration < .05 || duration > 10) return undefined;
  const avatar = root.getObjectByName('avatar');
  if (!avatar) return undefined;
  const metadata = avatar.userData;
  if (!isAvatarId(metadata.avatarId) || metadata.units !== 'metres' || metadata.forward !== '+Z'
    || typeof metadata.walkCycleMetres !== 'number' || !Number.isFinite(metadata.walkCycleMetres)
    || metadata.walkCycleMetres < .1 || metadata.walkCycleMetres > 2) return undefined;
  const cycleMetres = metadata.walkCycleMetres;
  const forward = new Vector3();
  return {
    cycleMetres, duration,
    pace(speed: number): number {
      if (!Number.isFinite(speed) || speed <= 0) return 0;
      // The GLB has non-unit source normalization. Include it and any parent scale.
      // A matrix column gives the +Z displacement scale, also under rotated parents.
      avatar.updateWorldMatrix(true, false);
      const scale = forward.setFromMatrixColumn(avatar.matrixWorld, 2).length();
      const stride = cycleMetres * scale;
      if (!Number.isFinite(stride) || stride <= 0) return 0;
      return Math.min(AVATAR_WALK_MAX_PACE, speed * duration / stride);
    },
  };
}
