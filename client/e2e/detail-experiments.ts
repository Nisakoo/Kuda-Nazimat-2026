import { Box3, Frustum, Matrix4, Mesh, Sphere, Vector3 } from 'three';
import type { DirectionalLight, InstancedMesh, Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { ThreeRenderer } from '../src/render/three/ThreeRenderer';
import type { WorldBudget } from '../src/map/WorldBudget';
import { BudgetExhausted } from '../src/map/WorldBudget';

export function detailExperiment(adapter: ThreeRenderer, variant: string, budget: WorldBudget): () => void {
  const engine = adapter as unknown as { scene: Scene; camera: PerspectiveCamera; sun: DirectionalLight; renderer: WebGLRenderer;
    view: { firstPerson?: boolean }; obstruction: { geometry: { bounds: WeakMap<Object3D, { bounded: boolean; tree: Box3 }> } };
    chunks: { farWindInterval: number; chunks: Map<string, { loaded: boolean }> } };
  if (variant === 'baseline') return () => {};
  if (variant === 'wind') {
    const previous = engine.chunks.farWindInterval; engine.chunks.farWindInterval = 100;
    return () => { engine.chunks.farWindInterval = previous; };
  }
  if (variant !== 'branches' && variant !== 'cached-branches') throw new Error('Invalid detail experiment');
  let lease;
  try { lease = budget.reserve('experiment:branches', 0, 64 * 1024); }
  catch (error) { if (error instanceof BudgetExhausted) return () => {}; throw error; }
  const original = engine.renderer.render, main = new Frustum(), shadow = new Frustum(), matrix = new Matrix4();
  const box = new Box3(), part = new Box3(), sphere = new Sphere(), extent = new Vector3();
  const hidden: Object3D[] = [];
  const eligible = new WeakMap<Object3D, boolean>();
  engine.renderer.render = (...args) => {
    if (variant === 'cached-branches' && engine.view.firstPerson) return original.apply(engine.renderer, args);
    main.setFromProjectionMatrix(matrix.multiplyMatrices(engine.camera.projectionMatrix, engine.camera.matrixWorldInverse));
    engine.sun.shadow.updateMatrices(engine.sun);
    shadow.setFromProjectionMatrix(matrix.multiplyMatrices(engine.sun.shadow.camera.projectionMatrix, engine.sun.shadow.camera.matrixWorldInverse));
    let roots = 0;
    for (const root of engine.scene.children) {
      if (!root.name.startsWith('chunk:') || !root.visible || roots++ >= 25) continue;
      box.makeEmpty(); let certain = true;
      if (variant === 'cached-branches') {
        const cached = engine.obstruction.geometry.bounds.get(root);
        if (!cached?.bounded || !engine.chunks.chunks.get(root.name.slice(6))?.loaded) continue;
        let safe = eligible.get(root);
        if (safe === undefined) {
          safe = true;
          root.traverse(node => { if (node.userData.cameraIgnore === true && !['instanced-wind', 'pellet-mark', 'pellet-batch'].includes(node.name)) safe = false; });
          eligible.set(root, safe);
        }
        if (!safe) continue;
        // Hidden wind sources remain in CameraRaycast bounds. Decals extend <=.05 m
        // from the owner, so this covers their omitted circles and normal offset.
        box.copy(cached.tree).expandByScalar(.1);
      } else {
      root.traverse(node => {
        if (!(node instanceof Mesh)) { if ('geometry' in node && node.visible) certain = false; return; }
        if ('isSkinnedMesh' in node || node.morphTargetInfluences?.length) { certain = false; return; }
        const instanced = node as InstancedMesh;
        if (instanced.isInstancedMesh) {
          if (!instanced.boundingSphere) { certain = false; return; }
          sphere.copy(instanced.boundingSphere); sphere.center.applyMatrix4(node.matrixWorld);
          const m = node.matrixWorld.elements;
          sphere.radius *= Math.hypot(m[0]!,m[1]!,m[2]!,m[4]!,m[5]!,m[6]!,m[8]!,m[9]!,m[10]!);
          extent.setScalar(sphere.radius); part.set(sphere.center, sphere.center).expandByVector(extent); box.union(part);
        } else {
          if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
          if (!node.geometry.boundingBox) { certain = false; return; }
          box.union(part.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld));
        }
      });
      }
      if (certain && !box.isEmpty() && !main.intersectsBox(box) && (!engine.renderer.shadowMap.enabled || !shadow.intersectsBox(box))) {
        root.visible = false; hidden.push(root);
      }
    }
    try { return original.apply(engine.renderer, args); }
    finally { for (const root of hidden) root.visible = true; hidden.length = 0; }
  };
  return () => { engine.renderer.render = original; lease.release(); };
}
