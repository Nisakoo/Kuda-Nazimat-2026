import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

// Execute only the guide's config/catalog creation bodies. No installation, tokenizer
// download, runtime startup, diagnostic CLI, model library or inference is permitted.
const exec = promisify(execFile);
const server = fileURLToPath(new URL('..', import.meta.url));
const guide = await readFile(join(server, 'llm/SETUP.md'), 'utf8');
const pythonBodies = [...guide.matchAll(/<<'PY'\n([\s\S]*?)\nPY(?:\n|$)/g)].map(match => match[1]!);
function pythonBody(marker: string): string {
  const found = pythonBodies.filter(body => body.includes(marker));
  if (found.length !== 1) throw new Error(`Expected one setup body for ${marker}`);
  return found[0]!;
}
const ollamaBody = pythonBody('from ollama_worker import verify_ollama_model');
const mlxBody = pythonBody('from mlx_worker import Runtime');
const catalogBodies = [...guide.matchAll(/<<'JS'\n([\s\S]*?)\nJS(?:\n|$)/g)];
if (catalogBodies.length !== 1) throw new Error('Expected one create-only catalog body');
const catalogBody = catalogBodies[0]![1]!;
const python = process.env.KUDA_TEST_PYTHON ?? 'python3';
const pythonAvailable = spawnSync(python, ['-B', '-c', 'import ast, sys; assert sys.version_info >= (3, 12)'], { timeout: 5000 }).status === 0;
const roots: string[] = [];
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type Model = '2b' | '0.8b';
type Layout = 'legacy' | 'canonical' | 'relative-link';
interface Fixture {
  root: string; home: string; base: string; config: string; manifest: string;
  tokenizer: string; inventory: string; executable: string; modelBlob: string;
  digest: string; model: Model; tag: string;
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function json(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
}
async function fixture(model: Model = '2b', layout: Layout = 'relative-link'): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'llm-setup-guide-')); roots.push(root);
  const home = join(root, 'home'), base = join(home, 'kuda-llm');
  const fixtureServer = join(root, 'server');
  await mkdir(join(fixtureServer, 'llm'), { recursive: true });
  for (const name of ['local_common.py', 'ollama_worker.py', 'mlx_worker.py']) {
    await copyFile(join(server, 'llm', name), join(fixtureServer, 'llm', name));
  }
  for (const name of ['config.ollama.example.json', 'config.mlx.example.json']) {
    await copyFile(join(server, name), join(fixtureServer, name));
  }
  // The JS body imports real parsers through a symlink, but writes only in this fixture.
  await symlink(join(server, 'src'), join(fixtureServer, 'src'), 'dir');
  await mkdir(join(base, 'venv/bin'), { recursive: true });
  const executable = join(base, 'ollama');
  for (const path of [executable, join(base, 'venv/bin/python3')]) {
    // These placeholders are never executed. If invoked by mistake, they cannot run a model.
    await writeFile(path, 'NOT AN EXECUTABLE RUNTIME\n', { mode: 0o700 });
  }
  await json(join(base, 'ollama-version.json'), { version: '0.40.13' });
  const tokenizer = join(base, model === '2b' ? 'tokenizer' : 'tokenizer-qwen35-08b');
  const inventory = join(base, model === '2b' ? 'tokenizer-sha256.json' : 'tokenizer-qwen35-08b-sha256.json');
  await mkdir(tokenizer);
  const tokenizerBytes = `fixture tokenizer ${model}; not a loadable tokenizer`;
  await writeFile(join(tokenizer, 'tokenizer.json'), tokenizerBytes);
  await json(inventory, { 'tokenizer.json': sha(tokenizerBytes) });
  const models = join(base, 'models'), blobs = join(models, 'blobs');
  await mkdir(blobs, { recursive: true });
  const blob = async (bytes: string, mediaType: string) => {
    const digest = sha(bytes);
    await writeFile(join(blobs, `sha256-${digest}`), bytes);
    return { mediaType, digest: `sha256:${digest}`, size: Buffer.byteLength(bytes) };
  };
  const configEntry = await blob('{}', 'application/vnd.docker.container.image.v1+json');
  const modelEntry = await blob(`tiny inert fixture ${model}`, 'application/vnd.ollama.image.model');
  const data = JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.docker.distribution.manifest.v2+json', config: configEntry, layers: [modelEntry] });
  const digest = sha(data), tag = model === '2b' ? '2b-q4_K_M' : '0.8b-q8_0';
  const manifest = join(models, layout === 'legacy' ? 'manifests/registry.ollama.ai/library/qwen3.5' : 'manifests-v2/ollama.com/library/qwen3.5', tag);
  await mkdir(dirname(manifest), { recursive: true });
  if (layout === 'relative-link') {
    const target = join(blobs, `sha256-${digest}`);
    await writeFile(target, data);
    await symlink(relative(dirname(manifest), target), manifest);
  } else await writeFile(manifest, data);
  return { root, home, base, config: join(fixtureServer, 'config.json'), manifest, tokenizer, inventory, executable,
    modelBlob: join(blobs, modelEntry.digest.replace(':', '-')), digest, model, tag };
}
function env(f: Fixture): NodeJS.ProcessEnv {
  return { ...process.env, HOME: f.home, KUDA_MODEL: f.model, KUDA_OLLAMA_EXE: f.executable,
    PYTHONDONTWRITEBYTECODE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' };
}
async function runPython(f: Fixture, body = ollamaBody) {
  return exec(python, ['-B', '-c', body], { cwd: f.root, env: env(f), timeout: 5000 });
}
async function catalog(f: Fixture) {
  return exec(process.execPath, ['--input-type=module', '--eval', catalogBody], { cwd: f.root, env: env(f), timeout: 5000 });
}

it('keeps map routing, runtime boundaries, and legacy migration warnings explicit', () => {
  expect(ollamaBody).toContain("defaultMap='demo'");
  expect(mlxBody).toContain("defaultMap='demo'");
  expect(guide).toContain('"adapter": "local"');
  expect(guide).toContain('ту же модель и очередь');
  expect(guide).toContain('Лее или Марку');
  expect(guide).toContain('изменить только поле «Карта» на `demo`');
  expect(guide).toContain('не требует правки существующего config');
  expect(guide).toContain('не универсальный установщик');
  expect(guide).toContain('500 мс');
  expect(guide).toContain('UNVERIFIED');
  expect(guide).toContain('[UPDATING.md](UPDATING.md)');
  expect(guide).toContain('make server ENV=development');
  expect(guide).not.toContain('APP_ENV=development HOST=127.0.0.1 make');
  expect(guide).toContain('npc.streamTimeoutMs');
  expect(guide).toContain('**непотоковый** NPC-запрос');
});
it('the catalog body has no runtime execution or installation command', () => {
  expect(catalogBody).not.toMatch(/child_process|\bspawn\b|\bexecFile\b|\bfetch\s*\(|https?:\/\//);
  expect(catalogBody).toContain("flag: 'wx'");
});

describe.skipIf(!pythonAvailable)('setup guide config/catalog bodies with inert local fixtures', () => {
  it.each<[{ model: Model; layout: Layout }]>([
    [{ model: '2b', layout: 'legacy' }], [{ model: '2b', layout: 'canonical' }],
    [{ model: '2b', layout: 'relative-link' }], [{ model: '0.8b', layout: 'relative-link' }],
  ])('creates full demo config and one catalog without modifying pins: %j', async ({ model, layout }) => {
    const f = await fixture(model, layout);
    const manifestBefore = await readFile(f.manifest), inventoryBefore = await readFile(f.inventory);
    await runPython(f);
    const raw = await readFile(f.config, 'utf8'), config = JSON.parse(raw);
    expect(config).toMatchObject({ host: '127.0.0.1', port: 8080, defaultMap: 'demo', npc: {
      adapter: 'ollama', maxConcurrent: 1, maxUnfinished: 4, timeoutMs: 30000,
      options: { model: `qwen3.5:${f.tag}`, modelDigest: f.digest, runnerVersion: '0.40.13',
        tokenizerDir: f.tokenizer, tokenizerManifest: f.inventory, executable: f.executable,
        port: 11501, threads: 2, numGpu: 0, startupTimeoutMs: 120000 },
    } });
    expect(raw).not.toContain('REPLACE_');
    expect((await stat(f.config)).mode & 0o777).toBe(0o600);
    await catalog(f);
    const path = join(f.base, 'profiles.json'), saved = await readFile(path, 'utf8');
    expect(JSON.parse(saved)).toMatchObject({ version: 1, selected: { backend: 'ollama', model },
      profiles: [{ backend: 'ollama', model, options: config.npc.options }] });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(catalog(f)).rejects.toThrow();
    await expect(runPython(f)).rejects.toThrow('existing config/catalog');
    expect(await readFile(path, 'utf8')).toBe(saved);
    expect(await readFile(f.config, 'utf8')).toBe(raw);
    expect(await readFile(f.manifest)).toEqual(manifestBefore);
    expect(await readFile(f.inventory)).toEqual(inventoryBefore);
  });

  it.each(['regular', 'symlink', 'catalog'] as const)('refuses existing %s without replacing anything', async kind => {
    const f = await fixture();
    const path = kind === 'catalog' ? join(f.base, 'profiles.json') : kind === 'symlink' ? join(f.root, 'outside-config') : f.config;
    await writeFile(path, 'original bytes');
    if (kind === 'symlink') await symlink(path, f.config);
    await expect(runPython(f)).rejects.toThrow('existing config/catalog');
    expect(await readFile(path, 'utf8')).toBe('original bytes');
    if (kind === 'catalog') await expect(stat(f.config)).rejects.toThrow();
  });

  it.each(['model', 'tokenizer', 'version', 'alias'] as const)('rejects invalid prepared %s before config publication', async kind => {
    const f = await fixture();
    if (kind === 'model') await writeFile(f.modelBlob, 'corrupt');
    if (kind === 'tokenizer') await writeFile(join(f.tokenizer, 'tokenizer.json'), 'corrupt');
    if (kind === 'version') await json(join(f.base, 'ollama-version.json'), { version: 'latest' });
    if (kind === 'alias') f.model = 'latest' as Model;
    await expect(runPython(f)).rejects.toThrow();
    await expect(stat(f.config)).rejects.toThrow();
  });

  it.each(['outside', 'dangling'] as const)('rejects %s canonical links rather than selecting a valid legacy manifest', async kind => {
    const f = await fixture();
    const legacy = join(f.base, 'models/manifests/registry.ollama.ai/library/qwen3.5', f.tag);
    await mkdir(dirname(legacy), { recursive: true }); await writeFile(legacy, await readFile(f.manifest));
    await rm(f.manifest);
    const target = join(f.root, 'outside-manifest');
    if (kind === 'outside') await writeFile(target, await readFile(legacy));
    await symlink(relative(dirname(f.manifest), target), f.manifest);
    await expect(runPython(f)).rejects.toThrow();
    await expect(stat(f.config)).rejects.toThrow();
  });

  it('parses every Python body without executing installation/download/template sections', async () => {
    const source = `import ast, json\nfor body in json.loads(${JSON.stringify(JSON.stringify(pythonBodies))}):\n    ast.parse(body)\n`;
    const f = await fixture();
    await exec(python, ['-B', '-c', source], { cwd: f.root, env: env(f), timeout: 5000 });
  });

  it('creates MLX config/catalog from structural-only dummy tensors and refuses overwrite', async () => {
    const f = await fixture();
    const modelDir = join(f.base, 'mlx-text-fixture');
    await mkdir(modelDir); await mkdir(join(f.base, 'mlx-venv/bin'), { recursive: true });
    await writeFile(join(f.base, 'mlx-venv/bin/python3'), 'NOT AN EXECUTABLE RUNTIME\n', { mode: 0o700 });
    // Distribution metadata only; no mlx or mlx_lm module is installed or imported.
    const dist = join(f.root, 'server/llm/mlx_lm-0.32.2.dist-info');
    await mkdir(dist); await writeFile(join(dist, 'METADATA'), 'Name: mlx-lm\nVersion: 0.32.2\n');
    const configBytes = JSON.stringify({ model_type: 'qwen3_5', quantization: { bits: 4, group_size: 64 } });
    const header = Buffer.from(JSON.stringify({ 'text.weight': { dtype: 'F32', shape: [0], data_offsets: [0, 0] } }));
    const length = Buffer.alloc(8); length.writeBigUInt64LE(BigInt(header.length));
    const weights = Buffer.concat([length, header]);
    await writeFile(join(modelDir, 'config.json'), configBytes);
    await writeFile(join(modelDir, 'model.safetensors'), weights);
    await json(join(f.base, 'model-sha256.json'), { 'config.json': sha(configBytes), 'model.safetensors': sha(weights) });
    await exec(python, ['-B', '-c', mlxBody], { cwd: f.root, env: { ...env(f), KUDA_MLX_MODEL_DIR: modelDir }, timeout: 5000 });
    const raw = await readFile(f.config, 'utf8');
    expect(JSON.parse(raw)).toMatchObject({ defaultMap: 'demo', npc: { adapter: 'mlx', options: {
      modelDir, modelManifest: join(f.base, 'model-sha256.json'), runnerVersion: '0.32.2',
    } } });
    await catalog(f);
    expect(JSON.parse(await readFile(join(f.base, 'profiles.json'), 'utf8')).selected).toEqual({ backend: 'mlx', model: '2b' });
    await expect(exec(python, ['-B', '-c', mlxBody], { cwd: f.root, env: { ...env(f), KUDA_MLX_MODEL_DIR: modelDir }, timeout: 5000 })).rejects.toThrow('existing config/catalog');
    expect(await readFile(f.config, 'utf8')).toBe(raw);
  });
});
