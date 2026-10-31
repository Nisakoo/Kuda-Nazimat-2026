import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseChunk, parseManifest, selfBootstrap } from '../../../shared/map/manifest.ts';
import { parseWorldDescriptor } from '../../../shared/protocol/validate.ts';
import { GameMap } from './GameMap.ts';
import type { FileUse, WorldFile } from './access.ts';
import { parseNpcContent } from './npcContent.ts';
import type { NpcDefinition } from './npcContent.ts';

export interface LoadedWorld {
  readonly maps: ReadonlyMap<string, GameMap>;
  readonly files: ReadonlyMap<string, WorldFile>;
  readonly npcs: readonly NpcDefinition[];
}
export interface WorldSource { readonly worldDir: string; readonly maps: Readonly<Record<string, string>>; readonly contentDir: string }

const SAFE_PATH = /^[A-Za-z0-9_./-]+$/;
const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2',
};

class WorldError extends Error {
  constructor(mapId: string, file: string, reason: string) { super(`Мир «${mapId}», файл ${file}: ${reason}`); }
}

/** Reads one world-relative file, refusing anything that resolves outside worldDir. */
async function readWorldFile(root: string, relative: string, mapId: string): Promise<{ absolute: string; bytes: Buffer }> {
  if (!SAFE_PATH.test(relative) || relative.startsWith('/') || relative.split('/').includes('..')) throw new WorldError(mapId, relative, 'недопустимый путь');
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(root + path.sep)) throw new WorldError(mapId, relative, 'путь вне worldDir');
  try { return { absolute, bytes: await readFile(absolute) }; }
  catch { throw new WorldError(mapId, relative, 'файл не найден или недоступен'); }
}

/** SERVER-WORLD-001–002, 007–008: validate the prepared world once at startup and index every servable file. */
export async function loadWorld(source: WorldSource): Promise<LoadedWorld> {
  const root = path.resolve(source.worldDir);
  if (!(await stat(root).catch(() => null))?.isDirectory()) throw new Error(`worldDir не найден: ${root}. Соберите клиент (npm --prefix client run build) или укажите worldDir.`);
  const maps = new Map<string, GameMap>();
  const files = new Map<string, { absolute: string; bytes: number; uses: FileUse[] }>();
  const addUse = (relative: string, absolute: string, bytes: number, use: FileUse): void => {
    const existing = files.get(relative);
    if (existing) existing.uses.push(use); else files.set(relative, { absolute, bytes, uses: [use] });
  };

  for (const [mapId, manifestPath] of Object.entries(source.maps)) {
    const manifestFile = await readWorldFile(root, manifestPath, mapId);
    let raw: unknown;
    try { raw = JSON.parse(manifestFile.bytes.toString('utf8')); } catch { throw new WorldError(mapId, manifestPath, 'некорректный JSON'); }
    const bootstrap = parseWorldDescriptor(selfBootstrap(raw, manifestPath, manifestFile.bytes.length));
    const manifest = parseManifest(raw, bootstrap);
    if (manifest.mapId !== mapId) throw new WorldError(mapId, manifestPath, `mapId в manifest — «${manifest.mapId}»`);
    addUse(manifestPath, manifestFile.absolute, manifestFile.bytes.length, { mapId, kind: 'manifest' });

    let total = manifestFile.bytes.length;
    for (const [assetPath, size] of Object.entries(manifest.assets)) {
      const file = await readWorldFile(root, assetPath, mapId);
      if (file.bytes.length !== size.bytes) throw new WorldError(mapId, assetPath, `размер ${file.bytes.length} ≠ ${size.bytes}`);
      addUse(assetPath, file.absolute, size.bytes, { mapId, kind: 'model' });
      total += size.bytes;
    }
    const collisionByChunk = new Map<string, Uint8Array>();
    const collisionCache = new Map<string, Uint8Array>();
    const collisionCells = new Map<string, { x: number; z: number }[]>();
    const resolution = manifest.collisionResolution;
    for (const entry of manifest.chunks) {
      const chunk = await readWorldFile(root, entry.url, mapId);
      if (chunk.bytes.length !== entry.bytes) throw new WorldError(mapId, entry.url, `размер ${chunk.bytes.length} ≠ ${entry.bytes}`);
      try { parseChunk(JSON.parse(chunk.bytes.toString('utf8')), entry); } catch (error) { throw new WorldError(mapId, entry.url, error instanceof Error ? error.message : 'некорректный чанк'); }
      addUse(entry.url, chunk.absolute, entry.bytes, { mapId, kind: 'chunk', cell: { x: entry.x, z: entry.z } });
      total += entry.bytes;

      let collision = collisionCache.get(entry.collisionUrl);
      if (!collision) {
        const file = await readWorldFile(root, entry.collisionUrl, mapId);
        if (file.bytes.length !== resolution * resolution || file.bytes.length !== entry.collisionBytes) throw new WorldError(mapId, entry.collisionUrl, `ожидалось ${resolution * resolution} байт`);
        collision = new Uint8Array(file.bytes);
        collisionCache.set(entry.collisionUrl, collision);
        collisionCells.set(entry.collisionUrl, []);
        files.set(entry.collisionUrl, files.get(entry.collisionUrl) ?? { absolute: file.absolute, bytes: file.bytes.length, uses: [] });
        total += file.bytes.length;
      }
      collisionCells.get(entry.collisionUrl)!.push({ x: entry.x, z: entry.z });
      collisionByChunk.set(entry.id, collision);
    }
    for (const [url, cells] of collisionCells) files.get(url)!.uses.push({ mapId, kind: 'collision', cells });

    if (total !== manifest.worldBytes) throw new WorldError(mapId, manifestPath, `worldBytes ${manifest.worldBytes} ≠ сумме уникальных ресурсов ${total}`);
    const map = new GameMap(manifest, bootstrap, collisionByChunk);
    if (!map.isWalkable(manifest.spawn.x, manifest.spawn.z)) throw new WorldError(mapId, manifestPath, 'spawn непроходим');
    maps.set(mapId, map);
  }

  const npcFile = path.resolve(source.contentDir, 'npcs.json');
  let npcRaw: unknown;
  try { npcRaw = JSON.parse(await readFile(npcFile, 'utf8')); } catch { throw new Error(`Не удалось прочитать NPC-контент ${npcFile}`); }
  const npcs = parseNpcContent(npcRaw);
  for (const npc of npcs) {
    const map = maps.get(npc.mapId);
    if (!map) throw new Error(`NPC ${npc.id}: неизвестная карта ${npc.mapId}`);
    if (!map.footprintChunkIds(npc.position.x, npc.position.z)) throw new Error(`NPC ${npc.id}: позиция вне чанков карты`);
  }

  const index = new Map<string, WorldFile>();
  for (const [relative, file] of files) {
    index.set(relative, { path: relative, absolutePath: file.absolute, bytes: file.bytes, contentType: CONTENT_TYPES[path.extname(relative).toLowerCase()] ?? 'application/octet-stream', uses: file.uses });
  }
  return { maps, files: index, npcs };
}
