import { afterEach, expect, it, vi } from 'vitest';
import { Group, Scene } from 'three';
import { VisualChunks } from './VisualChunks';
import type { GltfLibrary } from './GltfLibrary';
afterEach(() => vi.unstubAllGlobals());
const empty = { id: 'a', objects: [] };
it('holds chunks hidden until ready, lifts only the visual group and does not replay on later streaming', async () => {
  const scene = new Scene(); const chunks = new VisualChunks(scene, {} as GltfLibrary);
  await chunks.load(empty); const root = scene.children[0]!;
  chunks.animate(2); expect(root.visible).toBe(false); expect(root.position.y).toBe(-3);
  chunks.reveal(); chunks.animate(.3); expect(root.position.y).toBeCloseTo(-.375); expect(chunks.appearing).toBe(1);
  chunks.animate(.3); expect(root.position.y).toBe(0); expect(chunks.appearing).toBe(0);
  await chunks.load({ ...empty, id: 'b' }); chunks.animate(.1);
  expect(root.position.y).toBe(0); expect(scene.children[1]!.position.y).toBeLessThan(0);
  chunks.dispose(); expect(scene.children).toHaveLength(0); expect(chunks.appearing).toBe(0);
});
it('uses no vertical translation for reduced motion', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const scene = new Scene(); const chunks = new VisualChunks(scene, {} as GltfLibrary);
  await chunks.load(empty); expect(scene.children[0]!.position.y).toBe(0);
  chunks.reveal(); chunks.animate(.1); expect(chunks.appearing).toBe(0); expect(scene.children[0]!.visible).toBe(true);
});
it('disposes late models after cancellation without resurrecting a chunk', async () => {
  const dispose = vi.fn(); let finish!: (value: unknown) => void;
  const library = { instantiate: () => new Promise(resolve => { finish = resolve; }) } as unknown as GltfLibrary;
  const scene = new Scene(); const chunks = new VisualChunks(scene, library);
  const loading = chunks.load({ id: 'a', objects: [{ id: 'm', assetId: 'm', transform: { position: { x: 1, y: 2, z: 3 }, rotationY: 0 } }] });
  const rejected = expect(loading).rejects.toThrow(); chunks.dispose();
  finish({ root: new Group(), animate: vi.fn(), dispose }); await rejected;
  expect(dispose).toHaveBeenCalledOnce(); expect(scene.children).toHaveLength(0);
