import { Color, DirectionalLight, Fog, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer, ACESFilmicToneMapping, PCFShadowMap } from 'three';
import type { CameraView, RenderAdapter, VisualChunk, RenderDiagnostics } from '../RenderAdapter';
import type { EntityId, WorldSnapshot } from '../../core/types';
import { SceneAssets } from './SceneAssets';
import { EntityVisuals } from './EntityVisuals';
import { createDemoScenery } from './demoScenery';
import type { AssetManager } from '../../map/AssetManager';
import { GltfLibrary } from './GltfLibrary';
import { VisualChunks } from './VisualChunks';
import { CameraObstruction } from './CameraObstruction';
import { damp } from './CharacterMotion';
import { FrameFence } from './FrameFence';

export class ThreeRenderer implements RenderAdapter {
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private assets: SceneAssets | null = null;
  private visuals: EntityVisuals | null = null;
  private playerId: EntityId | null = null;
  private view: CameraView = { yaw: 0, pitch: 0.7, distance: 15 };
  private readonly target = new Vector3();
  private obstruction = new CameraObstruction();
  private readonly cameraDirection = new Vector3();
  private library: GltfLibrary | null = null;
  private chunks: VisualChunks | null = null;
  private lastElapsed = 0;
  private focusHeight = .8;
  private sun: DirectionalLight | null = null;
  private readonly errors = new Map<string, string>();
  private frameFence: FrameFence | null = null;
  private readonly contextLost = (): void => { this.frameFence?.contextLost(); this.errors.set('gpu', 'Графический контекст потерян.'); };
  private readonly contextRestored = (): void => { this.frameFence?.contextRestored(); this.errors.delete('gpu'); };

  constructor(private readonly modelAssets: AssetManager, private readonly proceduralDemo = true, private readonly marketStyle = false) {}

