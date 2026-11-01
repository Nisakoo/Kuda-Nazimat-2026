import { constants } from 'node:fs';
import { link, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defaultConfigPath, parseConfig } from '../app/config.ts';
import { parseLlmProfiles, validatePreparedLlmProfile } from '../app/llmProfiles.ts';
import { NPC_TIMING } from '../../../shared/protocol/npcTiming.ts';

const LIMIT = 64 * 1024;
type Options = { configPath?: string; backup2bPath?: string; profilesPath?: string; home?: string };
type Profile = { backend: 'ollama'; model: '2b' | '0.8b'; options: Record<string, unknown> };
type Failure = 'destination_exists' | 'backup_collision' | 'missing_2b' | 'unprepared' | 'invalid_config';
class ImportFailure extends Error {
  readonly reason: Failure;
  constructor(reason: Failure) { super(reason); this.reason = reason; }
}
function decode(bytes: Buffer): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

async function source(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > LIMIT || !(stat.mode & 0o444)) throw new Error('Invalid source');
    const buffer = Buffer.alloc(LIMIT + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > LIMIT) throw new Error('Invalid source');
    return buffer.subarray(0, length);
  } finally { await handle.close(); }
}
async function absent(path: string, reason: Failure): Promise<void> {
  try { await lstat(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new ImportFailure(reason);
}
async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
}
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function temporary(path: string, bytes: Buffer): Promise<string> {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  catch (error) { await unlink(temp).catch(() => {}); throw error; }
  finally { await handle.close(); }
  return temp;
}
async function createOnly(path: string, bytes: Buffer): Promise<void> {
  const temp = await temporary(path, bytes);
  try { await link(temp, path); await syncDirectory(dirname(path)); }
  finally { await unlink(temp).catch(() => {}); }
}
function extract(bytes: Buffer, path: string): { raw: Record<string, unknown>; profile?: Profile; timeout: number } {
  const raw = decode(bytes);
  const config = parseConfig(raw, path);
  if (config.npc.adapter !== 'ollama') throw new Error('Unsupported source');
  const model = config.npc.options.model;
  const kind = model === 'qwen3.5:2b-q4_K_M' ? '2b' : model === 'qwen3.5:0.8b-q8_0' ? '0.8b' : undefined;
  if (!kind) throw new Error('Unsupported model');
  return { raw: raw as Record<string, unknown>, profile: { backend: 'ollama', model: kind, options: structuredClone(config.npc.options) }, timeout: config.npc.timeoutMs };
}

/** Import trusted local configurations once. This does not run a model or change the active adapter. */
export async function importLlmProfiles(options: Options = {}): Promise<{ profilesPath: string; profiles: number; timeoutMs: number }> {
  const home = resolve(options.home ?? homedir());
  const configPath = resolve(options.configPath ?? defaultConfigPath);
  const backup2bPath = resolve(options.backup2bPath ?? join(home, 'kuda-llm', 'config-before-08b.json'));
  const profilesPath = resolve(options.profilesPath ?? join(home, 'kuda-llm', 'profiles.json'));
  const migrationBackup = join(home, 'kuda-llm', 'config-before-profiles.json');
  if (new Set([configPath, backup2bPath, profilesPath, migrationBackup]).size !== 4) throw new Error('Conflicting paths');
  await absent(profilesPath, 'destination_exists');
  let original: Buffer;
  let active: ReturnType<typeof extract>;
  try { original = await source(configPath); active = extract(original, configPath); }
  catch { throw new ImportFailure('invalid_config'); }
  // Only the documented legacy 8 s configuration migrates. Other valid budgets stay unchanged.
  if (active.timeout === 8000) await absent(migrationBackup, 'backup_collision');
  let backup: ReturnType<typeof extract> | undefined;
  try { backup = extract(await source(backup2bPath), backup2bPath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (active.profile?.model !== '2b') throw new ImportFailure('missing_2b');
    } else throw new ImportFailure('invalid_config');
  }
  const profiles: Profile[] = [];
  for (const item of [active.profile, backup?.profile]) {
    if (item && !profiles.some((p) => p.model === item.model)) profiles.push(item);
  }
  if (!profiles.some((p) => p.model === '2b')) throw new ImportFailure('missing_2b');
  const catalog = { version: 1, selected: { backend: 'ollama', model: '2b' }, profiles };
  try { parseLlmProfiles(catalog); } catch { throw new ImportFailure('invalid_config'); }
  for (const profile of profiles) {
    try { await validatePreparedLlmProfile(profile); } catch { throw new ImportFailure('unprepared'); }
  }
  const catalogBytes = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`);
  if (catalogBytes.length > LIMIT) throw new Error('Catalog too large');
  let replacement: Buffer | undefined;
  if (active.timeout === 8000) {
    const npc = active.raw.npc as Record<string, unknown>;
    replacement = Buffer.from(`${JSON.stringify({ ...active.raw, npc: { ...npc, timeoutMs: NPC_TIMING.defaultMs } }, null, 2)}\n`);
    parseConfig(JSON.parse(replacement.toString('utf8')), configPath);
  }
  await privateDirectory(dirname(profilesPath));
  if (replacement) {
    await privateDirectory(dirname(migrationBackup));
    // Create the recovery copy first. It remains if any later operation fails.
    try { await createOnly(migrationBackup, original); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ImportFailure('backup_collision'); throw error; }
    const temp = await temporary(configPath, replacement);
    try {
      if (!(await source(configPath)).equals(original)) throw new Error('Config changed during import');
      await rename(temp, configPath);
      await syncDirectory(dirname(configPath));
    } finally { await unlink(temp).catch(() => {}); }
  } else if (!(await source(configPath)).equals(original)) throw new Error('Config changed during import');
  // The timeout migration may remain if catalog publication fails; it does not switch models.
  try { await createOnly(profilesPath, catalogBytes); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ImportFailure('destination_exists'); throw error; }
  return { profilesPath, profiles: profiles.length, timeoutMs: active.timeout === 8000 ? NPC_TIMING.defaultMs : active.timeout };
}

function argumentsFrom(args: string[]): Options {
  const result: Options = {};
  const keys = { '--config': 'configPath', '--backup-2b': 'backup2bPath', '--profiles': 'profilesPath' } as const;
  for (let i = 0; i < args.length; i += 2) {
    const key = keys[args[i] as keyof typeof keys];
    const value = args[i + 1];
    if (!key || !value || value.startsWith('--') || result[key] !== undefined) throw new Error('Invalid arguments');
    result[key] = value;
  }
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = argumentsFrom(process.argv.slice(2));
    if (options.profilesPath === undefined && process.env.KUDA_LLM_PROFILES) options.profilesPath = process.env.KUDA_LLM_PROFILES;
    const result = await importLlmProfiles(options);
    console.log(`Profiles created: ${result.profilesPath} (${result.profiles}; timeout ${result.timeoutMs} ms)`);
  } catch (error) {
    const messages: Record<Failure, string> = {
      destination_exists: 'Profile import failed: profiles already exist; no profiles were overwritten.',
      backup_collision: 'Profile import failed: the timeout migration backup already exists.',
      missing_2b: 'Profile import failed: a 2b source configuration is required.',
      unprepared: 'Profile import failed: a model artifact or local inventory is missing or unreadable.',
      invalid_config: 'Profile import failed: a source configuration or profile is invalid.',
    };
    console.error(error instanceof ImportFailure ? messages[error.reason] : 'Profile import failed: check arguments, permissions, and source files.');
    console.error('A timeout migration may already be complete; its backup is retained.');
    process.exitCode = 1;
  }
}
