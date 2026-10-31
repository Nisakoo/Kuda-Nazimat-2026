import { Color, DirectionalLight, Fog, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import type { CameraView, RenderAdapter, VisualChunk, RenderDiagnostics } from '../RenderAdapter';
import type { EntityId, WorldSnapshot } from '../../core/types';
import { SceneAssets } from './SceneAssets';
import { EntityVisuals } from './EntityVisuals';
import { createDemoScenery } from './demoScenery';
import type { AssetManager } from '../../map/AssetManager';
import { GltfLibrary } from './GltfLibrary';
import { VisualChunks } from './VisualChunks';

export class ThreeRenderer implements RenderAdapter {
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private assets: SceneAssets | null = null;
  private visuals: EntityVisuals | null = null;
  private playerId: EntityId | null = null;
  private view: CameraView = { yaw: 0, pitch: 0.7, distance: 15 };
  private readonly target = new Vector3();
  private library: GltfLibrary | null = null;
  private chunks: VisualChunks | null = null;
  private lastElapsed = 0;
  private readonly errors = new Map<string, string>();

  constructor(private readonly modelAssets: AssetManager, private readonly proceduralDemo = true) {}

  mount(container: HTMLElement): void {
    if (this.renderer) throw new Error('Сцена уже создана.');
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.domElement.setAttribute('aria-label', 'Трёхмерная сцена');
    this.renderer.domElement.setAttribute('role', 'img');
    this.scene = new Scene();
    this.scene.background = new Color('#e8d9ba');
    this.scene.fog = new Fog('#e8d9ba', 38, 80);
    this.camera = new PerspectiveCamera(48, 1, 0.1, 120);
    const sun = new DirectionalLight('#fff0cf', 2);
    sun.position.set(-8, 18, 10);
    this.scene.add(new HemisphereLight('#f3f4ec', '#b5a17b', 2), sun);
    this.assets = new SceneAssets();
    if (this.proceduralDemo) this.scene.add(createDemoScenery(this.assets));
    this.library = new GltfLibrary(this.modelAssets);
    this.chunks = new VisualChunks(this.scene, this.library);
    this.visuals = new EntityVisuals(this.scene, this.assets, this.library, (id, error) => { if (error) this.errors.set(`entity:${id}`, error); else this.errors.delete(`entity:${id}`); });
    container.append(this.renderer.domElement);
  }

  syncWorld(previous: WorldSnapshot, current: WorldSnapshot, playerId: EntityId | null): void {
    this.playerId = playerId;
    this.visuals?.sync(previous, current, playerId);
  }

  setCamera(view: CameraView): void { this.view = { ...view }; }
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
  unloadChunk(id: string): void { this.chunks?.unload(id); this.errors.delete(`chunk:${id}`); }
  retryFailedModels(): void { this.errors.clear(); this.visuals?.retryFailed(); }
  getDiagnostics(): RenderDiagnostics {
    const stats = this.library?.stats;
    return { chunks: this.chunks?.ids ?? [], entities: this.visuals?.ids ?? [], models: stats?.resources ?? 0, instances: stats?.instances ?? 0, queued: stats?.queued ?? 0,
      pending: (stats?.loading ?? 0) + (stats?.queued ?? 0), errors: [...this.errors.values()], geometries: this.renderer?.info.memory.geometries ?? 0, textures: this.renderer?.info.memory.textures ?? 0, drawCalls: this.renderer?.info.render.calls ?? 0 };
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
    this.target.y += 0.8;
    const { yaw, pitch, distance } = this.view;
    this.camera.position.set(
      this.target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      this.target.y + Math.sin(pitch) * distance,
      this.target.z + Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.chunks?.dispose();
    this.visuals?.dispose();
    this.library?.dispose();
    this.assets?.dispose();
    this.scene?.clear();
    if (this.renderer) {
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
  }
}
