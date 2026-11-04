import { ShotgunVisuals } from './ShotgunVisuals';
import type { ShotgunState } from '../../../../shared/shotgun/types.ts';
import { GRAPHICS_PROFILES, type GraphicsQuality } from '../GraphicsQuality';
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
import { CameraRaycast } from './CameraRaycast';
import { damp } from './CharacterMotion';
import { FrameFence } from './FrameFence';
import type { SceneStateMessage } from '../../../../shared/world-life/types.ts';
import { WorldLifeVisuals } from './WorldLifeVisuals';
import { RenderMeasurement } from './RenderMeasurement';
import { DrawInventory } from './DrawInventory';
import type { WorldBudget } from '../../map/WorldBudget';
import type { BufferAttribute, InterleavedBufferAttribute, Mesh, InstancedMesh, SkinnedMesh, Texture } from 'three';

export class ThreeRenderer implements RenderAdapter {
  private shotgun: ShotgunVisuals | null = null;
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private assets: SceneAssets | null = null;
  private visuals: EntityVisuals | null = null;
  private playerId: EntityId | null = null;
  private view: CameraView = { yaw: 0, pitch: 0.7, distance: 15 };
  private readonly target = new Vector3();
  private readonly raycast = new CameraRaycast();
  private obstruction = new CameraObstruction(this.raycast);
  private readonly cameraDirection = new Vector3();
  private library: GltfLibrary | null = null;
  private chunks: VisualChunks | null = null;
  private lastElapsed = 0;
  private life: WorldLifeVisuals | null = null;
  private sceneState: SceneStateMessage | null = null;
  private focusHeight = .8;
  private sun: DirectionalLight | null = null;
  private readonly errors = new Map<string, string>();
  private frameFence: FrameFence | null = null;
  private measurement: RenderMeasurement | null = null;
  private inventoryRequested = false;
  private inventory: ReturnType<DrawInventory['finish']> | null = null;
  private readonly contextLost = (): void => { this.measurement?.gpu.contextLost(); this.frameFence?.contextLost(); this.errors.set('gpu', 'Графический контекст потерян.'); };
  private readonly contextRestored = (): void => { this.measurement?.gpu.contextRestored(); this.frameFence?.contextRestored(); this.errors.delete('gpu'); };

  constructor(private readonly modelAssets: AssetManager, private readonly proceduralDemo = true, private readonly marketStyle = false, private readonly quality: GraphicsQuality = 'balanced', private readonly markBudget?: WorldBudget, private readonly batchedMarks = quality !== 'high') {}

