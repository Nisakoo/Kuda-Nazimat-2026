import { Material, Mesh, MeshStandardMaterial, ShaderChunk, Vector3 } from 'three';
import type { DirectionalLight, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { BudgetExhausted, type WorldBudget } from '../src/map/WorldBudget';
import type { ThreeRenderer } from '../src/render/three/ThreeRenderer';

/** Test-only CSM quality/cost experiment. No product setting until acceptance. */
export function cascadeExperiment(adapter: ThreeRenderer, variant: string, budget: WorldBudget): () => void {
  if (variant === 'baseline') return () => {};
  if (variant !== 'two') throw new Error('Unknown cascade experiment');
  const engine = adapter as unknown as { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; sun: DirectionalLight; quality: string };
  if (engine.quality !== 'high') return () => {};
  let lease;
  try { lease = budget.reserve('experiment:cascades', 0, 256 * 1024); }
  catch (error) { if (error instanceof BudgetExhausted) return () => {}; throw error; }
  const sun = engine.sun, gpu = engine.renderer, scene = engine.scene;
  const chunks = { fragment: ShaderChunk.lights_fragment_begin, pars: ShaderChunk.lights_pars_begin };
  const original = gpu.render;
  const saved = new Map<MeshStandardMaterial, { hook: Material['onBeforeCompile']; defines: Record<string, unknown> }>();
  const meta = { variant, frames: 0, materials: 0, lateMaterials: 0, fallback: false, targets: [] as { width: number; height: number; format: number; type: number; depthFormat: number | null; depthType: number | null; depth: boolean }[], targetBytesEstimate: 0, splits: [] as number[] };
  scene.userData.cascadeExperiment = meta;
  sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.mapPass?.dispose(); sun.shadow.mapPass = null;
  scene.remove(sun, sun.target);
  const csm = new CSM({ camera: engine.camera, parent: scene, cascades: 2, maxFar: 64, mode: 'practical', shadowMapSize: 1024,
    lightDirection: new Vector3(-18,-12,12).normalize(), lightIntensity: sun.intensity, lightNear: 1, lightFar: 120, lightMargin: 40, shadowBias: sun.shadow.bias });
  csm.fade = true; csm.updateFrustums();
  for (const light of csm.lights) { light.color.copy(sun.color); light.shadow.normalBias = sun.shadow.normalBias; }
  engine.sun = csm.lights[0]!;
  let projection = '', released = false;
  const release = () => {
    if (released) return; released = true; gpu.render = original;
    csm.remove(); csm.dispose();
    for (const light of csm.lights) { light.shadow.dispose(); light.shadow.map = null; light.shadow.mapPass = null; }
    for (const [material, previous] of saved) { material.onBeforeCompile = previous.hook; material.defines = previous.defines; material.needsUpdate = true; } saved.clear();
    ShaderChunk.lights_fragment_begin = chunks.fragment; ShaderChunk.lights_pars_begin = chunks.pars;
    engine.sun = sun; scene.add(sun, sun.target); meta.targets = []; meta.targetBytesEstimate = 0; lease.release();
  };
  gpu.render = (...args) => {
    if (released) return original.apply(gpu, args);
    scene.traverse(node => {
      if (!(node instanceof Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (!(material instanceof MeshStandardMaterial) || saved.has(material)) continue;
        if (saved.size >= 128 || material.onBeforeCompile !== Material.prototype.onBeforeCompile) { meta.fallback = true; continue; }
        saved.set(material, { hook: material.onBeforeCompile, defines: { ...material.defines } }); csm.setupMaterial(material); material.needsUpdate = true;
        if (meta.frames > 0) meta.lateMaterials++;
      }
    });
    if (meta.fallback) { release(); return original.apply(gpu, args); }
    const nextProjection = engine.camera.projectionMatrix.elements.join(',');
    if (nextProjection !== projection) { csm.updateFrustums(); projection = nextProjection; }
    csm.update();
    for (const light of csm.lights) { light.updateMatrixWorld(); light.target.updateMatrixWorld(); }
    const result = original.apply(gpu, args); meta.frames++; meta.materials = saved.size; meta.splits = [...csm.breaks];
    meta.targets = csm.lights.flatMap(light => { const map = light.shadow.map; return map ? [{ width: map.width, height: map.height, format: map.texture.format, type: map.texture.type, depthFormat: map.depthTexture?.format ?? null, depthType: map.depthTexture?.type ?? null, depth: map.depthBuffer }] : []; });
    meta.targetBytesEstimate = meta.targets.reduce((sum,map) => sum + map.width * map.height * 8, 0);
    return result;
  };
  return () => { release(); delete scene.userData.cascadeExperiment; };
}
