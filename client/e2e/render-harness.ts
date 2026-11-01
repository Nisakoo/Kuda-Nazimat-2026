import { AssetManager, HttpAssetSource } from '../src/map/AssetManager';
import { ThreeRenderer } from '../src/render/three/ThreeRenderer';
import type { WorldSnapshot } from '../src/core/types';
import type { RenderDiagnostics } from '../src/render/RenderAdapter';
import { GameWorld } from '../src/core/GameWorld';
import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import lifeFixtures from '../../shared/world-life/fixtures.json';
import cataloguePlacement from './catalogue-placement.json';
import type { SceneStateMessage } from '../../shared/world-life/types.ts';

interface Harness {
  load(id: string, asset?: string, count?: number): Promise<string>;
  unload(id: string): void;
  entity(enabled: boolean): void;
  stats(): RenderDiagnostics & { frames: number };
  lifeFrame(view: 'cats' | 'flock'): Promise<void>;
  catalogueFrame(): Promise<void>;
  dispose(): void;
  movement(fps: number, yaw: number, carrying?: boolean): Promise<{ requestedFps: number; simulatedFrames: number; seconds: number; actualFps: number; completed: boolean; video: string }>;
}
declare global { interface Window { renderHarness: Harness } }

const http = new HttpAssetSource(new URL('/assets/models/', location.href).href);
let floorData: Promise<ArrayBuffer> | undefined;
const assets = new AssetManager({ resolve: (path, relativeTo) => http.resolve(path, relativeTo), load: (url, signal, maxBytes) => {
  if (!url.endsWith('/pose-floor.glb')) return http.load(url, signal, maxBytes);
  floorData ??= (async () => {
    const floor = new Mesh(new BoxGeometry(80, .1, 80), new MeshStandardMaterial({ color: '#cfb994', roughness: 1 })); floor.position.y = -.05;
    try { return await new GLTFExporter().parseAsync(floor, { binary: true }) as ArrayBuffer; }
    finally { floor.geometry.dispose(); floor.material.dispose(); }
  })();
  return floorData;
} });
const renderer = new ThreeRenderer(assets, false);
renderer.mount(document.getElementById('scene')!);
renderer.resize(800, 600, 1);
renderer.registerModels({ tablet: 'demo/tablet.glb', 'tablet-json': 'demo/tablet.gltf', floor: 'pose-floor.glb' });
let snapshot: WorldSnapshot = { tick: 0, entities: [{ id: 'player', transform: { position: { x: 0, y: 0, z: 4 }, rotationY: 0 }, renderable: { assetId: 'demo-player' } }] };
renderer.syncWorld(snapshot, snapshot, 'player');
let frames = 0;
let frame = 0;
let recording = false;
const first = performance.now();
const draw = (time: number) => { if (!recording) { frames++; renderer.render((time - first) / 1000, 1); } frame = requestAnimationFrame(draw); };
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
  catalogueFrame: async () => {
    renderer.registerModels({ bench: 'market/bench.glb', cart: 'market/cart.glb', 'scroll-table': 'market/scroll-table.glb', palm: 'market/palm.glb' });
    await renderer.loadChunk(cataloguePlacement);
    // The stand has no player. Remove the default resource-test avatar so it cannot
    // occlude the catalogue camera, and frame all data-only placements together.
    const next: WorldSnapshot = { tick: snapshot.tick + 1, entities: [] };
    renderer.syncWorld(snapshot, next, null); snapshot = next;
    renderer.setCamera({ yaw: 0, pitch: .5, distance: 22, focusHeight: 1 });
    renderer.render((performance.now() - first) / 1000, 1);
  },
  lifeFrame: async (view) => {
    renderer.registerModels({ 'next-apple': 'market/pickup-apple.glb', 'next-pot': 'market/pushable-pot.glb', 'next-cat': 'market/cat.glb', 'next-bird': 'market/bird.glb' });
    await renderer.loadChunk({ id: '0_0', objects: [{ id: 'floor', assetId: 'floor', transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0 } }] });
    const fixture = lifeFixtures.find(item => item.valid && item.packet.type === 'scene-state')!.packet as unknown as SceneStateMessage;
    renderer.setSceneState({ ...fixture, sceneId: 'render-life', serverTimeMs: 14000, epochMs: 0,
      definition: { ...fixture.definition, templates: fixture.definition.templates.map(template => ({ ...template, assetId: template.behavior === 'pickup' ? 'next-apple' : template.behavior === 'pushable' ? 'next-pot' : 'next-cat' })), flock: { ...fixture.definition.flock, assetId: 'next-bird' } } });
    const next: WorldSnapshot = { tick: snapshot.tick + 1, entities: [{ id: 'preview', transform: { position: { x: -10, y: 0, z: -1 }, rotationY: 0 }, renderable: { assetId: 'next-apple' } }] };
    renderer.syncWorld(snapshot, next, 'preview'); snapshot = next;
    renderer.setCamera({ yaw: 0, pitch: view === 'cats' ? .45 : .12, distance: view === 'cats' ? 10 : 24, focusHeight: view === 'cats' ? .4 : 7 });
  },
  movement: async (fps, yaw, carrying = false) => {
    renderer.setSceneState(null);
    renderer.registerModels({ 'next-apple': 'market/pickup-apple.glb', 'next-pot': 'market/pushable-pot.glb', 'next-cat': 'market/cat.glb', 'next-bird': 'market/bird.glb' });
    const fixture = lifeFixtures.find(item => item.valid && item.packet.type === 'scene-state')!.packet as unknown as SceneStateMessage;
    const life: SceneStateMessage = { ...fixture, sceneId: 'render-carry', revision: 0, serverTimeMs: 0, epochMs: 0,
      definition: { ...fixture.definition, templates: fixture.definition.templates.map(template => ({ ...template, assetId: template.behavior === 'pickup' ? 'next-apple' : template.behavior === 'pushable' ? 'next-pot' : 'next-cat' })), flock: { ...fixture.definition.flock, assetId: 'next-bird' } } };
    if (carrying) renderer.setSceneState(life);
    let handStage = 0;
    await renderer.loadChunk({ id: carrying ? '0_0' : 'pose-floor', objects: [{ id: 'floor', assetId: 'floor', transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0 }, animation: 'idle' }] });
    recording = true;
    const stream = document.querySelector('canvas')!.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: 3000000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const video = new Promise<string>(resolve => { recorder.onstop = () => {
      stream.getTracks().forEach(track => track.stop());
      const reader = new FileReader(); reader.onload = () => resolve((reader.result as string).split(',')[1]!); reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' }));
    }; });
    recorder.start();
    const world = new GameWorld('local', Array.from({ length: 4 }, (_, i) => ({ id: `move-${i}`, character: { kind: 'player' as const, name: `Игрок ${i + 1}` },
      transform: { position: { x: yaw === 0 ? [0, -3, 3, 6][i]! : 0, y: 0, z: yaw === 0 ? 0 : [0, -3, 3, 6][i]! }, rotationY: 0 }, movement: { direction: { x: 0, z: 0 }, speed: 3 }, renderable: { assetId: 'demo-player' }, animationState: { name: 'idle' } })));
    renderer.setCamera({ yaw, pitch: .4, distance: 13 });
    let previous = world.getSnapshot(); renderer.syncWorld(previous, previous, 'move-0');
    const began = performance.now(); let last = began; let elapsed = 0; let jumped = false; let count = 0;
    let movementFrame = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        const next = (now: number) => { try {
          if (now - last + .5 < 1000 / fps) { movementFrame = requestAnimationFrame(next); return; }
          last = now; elapsed += 1 / fps;
          count++;
          for (let i = 0; i < 4; i++) {
            const id = `move-${i}`;
            world.execute(id, { type: 'move', direction: elapsed > .7 && elapsed < 2.5 ? { x: 0, z: -1 } : { x: 0, z: 0 } });
            world.execute(id, { type: 'sprint', held: elapsed > 1.4 && elapsed < 2.5 });
            if (elapsed >= 2.2 && !jumped) world.execute(id, { type: 'jump' });
          }
          if (elapsed >= 2.2) jumped = true;
          world.step(1 / fps); const current = world.getSnapshot();
          renderer.syncWorld(previous, current, 'move-0');
          if (carrying && handStage === 0 && elapsed >= .25) {
            handStage = 1;
            renderer.setSceneState({ ...life, revision: 1, apples: life.apples.map((apple, i) => i < 4 ? { id: apple.id, mapId: apple.mapId, state: 'held' as const, holderId: `move-${i}` } : apple) });
          }
          if (carrying && handStage === 1 && elapsed >= 3.15) {
            handStage = 2;
            renderer.setSceneState({ ...life, revision: 2, apples: life.apples.map((apple, i) => {
              const player = current.entities.find(entity => entity.id === `move-${i}`)?.transform;
              return i < 4 && player ? { id: apple.id, mapId: apple.mapId, state: 'world' as const, position: { x: player.position.x, y: 0, z: player.position.z + .9 } } : apple;
            }) });
          }
          renderer.render((now - first) / 1000, 1); previous = current; frames++;
          // Keep slow software rendering diagnostic and bounded. This does not qualify cadence.
          if (elapsed >= 4 || now - began >= 15000) { snapshot = current; resolve(); } else movementFrame = requestAnimationFrame(next);
        } catch (error) { reject(error); } };
        movementFrame = requestAnimationFrame(next);
      });
    } finally { cancelAnimationFrame(movementFrame); recording = false; recorder.stop(); }
    const seconds = (performance.now() - began) / 1000;
    return { requestedFps: fps, simulatedFrames: count, seconds, actualFps: count / seconds, completed: elapsed >= 4, video: await video };
  },
  dispose: () => { cancelAnimationFrame(frame); renderer.dispose(); assets.dispose(); },
};
