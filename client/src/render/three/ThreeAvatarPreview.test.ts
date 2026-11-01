// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { BoxGeometry, DirectionalLight, Group, Mesh, MeshBasicMaterial, type Scene } from 'three';
import type { AssetManager } from '../../map/AssetManager';
import { ThreeAvatarPreview } from './ThreeAvatarPreview';

const mocked = vi.hoisted(() => ({
  renderers: [] as Array<{ domElement: HTMLCanvasElement; render: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; forceContextLoss: ReturnType<typeof vi.fn> }>,
  libraries: [] as Array<{ instantiate: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>,
  models: [] as Array<{ root: Group; animate: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>,
  releases: [] as Array<() => void>, rejects: [] as Array<() => void>, ids: [] as string[], live: 0, peak: 0,
}));
vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    domElement = document.createElement('canvas'); shadowMap = { enabled: false, type: 0 }; outputColorSpace = '';
    setPixelRatio = vi.fn(); setSize = vi.fn(); setClearColor = vi.fn(); render = vi.fn(); dispose = vi.fn(); forceContextLoss = vi.fn();
    constructor() { this.domElement.toDataURL = vi.fn(() => 'data:image/png;base64,portrait'); mocked.renderers.push(this); }
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});
vi.mock('./GltfLibrary', () => ({
  GltfLibrary: class {
    register = vi.fn(); dispose = vi.fn(); flush = vi.fn();
    instantiate = vi.fn((id: string) => {
      mocked.ids.push(id); mocked.live++; mocked.peak = Math.max(mocked.peak, mocked.live);
      const root = new Group(); root.name = id; root.add(new Mesh(new BoxGeometry(1, 2, 1), new MeshBasicMaterial()));
      const model = { root, animate: vi.fn(), dispose: vi.fn(() => { mocked.live--; root.removeFromParent(); }) }; mocked.models.push(model);
      return new Promise((resolve, reject) => { mocked.releases.push(() => resolve(model)); mocked.rejects.push(() => { model.dispose(); reject(new Error('load failed')); }); });
    });
    constructor() { mocked.libraries.push(this); }
  },
}));

afterEach(() => {
  for (const model of mocked.models) { const mesh = model.root.children[0] as Mesh; mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose(); }
  mocked.renderers.length = 0; mocked.libraries.length = 0; mocked.models.length = 0; mocked.releases.length = 0; mocked.rejects.length = 0; mocked.ids.length = 0; mocked.live = 0; mocked.peak = 0;
  document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
function setup() {
  const cancel = vi.fn(), observe = vi.fn(), disconnect = vi.fn();
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 42)); vi.stubGlobal('cancelAnimationFrame', cancel);
  vi.stubGlobal('ResizeObserver', class { observe = observe; disconnect = disconnect; });
  const host = document.createElement('div'); document.body.append(host);
  const assets = { dispose: vi.fn() } as unknown as AssetManager;
  const events = { loaded: vi.fn(), portrait: vi.fn(), error: vi.fn() };
  const preview = new ThreeAvatarPreview(host, assets, events);
  return { host, assets, events, preview, cancel, observe, disconnect, renderer: mocked.renderers[0]!, library: mocked.libraries[0]! };
}
async function resolveModel(index: number) {
  await vi.waitFor(() => expect(mocked.releases[index]).toBeTypeOf('function'));
  mocked.releases[index]!();
}

