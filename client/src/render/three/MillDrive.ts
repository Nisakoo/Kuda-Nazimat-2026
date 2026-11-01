import type { Object3D } from 'three';
import type { Vector3 } from '../../../../shared/world/types';

/** Presentation-only linkage: the closed route defines its fixed mill axle. */
export function poseMillDrive(root: Object3D, position: Vector3, yaw: number, route: readonly Vector3[]): void {
  const arm = root.getObjectByName('pack-drive-arm');
  const drop = root.getObjectByName('pack-drive-drop');
  const hub = root.getObjectByName('pack-drive-hub');
  if (!arm || !drop || !hub || !route.length) return;
  const center = route.reduce((sum, point) => ({ x: sum.x + point.x / route.length, y: sum.y + point.y / route.length, z: sum.z + point.z / route.length }), { x: 0, y: 0, z: 0 });
  const dx = center.x - position.x, dz = center.z - position.z, c = Math.cos(yaw), s = Math.sin(yaw);
  const axleX = c * dx - s * dz, axleZ = s * dx + c * dz, axleY = center.y + 2.65 - position.y;
  // Fixed hitch on the inside shoulder, modelled as a ring and leather collar.
  const hitchX = .43, hitchY = 1.32, hitchZ = .18;
  arm.position.set(axleX, axleY, axleZ);
  arm.rotation.set(0, Math.atan2(hitchX - axleX, hitchZ - axleZ), 0);
  arm.scale.set(1, 1, Math.hypot(hitchX - axleX, hitchZ - axleZ));
  drop.position.set(hitchX, hitchY, hitchZ);
  drop.scale.set(1, axleY - hitchY, 1);
  hub.position.set(axleX, axleY, axleZ);
}
