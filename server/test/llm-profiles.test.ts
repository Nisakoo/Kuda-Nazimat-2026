import { constants } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../src/app/config.ts';
import { defaultProfilesPath, parseLlmProfiles, selectLlmProfile, validatePreparedLlmProfile, type LlmProfile, type LlmProfiles } from '../src/app/llmProfiles.ts';

const home = vi.hoisted(() => `${process.env.TMPDIR ?? '/tmp'}/kuda-profiles-test-${process.pid}-${Math.random().toString(16).slice(2)}`);
vi.mock('node:os', async (original) => ({ ...await original<typeof import('node:os')>(), homedir: () => home }));
const linux = { platform: 'linux', arch: 'x64' };
const mac = { platform: 'darwin', arch: 'arm64' };
const digest = 'a'.repeat(64);
let root = '/unprepared-profile-shape-fixture';
let config: ReturnType<typeof parseConfig>;

beforeAll(async () => { await mkdir(home, { recursive: true }); });
afterAll(async () => { await rm(home, { recursive: true, force: true }); });
beforeEach(async () => {
  await rm(join(home, 'kuda-llm'), { recursive: true, force: true });
  root = await mkdtemp(join(home, 'fixture-'));
  config = parseConfig({ npc: { adapter: 'scripted', timeoutMs: 1234, options: { obsolete: 'never copy' } } }, '/base/config.json');
});
function ollama(model: '2b' | '0.8b' = '2b'): LlmProfile {
  const base = join(root, model);
  return { backend: 'ollama', model, options: {
    python: join(base, 'python'), executable: join(base, 'ollama'), modelsDir: join(base, 'models'),
    tokenizerDir: join(base, 'tokenizer'), tokenizerManifest: join(base, 'tokenizer-manifest.json'),
    runnerVersion: '0.40.13', model: model === '2b' ? 'qwen3.5:2b-q4_K_M' : 'qwen3.5:0.8b-q8_0',
    modelDigest: model === '2b' ? digest : 'b'.repeat(64), threads: model === '2b' ? 2 : 3, numGpu: 0,
  } };
}
function mlx(): LlmProfile {
  return { backend: 'mlx', model: '2b', options: { python: join(root, 'mlx/python'), modelDir: join(root, 'mlx/model'),
    modelManifest: join(root, 'mlx/manifest.json'), runnerVersion: '0.32.2' } };
}
function catalog(profiles: LlmProfile[] = [ollama(), ollama('0.8b'), mlx()]): LlmProfiles {
  return { version: 1, selected: { backend: profiles[0]!.backend, model: profiles[0]!.model }, profiles };
}
async function prepare(profile: LlmProfile): Promise<void> {
  const o = profile.options as Record<string, string>;
  const directory = (o.tokenizerDir ?? o.modelDir)!;
  await mkdir(directory, { recursive: true });
  if (o.modelsDir) {
    const manifest = join(o.modelsDir, 'manifests', 'registry.ollama.ai', 'library', 'qwen3.5', o.model!.split(':')[1]!);
    await mkdir(dirname(manifest), { recursive: true });
    await writeFile(manifest, JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.docker.distribution.manifest.v2+json', config: {}, layers: [] }));
  }
  // Dummy data only. These files are never executed, imported, hashed or loaded as a model.
  for (const path of [o.python!, ...(o.executable ? [o.executable] : [])]) {
    await writeFile(path, 'dummy non-executable content\n', { mode: 0o700 });
  }
  await writeFile(join(directory, 'tokenizer.json'), 'dummy-tokenizer');
  await writeFile((o.tokenizerManifest ?? o.modelManifest)!, JSON.stringify({ 'tokenizer.json': digest }));
}
async function save(value: unknown, path = defaultProfilesPath): Promise<string> {
  await mkdir(join(home, 'kuda-llm'), { recursive: true });
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
  return path;
}

describe('prepared LLM catalog parser', () => {
  it('validates all three pairs without filesystem access, copies options and preserves pins', () => {
    const input = catalog();
    const before = structuredClone(input);
    const parsed = parseLlmProfiles(input);
    expect(parsed.profiles).toHaveLength(3);
    expect(parsed.profiles[0]!.options.modelDigest).toBe(digest);
    expect(parsed.profiles[1]!.options.modelDigest).toBe('b'.repeat(64));
    expect(parsed.profiles[0]!.options.port).toBe(11501);
    expect(parsed.profiles[2]!.options.threads).toBe(2);
    expect(parsed.profiles[0]!.options).not.toBe(input.profiles[0]!.options);
    parsed.selected.model = '0.8b';
    expect(input).toEqual(before);
  });
  it.each([null, [], 'raw JSON string', {}, { version: 2 }, { ...catalog(), version: '1' },
    { ...catalog(), extra: 'secret' }, { ...catalog(), profiles: [] }, { ...catalog(), profiles: {} },
    { ...catalog(), selected: { backend: 'ollama', model: '2b', extra: true } },
  ])('rejects invalid shape/version/unknown keys %#', (raw) => {
    expect(() => parseLlmProfiles(raw)).toThrow('llm_profiles_invalid');
  });
  it('rejects duplicate pairs and selections absent from the collection', () => {
    expect(() => parseLlmProfiles(catalog([ollama(), ollama()]))).toThrow('llm_profiles_invalid');
    expect(() => parseLlmProfiles({ ...catalog([mlx()]), selected: { backend: 'ollama', model: '2b' } })).toThrow('llm_profiles_invalid');
    expect(() => parseLlmProfiles(catalog([ollama(), ollama(), ollama(), mlx()]))).toThrow('llm_profiles_invalid');
  });
  it.each(['qwen3.5:2b', 'qwen3.5:0.8b', 'qwen3.5:0.8b-q4_K_M', 'cloud:2b', '', 2])('rejects arbitrary aliases %s', (model) => {
    const entry = ollama();
    expect(() => parseLlmProfiles(catalog([{ ...entry, model } as LlmProfile]))).toThrow('llm_profiles_invalid');
    entry.options.model = model;
    expect(() => parseLlmProfiles(catalog([entry]))).toThrow('llm_profiles_invalid');
  });
  it('rejects wrong backend/model identity and options from another backend', () => {
    expect(() => parseLlmProfiles(catalog([{ ...mlx(), model: '0.8b' }]))).toThrow('llm_profiles_invalid');
    expect(() => parseLlmProfiles(catalog([{ ...ollama(), options: mlx().options }]))).toThrow('llm_profiles_invalid');
    expect(() => parseLlmProfiles(catalog([{ ...ollama('0.8b'), options: ollama().options }]))).toThrow('llm_profiles_invalid');
    expect(() => parseLlmProfiles(catalog([{ ...ollama(), backend: 'remote' } as unknown as LlmProfile]))).toThrow('llm_profiles_invalid');
  });
  it.each([
    { endpoint: 'https://secret.example' }, { python: 'relative/python' }, { threads: 0 }, { numGpu: 129 },
    { runnerVersion: 'latest' }, { modelDigest: 'no-pin' }, { startupTimeoutMs: 120001 }, { python: 1 },
  ])('reuses strict backend options validation %#', (patch) => {
    const entry = ollama();
    Object.assign(entry.options, patch);
    expect(() => parseLlmProfiles(catalog([entry]))).toThrow('llm_profiles_invalid');
  });
  it('validates shapes of unselected profiles too', () => {
    const value = catalog();
    value.profiles[2]!.options.hidden = 'secret';
    expect(() => parseLlmProfiles(value)).toThrow('llm_profiles_invalid');
  });
});

describe('prepared LLM selection', () => {
  it('uses the home collection and saved pair by default; leaves other-platform entries unprepared', async () => {
    expect(defaultProfilesPath).toBe(join(home, 'kuda-llm/profiles.json'));
    const value = catalog();
    value.selected.model = '0.8b';
    await prepare(value.profiles[1]!);
    await save(value);
    const input = structuredClone(config);
    const result = await selectLlmProfile(config, undefined, linux);
    expect(result.profile).toEqual({ backend: 'ollama', model: '0.8b' });
    expect(result.config.npc.options).toEqual(parseLlmProfiles(value).profiles[1]!.options);
    expect(result.config.npc.options.obsolete).toBeUndefined();
    expect(result.config.npc.timeoutMs).toBe(1234);
    expect(result.config.npc.maxUnfinished).toBe(config.npc.maxUnfinished);
    expect(result.config.dbPath).toBe(config.dbPath);
    expect(result.config.maps).toEqual(config.maps);
    expect(config).toEqual(input);
    expect(JSON.parse(await readFile(defaultProfilesPath, 'utf8'))).toEqual(value);
  });
  it('overrides the saved profile atomically, without mixing pins or rewriting files', async () => {
    const value = catalog();
    await prepare(value.profiles[0]!);
    await prepare(value.profiles[1]!);
    await save(value);
    const result = await selectLlmProfile(config, { backend: 'ollama', model: '0.8b' }, linux);
    expect(result.config.npc.options.modelDigest).toBe('b'.repeat(64));
    expect(result.config.npc.options.tokenizerDir).toBe(value.profiles[1]!.options.tokenizerDir);
    expect(result.config.npc.options.threads).toBe(3);
    expect(JSON.parse(await readFile(defaultProfilesPath, 'utf8'))).toEqual(value);
    expect(value.profiles[0]!.options.modelDigest).toBe(digest);
  });
  it('selects MLX 2b only on Apple Silicon and replaces Ollama options', async () => {
    const value = catalog([mlx(), ollama()]);
    await prepare(value.profiles[0]!);
    await save(value);
    config.npc.adapter = 'ollama';
    config.npc.options = ollama().options;
    const result = await selectLlmProfile(config, undefined, mac);
    expect(result.profile).toEqual({ backend: 'mlx', model: '2b' });
    expect(result.config.npc.options.modelDir).toBe(value.profiles[0]!.options.modelDir);
    expect(result.config.npc.options.modelDigest).toBeUndefined();
    expect(result.config.npc.options.tokenizerDir).toBeUndefined();
  });
  it('preserves legacy config when the default collection is absent', async () => {
    expect(await selectLlmProfile(config, undefined, linux)).toEqual({ config });
    config.npc.adapter = 'ollama';
    config.npc.options = ollama().options;
    expect(await selectLlmProfile(config, {}, linux)).toEqual({ config });
  });
  it.each([{ backend: 'ollama' }, { model: '2b' }, { backend: '', model: '' },
    { backend: 'mlx', model: '0.8b' }, { backend: 'cloud', model: '2b' },
    { backend: 'ollama', model: 'qwen3.5:2b-q4_K_M' }, { profilesPath: '' }, { profilesPath: 3 }, { unknown: true },
  ])('rejects incomplete/invalid explicit selection %#', async (selection) => {
    await expect(selectLlmProfile(config, selection as Parameters<typeof selectLlmProfile>[1], linux)).rejects.toThrow('llm_profile_selection_invalid');
  });
  it('does not fall back on absent explicitly selected collection or pair', async () => {
    await expect(selectLlmProfile(config, { backend: 'ollama', model: '2b' }, linux)).rejects.toThrow('llm_profiles_unavailable');
    await expect(selectLlmProfile(config, { profilesPath: join(root, 'absent.json') }, linux)).rejects.toThrow('llm_profiles_unavailable');
    await save(catalog([ollama()]));
    await expect(selectLlmProfile(config, { backend: 'ollama', model: '0.8b' }, linux)).rejects.toThrow('llm_profile_not_found');
  });
  it('uses an explicit collection path and never falls back from malformed data', async () => {
    const value = catalog([ollama()]);
    await prepare(value.profiles[0]!);
    await save(value);
    const path = join(root, 'explicit.json');
    await save(value, path);
    expect((await selectLlmProfile(config, { profilesPath: path }, linux)).profile?.model).toBe('2b');
    await writeFile(path, '{"secret":"do not publish"');
    await expect(selectLlmProfile(config, { profilesPath: path }, linux)).rejects.toThrow(/^llm_profiles_invalid$/);
    await writeFile(defaultProfilesPath, '{}');
    await expect(selectLlmProfile(config, undefined, linux)).rejects.toThrow('llm_profiles_invalid');
  });
  it.each([{ platform: 'darwin', arch: 'x64' }, linux, { platform: 'win32', arch: 'arm64' }])('rejects explicit MLX before collection I/O on %j', async (platform) => {
    await expect(selectLlmProfile(config, { backend: 'mlx', model: '2b', profilesPath: '/missing' }, platform)).rejects.toThrow('unsupported_platform');
  });
  it.each([{ platform: 'win32', arch: 'x64' }, { platform: 'linux', arch: 'ia32' }])('rejects unsupported Ollama platforms %j', async (platform) => {
    await save(catalog([ollama()]));
    await expect(selectLlmProfile(config, undefined, platform)).rejects.toThrow('unsupported_platform');
  });
  it('rejects saved MLX on Intel before checking missing runtime files', async () => {
    await save(catalog([mlx()]));
    await expect(selectLlmProfile(config, undefined, { platform: 'darwin', arch: 'x64' })).rejects.toThrow('unsupported_platform');
  });
  it('rejects selected real runtime concurrency 2 even when the base config was scripted', async () => {
    config.npc.maxConcurrent = 2;
    await save(catalog([ollama()]));
    await expect(selectLlmProfile(config, undefined, linux)).rejects.toThrow('llm_profile_concurrency_invalid');
  });
  it.each(['python', 'executable', 'modelsDir', 'tokenizerDir', 'tokenizerManifest'])('rejects missing/wrong-type Ollama resource %s safely', async (key) => {
    const entry = ollama();
    await prepare(entry);
    await save(catalog([entry]));
    const path = entry.options[key] as string;
    await rm(path, { recursive: true, force: true });
    await expect(selectLlmProfile(config, undefined, linux)).rejects.toThrow(/^llm_profile_unprepared$/);
    if (key.endsWith('Dir')) await writeFile(path, 'not directory');
    else await mkdir(path);
    await expect(selectLlmProfile(config, undefined, linux)).rejects.toThrow(/^llm_profile_unprepared$/);
  });
  it.each(['python', 'modelDir', 'modelManifest'])('rejects unavailable MLX resource %s safely', async (key) => {
    const entry = mlx();
    await prepare(entry);
    await save(catalog([entry]));
    await rm(entry.options[key] as string, { recursive: true, force: true });
    await expect(selectLlmProfile(config, undefined, mac)).rejects.toThrow('llm_profile_unprepared');
  });
  it('accepts venv-style interpreter and executable symlinks to prepared regular files', async () => {
    const entry = ollama();
    await prepare(entry);
    const runtime = join(root, 'runtime-targets');
    await mkdir(runtime);
    for (const key of ['python', 'executable'] as const) {
      const target = join(runtime, key);
      await writeFile(target, 'dummy runtime; never executed\n', { mode: 0o700 });
      const path = entry.options[key] as string;
      await rm(path);
      await symlink(target, path);
    }
    await expect(validatePreparedLlmProfile(entry)).resolves.toBeUndefined();
    await save(catalog([entry]));
    expect((await selectLlmProfile(config, undefined, linux)).profile).toEqual({ backend: 'ollama', model: '2b' });
  });
  it('requires readable resources and executable interpreter files without running them', async () => {
    const entry = ollama();
    await prepare(entry);
    await save(catalog([entry]));
    await chmod(entry.options.python as string, 0o600);
    await expect(selectLlmProfile(config, undefined, linux)).rejects.toThrow('llm_profile_unprepared');
    await chmod(entry.options.python as string, 0o700);
    await chmod(join(entry.options.tokenizerDir as string, 'tokenizer.json'), 0);
    await expect(selectLlmProfile(config, undefined, linux)).rejects.toThrow('llm_profile_unprepared');
  });
  it.each(['', '{}', '{"../outside":"' + digest + '"}', '{"tokenizer.json":"bad digest"}', '[]'])('rejects empty/invalid tokenizer inventory %#', async (manifest) => {
    const entry = ollama();
    await prepare(entry);
    await save(catalog([entry]));
    await writeFile(entry.options.tokenizerManifest as string, manifest);
    await expect(selectLlmProfile(config, undefined, linux)).rejects.toThrow('llm_profile_unprepared');
  });
  it('rejects missing and empty inventoried tokenizer files', async () => {
    const entry = ollama();
    await prepare(entry);
    await save(catalog([entry]));
    const tokenizer = join(entry.options.tokenizerDir as string, 'tokenizer.json');
    await rm(tokenizer);
    await expect(selectLlmProfile(config, undefined, linux)).rejects.toThrow('llm_profile_unprepared');
    await writeFile(tokenizer, '');
    await expect(selectLlmProfile(config, undefined, linux)).rejects.toThrow('llm_profile_unprepared');
  });
  it('rejects catalog symlinks, directories, unreadable, oversized and non-UTF8 files', async () => {
    await mkdir(join(home, 'kuda-llm'), { recursive: true });
    const source = join(root, 'source.json');
    await writeFile(source, JSON.stringify(catalog()));
    await symlink(source, defaultProfilesPath);
    await expect(selectLlmProfile(config, undefined, linux)).rejects.toThrow('llm_profiles_unavailable');
    await rm(defaultProfilesPath);
    await mkdir(defaultProfilesPath);
    await expect(selectLlmProfile(config, undefined, linux)).rejects.toThrow('llm_profiles_unavailable');
    await rm(defaultProfilesPath, { recursive: true });
    await writeFile(defaultProfilesPath, 'x', { mode: 0 });
    await expect(selectLlmProfile(config, undefined, linux)).rejects.toThrow('llm_profiles_unavailable');
    await chmod(defaultProfilesPath, constants.S_IRUSR | constants.S_IWUSR);
    await writeFile(defaultProfilesPath, Buffer.alloc(65537, 32));
    await expect(selectLlmProfile(config, undefined, linux)).rejects.toThrow('llm_profiles_unavailable');
    await writeFile(defaultProfilesPath, Buffer.from([0xff]));
    await expect(selectLlmProfile(config, undefined, linux)).rejects.toThrow('llm_profiles_invalid');
  });
  it('requires the selected Ollama tag, not merely another prepared model in the store', async () => {
    const entry = ollama();
    await prepare(entry);
    const store = entry.options.modelsDir as string;
    const directory = join(store, 'manifests', 'registry.ollama.ai', 'library', 'qwen3.5');
    await rm(join(directory, '2b-q4_K_M'));
    await writeFile(join(directory, '0.8b-q8_0'), '{"schemaVersion":2}');
    await save(catalog([entry]));
    await expect(selectLlmProfile(config, undefined, linux)).rejects.toThrow('llm_profile_unprepared');
  });
  it('accepts a canonical v2 link to a regular same-store blob without hashing weights', async () => {
    const entry = ollama();
    await prepare(entry);
    const store = entry.options.modelsDir as string;
    const canonical = join(store, 'manifests-v2', 'ollama.com', 'library', 'qwen3.5', '2b-q4_K_M');
    const blob = join(store, 'blobs', 'sha256-' + digest);
    await mkdir(dirname(canonical), { recursive: true });
    await mkdir(dirname(blob));
    await writeFile(blob, '{"schemaVersion":2}');
    await symlink('../../../../blobs/sha256-' + digest, canonical);
    await rm(join(store, 'manifests'), { recursive: true });
    await expect(validatePreparedLlmProfile(entry)).resolves.toBeUndefined();
    await save(catalog([entry]));
    expect((await selectLlmProfile(config, undefined, linux)).profile?.model).toBe('2b');
  });
  it.each(['dangling', 'outside', 'invalid', 'oversized', 'directory'])('does not fall back to valid legacy metadata from %s canonical v2 state', async (state) => {
    const entry = ollama();
    await prepare(entry);
    const store = entry.options.modelsDir as string;
    const canonical = join(store, 'manifests-v2', 'ollama.com', 'library', 'qwen3.5', '2b-q4_K_M');
    await mkdir(dirname(canonical), { recursive: true });
    if (state === 'directory') await mkdir(canonical);
    else if (state === 'invalid') await writeFile(canonical, 'bad JSON');
    else if (state === 'oversized') await writeFile(canonical, ' '.repeat(65537));
    else {
      const target = join(root, state === 'dangling' ? 'missing' : 'outside.json');
      if (state === 'outside') await writeFile(target, '{"schemaVersion":2}');
      await symlink(target, canonical);
    }
    await save(catalog([entry]));
    await expect(selectLlmProfile(config, undefined, linux)).rejects.toThrow('llm_profile_unprepared');
  });
  it('validates static resources without a platform guard or runtime start', async () => {
    const entry = mlx();
    await prepare(entry);
    await expect(validatePreparedLlmProfile(entry)).resolves.toBeUndefined();
  });
  it('accepts exactly 64 KiB and does not hash dummy tokenizer data against the pin', async () => {
    const entry = ollama();
    await prepare(entry);
    const json = JSON.stringify(catalog([entry]));
    await save(catalog([entry]));
    await writeFile(defaultProfilesPath, json + ' '.repeat(65536 - Buffer.byteLength(json)));
    expect((await selectLlmProfile(config, undefined, linux)).profile).toEqual({ backend: 'ollama', model: '2b' });
  });
});