  mount(container: HTMLElement): void {
    if (this.renderer) throw new Error('Сцена уже создана.');
    this.renderer = new WebGLRenderer({ antialias: true });
    const gl = this.renderer.getContext();
    if (!('fenceSync' in gl)) throw new Error('Требуется WebGL2 для управления очередью кадров.');
    this.frameFence = new FrameFence(gl);
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.contextRestored);
    this.renderer.domElement.setAttribute('aria-label', 'Трёхмерная сцена');
    this.renderer.domElement.setAttribute('role', 'img');
    this.scene = new Scene();
    this.scene.background = new Color(this.marketStyle ? '#edc5a4' : '#e8d9ba');
    this.scene.fog = new Fog(this.marketStyle ? '#edc5a4' : '#e8d9ba', 38, 80);
    this.camera = new PerspectiveCamera(48, 1, 0.1, 120);
    const sun = new DirectionalLight(this.marketStyle ? '#ffcf91' : '#fff0cf', this.marketStyle ? 2.7 : 2);
    sun.position.set(this.marketStyle ? 18 : -8, this.marketStyle ? 12 : 18, this.marketStyle ? -12 : 10);
    if (this.marketStyle) {
      this.renderer.toneMapping = ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
      this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = PCFShadowMap;
      sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 85 });
      sun.shadow.normalBias = .035; sun.shadow.bias = -.0001;
      this.sun = sun; this.scene.add(sun.target);
    }
    this.scene.add(new HemisphereLight(this.marketStyle ? '#ffe5cd' : '#f3f4ec', this.marketStyle ? '#aa8164' : '#b5a17b', this.marketStyle ? 1.8 : 2), sun);
    this.assets = new SceneAssets();
    if (this.proceduralDemo) this.scene.add(createDemoScenery(this.assets));
    this.library = new GltfLibrary(this.modelAssets);
    this.chunks = new VisualChunks(this.scene, this.library);
    this.visuals = new EntityVisuals(this.scene, this.assets, this.library, (id, error) => { if (error) this.errors.set(`entity:${id}`, error); else this.errors.delete(`entity:${id}`); }, this.marketStyle);
    container.append(this.renderer.domElement);
  }

  syncWorld(previous: WorldSnapshot, current: WorldSnapshot, playerId: EntityId | null): void {
    this.playerId = playerId;
    this.visuals?.sync(previous, current, playerId);
  }

  setCamera(view: CameraView): void { this.view = { ...view }; }
  setBuildingSymbols(visible: boolean): void { this.chunks?.setBuildingSymbols(visible); }
  registerModels(models: Readonly<Record<string, string>>): void { this.library?.register(models); }
  async loadChunk(chunk: VisualChunk): Promise<void> {
    if (!this.chunks) throw new Error('Renderer is not mounted');
    this.errors.delete(`chunk:${chunk.id}`);
    try { await this.chunks.load(chunk); }
    catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) this.errors.set(`chunk:${chunk.id}`, error instanceof Error ? error.message : 'Model load failed');
      throw error;
    }
  }
  revealChunks(): void { this.chunks?.reveal(); }
  unloadChunk(id: string): void { this.chunks?.unload(id); this.errors.delete(`chunk:${id}`); }
  retryFailedModels(): void { this.errors.clear(); this.visuals?.retryFailed(); }
  getDiagnostics(): RenderDiagnostics {
    const stats = this.library?.stats;
    return { chunks: this.chunks?.ids ?? [], entities: this.visuals?.ids ?? [], models: stats?.resources ?? 0, instances: stats?.instances ?? 0, queued: stats?.queued ?? 0,
      appearing: this.chunks?.appearing ?? 0, pending: (stats?.loading ?? 0) + (stats?.queued ?? 0), errors: [...this.errors.values()], geometries: this.renderer?.info.memory.geometries ?? 0, textures: this.renderer?.info.memory.textures ?? 0, drawCalls: this.renderer?.info.render.calls ?? 0 };
  }

  resize(width: number, height: number, pixelRatio: number): void {
    if (!this.renderer || !this.camera) return;
    this.camera.aspect = width / height;
    this.camera.fov = width < height ? 62 : 48;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
  }

  render(elapsedSeconds: number, alpha: number): void {
    if (!this.renderer || !this.scene || !this.camera || !this.visuals) return;
    const delta = Math.max(0, elapsedSeconds - this.lastElapsed);
    this.lastElapsed = elapsedSeconds;
    this.library?.flush();
    this.visuals.animate(alpha, elapsedSeconds, delta);
    this.chunks?.animate(delta);
    const position = this.visuals.position(this.playerId);
    if (position) this.target.copy(position);
    else this.target.set(0, 0, 0);
    if (this.sun) { this.sun.position.set(this.target.x + 18, 12, this.target.z - 12); this.sun.target.position.set(this.target.x, 0, this.target.z); }
    this.focusHeight = damp(this.focusHeight, this.view.focusHeight ?? .8, 5, Math.min(delta, .1));
    this.target.y += this.focusHeight;
    const fov = this.view.fieldOfView ?? (this.camera.aspect < 1 ? 62 : 48);
    if (Math.abs(this.camera.fov - fov) > .01) { this.camera.fov = damp(this.camera.fov, fov, 5, Math.min(delta, .1)); this.camera.updateProjectionMatrix(); }
    const { yaw, pitch, distance } = this.view;
    this.camera.position.set(
      this.target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      this.target.y + Math.sin(pitch) * distance,
      this.target.z + Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    // Update before camera probes; suppress only the renderer's duplicate scene traversal.
    this.scene.updateMatrixWorld(true);
    this.cameraDirection.copy(this.camera.position).sub(this.target).normalize();
    const halfHeight = Math.tan(this.camera.fov*Math.PI/360)*this.camera.near+.08;
    const allowed = this.obstruction.resolve(this.target,this.cameraDirection,distance,
      halfHeight*this.camera.aspect,halfHeight,this.scene.children.filter(child=>child.name.startsWith('chunk:')),delta);
    this.camera.position.copy(this.target).addScaledVector(this.cameraDirection,allowed);
    this.camera.lookAt(this.target);
    if (!this.frameFence?.canSubmit()) {
      if (this.frameFence?.failed) this.errors.set('gpu', 'Не удалось синхронизировать графический процессор.');
      return;
    }
    this.scene.matrixWorldAutoUpdate = false;
    try { this.renderer.render(this.scene, this.camera); this.frameFence.submitted(); }
    finally { this.scene.matrixWorldAutoUpdate = true; }
    if (this.frameFence.failed) this.errors.set('gpu', 'Не удалось синхронизировать графический процессор.');
  }

  dispose(): void {
    this.chunks?.dispose();
    this.visuals?.dispose();
    this.library?.dispose();
    this.assets?.dispose();
    this.sun?.shadow.dispose(); this.sun = null;
    this.scene?.clear();
    if (this.renderer) {
      this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
      this.renderer.domElement.removeEventListener('webglcontextrestored', this.contextRestored);
      this.frameFence?.dispose(); this.frameFence = null;
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer.domElement.remove();
    }
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.assets = null;
    this.visuals = null;
    this.playerId = null;
    this.library = null;
    this.chunks = null;
    this.errors.clear();
    this.obstruction = new CameraObstruction(); this.lastElapsed = 0;
  }
}
