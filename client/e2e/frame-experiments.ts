import { Material, Mesh, MeshLambertMaterial, MeshStandardMaterial } from 'three';
import type { Scene, WebGLRenderer } from 'three';
import type { ThreeRenderer } from '../src/render/three/ThreeRenderer';
import type { CameraRaycast } from '../src/render/three/CameraRaycast';
import { BudgetExhausted, type WorldBudget } from '../src/map/WorldBudget';

/** Test-only material comparison. Original materials are restored after every draw. */
export function frameExperiment(adapter: ThreeRenderer, variant: string, budget: WorldBudget): () => void {
  if (variant === 'baseline') return () => {};
  if (variant === 'precompile') {
    const engine = adapter as unknown as { scene: Scene; camera: import('three').PerspectiveCamera; renderer: WebGLRenderer;
      chunks: { chunks: Map<string, { loaded: boolean; controller: AbortController }> } };
    let lease;
    try { lease = budget.reserve('experiment:precompile', 0, 128 * 1024); }
    catch (error) { if (error instanceof BudgetExhausted) return () => {}; throw error; }
    const meta = { variant, rounds: 0, active: false, fallback: false, cpuMs: [] as number[], readyMs: [] as number[] };
    engine.scene.userData.frameExperiment = meta;
    const original = adapter.loadChunk, materials = new Set<Material>();
    let requested = false, disposed = false, inFlight: Promise<void> | null = null, cancel!: () => void;
    const cancelled = new Promise<void>(resolve => { cancel = resolve; });
    const prepare = (): Promise<void> => {
      if (disposed || meta.rounds >= 2) return Promise.resolve();
      requested = true;
      inFlight ??= (async () => {
        while (requested && !disposed && meta.rounds < 2) {
          requested = false; meta.rounds++; materials.clear();
          engine.scene.traverse(node => { if (!(node instanceof Mesh)) return; for (const m of Array.isArray(node.material) ? node.material : [node.material]) { if (materials.size < 128) materials.add(m); else meta.fallback = true; } });
          if (meta.fallback) { materials.clear(); break; }
          meta.active = true; const began = performance.now();
          const compile = engine.renderer.compileAsync(engine.scene, engine.camera);
          meta.cpuMs.push(performance.now() - began);
          await Promise.race([compile.then(() => {}), cancelled]);
          meta.readyMs.push(performance.now() - began); meta.active = false; materials.clear();
        }
      })().finally(() => { inFlight = null; });
      return inFlight;
    };
    adapter.loadChunk = async chunk => {
      await original.call(adapter, chunk); if (disposed) return;
      const state = engine.chunks.chunks.get(chunk.id); if (!state) return;
      state.loaded = false;
      try { await prepare(); }
      finally { if (engine.chunks.chunks.get(chunk.id) === state && !state.controller.signal.aborted) state.loaded = true; }
    };
    const cleanup = () => {
      if (disposed) return; disposed = true;
      // Disposing pending materials lets Three's internal 10 ms readiness poll
      // finish even if context loss prevents a compile result from arriving.
      for (const material of materials) material.dispose(); materials.clear(); cancel();
      engine.renderer.domElement.removeEventListener('webglcontextlost', cleanup); adapter.loadChunk = original;
      delete engine.scene.userData.frameExperiment; lease.release();
    };
    engine.renderer.domElement.addEventListener('webglcontextlost', cleanup);
    return cleanup;
  }
  if (variant === 'shared-rays') {
    const engine = adapter as unknown as { shotgun: { raycast: CameraRaycast }; obstruction: { geometry: CameraRaycast } };
    const previous = engine.shotgun.raycast; engine.shotgun.raycast = engine.obstruction.geometry;
    return () => { engine.shotgun.raycast = previous; };
  }
  if (variant !== 'lambert' && variant !== 'lambert96') throw new Error('Invalid frame experiment');
  const engine = adapter as unknown as { scene: Scene; renderer: WebGLRenderer };
  let lease;
  try { lease = budget.reserve('experiment:materials', 0, 512 * 1024); }
  catch (error) { if (error instanceof BudgetExhausted) return () => {}; throw error; }
  const pool = new Map<MeshStandardMaterial, MeshLambertMaterial>();
  const changes: { mesh: Mesh; original: Material | Material[] }[] = [];
  const originalRender = engine.renderer.render;
  const convert = (source: Material): Material => {
    if (!(source instanceof MeshStandardMaterial) || source.roughness !== 1 || source.metalness !== 0 || source.transparent || source.opacity !== 1 || source.alphaTest !== 0
      || source.onBeforeCompile !== Material.prototype.onBeforeCompile || Object.keys(source.userData).length
      || Object.values(source).some(value => value && typeof value === 'object' && 'isTexture' in value)) return source;
    const previous = pool.get(source); if (previous) return previous;
    if (pool.size >= 64) return source;
    const copy = new MeshLambertMaterial(); Material.prototype.copy.call(copy, source);
    copy.color.copy(source.color).multiplyScalar(variant === 'lambert96' ? .96 : 1);
    copy.emissive.copy(source.emissive); copy.emissiveIntensity = source.emissiveIntensity;
    copy.flatShading = source.flatShading; copy.wireframe = source.wireframe;
    copy.fog = source.fog; copy.shadowSide = source.shadowSide;
    pool.set(source, copy); return copy;
  };
  engine.renderer.render = (...args) => {
    engine.scene.traverse(node => {
      if (!(node instanceof Mesh) || changes.length >= 2048) return;
      const original = node.material;
      const next = Array.isArray(original) ? original.map(convert) : convert(original);
      if (Array.isArray(original) ? (next as Material[]).every((material,index) => material === original[index]) : next === original) return;
      changes.push({ mesh: node, original }); node.material = next;
    });
    try { return originalRender.apply(engine.renderer, args); }
    finally { for (const { mesh, original } of changes) mesh.material = original; changes.length = 0; }
  };
  return () => { engine.renderer.render = originalRender; for (const material of pool.values()) material.dispose(); pool.clear(); lease.release(); };
}