it('serializes portraits and latest selection, keeps rotation, and releases resources once', async () => {
  const { host, assets, events, preview, cancel, observe, disconnect, renderer, library } = setup();
  expect(host.contains(renderer.domElement)).toBe(true); expect(observe).toHaveBeenCalledWith(host);
  preview.rotate(.73); preview.select('nic'); preview.select('dan');
  for (let i = 0; i < 4; i++) await resolveModel(i);
  await vi.waitFor(() => expect(mocked.ids).toHaveLength(5));
  expect(mocked.ids).toEqual(['lukas', 'nic', 'dan', 'ksu', 'dan']);
  expect(events.portrait.mock.calls.map(call => call[0])).toEqual(['lukas', 'nic', 'dan', 'ksu']);
  for (const model of mocked.models.slice(0, 4)) expect(model.dispose).toHaveBeenCalledOnce();
  await resolveModel(4); await vi.waitFor(() => expect(events.loaded).toHaveBeenCalledTimes(1));
  const group = mocked.models[4]!.root.parent!; expect(group.rotation.y).toBeCloseTo(.73);
  const scene = renderer.render.mock.calls[0]![0] as Scene;
  const sun = scene.children.find(object => object instanceof DirectionalLight && object.castShadow) as DirectionalLight;
  const releaseShadow = vi.spyOn(sun.shadow, 'dispose'), cleanupScene = vi.spyOn(scene, 'clear');
  preview.select('ksu'); expect(mocked.models[4]!.dispose).toHaveBeenCalledOnce();
  preview.select('nic'); preview.select('dan'); preview.select('nic');
  await resolveModel(5); await vi.waitFor(() => expect(mocked.ids).toHaveLength(7));
  expect(mocked.ids.slice(5)).toEqual(['ksu', 'nic']); expect(mocked.models[5]!.dispose).toHaveBeenCalledOnce();
  expect(events.loaded).toHaveBeenCalledTimes(1); expect(group.children).toHaveLength(0);
  await resolveModel(6); await vi.waitFor(() => expect(events.loaded).toHaveBeenCalledTimes(2));
  expect(group.children).toEqual([mocked.models[6]!.root]); expect(group.rotation.y).toBeCloseTo(.73);
  preview.select('nic'); await vi.waitFor(() => expect(events.loaded).toHaveBeenCalledTimes(3));
  expect(mocked.ids).toHaveLength(7); expect(mocked.peak).toBe(1); expect(mocked.live).toBe(1); expect(events.error).not.toHaveBeenCalled();
  expect(renderer.domElement.toDataURL).toHaveBeenCalledTimes(4);
  preview.dispose(); preview.dispose();
  for (const model of mocked.models) expect(model.dispose).toHaveBeenCalledOnce();
  expect(mocked.live).toBe(0); expect(library.dispose).toHaveBeenCalledOnce(); expect(assets.dispose).toHaveBeenCalledOnce();
  expect(releaseShadow).toHaveBeenCalledOnce(); expect(cleanupScene).toHaveBeenCalledOnce();
  expect(renderer.dispose).toHaveBeenCalledOnce(); expect(renderer.forceContextLoss).toHaveBeenCalledOnce();
  expect(host.contains(renderer.domElement)).toBe(false); expect(disconnect).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledExactlyOnceWith(42);
});

it('reports a failed selected load and permits retry without another live model', async () => {
  const { preview, events } = setup();
  for (let i = 0; i < 5; i++) await resolveModel(i);
  await vi.waitFor(() => expect(events.loaded).toHaveBeenCalledOnce());
  preview.select('ksu'); await vi.waitFor(() => expect(mocked.rejects[5]).toBeTypeOf('function')); mocked.rejects[5]!();
  await vi.waitFor(() => expect(events.error).toHaveBeenCalledOnce());
  expect(mocked.live).toBe(0); preview.select('ksu'); await resolveModel(6);
  await vi.waitFor(() => expect(events.loaded).toHaveBeenCalledTimes(2));
  expect(mocked.peak).toBe(1); preview.dispose(); expect(mocked.live).toBe(0);
});

it('disposes a model that resolves after disposal and emits no callbacks', async () => {
  const { preview, events, assets, library } = setup();
  preview.dispose(); preview.dispose(); await resolveModel(0);
  await vi.waitFor(() => expect(mocked.models[0]!.dispose).toHaveBeenCalledOnce());
  expect(mocked.live).toBe(0); expect(mocked.peak).toBe(1); expect(library.dispose).toHaveBeenCalledOnce(); expect(assets.dispose).toHaveBeenCalledOnce();
  expect(events.loaded).not.toHaveBeenCalled(); expect(events.portrait).not.toHaveBeenCalled(); expect(events.error).not.toHaveBeenCalled();
  preview.select('nic'); expect(mocked.ids).toHaveLength(1);
});