  mount(container: HTMLElement): void {
    if (this.renderer) throw new Error('Сцена уже создана.');
    this.renderer = new WebGLRenderer({ antialias: GRAPHICS_PROFILES[this.quality].antialias });
    // Count the complete submitted frame, including shadow passes.
    this.renderer.info.autoReset = false;
    const gl = this.renderer.getContext();
    if (!('fenceSync' in gl)) throw new Error('Требуется WebGL2 для управления очередью кадров.');
    this.frameFence = new FrameFence(gl);
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.contextRestored);
    this.renderer.domElement.setAttribute('aria-label', 'Трёхмерная сцена');
    this.renderer.domElement.setAttribute('role', 'img');
    this.scene = new Scene();
    this.scene.matrixAutoUpdate = false;
    this.scene.background = new Color(this.marketStyle ? '#edc5a4' : '#e8d9ba');
    this.scene.fog = new Fog(this.marketStyle ? '#edc5a4' : '#e8d9ba', 38, 80);
    this.camera = new PerspectiveCamera(48, 1, 0.1, 120);
    const sun = new DirectionalLight(this.marketStyle ? '#ffcf91' : '#fff0cf', this.marketStyle ? 2.7 : 2);
    sun.position.set(this.marketStyle ? 18 : -8, this.marketStyle ? 12 : 18, this.marketStyle ? -12 : 10);
    if (this.marketStyle) {
      this.renderer.toneMapping = ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
      this.renderer.shadowMap.enabled = this.quality !== 'low'; this.renderer.shadowMap.type = PCFShadowMap;
      sun.castShadow = this.quality !== 'low';
      const shadowSize = GRAPHICS_PROFILES[this.quality].shadowSize; sun.shadow.mapSize.set(shadowSize, shadowSize);
      Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 85 });
      sun.shadow.normalBias = .035; sun.shadow.bias = -.0001;
      this.sun = sun; this.scene.add(sun.target);
    }
    this.scene.add(new HemisphereLight(this.marketStyle ? '#ffe5cd' : '#f3f4ec', this.marketStyle ? '#aa8164' : '#b5a17b', this.marketStyle ? 1.8 : 2), sun);
    this.assets = new SceneAssets();
    if (this.proceduralDemo) this.scene.add(createDemoScenery(this.assets));
    this.library = new GltfLibrary(this.modelAssets, this.quality);
    this.chunks = new VisualChunks(this.scene, this.library, GRAPHICS_PROFILES[this.quality].farWindInterval);
    this.visuals = new EntityVisuals(this.scene, this.assets, this.library, (id, error) => { if (error) this.errors.set(`entity:${id}`, error); else this.errors.delete(`entity:${id}`); }, this.marketStyle);
    this.life = new WorldLifeVisuals(this.scene,this.library,this.visuals,(id,error)=>{if(error)this.errors.set(`life:${id}`,error);else this.errors.delete(`life:${id}`);});
    this.shotgun=new ShotgunVisuals(this.scene,this.camera,this.visuals,this.markBudget,this.batchedMarks,this.raycast);
    container.append(this.renderer.domElement);
  }

  syncWorld(previous: WorldSnapshot, current: WorldSnapshot, playerId: EntityId | null): void {
    this.playerId = playerId;
    this.visuals?.sync(previous, current, playerId);
  }

  shotgunAim(): {yaw:number;pitch:number} | null { const position=this.visuals?.position(this.playerId);return position && this.shotgun ? this.shotgun.aim(position.clone().add(new Vector3(0,1.45,0))) : null; }
  setShotgun(state: ShotgunState, playerId: string): void { this.shotgun?.setState(state,playerId); }
  setCamera(view: CameraView): void { this.view = { ...view }; }
  setBuildingSymbols(visible: boolean): void { this.chunks?.setBuildingSymbols(visible); }
  setSceneState(state: SceneStateMessage | null): void { this.sceneState = state; this.life?.setState(state,this.lastElapsed); this.shotgun?.pruneDetachedMarks(); }
  registerModels(models: Readonly<Record<string, string>>): void { this.library?.register(models); }
  async loadChunk(chunk: VisualChunk): Promise<void> {
    if (!this.chunks) throw new Error('Renderer is not mounted');
    this.errors.delete(`chunk:${chunk.id}`);
    try {
      const loading = this.chunks.load(chunk);
      this.shotgun?.pruneDetachedMarks();
      await loading;
    }
    catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) this.errors.set(`chunk:${chunk.id}`, error instanceof Error ? error.message : 'Model load failed');
      throw error;
    }
  }
  revealChunks(): void { this.chunks?.reveal(); }
  unloadChunk(id: string): void { this.chunks?.unload(id); this.shotgun?.pruneDetachedMarks(); this.errors.delete(`chunk:${id}`); }
  retryFailedModels(): void { this.errors.clear(); this.visuals?.retryFailed(); this.life?.retryFailed(); }
  setMeasurementEnabled(enabled: boolean, passes = false): void {
    this.measurement?.dispose();
    this.measurement = enabled && this.renderer ? new RenderMeasurement(this.renderer.getContext() as WebGL2RenderingContext, passes) : null;
  }
  readMeasurement(): ReturnType<RenderMeasurement['read']> | null { return this.measurement?.read() ?? null; }
  measurementStatus() { return this.measurement?.gpu.stats ?? { status: 'disabled', queries: 0, rejected: 0 }; }
  requestDrawInventory(): void { this.inventory = null; this.inventoryRequested = true; }
  readDrawInventory() { return this.inventory; }
  measurementResources() {
    // Snapshot-only estimates of scene-owned storage, not a measurement of driver VRAM.
    const buffers = new Set<BufferAttribute | import('three').InterleavedBuffer>();
    const textures = new Set<Texture>();
    let instanceCount = 0, instanceBytes = 0;
    const add = (attribute: BufferAttribute | InterleavedBufferAttribute) => {
      buffers.add('isInterleavedBufferAttribute' in attribute ? attribute.data : attribute);
    };
    this.scene?.traverse(node => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      for (const attribute of Object.values(mesh.geometry.attributes)) add(attribute);
      if (mesh.geometry.index) add(mesh.geometry.index);
      for (const attributes of Object.values(mesh.geometry.morphAttributes)) for (const attribute of attributes ?? []) add(attribute);
      const instances = node as InstancedMesh;
      if (instances.isInstancedMesh) { instanceCount += instances.count; instanceBytes += instances.instanceMatrix.array.byteLength + (instances.instanceColor?.array.byteLength ?? 0); }
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(material)) if (value && typeof value === 'object' && 'isTexture' in value) textures.add(value as Texture);
      }
      const skin = node as SkinnedMesh;
      if (skin.isSkinnedMesh && skin.skeleton.boneTexture) textures.add(skin.skeleton.boneTexture);
    });
    let textureBaseBytes = 0;
    for (const texture of textures) {
      const image = texture.image as { width?: number; height?: number } | undefined;
      textureBaseBytes += (image?.width ?? 0) * (image?.height ?? 0) * 4;
    }
    const shadow = this.sun?.shadow.map;
    const shadowCamera = this.sun?.shadow.camera;
    return { geometryAttributeBytes: [...buffers].reduce((bytes, attribute) => bytes + attribute.array.byteLength, 0),
      instanceCount, instanceBytes, textureRgbaBaseLevelEstimateBytes: textureBaseBytes,
      shadowTargets: Number(!!shadow), shadowTargetRgbaDepthEstimateBytes: shadow ? shadow.width * shadow.height * 8 : 0,
      extraTargets: 0, programs: this.renderer?.info.programs?.length ?? 0, queries: this.measurement?.gpu.stats.queries ?? 0, pelletMarks: this.shotgun?.markCount ?? 0,
      shadow: this.sun && shadowCamera ? { enabled: this.sun.castShadow && !!this.renderer?.shadowMap.enabled, mapSize: this.sun.shadow.mapSize.toArray(), filter: this.renderer?.shadowMap.type,
        extent: [shadowCamera.left, shadowCamera.right, shadowCamera.bottom, shadowCamera.top, shadowCamera.near, shadowCamera.far],
        bias: this.sun.shadow.bias, normalBias: this.sun.shadow.normalBias, autoUpdate: this.sun.shadow.autoUpdate,
        position: this.sun.position.toArray(), target: this.sun.target.position.toArray(), textureFormat: shadow?.texture.format ?? null, textureType: shadow?.texture.type ?? null,
        depthTextureType: shadow?.depthTexture?.type ?? null, depthTextureFormat: shadow?.depthTexture?.format ?? null, depthCompare: shadow?.depthTexture?.compareFunction ?? null, depthBuffer: shadow?.depthBuffer ?? false } : null,
      note: 'Scene geometry/instance arrays and RGBA base levels; excludes driver overhead, mipmaps, default framebuffer/MSAA. Shadow estimate includes RGBA + depth32. Not measured VRAM or WorldBudget reserve.' };
  }
  getDiagnostics(): RenderDiagnostics {
    const stats = this.library?.stats;
    return { chunks: this.chunks?.ids ?? [], entities: [...this.visuals?.ids ?? [], ...this.life?.ids ?? []], models: stats?.resources ?? 0, instances: stats?.instances ?? 0, queued: stats?.queued ?? 0,
      appearing: this.chunks?.appearing ?? 0, pending: (stats?.loading ?? 0) + (stats?.queued ?? 0), errors: [...this.errors.values()], geometries: this.renderer?.info.memory.geometries ?? 0, textures: this.renderer?.info.memory.textures ?? 0, drawCalls: this.renderer?.info.render.calls ?? 0 };
  }

  resize(width: number, height: number, pixelRatio: number): void {
    if (!this.renderer || !this.camera) return;
    this.camera.aspect = width / height;
    this.camera.fov = width < height ? 62 : 48;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(pixelRatio, GRAPHICS_PROFILES[this.quality].pixelRatio));
    this.renderer.setSize(width, height, false);
  }

  render(elapsedSeconds: number, alpha: number): boolean {
    if (!this.renderer || !this.scene || !this.camera || !this.visuals) return false;
    const measurement = this.measurement;
    measurement?.begin();
    // Loads must progress even under GPU backpressure. Presentation can wait.
    this.library?.flush();
    measurement?.phase('cloneQueue');
    if (!this.frameFence?.canSubmit()) {
      measurement?.phase('fence'); measurement?.finish(false);
      if (this.frameFence?.failed) this.errors.set('gpu', 'Не удалось синхронизировать графический процессор.');
      return false;
    }
    measurement?.phase('fence');
    const delta = Math.max(0, elapsedSeconds - this.lastElapsed);
    this.lastElapsed = elapsedSeconds;
    this.visuals.animate(alpha, elapsedSeconds, delta);
    measurement?.phase('entities');
    this.life?.animate(elapsedSeconds,delta,this.chunks?.readyIds ?? []);
    measurement?.phase('worldLife');
    this.chunks?.animate(delta,this.life?.sceneTime(elapsedSeconds) ?? elapsedSeconds*1000,this.sceneState?.definition.wind, this.visuals.position(this.playerId) ?? undefined);
    measurement?.phase('chunks');
    const position = this.visuals.position(this.playerId);
    if (position) this.target.copy(position);
    else this.target.set(0, 0, 0);
    if (this.sun) { this.sun.position.set(this.target.x + 18, 12, this.target.z - 12); this.sun.target.position.set(this.target.x, 0, this.target.z); }
    this.focusHeight = damp(this.focusHeight, this.view.focusHeight ?? .8, 5, Math.min(delta, .1));
    const firstPerson=this.view.firstPerson===true;
    this.visuals.setVisible(this.playerId,!firstPerson);
    this.target.y += firstPerson ? 1.45 : this.focusHeight;
    const fov = firstPerson ? 76 : this.view.fieldOfView ?? (this.camera.aspect < 1 ? 62 : 48);
    if (Math.abs(this.camera.fov - fov) > .01) { this.camera.fov = damp(this.camera.fov, fov, 5, Math.min(delta, .1)); this.camera.updateProjectionMatrix(); }
    const { yaw, pitch, distance } = this.view;
    this.camera.position.set(
      this.target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      this.target.y + Math.sin(pitch) * distance,
      this.target.z + Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    this.shotgun?.animate(Math.min(delta,.1),firstPerson);
    // Update before camera probes; suppress only the renderer's duplicate scene traversal.
    this.scene.updateMatrixWorld();
    measurement?.phase('matricesAndSetup');
    if(firstPerson) {
      this.camera.position.copy(this.target);this.camera.rotation.set(-pitch,yaw,0,'YXZ');
    } else {
    this.cameraDirection.copy(this.camera.position).sub(this.target).normalize();
    const halfHeight = Math.tan(this.camera.fov*Math.PI/360)*this.camera.near+.08;
    const allowed = this.obstruction.resolve(this.target,this.cameraDirection,distance,
      halfHeight*this.camera.aspect,halfHeight,this.scene.children.filter(child=>child.name.startsWith('chunk:')),delta);
    this.camera.position.copy(this.target).addScaledVector(this.cameraDirection,allowed);
    this.camera.lookAt(this.target);
    }
    this.camera.updateMatrixWorld();
    measurement?.phase('camera');
    this.shotgun?.flushShots();
    measurement?.phase('shots');
    this.scene.matrixWorldAutoUpdate = false;
    this.renderer.info.reset();
    const inventory = this.inventoryRequested ? new DrawInventory(this.scene) : null;
    const renderer = this.renderer;
    const shadowRender = renderer.shadowMap.render;
    if (measurement?.passes) renderer.shadowMap.render = (...args) => {
      const calls = renderer.info.render.calls, triangles = renderer.info.render.triangles;
      measurement.beginShadow(renderer.shadowMap.enabled && !!this.sun?.castShadow);
      const started = performance.now();
      try { return shadowRender.apply(renderer.shadowMap, args); }
      finally { measurement.endShadow(performance.now() - started, renderer.info.render.calls - calls, renderer.info.render.triangles - triangles); }
    };
    measurement?.startGpu();
    let submitted = false;
    try { this.renderer.render(this.scene, this.camera); submitted = true; }
    finally {
      this.scene.matrixWorldAutoUpdate = true;
      if (measurement?.passes) renderer.shadowMap.render = shadowRender;
      measurement?.phase('submit');
      measurement?.finish(submitted, this.renderer.info.render.calls, this.renderer.info.render.triangles);
      if (inventory) { this.inventory = inventory.finish(); this.inventoryRequested = false; }
    }
    this.frameFence.submitted();
    if (this.frameFence.failed) this.errors.set('gpu', 'Не удалось синхронизировать графический процессор.');
    return true;
  }

  dispose(): void {
    this.measurement?.dispose(); this.measurement = null;
    this.inventory = null; this.inventoryRequested = false;
    this.shotgun?.dispose();this.shotgun=null;
    this.life?.dispose(); this.life = null; this.sceneState = null;
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
    this.obstruction = new CameraObstruction(this.raycast); this.lastElapsed = 0;
  }
}
