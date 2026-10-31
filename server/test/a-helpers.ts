import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const RES = 128;
export const SPAWN = { x: 0, y: 0, z: 6 };
/** Wall inside chunk 0_0 at world x ∈ [8, 12). */
export const WALL_MIN_X = 8;

/**
 * Small valid world in MAP format: chunks -2..2 × -2..2 of 32 m, a wall in 0_0,
 * one shared model and unique collision files (so the 10% bootstrap limits hold).
 */
export async function makeWorld(npcs: unknown[], mapId = 'test'): Promise<{ worldDir: string; contentDir: string; maps: Record<string, string> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'kn-world-'));
  const worldDir = path.join(root, 'world');
  const contentDir = path.join(root, 'content');
  await mkdir(path.join(worldDir, `maps/${mapId}/chunks`), { recursive: true });
  await mkdir(path.join(worldDir, 'assets/models'), { recursive: true });
  await mkdir(contentDir, { recursive: true });

  const model = Buffer.alloc(100, 7);
  await writeFile(path.join(worldDir, 'assets/models/t.glb'), model);
  let resources = model.length;
  const chunks = [];
  let index = 0;
  for (let z = -2; z <= 2; z++) for (let x = -2; x <= 2; x++) {
    const id = `${x}_${z}`;
    const collision = Buffer.alloc(RES * RES);
    collision[(RES - 1) * RES + index++] = 1; // unique file per chunk, far corner only
    if (x === 0 && z === 0) for (let row = 0; row < RES; row++) collision.fill(1, row * RES + 96, row * RES + 112);
    const collisionUrl = `maps/${mapId}/chunks/collision-${id}.bin`;
    await writeFile(path.join(worldDir, collisionUrl), collision);
    const json = JSON.stringify({ id, objects: [{ id: `${id}-o`, assetId: 't', transform: { position: { x: x * 32, y: 0, z: z * 32 }, rotationY: 0 } }] });
    const url = `maps/${mapId}/chunks/${id}.json`;
    await writeFile(path.join(worldDir, url), json);
    resources += collision.length + Buffer.byteLength(json);
    chunks.push({ id, x, z, region: 'Тест', url, bytes: Buffer.byteLength(json), collisionUrl, collisionBytes: collision.length, assets: ['t'] });
  }
  const manifest = { mapId, version: 1, worldBytes: resources, chunkSize: 32, collisionResolution: RES, spawn: SPAWN, origin: { x: -16, z: -16 }, chunks, models: { t: 't.glb' }, assets: { 'assets/models/t.glb': { bytes: model.length, memory: 4096 } } };
  let text = '';
  for (let pass = 0; pass < 10; pass++) { text = JSON.stringify(manifest); const total = resources + Buffer.byteLength(text); if (total === manifest.worldBytes) break; manifest.worldBytes = total; }
  await writeFile(path.join(worldDir, `maps/${mapId}/manifest.json`), JSON.stringify(manifest));
  await writeFile(path.join(contentDir, 'npcs.json'), JSON.stringify(npcs));
  return { worldDir, contentDir, maps: { [mapId]: `maps/${mapId}/manifest.json` } };
}

export const npc = (id: string, x: number, z: number, extra: Record<string, unknown> = {}) => ({
  id, mapId: 'test', name: `NPC ${id}`, topic: 'Тема', persona: 'Персона', greeting: 'Привет',
  position: { x, y: 0, z }, rotationY: 0, interactionRadius: 2.2, ...extra,
});
