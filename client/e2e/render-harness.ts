import { AssetManager, HttpAssetSource } from '../src/map/AssetManager';
import { ThreeRenderer } from '../src/render/three/ThreeRenderer';
import type { WorldSnapshot } from '../src/core/types';
import type { RenderDiagnostics } from '../src/render/RenderAdapter';

interface Harness {
  load(id: string, asset?: string, count?: number): Promise<string>;
  unload(id: string): void;
  entity(enabled: boolean): void;
  stats(): RenderDiagnostics & { frames: number };
  dispose(): void;
}
declare global { interface Window { renderHarness: Harness } }

const assets = new AssetManager(new HttpAssetSource(new URL('/assets/models/', location.href).href));
const renderer = new ThreeRenderer(assets);
renderer.mount(document.getElementById('scene')!);
renderer.resize(800, 600, 1);
renderer.registerModels({ tablet: 'demo/tablet.glb', 'tablet-json': 'demo/tablet.gltf' });
let snapshot: WorldSnapshot = { tick: 0, entities: [{ id: 'player', transform: { position: { x: 0, y: 0, z: 4 }, rotationY: 0 }, renderable: { assetId: 'demo-player' } }] };
renderer.syncWorld(snapshot, snapshot, 'player');
let frames = 0;
let frame = 0;
const first = performance.now();
const draw = (time: number) => { frames++; renderer.render((time - first) / 1000, 1); frame = requestAnimationFrame(draw); };
frame = requestAnimationFrame(draw);
window.renderHarness = {
  load: async (id, asset = 'tablet', count = 1) => {
    try {
      await renderer.loadChunk({ id, objects: Array.from({ length: count }, (_, index) => ({ id: `${id}-${index}`, assetId: asset, transform: { position: { x: id === 'west' ? -2 : 2, y: 0, z: index * 0.1 }, rotationY: 0 }, animation: index % 2 ? 'walk' : 'idle' })) });
      return 'ready';
    } catch (error) { return error instanceof Error ? error.name : 'error'; }
  },
  unload: (id) => renderer.unloadChunk(id),
  entity: (enabled) => {
    const next: WorldSnapshot = { tick: snapshot.tick + 1, entities: enabled ? [...snapshot.entities.filter((entity) => entity.id !== 'dynamic'), { id: 'dynamic', transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0 }, renderable: { assetId: 'tablet' }, animationState: { name: 'idle' } }] : snapshot.entities.filter((entity) => entity.id !== 'dynamic') };
    renderer.syncWorld(snapshot, next, 'player');
    snapshot = next;
  },
  stats: () => ({ ...renderer.getDiagnostics(), frames }),
  dispose: () => { cancelAnimationFrame(frame); renderer.dispose(); assets.dispose(); },
};
