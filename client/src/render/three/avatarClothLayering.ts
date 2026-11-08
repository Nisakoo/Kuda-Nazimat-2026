import { Mesh } from 'three';
import type { Material, Object3D } from 'three';
import { isAvatarId } from '../../../../shared/avatar/index.ts';

/** View-space distance (metres) by which trouser depth is pushed away from the camera. */
export const TROUSER_DEPTH_BIAS = .1;
const TROUSERS = /^(hip|knee)-(left|right)-surface$/;

/**
 * Keeps player tunics over the trousers while walking. Swinging thighs can still cut through the
 * hem panels, so trouser surfaces get a small depth bias: wherever trousers and tunic overlap on
 * screen, the tunic wins; their screen position is unchanged and boots are not biased. Applied
 * once to a loaded template, so every clone shares the layered material and disposal path.
 * Returns the number of layered meshes.
 */
export function layerAvatarClothing(scene: Object3D): number {
  const avatar = scene.getObjectByName('avatar');
  if (!avatar || !isAvatarId(avatar.userData.avatarId)) return 0;
  const layered = new Map<Material, Material>();
  let count = 0;
  avatar.traverse(node => {
    if (!(node instanceof Mesh) || !TROUSERS.test(node.name) || Array.isArray(node.material)) return;
    const source = node.material as Material;
    let material = layered.get(source);
    if (!material) {
      material = source.clone();
      material.onBeforeCompile = shader => {
        // Keep x/y (silhouette) and move only depth, as if the vertex were further away.
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  { vec4 biased = projectionMatrix * vec4( mvPosition.xyz - vec3( 0.0, 0.0, ${TROUSER_DEPTH_BIAS.toFixed(3)} ), 1.0 );
    gl_Position.z = biased.z / biased.w * gl_Position.w; }`);
      };
      material.customProgramCacheKey = () => 'avatar-trouser-depth-bias';
      layered.set(source, material);
    }
    node.material = material;
    count++;
  });
  return count;
}
