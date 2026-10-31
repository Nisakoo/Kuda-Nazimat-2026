import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameConfig } from '../contracts.ts';

export interface Config extends GameConfig {
  host: string; port: number; clientDir: string; defaultMap: string; dbPath: string;
  sessionTtlMs: number; logWorldAccess: boolean;
  npc: { adapter: string; maxConcurrent: number; maxUnfinished: number; timeoutMs: number; options: Record<string, unknown> };
}
export const defaultConfigPath = fileURLToPath(new URL('../../config.json', import.meta.url));
const defaults: Config = {
  host: '0.0.0.0', port: 8080, clientDir: '../client/dist', worldDir: '../client/public',
  maps: { market: 'maps/market/manifest.json', demo: 'maps/demo/manifest.json', science: 'maps/demo/science.json' },
  defaultMap: 'market', contentDir: 'content', dbPath: 'data/game.sqlite', maxPlayers: 4,
  sessionTtlMs: 43200000, tickHz: 20, broadcastHz: 10, aoiRadius: 64, staticChunkRadius: 3,
  disconnectGraceMs: 10000, saveIntervalMs: 10000, corsOrigins: [], logWorldAccess: false,
  npc: { adapter: 'scripted', maxConcurrent: 1, maxUnfinished: 4, timeoutMs: 8000, options: {} },
};
export function record(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Неверный объект: ${key}`);
  return value as Record<string, unknown>;
}
export function parseConfig(raw: unknown, path: string): Config {
  const input = record(raw, 'config');
  for (const key of Object.keys(input)) if (!Object.hasOwn(defaults, key)) throw new Error(`Неизвестный ключ config.${key}`);
  const npc = { ...defaults.npc, ...record(input.npc ?? {}, 'npc') };
  for (const key of Object.keys(npc)) if (!Object.hasOwn(defaults.npc, key)) throw new Error(`Неизвестный ключ npc.${key}`);
  const config = { ...defaults, ...input, npc } as Config;
  for (const key of ['host', 'clientDir', 'worldDir', 'contentDir', 'dbPath', 'defaultMap'] as const) {
    if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error(`Неверный config.${key}`);
  }
  const ranges = { port: [1, 65535], maxPlayers: [1, 4], sessionTtlMs: [1, 2147483647], tickHz: [1, 1000], broadcastHz: [1, 1000], aoiRadius: [1, 100000], staticChunkRadius: [0, 100], disconnectGraceMs: [0, 2147483647], saveIntervalMs: [1, 2147483647] } as const;
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const value = config[key as keyof typeof ranges];
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Неверный config.${key}`);
  }
  if (config.tickHz % config.broadcastHz !== 0) throw new Error('tickHz должен быть кратен broadcastHz');
  const maps = record(config.maps, 'maps');
  if (!Object.keys(maps).length || Object.entries(maps).some(([id, path]) => !/^[A-Za-z0-9_-]{1,80}$/.test(id) || typeof path !== 'string' || !path || path.startsWith('/') || path.split(/[\\/]/).includes('..'))) throw new Error('Неверный config.maps');
  if (!Object.hasOwn(maps, config.defaultMap)) throw new Error('defaultMap отсутствует в maps');
  if (typeof config.logWorldAccess !== 'boolean') throw new Error('Неверный logWorldAccess');
  if (!Array.isArray(config.corsOrigins) || config.corsOrigins.some((origin) => {
    try { const url = new URL(origin); return typeof origin !== 'string' || !['http:', 'https:'].includes(url.protocol) || url.origin !== origin; } catch { return true; }
  })) throw new Error('Неверный corsOrigins');
  if (typeof npc.adapter !== 'string' || !npc.adapter) throw new Error('Неверный npc.adapter');
  record(npc.options, 'npc.options');
  for (const [key, max] of [['maxConcurrent', 2], ['maxUnfinished', 4], ['timeoutMs', 9000]] as const) {
    if (!Number.isSafeInteger(npc[key]) || npc[key] < 1 || npc[key] > max) throw new Error(`Неверный npc.${key}`);
  }
  if (npc.maxConcurrent > npc.maxUnfinished) throw new Error('npc.maxConcurrent > maxUnfinished');
  return { ...config, clientDir: resolve(dirname(path), config.clientDir), worldDir: resolve(dirname(path), config.worldDir), contentDir: resolve(dirname(path), config.contentDir), dbPath: resolve(dirname(path), config.dbPath) };
}
export async function loadConfig(path = defaultConfigPath): Promise<Config> {
  let raw: unknown = {};
  try { raw = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path !== defaultConfigPath) throw new Error(`Не удалось прочитать конфигурацию ${path}`, { cause: error }); }
  return parseConfig(raw, path);
}
export function configArgument(args = process.argv.slice(2)): string {
  if (!args.length) return defaultConfigPath;
  if (args.length !== 2 || args[0] !== '--config' || !args[1]) throw new Error('Использование: --config <путь>');
  return resolve(args[1]);
}
