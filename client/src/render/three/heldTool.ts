import { Group } from 'three';
import type { ToolId } from '../../../../shared/equipment/types';
import type { SceneAssets, Shape } from './SceneAssets';
/** Closed, local presentation of the authoritative hands slot. Does not own inventory. */
export function createHeldTool(assets: SceneAssets, tool: ToolId): Group {
  const root = new Group(); root.name = `held:${tool}`;
  const add = (shape: Shape, color: string, position: readonly number[], scale: readonly number[]) => {
    const mesh = assets.mesh(shape, color); mesh.position.set(position[0]!, position[1]!, position[2]!); mesh.scale.set(scale[0]!, scale[1]!, scale[2]!); root.add(mesh); return mesh;
  };
  if (tool === 'bag') {
    add('roundedBox', '#967045', [0, -.19, .02], [.29, .3, .15]);
    add('roundedBox', '#b39261', [0, -.08, .105], [.3, .13, .035]);
    add('roundedBox', '#b89a59', [0, -.16, .128], [.055, .065, .018]);
    for (const side of [-1, 1]) { const strap = add('capsule', '#765739', [side * .095, -.025, 0], [.035, .16, .035]); strap.rotation.z = side * -.45; }
  } else {
    add('sphere', '#bd754c', [0, -.23, .015], [.125, .16, .115]);
    add('cylinder', '#cc8b5b', [0, -.065, .015], [.06, .13, .06]);
    add('cylinder', '#d9a16a', [0, .005, .015], [.075, .025, .075]);
    add('cylinder', '#714527', [0, .019, .015], [.05, .003, .05]);
    add('capsule', '#a66443', [.135, -.14, .015], [.035, .15, .035]);
    for (const y of [-.07, -.21]) add('roundedBox', '#a66443', [.106, y, .015], [.085, .035, .035]);
    add('cylinder', '#d0a16b', [0, -.21, .015], [.127, .035, .117]);
  }
  return root;
}
