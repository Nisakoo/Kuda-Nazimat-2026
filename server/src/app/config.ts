import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameConfig } from '../contracts.ts';
import { NPC_TIMING, validNpcTimeoutMs } from '../../../shared/protocol/npcTiming.ts';
import { isIP } from 'node:net';
import { LEVELS, type LogsConfig } from '../common/logger.ts';

/** SERVER-009: the environment selects a preset; files and arguments override it. */
export const ENVIRONMENTS = ['development', 'production', 'test'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export type { LogsConfig };
export interface Config extends GameConfig {
  env: Environment;
  host: string; port: number; clientDir: string; defaultMap: string; dbPath: string;
  sessionTtlMs: number; logWorldAccess: boolean; clientDebug: boolean;
  /** passwordless enables `guest` and `dev` login (AUTH-001, AUTH-016); never in production. */
  auth: { maxSessions: number; passwordless: boolean };
  logs: LogsConfig;
  /** TLS-016: HTTPS is always on; only the certificate directory and extra names are configurable. */
  tls: { dir: string; extraNames: string[] };
  monitoring: { token: string | null; pingIntervalMs: number; validateOutgoing: boolean };
  language: { adapter: string; options: Record<string, unknown> };
  npc: { adapter: string; maxConcurrent: number; maxUnfinished: number; timeoutMs: number; streamTimeoutMs: number; options: Record<string, unknown> };
}
type Input = Omit<Config, 'env'>;
export const defaultConfigPath = fileURLToPath(new URL('../../config.json', import.meta.url));
const defaults: Input = {
  host: '0.0.0.0', port: 8080, clientDir: '../client/dist', worldDir: '../client/public',
  maps: { market: 'maps/market/manifest.json', demo: 'maps/demo/manifest.json', science: 'maps/demo/science.json' },
  defaultMap: 'market', contentDir: 'content', dbPath: 'data/game.sqlite', maxPlayers: 4,
  sessionTtlMs: 43200000, tickHz: 20, broadcastHz: 10, aoiRadius: 64, staticChunkRadius: 3,
  disconnectGraceMs: 10000, saveIntervalMs: 10000, corsOrigins: [], logWorldAccess: false, clientDebug: false,
  auth: { maxSessions: 5, passwordless: false },
  logs: { consoleLevel: 'info', fileLevel: 'debug', dir: 'data/logs', maxFileMb: 20, maxTotalMb: 200, retentionDays: 14 },
  tls: { dir: 'data/tls', extraNames: [] },
  monitoring: { token: null, pingIntervalMs: 5000, validateOutgoing: false },
  language: { adapter: 'test', options: {} },
  npc: { adapter: 'scripted', maxConcurrent: 1, maxUnfinished: 4, timeoutMs: NPC_TIMING.defaultMs, streamTimeoutMs: NPC_TIMING.defaultMs, options: {} },
};
const NESTED = ['auth', 'logs', 'tls', 'monitoring', 'language', 'npc'] as const;
type Preset = { [K in keyof Input]?: K extends (typeof NESTED)[number] ? Partial<Input[K]> : Input[K] };
const PRESETS: Record<Environment, Preset> = {
  development: { dbPath: 'data/dev.sqlite', corsOrigins: ['https://localhost:5173'], clientDebug: true, auth: { passwordless: true }, logs: { consoleLevel: 'debug' }, monitoring: { validateOutgoing: true } },
  production: {},
  test: { dbPath: 'data/test.sqlite', auth: { passwordless: true }, logs: { consoleLevel: 'warn', fileLevel: 'off' } },
};

const DNS_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export function record(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Неверный объект: ${key}`);
  return value as Record<string, unknown>;
}
function integer(value: unknown, key: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`Неверный config.${key}`);
}

export function parseConfig(raw: unknown, path: string, env: Environment = 'development'): Config {
  const input = record(raw, 'config');
  for (const key of Object.keys(input)) if (!Object.hasOwn(defaults, key)) throw new Error(`Неизвестный ключ config.${key}`);
  const preset = PRESETS[env];
  const merged: Record<string, unknown> = { ...defaults, ...preset, ...input };
  for (const key of NESTED) {
    const value = { ...defaults[key], ...preset[key], ...record(input[key] ?? {}, key) } as Record<string, unknown>;
    for (const name of Object.keys(value)) if (!Object.hasOwn(defaults[key], name)) throw new Error(`Неизвестный ключ ${key}.${name}`);
    merged[key] = value;
  }
  const config = { ...merged, env } as Config;
  for (const key of ['host', 'clientDir', 'worldDir', 'contentDir', 'dbPath', 'defaultMap'] as const) {
    if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error(`Неверный config.${key}`);
  }
  const ranges = { port: [1, 65535], maxPlayers: [1, 4], sessionTtlMs: [1, 2147483647], tickHz: [1, 1000], broadcastHz: [1, 1000], aoiRadius: [1, 100000], staticChunkRadius: [0, 100], disconnectGraceMs: [0, 2147483647], saveIntervalMs: [1, 2147483647] } as const;
  for (const [key, [min, max]] of Object.entries(ranges)) integer(config[key as keyof typeof ranges], key, min, max);
  if (config.tickHz % config.broadcastHz !== 0) throw new Error('tickHz должен быть кратен broadcastHz');
  const maps = record(config.maps, 'maps');
  if (!Object.keys(maps).length || Object.entries(maps).some(([id, file]) => !/^[A-Za-z0-9_-]{1,80}$/.test(id) || typeof file !== 'string' || !file || file.startsWith('/') || file.split(/[\\/]/).includes('..'))) throw new Error('Неверный config.maps');
  if (!Object.hasOwn(maps, config.defaultMap)) throw new Error('defaultMap отсутствует в maps');
  for (const key of ['logWorldAccess', 'clientDebug'] as const) if (typeof config[key] !== 'boolean') throw new Error(`Неверный ${key}`);
  if (!Array.isArray(config.corsOrigins) || config.corsOrigins.some((origin) => {
    try { const url = new URL(origin); return typeof origin !== 'string' || !['http:', 'https:'].includes(url.protocol) || url.origin !== origin; } catch { return true; }
  })) throw new Error('Неверный corsOrigins');
  const { auth, logs, tls, monitoring, language, npc } = config;
  integer(auth.maxSessions, 'auth.maxSessions', 1, 100);
  if (typeof auth.passwordless !== 'boolean') throw new Error('Неверный auth.passwordless');
  if (env === 'production' && auth.passwordless) throw new Error('auth.passwordless запрещён в production: вход без пароля только для development и test');
  if (!LEVELS.includes(logs.consoleLevel) || (logs.fileLevel !== 'off' && !LEVELS.includes(logs.fileLevel))) throw new Error('Неверный уровень logs');
  if (typeof logs.dir !== 'string' || !logs.dir.trim()) throw new Error('Неверный logs.dir');
  integer(logs.maxFileMb, 'logs.maxFileMb', 1, 1024); integer(logs.maxTotalMb, 'logs.maxTotalMb', 1, 100000); integer(logs.retentionDays, 'logs.retentionDays', 1, 3650);
  if (logs.maxFileMb > logs.maxTotalMb) throw new Error('logs.maxFileMb > logs.maxTotalMb');
  if (typeof tls.dir !== 'string' || !tls.dir.trim()) throw new Error('Неверный tls.dir');
  if (!Array.isArray(tls.extraNames) || tls.extraNames.length > 8 || tls.extraNames.some((name) => typeof name !== 'string' || !(isIP(name) || DNS_NAME.test(name)))) {
    throw new Error('tls.extraNames: до 8 DNS-имён или IP-адресов');
  }
  if (monitoring.token !== null && (typeof monitoring.token !== 'string' || monitoring.token.length < 32 || /\s/.test(monitoring.token))) throw new Error('monitoring.token: null или строка от 32 символов без пробелов');
  integer(monitoring.pingIntervalMs, 'monitoring.pingIntervalMs', 1000, 60000);
  if (typeof monitoring.validateOutgoing !== 'boolean') throw new Error('Неверный monitoring.validateOutgoing');
  if (typeof language.adapter !== 'string' || !language.adapter) throw new Error('Неверный language.adapter');
  record(language.options, 'language.options');
  if (typeof npc.adapter !== 'string' || !npc.adapter) throw new Error('Неверный npc.adapter');
  record(npc.options, 'npc.options');
  if (language.adapter === 'local') {
    if (Object.keys(language.options).length) throw new Error(`Неизвестный language.options.${Object.keys(language.options)[0]}`);
  }
  for (const [key, max] of [['maxConcurrent', 2], ['maxUnfinished', 4], ['streamTimeoutMs', NPC_TIMING.maxMs]] as const) integer(npc[key], `npc.${key}`, 1, max);
  if (!validNpcTimeoutMs(npc.timeoutMs)) throw new Error('Неверный npc.timeoutMs');
  if (['ollama', 'mlx'].includes(npc.adapter) && npc.maxConcurrent !== 1) throw new Error('Локальная LLM поддерживает только npc.maxConcurrent: 1; профиль 2 ещё не квалифицирован');
  if (npc.maxConcurrent > npc.maxUnfinished) throw new Error('npc.maxConcurrent > maxUnfinished');
  const base = dirname(path);
  return {
    ...config, clientDir: resolve(base, config.clientDir), worldDir: resolve(base, config.worldDir), contentDir: resolve(base, config.contentDir), dbPath: resolve(base, config.dbPath),
    logs: { ...logs, dir: resolve(base, logs.dir) }, tls: { ...tls, dir: resolve(base, tls.dir) },
  };
}

export async function loadConfig(path = defaultConfigPath, env: Environment = 'development'): Promise<Config> {
  let raw: unknown = {};
  try { raw = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path !== defaultConfigPath) throw new Error(`Не удалось прочитать конфигурацию ${path}`, { cause: error }); }
  return parseConfig(raw, path, env);
}

export interface ServerArguments { configPath: string; env: Environment; port?: number; rest: string[] }
const USAGE = 'Использование: [--env development|production|test] [--config <путь>] [--port <1–65535>]';
function environment(value: string | undefined): Environment {
  if (!(ENVIRONMENTS as readonly string[]).includes(value ?? '')) throw new Error(`Неизвестное окружение «${value}». ${USAGE}`);
  return value as Environment;
}
function port(value: string | undefined): number {
  if (!value || !/^\d{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error(USAGE);
  return Number(value);
}
/**
 * Command line of the server and its CLIs. `--env` beats APP_ENV, `--port` beats PORT; positional words
 * (e.g. the backup destination) are returned in `rest`. Defaults to development (SERVER-009).
 */
export function serverArguments(args = process.argv.slice(2), environ: NodeJS.ProcessEnv = process.env): ServerArguments {
  const result: ServerArguments = { configPath: defaultConfigPath, env: environ.APP_ENV ? environment(environ.APP_ENV) : 'development', rest: [] };
  if (environ.PORT) result.port = port(environ.PORT);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (!flag.startsWith('--')) { result.rest.push(flag); continue; }
    const value = args[++i];
    if (flag === '--config' && value) result.configPath = resolve(value);
    else if (flag === '--port') result.port = port(value);
    else if (flag === '--env') result.env = environment(value);
    else throw new Error(USAGE);
  }
  return result;
}

/** Defaults → environment preset → config file → HOST/PORT → --port. */
export async function loadServerConfig(args = process.argv.slice(2), environ: NodeJS.ProcessEnv = process.env): Promise<{ config: Config; args: ServerArguments }> {
  const parsed = serverArguments(args, environ);
  const loaded = await loadConfig(parsed.configPath, parsed.env);
  const config = { ...loaded, ...(environ.HOST ? { host: environ.HOST } : {}), ...(parsed.port === undefined ? {} : { port: parsed.port }) };
  return { config, args: parsed };
}

/** Legacy callers use this config-only argument helper. */
export function configArgument(args = process.argv.slice(2)): string { return serverArguments(args).configPath; }
