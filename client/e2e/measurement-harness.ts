import { AssetManager, HttpAssetSource } from '../src/map/AssetManager';
import { WorldBudget } from '../src/map/WorldBudget';
import { HttpMapSource } from '../src/map/HttpMapSource';
import { ChunkManager } from '../src/map/ChunkManager';
import { ThreeRenderer } from '../src/render/three/ThreeRenderer';
import { isGraphicsQuality } from '../src/render/GraphicsQuality';
import { MarketSession } from '../src/session/MarketSession';
import { MARKET_WORLD } from '../src/shared/marketWorld.generated';
import type { WorldSnapshot } from '../src/core/types';
import type { ShotgunState } from '../../shared/shotgun/types';
import type { SceneStateMessage } from '../../shared/world-life/types';
import { shadowExperiment } from './shadow-experiments';
import type { ShadowVariant } from './shadow-experiments';
import { shadowCacheAudit } from './shadow-cache-audit';
import { detailExperiment } from './detail-experiments';
import { frameExperiment } from './frame-experiments';
import { occlusionExperiment } from './occlusion-experiments';
import { cascadeExperiment } from './cascade-experiments';
import { Box3, Mesh, Vector3 } from 'three';

// Presentation-only fixture: positions are authored, not simulated or authoritative.
// Wall-clock time drives the route; fixed scene time drives wind/animations.
const route = [
  [0, 0, 8, 0, 0], [10, 0, 8, 0, 0], [18, -32, 9, 0, .7],
  [24, -23, -4, 3, 1.4], [30, 0, -16, 0, Math.PI],
  [40, 0, -58, 0, Math.PI], [48, 0, -40, 0, 0], [56, 0, 8, 0, 0], [60, 0, 8, 0, 0],
] as const;
const params = new URLSearchParams(location.search);
const selectedQuality = params.get('quality'); if (!isGraphicsQuality(selectedQuality)) throw new Error('quality required');
const quality = selectedQuality;
let renderer: ThreeRenderer | null = null, chunks: ChunkManager | null = null, assets: AssetManager | null = null;
let budget = new WorldBudget();
let snapshot: WorldSnapshot = { tick: 0, entities: [] };
let definition: SceneStateMessage['definition'] | null = null;
let lifeState: SceneStateMessage | null = null;
let frame = 0, began = 0, openedAt = 0, running = false, fixedTime: number | null = null, lastShot = 0, shotId = 0;
let loops: number[] = [], overflow = 0;
let lastSubmit: number | null = null;
let submissions: number[] = [];
let outerRenderCpu: number[] | null = null;
let releaseShadowExperiment: (() => void) | null = null;
let cacheAudit: ReturnType<typeof shadowCacheAudit> | null = null;
let releaseDetailExperiment: (() => void) | null = null;
let releaseFrameExperiment: (() => void) | null = null;
let releaseOcclusionExperiment: (() => void) | null = null;
let releaseCascadeExperiment: (() => void) | null = null;
let visualTime: number | null = null;
const shots: ShotgunState = { v: 1, type: 'shotgun-state', sceneId: 'measurement', mapId: 'market', revision: 0, props: [], weapons: [{ playerId: 'local-player', ammo: 6, reloadLeft: 0, shotId: 0 }], shots: [] };
function pose(seconds: number) {
  const t = Math.max(0, Math.min(seconds, 60));
  const b = route.findIndex(point => point[0] >= t);
  const from = route[Math.max(0, b - 1)]!, to = route[Math.max(0, b)]!;
  const alpha = to[0] === from[0] ? 0 : (t - from[0]) / (to[0] - from[0]);
  const lerp = (a: number, b: number) => a + (b - a) * alpha;
  return { x: lerp(from[1], to[1]), z: lerp(from[2], to[2]), y: lerp(from[3], to[3]), yaw: lerp(from[4], to[4]) + (t >= 48 && t < 50 ? Math.PI : 0) };
}
function present(now: number) {
  if (!renderer) return;
  const seconds = fixedTime ?? (running ? (now - began) / 1000 : 0);
  const p = pose(seconds);
  const next = { ...snapshot, tick: snapshot.tick + 1, entities: snapshot.entities.map(entity => entity.id === 'local-player' ? { ...entity, transform: { position: { x: p.x, y: p.y, z: p.z }, rotationY: p.yaw } } : entity) };
  renderer.syncWorld(snapshot, next, 'local-player'); snapshot = next;
  chunks?.plan(p);
  renderer.setCamera({ yaw: p.yaw, pitch: .5, distance: 18, firstPerson: seconds >= 50 && seconds < 54 });
  // 16 deterministic shots, eight pellets each, reach the existing 96-mark bound.
  // This isolates visual impact handling; it does not exercise authority/ammo rules.
  if (running && seconds >= 1 && seconds < 9 && seconds - lastShot >= .5) {
    lastShot = seconds; shotId++;
    renderer.setShotgun({ ...shots, revision: shotId, shots: [{ id: shotId, playerId: 'local-player', origin: { x: 0, y: 1.45, z: 8 }, yaw: 0, pitch: .3 }] }, 'local-player');
  }
  const cpuStart = outerRenderCpu ? performance.now() : 0;
  const submitted = renderer.render(visualTime ?? 100 + (now - openedAt) / 1000, 1);
  if (outerRenderCpu && outerRenderCpu.length < 12000) outerRenderCpu.push(performance.now() - cpuStart);
  if (running) {
    if (loops.length < 12000) loops.push(now); else overflow++;
    if (submitted && submissions.length < 12000) { submissions.push(now); lastSubmit = now; }
  }
}
const draw = (now: number) => { present(now); frame = requestAnimationFrame(draw); };
function stats() { const experiment = renderer ? (renderer as unknown as { scene: import('three').Scene }).scene?.userData.frameExperiment : undefined; return { cascades: renderer ? structuredClone((renderer as unknown as { scene: import('three').Scene }).scene?.userData.cascadeExperiment ?? null) : null, occlusion: renderer ? structuredClone((renderer as unknown as { scene: import('three').Scene }).scene?.userData.occlusionExperiment ?? null) : null, experiment: experiment ? structuredClone(experiment) : null, render: renderer?.getDiagnostics(), budget: budget.stats, chunks: chunks?.stats, resources: renderer?.measurementResources(), queries: renderer?.measurementStatus(), shotId }; }
async function close() {
  cancelAnimationFrame(frame); running = false;
  cacheAudit?.(); cacheAudit = null;
  releaseCascadeExperiment?.(); releaseCascadeExperiment = null;
  releaseOcclusionExperiment?.(); releaseOcclusionExperiment = null;
  releaseFrameExperiment?.(); releaseFrameExperiment = null;
  releaseDetailExperiment?.(); releaseDetailExperiment = null;
  releaseShadowExperiment?.(); releaseShadowExperiment = null;
  chunks?.dispose(); renderer?.dispose(); assets?.dispose();
  const result = stats();
  renderer = null; chunks = null; assets = null; definition = null; lifeState = null; snapshot = { tick: 0, entities: [] };
  await budget.whenEmpty(); return { ...result, releasedBudget: budget.stats };
}
async function open(measure = true, marks: 'legacy' | 'instanced' = params.has('marks') ? params.get('marks') === 'instanced' ? 'instanced' : 'legacy' : quality === 'high' ? 'legacy' : 'instanced') {
  await close(); budget = new WorldBudget();
  const sizes = new Map(Object.entries(MARKET_WORLD.assets).map(([path, size]) => [new URL(path, location.origin).href, size]));
  assets = new AssetManager(new HttpAssetSource(new URL('/assets/models/', location.href).href), budget, url => sizes.get(url));
  renderer = new ThreeRenderer(assets, false, true, quality, budget, marks === 'instanced');
  renderer.mount(document.getElementById('scene')!); renderer.resize(1280, 800, devicePixelRatio); renderer.revealChunks();
  const variant = params.get('shadow') ?? 'baseline';
  if (!['baseline', 'tight', 'snap'].includes(variant)) throw new Error('Invalid shadow experiment');
  releaseShadowExperiment = shadowExperiment(renderer, variant as ShadowVariant);
  releaseDetailExperiment = detailExperiment(renderer, params.get('detail') ?? 'baseline', budget);
  releaseFrameExperiment = frameExperiment(renderer, params.get('frame') ?? 'baseline', budget); visualTime = null;
  releaseOcclusionExperiment = occlusionExperiment(renderer, params.get('occlusion') ?? 'baseline', budget);
  releaseCascadeExperiment = cascadeExperiment(renderer, params.get('cascades') ?? 'baseline', budget);
  renderer.setMeasurementEnabled(measure, params.get('passes') === '1'); lastShot = shotId = 0; fixedTime = null; openedAt = performance.now();
  const session = new MarketSession(); snapshot = session.getSnapshot(); session.dispose();
  renderer.syncWorld(snapshot, snapshot, 'local-player');
  renderer.setShotgun(shots, 'local-player');
  chunks = new ChunkManager(new HttpMapSource(MARKET_WORLD, budget, location.origin + '/'), renderer); chunks.setRadius(2);
  frame = requestAnimationFrame(draw);
  const started = performance.now();
  await chunks.start({ x: 0, y: 0, z: 8 }, manifest => {
    renderer!.registerModels(manifest.models); definition = manifest.worldLife ?? null;
    if (definition) {
      const behavior = (templateId: string) => definition!.templates.find(template => template.id === templateId)?.behavior;
      lifeState = { v: 1, type: 'scene-state', sceneId: 'measurement', revision: 0, serverTimeMs: 100000, epochMs: 0, definition,
        pots: definition.instances.filter(instance => behavior(instance.templateId) === 'pushable').map(instance => ({ id: instance.id, position: instance.position })),
        apples: definition.instances.filter(instance => behavior(instance.templateId) === 'pickup').map(instance => ({ id: instance.id, mapId: 'market', state: 'world', position: instance.position })),
        birds: (definition.perches ?? []).map(bird => ({ id: bird.id, startedMs: null, landingMs: null, yaw: bird.rotationY })),
      };
      renderer!.setSceneState(lifeState);
    }
  });
  while (chunks.stats.loading || renderer.getDiagnostics().pending || renderer.getDiagnostics().appearing) {
    if (performance.now() - started > 60000) throw new Error('Market load timeout');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return { loadMs: performance.now() - started, ...stats(), measurement: renderer.readMeasurement() };
}
const harness = {
  route, open, close, stats,
  resize(width: number, height: number, dpr = devicePixelRatio) { renderer?.resize(width, height, dpr); },
  occlusionVariant(variant: string) { releaseOcclusionExperiment?.(); releaseOcclusionExperiment = occlusionExperiment(renderer!, variant, budget); },
  occlusionBudgetFallback() { const tiny = new WorldBudget(1); const release = occlusionExperiment(renderer!, 'queries', tiny); release(); return tiny.stats; },
  cascadeVariant(variant: string) { releaseCascadeExperiment?.(); releaseCascadeExperiment = cascadeExperiment(renderer!, variant, budget); },
  cascadeBudgetFallback() { const tiny = new WorldBudget(1); const release = cascadeExperiment(renderer!, 'two', tiny); release(); return tiny.stats; },
  freezeTime(seconds: number | null) { visualTime = seconds; },
  frameVariant(variant: string) { releaseFrameExperiment?.(); releaseFrameExperiment = frameExperiment(renderer!, variant, budget); },
  detailBudgetFallback() { const empty = new WorldBudget(1); const release = detailExperiment(renderer!, 'branches', empty); release(); return empty.stats; },
  detailAudit() {
    if (!renderer) throw new Error('Open first');
    const engine = renderer as unknown as { scene: import('three').Scene; camera: import('three').PerspectiveCamera };
    const camera = engine.camera, box = new Box3(), size = new Vector3();
    const rows: { name: string; vertices: number; triangles: number; distance: number; pixels: number; animated: boolean }[] = [];
    engine.scene.traverse(node => {
      if (!(node instanceof Mesh) || !node.visible) return;
      let chunk = false, animated = false;
      for (let parent = node.parent; parent && parent !== engine.scene; parent = parent.parent) { chunk ||= parent.name.startsWith('chunk:'); animated ||= parent.matrixAutoUpdate; }
      if (!chunk) return;
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      box.copy(node.geometry.boundingBox!).applyMatrix4(node.matrixWorld); box.getSize(size);
      const distance = box.distanceToPoint(camera.position);
      rows.push({ name: node.name, vertices: node.geometry.attributes.position?.count ?? 0,
        triangles: (node.geometry.index?.count ?? node.geometry.attributes.position?.count ?? 0) / 3,
        distance, pixels: Math.max(size.x,size.y,size.z) * innerHeight / (2 * Math.tan(camera.fov * Math.PI / 360) * Math.max(1,distance)), animated });
    });
    return rows.sort((a,b)=>b.triangles-a.triangles);
  },
  startCacheAudit() { if (!renderer) throw new Error('Open first'); cacheAudit?.(); cacheAudit = shadowCacheAudit(renderer); },
  stopCacheAudit() { const result = cacheAudit?.(); cacheAudit = null; return result; },
  unloadVisual(id: string) { renderer?.unloadChunk(id); return stats(); },
  async inventory() {
    if (!renderer) throw new Error('Open first');
    renderer.requestDrawInventory();
    const started = performance.now();
    while (!renderer.readDrawInventory()) {
      if (performance.now() - started > 10000) throw new Error('Inventory frame timeout');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return { ...renderer.readDrawInventory()!, ...stats() };
  },
  start(measure: boolean, outer = false) {
    if (!renderer) throw new Error('Open first');
    loops = []; submissions = []; overflow = 0; lastSubmit = null;
    outerRenderCpu = outer ? [] : null;
    lastShot = 0; fixedTime = null; renderer.setMeasurementEnabled(measure, params.get('passes') === '1'); running = true; began = performance.now();
    if (lifeState) renderer.setSceneState({ ...lifeState });
  },
  stop() { running = false; const cpu = outerRenderCpu; outerRenderCpu = null; return { startedAt: began, durationMs: performance.now() - began, loops, submissions, outerRenderCpu: cpu, overflow, lastSubmit, ...stats(), measurement: renderer?.readMeasurement() }; },
  at(seconds: number) { fixedTime = seconds; },
  seekRoute(seconds: number) { began = performance.now() - seconds * 1000; fixedTime = null; },
};
declare global { interface Window { measurementHarness: typeof harness } }
window.measurementHarness = harness;
