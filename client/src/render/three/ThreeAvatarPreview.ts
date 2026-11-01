import { AmbientLight, Box3, Color, CylinderGeometry, DirectionalLight, Group, Mesh, MeshStandardMaterial, OrthographicCamera, PCFShadowMap, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import type { AvatarId } from '../../../../shared/avatar/types';
import { AVATAR_IDS } from '../../../../shared/avatar/types';
import type { AssetManager } from '../../map/AssetManager';
import type { AvatarPreview, AvatarPreviewEvents } from '../AvatarPreview';
import { GltfLibrary, type ModelInstance } from './GltfLibrary';

/** Frame the entire pedestal even when the preview becomes unusually narrow. */
export function configureAvatarCamera(camera: OrthographicCamera, width: number, height: number): void {
  const aspect = Math.max(1, width) / Math.max(1, height);
  const halfHeight = Math.max(1.10, .78 / aspect);
  camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
  camera.top = halfHeight; camera.bottom = -halfHeight;
  camera.position.set(0, 1.5, 5); camera.lookAt(0, .86, 0); camera.updateProjectionMatrix();
}

/** A bounded preview renderer. It shares the production GLB parser and resource lifecycle. */
export class ThreeAvatarPreview implements AvatarPreview {
  private readonly renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1.1, -1.1, .1, 30);
  private readonly group = new Group();
  private readonly library: GltfLibrary;
  private model: ModelInstance | null = null;
  private modelId: AvatarId | null = null;
  private portraitsReady = false;
  private working = false;
  private revision = 0;
  private settledRevision = 0;
  private readonly abort = new AbortController();
  private readonly observer: ResizeObserver;
  private readonly pedestal: Mesh<CylinderGeometry, MeshStandardMaterial>;
  private readonly sun: DirectionalLight;
  private selected: AvatarId = 'lukas';
  private frame = 0;
  private disposed = false;
  private last = 0;

  constructor(private readonly host: HTMLElement, private readonly assets: AssetManager, private readonly events: AvatarPreviewEvents) {
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setClearColor(new Color('#fff4da'), 0);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    host.append(this.renderer.domElement);
    configureAvatarCamera(this.camera, 1, 1);
    this.scene.add(new AmbientLight('#fff7df', 2.3));
    const sun = this.sun = new DirectionalLight('#fff1d0', 3.3); sun.position.set(-3, 6, 5); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -2; sun.shadow.camera.right = 2; sun.shadow.camera.top = 3; sun.shadow.camera.bottom = -1; this.scene.add(sun);
    const fill = new DirectionalLight('#d4e9e9', 1.2); fill.position.set(4, 2, 1); this.scene.add(fill);
    this.pedestal = new Mesh(new CylinderGeometry(.72, .76, .12, 6), new MeshStandardMaterial({ color: '#e4cba2', roughness: 1, flatShading: true }));
    this.pedestal.position.y = -.065; this.pedestal.receiveShadow = true; this.scene.add(this.pedestal, this.group);
    this.library = new GltfLibrary(assets);
    this.library.register(Object.fromEntries(AVATAR_IDS.map(id => [id, `${id}.glb`])));
    this.observer = new ResizeObserver(this.resize); this.observer.observe(host); this.resize();
    this.frame = requestAnimationFrame(this.render);
    this.pump();
  }
  private readonly resize = (): void => {
    if (this.disposed) return;
    const { width, height } = this.host.getBoundingClientRect();
    this.renderer.setSize(Math.max(1, width), Math.max(1, height));
    configureAvatarCamera(this.camera, width, height);
  };
  private normalize(model: ModelInstance): void {
    // Normalize visual geometry only. Gameplay dimensions are not read from the mesh.
    const bounds = new Box3().setFromObject(model.root); const size = bounds.getSize(new Vector3());
    if (!(size.y > 0)) throw new Error('Empty avatar model');
    model.root.scale.multiplyScalar(1.85 / size.y); model.root.position.y = -bounds.min.y * (1.85 / size.y);
  }
  private pump(): void {
    if (this.disposed || this.working) return;
    this.working = true;
    void this.load().finally(() => {
      this.working = false;
      if (!this.disposed && this.revision !== this.settledRevision) this.pump();
    });
  }
  private async load(): Promise<void> {
    try {
      if (!this.portraitsReady) {
        for (const id of AVATAR_IDS) {
          const model = await this.library.instantiate(id, this.abort.signal);
          try {
            if (this.disposed) return;
            this.normalize(model); this.group.add(model.root);
            this.makePortrait(id);
          } finally { model.root.removeFromParent(); model.dispose(); }
          if (this.disposed) return;
        }
        this.portraitsReady = true;
      }
      while (!this.disposed) {
        const id = this.selected;
        if (this.modelId === id && this.model) { this.settledRevision = this.revision; this.events.loaded(); return; }
        this.model?.dispose(); this.model = null; this.modelId = null;
        let model: ModelInstance;
        try { model = await this.library.instantiate(id, this.abort.signal); }
        catch (error) { if (!this.disposed && this.selected !== id) continue; throw error; }
        if (this.disposed || this.selected !== id) { model.dispose(); continue; }
        try { this.normalize(model); this.group.add(model.root); }
        catch (error) { model.dispose(); throw error; }
        this.model = model; this.modelId = id; this.settledRevision = this.revision; this.events.loaded();
        if (this.selected === id) return;
      }
    } catch (error) {
      if (!this.disposed) { this.settledRevision = this.revision; this.events.error(error instanceof Error ? `Не удалось загрузить модель: ${error.message}` : 'Не удалось загрузить модели обликов.'); }
    }
  }
  private makePortrait(id: AvatarId): void {
    this.pedestal.visible = false;
    const yaw = this.group.rotation.y;
    this.group.rotation.y = -.12;
    const camera = new OrthographicCamera(-.55, .55, .55, -.55, .1, 20);
    camera.position.set(0, 1.56, 5); camera.lookAt(0, 1.47, 0);
    this.renderer.setPixelRatio(1); this.renderer.setSize(320, 320, false); this.renderer.render(this.scene, camera);
    this.events.portrait(id, this.renderer.domElement.toDataURL('image/png'));
    this.pedestal.visible = true; this.group.rotation.y = yaw; this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); this.resize();
  }
  select(id: AvatarId): void { if (this.disposed) return; this.selected = id; this.revision++; this.pump(); }
  rotate(radians: number): void { this.group.rotation.y += radians; }
  private readonly render = (now: number): void => {
    if (this.disposed) return;
    const dt = this.last ? Math.min((now - this.last) / 1000, .1) : 0; this.last = now;
    this.library.flush(4);
    if (!document.hidden) { this.model?.animate('idle', dt); this.renderer.render(this.scene, this.camera); }
    this.frame = requestAnimationFrame(this.render);
  };
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.abort.abort(); cancelAnimationFrame(this.frame); this.observer.disconnect();
    this.model?.dispose(); this.model = null; this.modelId = null;
    this.library.dispose(); this.assets.dispose(); this.pedestal.geometry.dispose(); this.pedestal.material.dispose();
    this.sun.shadow.dispose(); this.scene.clear();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
