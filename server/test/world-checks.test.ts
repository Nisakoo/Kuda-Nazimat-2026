import { expect, it } from 'vitest';
import { readFile, rm, stat, writeFile, appendFile } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorld } from '../src/world/loader.ts';
import { makeWorld, npc } from './a-helpers.ts';
import { setup } from './harness.ts';

interface Manifest { worldBytes: number; assets: Record<string, { bytes: number }>; chunks: { id: string; url: string; bytes: number; collisionUrl: string }[] }

/** SERVER-WORLD-004 recomputed independently from the files on disk: each unique file once. */
async function independentWorldBytes(worldDir: string, manifestPath: string): Promise<number> {
  const manifest = JSON.parse(await readFile(join(worldDir, manifestPath), 'utf8')) as Manifest;
  const unique = new Set([manifestPath, ...Object.keys(manifest.assets), ...manifest.chunks.flatMap((c) => [c.url, c.collisionUrl])]);
  let total = 0;
  for (const path of unique) total += (await stat(join(worldDir, path))).size;
  return total;
}

/** Rewrites a test manifest and recomputes its self-inclusive worldBytes, like the generator does. */
async function rewrite(worldDir: string, change: (manifest: Manifest) => void): Promise<void> {
  const file = join(worldDir, 'maps/test/manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf8')) as Manifest; change(manifest);
  for (let pass = 0; pass < 10; pass++) { await writeFile(file, JSON.stringify(manifest)); const total = await independentWorldBytes(worldDir, 'maps/test/manifest.json'); if (total === manifest.worldBytes) return; manifest.worldBytes = total; }
}

it('S1: a chunk changed by one byte stops the start and names the file', async () => {
  const world = await makeWorld([npc('guide', 0, 6)]);
  await appendFile(join(world.worldDir, 'maps/test/chunks/0_1.json'), ' ');
  await expect(loadWorld(world)).rejects.toThrow('maps/test/chunks/0_1.json');
});

it('S2: worldBytes equals an independent sum of unique files; a shared collision file counts once', async () => {
  const world = await makeWorld([npc('guide', 0, 6)]);
  const loaded = await loadWorld(world);
  expect(loaded.maps.get('test')!.manifest.worldBytes).toBe(await independentWorldBytes(world.worldDir, 'maps/test/manifest.json'));
  // Two chunks referencing one collision file: counted once on both sides.
  await rewrite(world.worldDir, (m) => { const [a, b] = [m.chunks.find((c) => c.id === '2_2')!, m.chunks.find((c) => c.id === '1_2')!]; rmSync(join(world.worldDir, b.collisionUrl)); b.collisionUrl = a.collisionUrl; });
  const shared = await loadWorld(world);
  expect(shared.maps.get('test')!.manifest.worldBytes).toBe(await independentWorldBytes(world.worldDir, 'maps/test/manifest.json'));
  expect(shared.files.get('maps/test/chunks/collision-2_2.bin')!.uses).toEqual([expect.objectContaining({ kind: 'collision', cells: expect.arrayContaining([{ x: 2, z: 2 }, { x: 1, z: 2 }]) })]);
  // A deliberately wrong total is rejected.
  const file = join(world.worldDir, 'maps/test/manifest.json'); const manifest = JSON.parse(await readFile(file, 'utf8')) as Manifest;
  manifest.worldBytes += 100; await writeFile(file, JSON.stringify(manifest));
  await expect(loadWorld(world)).rejects.toThrow('worldBytes');
});

const publicDir = fileURLToPath(new URL('../../client/public/', import.meta.url));
it.runIf(existsSync(join(publicDir, 'maps/market/manifest.json')))('S2: the generated client worlds pass the independent recount', async () => {
  for (const manifest of ['maps/market/manifest.json', 'maps/demo/manifest.json', 'maps/demo/science.json']) {
    const declared = (JSON.parse(await readFile(join(publicDir, manifest), 'utf8')) as Manifest).worldBytes;
    expect(declared, manifest).toBe(await independentWorldBytes(publicDir, manifest));
  }
});

it('S5: NPC content with a duplicate id, an unknown map or a position outside the chunks stops the start', async () => {
  for (const [npcs, message] of [
    [[npc('a', 0, 6), npc('a', 1, 6)], 'id'],
    [[npc('a', 0, 6, { mapId: 'nowhere' })], 'неизвестная карта'],
    [[npc('a', 500, 6)], 'вне чанков'],
    [[npc('a', 0, 6, { secret: true })], 'secret'],
  ] as const) await expect(loadWorld(await makeWorld([...npcs]))).rejects.toThrow(message);
});

function rawGet(port: number, path: string, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { Authorization: `Bearer ${token}` } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
    req.on('error', reject); req.end();
  });
}

it('S3: traversal, encoded separators, unknown files and trailing slashes are 404 with a valid token; a vanished file is 500', async () => {
  const { port, guest, connect, config } = await setup();
  const session = await guest('Аня'); const client = await connect(session.token);
  client.command('join', { mapId: 'test' }); await client.wait((p) => p.type === 'joined');
  for (const path of ['/world/../server/config.json', '/world/maps%2F..%2F..', '/world/maps/test/unknown.json', '/world/maps/test/manifest.json/', '/world/maps/test/%2e%2e/manifest.json', '/world/maps\\test\\manifest.json']) {
    expect(await rawGet(port, path, session.token), path).toBe(404);
  }
  expect(await rawGet(port, '/world/maps/test/manifest.json', session.token)).toBe(200);
  await rm(join(config.worldDir, 'maps/test/chunks/0_0.json'));
  const response = await fetch(`http://127.0.0.1:${port}/world/maps/test/chunks/0_0.json`, { headers: { Authorization: `Bearer ${session.token}` } });
  expect(response.status).toBe(500); expect(await response.text()).not.toContain(config.worldDir);
  expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
});
