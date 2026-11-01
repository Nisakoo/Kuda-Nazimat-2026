import { constants } from 'node:fs';
import { access, lstat, open, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { validateLocalLlmOptions } from '../npc/adapters/localLlm.ts';
import type { Config } from './config.ts';

export type ProfileSelection = { backend: 'ollama' | 'mlx'; model: '2b' | '0.8b' };
export type LlmProfile = ProfileSelection & { options: Record<string, unknown> };
export interface LlmProfiles { version: 1; selected: ProfileSelection; profiles: LlmProfile[] }
export const defaultProfilesPath = join(homedir(), 'kuda-llm', 'profiles.json');
const LIMIT = 64 * 1024;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('llm_profiles_invalid');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Reflect.ownKeys(value);
  if (actual.length !== expected.length || actual.some((key) => typeof key !== 'string' || !expected.includes(key))) throw new Error('llm_profiles_invalid');
}
function pair(value: Record<string, unknown>): ProfileSelection {
  const { backend, model } = value;
  if ((backend !== 'ollama' && backend !== 'mlx') || (model !== '2b' && model !== '0.8b') ||
      (backend === 'mlx' && model !== '2b')) throw new Error('llm_profiles_invalid');
  return { backend, model };
}
const same = (a: ProfileSelection, b: ProfileSelection): boolean => a.backend === b.backend && a.model === b.model;

/** Pure shape/identity validation. Unselected entries need not exist on this machine. */
export function parseLlmProfiles(raw: unknown): LlmProfiles {
  try {
    const input = object(raw);
    keys(input, ['version', 'selected', 'profiles']);
    if (input.version !== 1 || !Array.isArray(input.profiles) || input.profiles.length < 1 || input.profiles.length > 3) throw new Error();
    const selectedInput = object(input.selected);
    keys(selectedInput, ['backend', 'model']);
    const selected = pair(selectedInput);
    const profiles: LlmProfile[] = [];
    for (const entry of input.profiles) {
      const profile = object(entry);
      keys(profile, ['backend', 'model', 'options']);
      const identity = pair(profile);
      if (profiles.some((previous) => same(previous, identity))) throw new Error();
      const options = validateLocalLlmOptions(identity.backend, object(profile.options));
      if (identity.backend === 'ollama' && options.model !== (identity.model === '2b' ? 'qwen3.5:2b-q4_K_M' : 'qwen3.5:0.8b-q8_0')) throw new Error();
      profiles.push({ ...identity, options });
    }
    if (!profiles.some((profile) => same(profile, selected))) throw new Error();
    return { version: 1, selected, profiles };
  } catch { throw new Error('llm_profiles_invalid'); }
}

/** A fixed-size read also bounds growth after stat. Never open a FIFO or follow a final symlink. */
async function readBounded(path: string): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.size > LIMIT || !(info.mode & 0o444)) throw new Error('llm_profiles_unavailable');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.size > LIMIT) throw new Error('llm_profiles_unavailable');
    const buffer = Buffer.alloc(LIMIT + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > LIMIT) throw new Error('llm_profiles_unavailable');
    return buffer.subarray(0, length);
  } finally { await file.close(); }
}
function decodeJson(buffer: Buffer): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) as unknown;
}

