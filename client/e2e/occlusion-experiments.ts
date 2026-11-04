import { Box3, Frustum, Matrix4, Mesh, Vector3 } from 'three';
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { BudgetExhausted, type WorldBudget } from '../src/map/WorldBudget';
import type { ThreeRenderer } from '../src/render/three/ThreeRenderer';

/** Observation only: delayed results never hide geometry or affect shadows. */
export function occlusionExperiment(adapter: ThreeRenderer, variant: string, budget: WorldBudget): () => void {
  if (variant === 'baseline') return () => {};
  if (variant !== 'queries') throw new Error('Unknown occlusion experiment');
  const engine = adapter as unknown as { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera };
  let lease;
  try { lease = budget.reserve('experiment:occlusion', 0, 256 * 1024); }
  catch (error) { if (error instanceof BudgetExhausted) return () => {}; throw error; }
  const gpu = engine.renderer, gl = gpu.getContext() as WebGL2RenderingContext;
  type Pending = { query: WebGLQuery; at: number; camera: string; dynamic: boolean; triangles: number; calls: number; name: string };
  const pending: Pending[] = [];
  const meta = { variant, frames: 0, submitted: 0, completed: 0, hidden: 0, cameraChanged: 0, dynamicInvalid: 0, reusableNegative: 0,
    nearSkipped: 0, overCap: 0, maxOutstanding: 0, cpuMs: [] as number[], results: [] as { at: number; hidden: boolean; triangles: number; calls: number; name: string }[], targets: 0 };
  engine.scene.userData.occlusionExperiment = meta;
  const original = gpu.render, frustum = new Frustum(), projection = new Matrix4(), box = new Box3(), center = new Vector3(), size = new Vector3();
  let disposed = false, cursor = 0, pollCursor = 0, active: Pending | null = null;
  const clearQueries = () => { if (active) { if (!gl.isContextLost()) gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE); gl.deleteQuery(active.query); active = null; } for (const p of pending) gl.deleteQuery(p.query); pending.length = 0; };
  gpu.domElement.addEventListener('webglcontextlost', clearQueries);
  gpu.render = (...args) => {
    if (disposed || gl.isContextLost()) return original.apply(gpu, args);
    const began = performance.now(), camera = engine.camera;
    const cameraKey = [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements].join(',');
    let dynamic = false, visited = 0;
    const eligible: { mesh: Mesh; triangles: number }[] = [];
    engine.scene.traverse(node => {
      if (!(node instanceof Mesh)) return;
      if (node.name === 'instanced-wind' || (node.visible && node.matrixAutoUpdate && node.name.startsWith('wind-'))) dynamic = true;
      if (++visited > 2048) return;
      const triangles = (node.geometry.index?.count ?? node.geometry.attributes.position?.count ?? 0) / 3;
      if (node.geometry.drawRange.start !== 0 || node.geometry.drawRange.count !== Infinity) return;
      if (node.type !== 'Mesh' || !node.visible || triangles < 4096 || node.morphTargetInfluences?.length) return;
      let chunk = false;
      for (let p = node.parent; p && p !== engine.scene; p = p.parent) { if (p.matrixAutoUpdate) return; chunk ||= p.name.startsWith('chunk:'); }
      if (!chunk || node.matrixAutoUpdate) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (materials.some(m => m.transparent || m.opacity !== 1 || m.alphaTest !== 0 || !m.depthWrite)) return;
      eligible.push({ mesh: node, triangles }); eligible.sort((a,b) => b.triangles - a.triangles); if (eligible.length > 8) eligible.pop();
    });
    if (visited > 2048) { meta.overCap++; eligible.length = 0; }
    for (let checks = 0; checks < Math.min(2, pending.length); checks++) {
      pollCursor %= pending.length; const item = pending[pollCursor]!;
      if (!gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) { pollCursor++; continue; }
      const hidden = !gl.getQueryParameter(item.query, gl.QUERY_RESULT); gl.deleteQuery(item.query); pending.splice(pollCursor, 1);
      meta.completed++; if (hidden) meta.hidden++;
      if (item.camera !== cameraKey) meta.cameraChanged++; if (item.dynamic || dynamic) meta.dynamicInvalid++;
      if (meta.results.length < 2048) meta.results.push({ at: item.at, hidden, triangles: item.triangles, calls: item.calls, name: item.name });
    }
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const selected = eligible.length ? eligible[cursor++ % eligible.length] : null;
    let restore: (() => void) | null = null, issued = false, callbackCpuMs = 0;
    if (selected && pending.length < 8) {
      const mesh = selected.mesh; if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) {
        box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld).expandByScalar(.1); box.getCenter(center); box.getSize(size);
        const near = frustum.planes[5]!;
        const radius = Math.abs(near.normal.x) * size.x / 2 + Math.abs(near.normal.y) * size.y / 2 + Math.abs(near.normal.z) * size.z / 2;
        if (box.containsPoint(camera.position) || near.distanceToPoint(center) <= radius || !frustum.intersectsBox(box)) meta.nearSkipped++;
        else {
          const before = mesh.onBeforeRender, after = mesh.onAfterRender;
          mesh.onBeforeRender = (...a) => {
            before.apply(mesh, a); const triangles = (a[5]?.count ?? mesh.geometry.index?.count ?? mesh.geometry.attributes.position!.count) / 3;
            if (issued || active || triangles < 4096 || pending.length >= 8) return;
            const queryAt = performance.now(), query = gl.createQuery(); if (!query) return;
            gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, query); issued = true;
            active = { query, at: began, camera: cameraKey, dynamic, triangles, calls: 1, name: mesh.name }; meta.submitted++; callbackCpuMs += performance.now() - queryAt;
          };
          mesh.onAfterRender = (...a) => {
            try { after.apply(mesh, a); }
            finally { if (active) { const queryAt = performance.now(); gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE); pending.push(active); active = null; callbackCpuMs += performance.now() - queryAt; } }
          };
          restore = () => { mesh.onBeforeRender = before; mesh.onAfterRender = after; };
        }
      }
    }
    const overhead = performance.now() - began;
    try { return original.apply(gpu, args); }
    finally {
      restore?.(); if (active) { gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE); gl.deleteQuery(active.query); active = null; }
      meta.frames++; meta.maxOutstanding = Math.max(meta.maxOutstanding, pending.length);
      if (meta.cpuMs.length < 4096) meta.cpuMs.push(overhead + callbackCpuMs);
    }
  };
  return () => { if (disposed) return; disposed = true; gpu.render = original; gpu.domElement.removeEventListener('webglcontextlost', clearQueries); clearQueries(); lease.release(); delete engine.scene.userData.occlusionExperiment; };
}
