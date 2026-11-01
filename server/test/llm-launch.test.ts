import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { launchArguments, loadLaunchConfig } from '../src/app/launch.ts';
import { defaultConfigPath } from '../src/app/config.ts';

const home = vi.hoisted(() => `/tmp/kuda-launch-home-${process.pid}-${Math.random().toString(16).slice(2)}`);
vi.mock('node:os', async (original) => ({ ...await original<typeof import('node:os')>(), homedir: () => home }));
const run = promisify(execFile);
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

it('keeps legacy config arguments and saved selection when no override exists', () => {
  expect(launchArguments([], {})).toEqual({ configPath: defaultConfigPath, selection: {} });
  expect(launchArguments(['--config', '/tmp/game.json'], {})).toEqual({ configPath: '/tmp/game.json', selection: {} });
  expect(launchArguments([], { KUDA_LLM_BACKEND: '', KUDA_LLM_MODEL: '', KUDA_LLM_PROFILES: '' }).selection).toEqual({});
});
it('selects an explicit pair from CLI or Make environment without mixing partial sources', () => {
  expect(launchArguments([], { KUDA_LLM_BACKEND: 'ollama', KUDA_LLM_MODEL: '2b', KUDA_LLM_PROFILES: '/tmp/profiles.json' }).selection)
    .toEqual({ backend: 'ollama', model: '2b', profilesPath: '/tmp/profiles.json' });
  expect(launchArguments(['--backend', 'mlx', '--model', '2b'], { KUDA_LLM_BACKEND: 'ollama', KUDA_LLM_MODEL: '0.8b' }).selection)
    .toEqual({ backend: 'mlx', model: '2b' });
  expect(() => launchArguments(['--backend', 'mlx'], { KUDA_LLM_MODEL: '2b' })).toThrow('вместе');
  expect(launchArguments(['--profiles', 'local profiles.json'], {}).selection.profilesPath).toBe(resolve('local profiles.json'));
});
it('rejects incomplete, ambiguous and unsupported selections before any runtime', () => {
  for (const args of [['--backend', 'ollama'], ['--model', '2b'], ['--backend', 'mlx', '--model', '0.8b'],
    ['--backend', 'auto', '--model', '2b'], ['--backend', 'ollama', '--model', 'latest'],
    ['--config'], ['--profiles', ''], ['--unknown', 'x'], ['--config', 'a', '--config', 'b'], ['--model=2b']]) {
    expect(() => launchArguments(args, {})).toThrow();
  }
  expect(() => launchArguments([], { KUDA_LLM_MODEL: '2b' })).toThrow();
});

it('reads timeout as whole seconds from Make or CLI and never accepts suffixes or fractions', () => {
  expect(launchArguments([], { KUDA_NPC_TIMEOUT: '60' }).npcTimeoutMs).toBe(60000);
  expect(launchArguments(['--npc-timeout', '120'], { KUDA_NPC_TIMEOUT: '60' }).npcTimeoutMs).toBe(120000);
  expect(launchArguments([], { KUDA_NPC_TIMEOUT: '' }).npcTimeoutMs).toBeUndefined();
  for (const value of ['0', '-1', '1.5', '60s', '1m', '301', 'Infinity', 'NaN', '1e2', '060']) {
    expect(() => launchArguments([], { KUDA_NPC_TIMEOUT: value })).toThrow('NPC_TIMEOUT');
  }
  expect(launchArguments(['--npc-timeout', '300'], {}).npcTimeoutMs).toBe(300000);
});
it('applies the timeout override only in memory and preserves config bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kuda-timeout-launch-')); directories.push(root);
  const configPath = join(root, 'config.json');
  const original = JSON.stringify({ npc: { timeoutMs: 15000 } }); await writeFile(configPath, original);
  expect((await loadLaunchConfig(['--config', configPath, '--npc-timeout', '60'], {})).config.npc.timeoutMs).toBe(60000);
  expect((await loadLaunchConfig(['--config', configPath], {})).config.npc.timeoutMs).toBe(15000);
  expect(await readFile(configPath, 'utf8')).toBe(original);
});

it('the real entrypoint fails before game startup for an explicit missing catalog, without launching a model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kuda-launch-refused-')); directories.push(root);
  const configPath = join(root, 'config.json'); await writeFile(configPath, '{}');
  const missing = join(root, 'missing.json');
  let output = '';
  try {
    await run(process.execPath, [resolve(import.meta.dirname, '../src/app/main.ts'), '--config', configPath,
      '--profiles', missing, '--backend', 'ollama', '--model', '2b']);
    throw new Error('Expected startup refusal');
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string };
    expect(failure.code).toBe(1); output = failure.stdout ?? '';
  }
  expect(output).toContain('Каталог профилей недоступен');
  expect(output).not.toContain('Сервер доступен'); expect(output).not.toContain('NPC готов к вопросам');
  expect(output).not.toContain(missing);
});

it('Make forwards profile values as environment data, and server never installs/builds/downloads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kuda-launch-')); directories.push(root);
  const capture = join(root, 'capture.mjs'); const output = join(root, 'captured.json');
  await writeFile(capture, `import {writeFileSync} from 'node:fs'; writeFileSync(process.env.CAPTURE_OUTPUT,JSON.stringify({args:process.argv.slice(2),backend:process.env.KUDA_LLM_BACKEND,model:process.env.KUDA_LLM_MODEL,profiles:process.env.KUDA_LLM_PROFILES,timeout:process.env.KUDA_NPC_TIMEOUT}));`);
  await run('make', ['server', `NODE=${process.execPath} ${capture}`, 'BACKEND=ollama', 'MODEL=2b', 'LLM_PROFILES=/tmp/local profiles.json', 'NPC_TIMEOUT=60'],
    { cwd: resolve(import.meta.dirname, '../..'), env: { ...process.env, CAPTURE_OUTPUT: output } });
  expect(JSON.parse(await readFile(output, 'utf8'))).toEqual({ args: ['server/src/app/main.ts'], backend: 'ollama', model: '2b', profiles: '/tmp/local profiles.json', timeout: '60' });
  const { stdout } = await run('make', ['-n', 'server', 'BACKEND=ollama', 'MODEL=0.8b'], { cwd: resolve(import.meta.dirname, '../..') });
  expect(stdout).toContain('server/src/app/main.ts');
  expect(stdout).not.toMatch(/npm|install|ollama\s+(?:pull|serve)|run build/);
  const demo = await run('make', ['-n', 'demo', 'BACKEND=ollama', 'MODEL=0.8b'], { cwd: resolve(import.meta.dirname, '../..') });
  expect(demo.stdout).toContain('client run build'); expect(demo.stdout).toContain('server/src/app/main.ts');
});
