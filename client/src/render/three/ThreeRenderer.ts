import { Color, DirectionalLight, Fog, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import type { CameraView, RenderAdapter } from '../RenderAdapter';
import type { EntityId, WorldSnapshot } from '../../core/types';
import { SceneAssets } from './SceneAssets';
import { EntityVisuals } from './EntityVisuals';
import { createDemoScenery } from './demoScenery';

export class ThreeRenderer implements RenderAdapter {
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private assets: SceneAssets | null = null;
  private visuals: EntityVisuals | null = null;
  private playerId: EntityId | null = null;
  private view: CameraView = { yaw: 0, pitch: 0.7, distance: 15 };
  private readonly target = new Vector3();

  mount(container: HTMLElement): void {
    if (this.renderer) throw new Error('Сцена уже создана.');
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.domElement.setAttribute('aria-label', 'Трёхмерная сцена');
    this.renderer.domElement.setAttribute('role', 'img');
    this.scene = new Scene();
    this.scene.background = new Color('#c9d9d4');
    this.scene.fog = new Fog('#c9d9d4', 35, 75);
    this.camera = new PerspectiveCamera(48, 1, 0.1, 120);
    const sun = new DirectionalLight('#fff3d9', 2.5);
    sun.position.set(-8, 18, 10);
    this.scene.add(new HemisphereLight('#e5f2ff', '#a2ab87', 2.5), sun);
    this.assets = new SceneAssets();
    this.scene.add(createDemoScenery(this.assets));
    this.visuals = new EntityVisuals(this.scene, this.assets);
    container.append(this.renderer.domElement);
  }

  syncWorld(previous: WorldSnapshot, current: WorldSnapshot, playerId: EntityId | null): void {
    this.playerId = playerId;
    this.visuals?.sync(previous, current, playerId);
  }

  setCamera(view: CameraView): void { this.view = { ...view }; }

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
    this.visuals.animate(alpha, elapsedSeconds);
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
    this.visuals?.dispose();
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
  }
}
