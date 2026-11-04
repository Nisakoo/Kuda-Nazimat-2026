import { BoxGeometry, Frustum, Matrix4, Mesh, MeshStandardMaterial } from 'three';
import type { DirectionalLight, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { AssetManager, HttpAssetSource } from '../src/map/AssetManager';
import { WorldBudget } from '../src/map/WorldBudget';
import { ThreeRenderer } from '../src/render/three/ThreeRenderer';
import { isGraphicsQuality } from '../src/render/GraphicsQuality';
import { shadowExperiment } from './shadow-experiments';
import { cascadeExperiment } from './cascade-experiments';
import type { ShadowVariant } from './shadow-experiments';
const params = new URLSearchParams(location.search), quality = params.get('quality');
if (!isGraphicsQuality(quality)) throw new Error('quality required');
const budget = new WorldBudget(), reserve = budget.reserve('fixture:shadow', 0, 128 * 1024);
const assets = new AssetManager(new HttpAssetSource(new URL('/assets/models/', location.href).href));
const renderer = new ThreeRenderer(assets, false, true, quality, budget);
renderer.mount(document.getElementById('scene')!); renderer.resize(1280, 800, devicePixelRatio);
const engine = renderer as unknown as { scene: Scene; camera: PerspectiveCamera; renderer: WebGLRenderer; sun: DirectionalLight };
const contextLoss = engine.renderer.getContext().getExtension('WEBGL_lose_context');
const surfaces: Mesh[] = [];
function box(name: string, position: number[], size: number[], caster: boolean) {
  const mesh = new Mesh(new BoxGeometry(size[0], size[1], size[2]), new MeshStandardMaterial({ color: caster ? '#855d40' : '#ded4ba', roughness: 1 }));
  mesh.name = name; mesh.position.set(position[0]!, position[1]!, position[2]!); mesh.castShadow = caster; mesh.receiveShadow = true;
  engine.scene.add(mesh); surfaces.push(mesh); return mesh;
}
box('receiver', [0, -.03, 12], [90, .06, 90], false);
const behind = box('behind-camera-caster', [16, 7, -8], [8, 14, .3], true);
box('far-visible-caster', [12, 4, 16], [8, 8, .3], true);
const release = shadowExperiment(renderer, (params.get('shadow') ?? 'baseline') as ShadowVariant);
const releaseCascades = cascadeExperiment(renderer, params.get('cascades') ?? 'baseline', budget);
let frames = 0, submissions = 0, frame = 0, yaw = Math.PI, firstPerson = true, x = 0;
const snapshot = () => ({ tick: frames, entities: [{ id: 'p', transform: { position: { x, y: 0, z: 0 }, rotationY: 0 }, renderable: { assetId: 'demo-player' } }] });
let previous = snapshot(); renderer.syncWorld(previous, previous, 'p'); renderer.setMeasurementEnabled(true, true);
const began = performance.now();
const draw = (now: number) => {
  const next = snapshot(); renderer.syncWorld(previous, next, 'p'); previous = next;
  renderer.setCamera({ yaw, pitch: .2, distance: 18, firstPerson });
  if (renderer.render((now - began) / 1000, 1)) submissions++;
  frames++; document.getElementById('frames')!.textContent = `UI frames ${frames}`; frame = requestAnimationFrame(draw);
};
frame = requestAnimationFrame(draw);
const harness = {
  pose(position: number, view: boolean, angle = Math.PI) { x = position; firstPerson = view; yaw = angle; },
  stats() {
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(engine.camera.projectionMatrix, engine.camera.matrixWorldInverse));
    return { cascades: structuredClone(engine.scene.userData.cascadeExperiment ?? null), frames, submissions, behindVisibleInMain: frustum.intersectsObject(behind), shadowMatrix: engine.sun.shadow.matrix.toArray(), resources: renderer.measurementResources(), render: renderer.getDiagnostics(), budget: budget.stats, measurement: renderer.readMeasurement() };
  },
  lose() { if (!contextLoss) throw new Error('WEBGL_lose_context unavailable'); contextLoss.loseContext(); },
  restore() { if (!contextLoss) throw new Error('WEBGL_lose_context unavailable'); contextLoss.restoreContext(); },
  async inventory() { renderer.requestDrawInventory(); await new Promise(resolve => setTimeout(resolve, 100)); return renderer.readDrawInventory(); },
  dispose() { cancelAnimationFrame(frame); releaseCascades(); release(); for (const mesh of surfaces) { mesh.geometry.dispose(); (mesh.material as MeshStandardMaterial).dispose(); } renderer.dispose(); assets.dispose(); reserve.release(); return { budget: budget.stats, resources: renderer.measurementResources() }; },
};
declare global { interface Window { shadowHarness: typeof harness } }
window.shadowHarness = harness;
