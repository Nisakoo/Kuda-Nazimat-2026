import type { InstancedMesh, Object3D, Scene, SkinnedMesh, WebGLRenderer, DirectionalLight } from 'three';
import type { ThreeRenderer } from '../src/render/three/ThreeRenderer';

/** A conservative subset of cache invalidators; no cache is installed. Test-only. */
export function shadowCacheAudit(renderer: ThreeRenderer) {
  const { scene, sun, renderer: gpu } = renderer as unknown as { scene: Scene; sun: DirectionalLight; renderer: WebGLRenderer };
  const before = scene.onBeforeRender, after = scene.onAfterRender;
  const restores = new Map<Object3D, Object3D['onBeforeShadow']>();
  let previous = new Map<string, number[]>(), current = new Map<string, number[]>(), previousLight: number[] = [];
  let bytes = 0, overflow = false, frames = 0, unchanged = 0, lightChanges = 0, transformChanges = 0, setChanges = 0, first = true;
  const same = (a: readonly number[] | undefined, b: ArrayLike<number>) => !!a && a.length === b.length && a.every((value, index) => value === b[index]);
  scene.onBeforeRender = (...args) => {
    current = new Map(); bytes = 0;
    scene.traverse(object => {
      if (!('isMesh' in object) || restores.has(object)) return;
      if (restores.size >= 2048) { overflow = true; return; }
      const original = object.onBeforeShadow; restores.set(object, original);
      object.onBeforeShadow = (...shadowArgs) => {
        const instance = object as InstancedMesh, skin = object as SkinnedMesh;
        const parts: ArrayLike<number>[] = [object.matrixWorld.elements];
        if (instance.isInstancedMesh) parts.push(instance.instanceMatrix.array);
        if (skin.isSkinnedMesh && skin.skeleton.boneMatrices) parts.push(skin.skeleton.boneMatrices);
        const count = parts.reduce((sum, part) => sum + part.length, 0);
        if (bytes + count * 8 > 1024 * 1024) overflow = true;
        else {
          const values = parts.flatMap(part => Array.from(part)); bytes += values.length * 8;
          current.set(object.uuid, values);
        }
        return original.apply(object, shadowArgs);
      };
    });
    before.apply(scene, args);
  };
  scene.onAfterRender = (...args) => {
    if (gpu.shadowMap.enabled) {
      const light = [...sun.matrixWorld.elements, ...sun.target.matrixWorld.elements, ...sun.shadow.camera.projectionMatrix.elements];
      const lightChanged = !same(previousLight, light);
      const changedSet = current.size !== previous.size || [...current.keys()].some(key => !previous.has(key));
      const moved = [...current].some(([key, value]) => !same(previous.get(key), value));
      if (!first) {
        frames++; if (lightChanged) lightChanges++; if (changedSet) setChanges++; if (moved) transformChanges++;
        if (!overflow && !lightChanged && !changedSet && !moved) unchanged++;
      }
      previous = current; previousLight = light; first = false;
    }
    after.apply(scene, args);
  };
  return () => {
    scene.onBeforeRender = before; scene.onAfterRender = after;
    for (const [object, original] of restores) object.onBeforeShadow = original;
    const result = { frames, unchanged, lightChanges, transformChanges, setChanges, observedCasters: restores.size, overflow, note: 'World/instance/bone transforms and caster/light changes only; additional material/geometry invalidators can only reduce cache reuse.' };
    restores.clear(); previous.clear(); current.clear(); return result;
  };
}