async function resource(path: string, directory: boolean, executable = false): Promise<void> {
  // Runtime interpreters commonly are venv symlinks. Check their resolved target type.
  const info = await stat(path);
  if ((directory ? !info.isDirectory() : !info.isFile()) || !(info.mode & 0o444) ||
      ((directory || executable) && !(info.mode & 0o111))) throw new Error();
  await access(path, constants.R_OK | (directory || executable ? constants.X_OK : 0));
}
async function inventory(directory: string, manifestPath: string): Promise<void> {
  const manifest = object(decodeJson(await readBounded(manifestPath)));
  const entries = Object.entries(manifest);
  if (!entries.length) throw new Error();
  for (const [name, digest] of entries) {
    const parts = name.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\') || /[\x00-\x1f]/.test(part)) ||
        typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw new Error();
    let path = directory;
    for (const part of parts) {
      path = join(path, part);
      if ((await lstat(path)).isSymbolicLink()) throw new Error();
    }
    await resource(path, false);
    if ((await stat(path)).size === 0) throw new Error();
  }
  // Do not read/hash weights or execute anything. The worker verifies the complete inventory and pins.
}
async function ollamaManifest(options: Record<string, string>): Promise<void> {
  const root = await realpath(options.modelsDir!);
  const tag = options.model!.split(':')[1]!;
  const canonical = join(root, 'manifests-v2', 'ollama.com', 'library', 'qwen3.5', tag);
  let selected = canonical;
  // lstat sees dangling links: only a truly absent v2 entry permits legacy lookup.
  try { await lstat(canonical); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // A dangling/symlinked parent is not an absent prepared v2 layout.
    let parent = root;
    for (const part of ['manifests-v2', 'ollama.com', 'library', 'qwen3.5']) {
      parent = join(parent, part);
      try {
        const info = await lstat(parent);
        if (!info.isDirectory()) throw new Error();
      } catch (parentError) {
        if ((parentError as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw parentError;
      }
    }
    selected = join(root, 'manifests', 'registry.ollama.ai', 'library', 'qwen3.5', tag);
  }
  // Ollama on macOS can use a direct v2 manifest link to a same-store blob.
  const target = await realpath(selected);
  const name = relative(root, target);
  if (!name || isAbsolute(name) || name === '..' || name.startsWith('../')) throw new Error();
  await resource(target, false);
  const metadata = object(decodeJson(await readBounded(target)));
  if (!Object.keys(metadata).length) throw new Error();
  // Full manifest payload, digest, blob hashes and link-anchor checks remain in the worker.
}
/** Static preparation checks only; no platform check, runtime execution or weight hashing. */
export async function validatePreparedLlmProfile(profile: LlmProfile): Promise<void> {
  const options = profile.options as Record<string, string>;
  try {
    await resource(options.python!, false, true);
    if (profile.backend === 'ollama') {
      await resource(options.executable!, false, true);
      await resource(options.modelsDir!, true);
      await ollamaManifest(options);
      await resource(options.tokenizerDir!, true);
      await resource(options.tokenizerManifest!, false);
      await inventory(options.tokenizerDir!, options.tokenizerManifest!);
    } else {
      await resource(options.modelDir!, true);
      await resource(options.modelManifest!, false);
      await inventory(options.modelDir!, options.modelManifest!);
    }
  } catch { throw new Error('llm_profile_unprepared'); }
}

/** Resolve one prepared local profile before startup, without runtime load, download or fallback. */
export async function selectLlmProfile(
  config: Config,
  selection?: { backend?: string; model?: string; profilesPath?: string },
  platform: { platform: string; arch: string } = { platform: process.platform, arch: process.arch },
): Promise<{ config: Config; profile?: ProfileSelection }> {
  let requested: ProfileSelection | undefined;
  let path = defaultProfilesPath;
  let explicitPath = false;
  if (selection !== undefined) {
    try {
      const input = object(selection);
      if (Reflect.ownKeys(input).some((key) => typeof key !== 'string' || !['backend', 'model', 'profilesPath'].includes(key))) throw new Error();
      if (selection.backend !== undefined || selection.model !== undefined) requested = pair(input);
      if (selection.profilesPath !== undefined) {
        if (typeof selection.profilesPath !== 'string' || !selection.profilesPath.trim() || selection.profilesPath.length > 4096 || /[\x00-\x1f]/.test(selection.profilesPath)) throw new Error();
        path = resolve(selection.profilesPath);
        explicitPath = true;
      }
    } catch { throw new Error('llm_profile_selection_invalid'); }
  }
  // Reject an explicitly incompatible backend before even reading a collection.
  const supported = (backend: ProfileSelection['backend']): boolean => backend === 'mlx'
    ? platform.platform === 'darwin' && platform.arch === 'arm64'
    : ['darwin', 'linux'].includes(platform.platform) && ['x64', 'arm64'].includes(platform.arch);
  if (requested && !supported(requested.backend)) throw new Error('unsupported_platform');
  let bytes: Buffer;
  try { bytes = await readBounded(path); }
  catch (error) {
    if (!requested && !explicitPath && (error as NodeJS.ErrnoException).code === 'ENOENT') return { config };
    throw new Error('llm_profiles_unavailable');
  }
  let catalog: LlmProfiles;
  try { catalog = parseLlmProfiles(decodeJson(bytes)); }
  catch { throw new Error('llm_profiles_invalid'); }
  const selected = requested ?? catalog.selected;
  const profile = catalog.profiles.find((entry) => same(entry, selected));
  if (!profile) throw new Error('llm_profile_not_found');
  if (!supported(profile.backend)) throw new Error('unsupported_platform');
  if (config.npc.maxConcurrent !== 1) throw new Error('llm_profile_concurrency_invalid');
  await validatePreparedLlmProfile(profile);
  return {
    config: { ...config, npc: { ...config.npc, adapter: profile.backend, options: { ...profile.options } } },
    profile: { backend: profile.backend, model: profile.model },
  };
}
