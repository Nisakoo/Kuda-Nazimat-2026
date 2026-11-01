import { AnimationMixer, LoadingManager, LoopRepeat } from 'three';
import type { AnimationAction, AnimationClip, BufferGeometry, Material, Object3D, SkinnedMesh, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { AssetManager } from '../../map/AssetManager';
import { abortError, AsyncLeaseCache } from '../../shared/AsyncLeaseCache';
import type { Lease } from '../../shared/AsyncLeaseCache';
import { AVATAR_WALK_MAX_PACE, avatarWalkPacing } from './AvatarWalkPace';

interface Template { readonly scene: Object3D; readonly animations: AnimationClip[]; readonly sources: readonly Lease<ArrayBuffer>[] }
export interface ModelInstance {
  readonly root: Object3D;
  /** Present only for validated avatar metadata; converts observed m/s to clip pace. */
  readonly walkPace?: (speed: number) => number;
  animate(name: string, delta: number, pace?: number): void;
  dispose(): void;
}
interface Job { run(): void; cancel(): void }

function disposeTemplate(template: Template): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  template.scene.traverse((object) => {
    const mesh = object as SkinnedMesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) {
      materials.add(material);
      for (const value of Object.values(material)) if (value && typeof value === 'object' && 'isTexture' in value) textures.add(value as Texture);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) { texture.dispose(); if (typeof ImageBitmap !== 'undefined' && texture.source.data instanceof ImageBitmap) texture.source.data.close(); }
  for (const source of template.sources) source.release();
}

function readJson(bytes: ArrayBuffer): Record<string, unknown> {
  const view = new DataView(bytes);
  let text: string;
  if (bytes.byteLength >= 20 && view.getUint32(0, true) === 0x46546c67) {
    if (view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength || view.getUint32(16, true) !== 0x4e4f534a) throw new Error('Invalid GLB container');
    text = new TextDecoder().decode(new Uint8Array(bytes, 20, view.getUint32(12, true)));
  } else text = new TextDecoder().decode(bytes);
  const json: unknown = JSON.parse(text);
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('Invalid glTF JSON');
  return json as Record<string, unknown>;
}

export class GltfLibrary {
  private readonly paths = new Map<string, string>();
  private readonly cache: AsyncLeaseCache<Template>;
  private readonly jobs = new Set<Job>();
  private readonly instances = new Set<ModelInstance>();
  private disposed = false;
  constructor(private readonly assets: AssetManager) { this.cache = new AsyncLeaseCache((id, signal) => this.load(id, signal), disposeTemplate); }
  register(models: Readonly<Record<string, string>>): void {
    for (const [id, path] of Object.entries(models)) {
      const resolved = this.assets.resolve(path);
      if (this.paths.has(id) && this.paths.get(id) !== resolved) throw new Error('Model ID already registered');
      this.paths.set(id, resolved);
    }
  }
  has(id: string): boolean { return this.paths.has(id); }
  get stats() { return { ...this.cache.stats, instances: this.instances.size, queued: this.jobs.size }; }

  async instantiate(id: string, signal: AbortSignal): Promise<ModelInstance> {
    const lease = await this.cache.acquire(id, signal);
    if (this.disposed || signal.aborted) { lease.release(); throw abortError(); }
    return new Promise((resolve, reject) => {
      const cleanup = () => { this.jobs.delete(job); signal.removeEventListener('abort', job.cancel); };
      const job: Job = {
        cancel: () => { cleanup(); lease.release(); reject(abortError()); },
        run: () => {
          cleanup();
          if (this.disposed || signal.aborted) { lease.release(); reject(abortError()); return; }
          try { resolve(this.makeInstance(lease)); } catch (error) { lease.release(); reject(error); }
        },
      };
      this.jobs.add(job);
      signal.addEventListener('abort', job.cancel, { once: true });
    });
  }

  flush(limit = 8): void { for (const job of [...this.jobs].slice(0, limit)) job.run(); }

  private makeInstance(lease: Lease<Template>): ModelInstance {
    const root = clone(lease.value.scene);
    root.traverse(object => { if ('isMesh' in object) { object.castShadow = true; object.receiveShadow = true; } });
    const mixer = new AnimationMixer(root);
    const avatarWalk = avatarWalkPacing(root, lease.value.animations.find(clip => clip.name === 'walk')?.duration);
    let animation = '';
    const actions = new Map<string, { action: AnimationAction; weight: number; from: number }>();
    let transition = 0;
    let disposed = false;
    const instance: ModelInstance = {
      root,
      ...(avatarWalk ? { walkPace: (speed: number) => avatarWalk.pace(speed) } : {}),
      animate: (name, delta, pace = 1) => {
        if (disposed) return;
        const dt = Math.min(Math.max(delta, 0), 0.1);
        const clip = lease.value.animations.find(item => item.name === name)
          ?? lease.value.animations.find(item => item.name === 'idle');
        if (clip && clip.name !== animation) {
          const first = animation === '';
          animation = clip.name;
          transition = 0;
          if (!actions.has(animation)) actions.set(animation, { action: mixer.clipAction(clip).setLoop(LoopRepeat, Infinity), weight: 0, from: 0 });
          for (const [key, state] of actions) {
            state.from = state.weight;
            if (key === animation) {
              if (state.weight === 0) state.action.reset();
              state.action.play();
              if (first) state.weight = state.from = 1;
            }
          }
        }
        transition = Math.min(.14, transition + dt);
        for (const [key, state] of actions) {
          const target = key === animation ? 1 : 0;
          state.weight = state.from + (target - state.from) * (transition / .14);
          state.action.setEffectiveWeight(state.weight);
          const walkPace = avatarWalk
            ? Number.isFinite(pace) ? Math.max(0, Math.min(AVATAR_WALK_MAX_PACE, pace)) : 0
            : Math.max(.2, Math.min(2, pace));
          state.action.setEffectiveTimeScale(key === 'walk' ? walkPace : 1);
          if (state.weight === 0 && target === 0) state.action.stop();
        }
        mixer.update(dt);
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        mixer.stopAllAction();
        mixer.uncacheRoot(root);
        const skeletons = new Set<SkinnedMesh['skeleton']>();
        root.traverse((object) => { const mesh = object as SkinnedMesh; if (mesh.isSkinnedMesh) skeletons.add(mesh.skeleton); });
        for (const skeleton of skeletons) skeleton.dispose();
        root.removeFromParent();
        this.instances.delete(instance);
        lease.release();
      },
    };
    this.instances.add(instance);
    return instance;
  }

  private async load(id: string, signal: AbortSignal): Promise<Template> {
    const path = this.paths.get(id);
    if (!path) throw new Error(`Unknown model: ${id}`);
    const leases: Lease<ArrayBuffer>[] = [];
    const urls: string[] = [];
    let succeeded = false;
    try {
      const main = await this.assets.acquire(path, signal);
      leases.push(main);
      const json = readJson(main.value);
      const resources = new Map<string, string>();
      for (const field of ['buffers', 'images']) {
        const items = json[field];
        if (items === undefined) continue;
        if (!Array.isArray(items)) throw new Error('Invalid glTF resource list');
        for (const item of items as { uri?: unknown }[]) {
          if (typeof item.uri !== 'string') continue;
          const uri = item.uri;
          if (uri.startsWith('data:')) {
            if (!/^data:(application\/(octet-stream|gltf-buffer)|image\/(png|jpeg|webp));base64,/.test(uri)) throw new Error('Unsupported embedded resource');
            continue;
          }
          const resolved = this.assets.resolve(uri, path);
          if (resources.has(uri)) continue;
          const resource = await this.assets.acquire(resolved, signal);
          leases.push(resource);
          const mime = field === 'images' ? /\.png(?:\?|$)/i.test(uri) ? 'image/png' : /\.webp(?:\?|$)/i.test(uri) ? 'image/webp' : 'image/jpeg' : 'application/octet-stream';
          const url = URL.createObjectURL(new Blob([resource.value], { type: mime }));
          resources.set(uri, url);
          urls.push(url);
        }
      }
      if (signal.aborted) throw abortError();
      const manager = new LoadingManager();
      manager.setURLModifier((url) => {
        if (resources.has(url)) return resources.get(url)!;
        if (url.startsWith('blob:') || url.startsWith('data:')) return url;
        throw new Error('Unprepared glTF URL');
      });
      const gltf = await new GLTFLoader(manager).parseAsync(main.value, '');
      succeeded = true;
      return { scene: gltf.scene, animations: gltf.animations, sources: leases };
    } finally {
      if (!succeeded) for (const lease of leases) lease.release();
      for (const url of urls) URL.revokeObjectURL(url);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const job of [...this.jobs]) job.cancel();
    for (const instance of [...this.instances]) instance.dispose();
    this.cache.dispose();
    this.paths.clear();
  }
}
