import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../llm/prepare.mjs', import.meta.url));
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kuda-uv-')); roots.push(root);
  const bin = join(root, 'bin'), environment = join(root, 'env with spaces;literal');
  await mkdir(bin);
  const log = join(root, 'calls.jsonl');
  await writeFile(join(bin, 'uv'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.UV_FIXTURE_LOG, JSON.stringify({args, env: process.env.UV_PROJECT_ENVIRONMENT})+'\\n');
if (args[0] === process.env.UV_FIXTURE_FAIL) process.exit(7);
if (args[0] === 'venv') {
  fs.mkdirSync(path.join(process.env.UV_PROJECT_ENVIRONMENT, 'bin'));
  fs.writeFileSync(path.join(process.env.UV_PROJECT_ENVIRONMENT, 'bin/python3'), 'fixture only');
}
`, { mode: 0o700 });
  const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, UV_FIXTURE_LOG: log };
  const run = (args: string[] = [], extra: Record<string, string> = {}) => exec(process.execPath,
    [script, 'ollama', '--environment', environment, ...args], { env: { ...env, ...extra } });
  const calls = async () => (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { args: string[]; env: string });
  return { root, environment, env, run, calls, log };
}

describe('uv environment preparation (fake package manager, real filesystem)', () => {
  it('prepares a dedicated environment, handles literal paths and repeats offline without changing operator files', async () => {
    const f = await fixture();
    const config = join(f.root, 'config.json'); await writeFile(config, 'operator bytes');
    await f.run();
    const marker = await readFile(join(f.environment, '.kuda-uv-environment.json'), 'utf8');
    await f.run(['--offline']);
    expect(await readFile(config, 'utf8')).toBe('operator bytes');
    expect(await readFile(join(f.environment, '.kuda-uv-environment.json'), 'utf8')).toBe(marker);
    const calls = await f.calls();
    expect(calls.map(c => c.args[0])).toEqual(['python', 'venv', 'sync', 'python', 'sync']);
    expect(calls.every(c => c.env === f.environment)).toBe(true);
    expect(calls[2]!.args).toEqual(expect.arrayContaining(['--locked', '--no-dev', '--no-python-downloads']));
    expect(calls.slice(3).every(c => c.args.includes('--offline'))).toBe(true);
  });

  it('refuses a legacy environment before invoking uv and preserves its contents', async () => {
    const f = await fixture(); await mkdir(f.environment);
    await writeFile(join(f.environment, 'valuable'), 'legacy');
    await expect(f.run()).rejects.toThrow('Existing environment');
    expect(await readFile(join(f.environment, 'valuable'), 'utf8')).toBe('legacy');
    await expect(readFile(f.log)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses another backend marker and symlink destinations', async () => {
    const f = await fixture(); await mkdir(f.environment);
    await writeFile(join(f.environment, '.kuda-uv-environment.json'), JSON.stringify({ version: 1, backend: 'mlx' }));
    await expect(f.run()).rejects.toThrow('Existing environment');
    const linked = join(f.root, 'linked'); await symlink(f.environment, linked);
    await expect(exec(process.execPath, [script, 'ollama', '--environment', linked], { env: f.env })).rejects.toThrow('Existing environment');
    await expect(readFile(f.log)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports incomplete offline sync without claiming success and supports retry', async () => {
    const f = await fixture();
    await expect(f.run(['--offline'], { UV_FIXTURE_FAIL: 'sync' })).rejects.toThrow('preparation is incomplete');
    expect((await f.calls()).every(c => c.args.includes('--offline'))).toBe(true);
    const { stdout } = await f.run(['--offline']);
    expect(stdout).toContain('Python environment prepared:');
  });

  it('does not create an environment when Python is missing', async () => {
    const f = await fixture();
    await expect(f.run([], { UV_FIXTURE_FAIL: 'python' })).rejects.toThrow('uv failed');
    await expect(readFile(join(f.environment, '.kuda-uv-environment.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects unsupported selection, relative destinations and MLX on Intel without filesystem changes', async () => {
    const f = await fixture();
    for (const args of [['unknown'], ['mlx', '--environment', 'relative'], ['ollama', '--unknown']]) {
      await expect(exec(process.execPath, [script, ...args], { env: f.env })).rejects.toThrow();
    }
    const source = `import {prepareEnvironment} from ${JSON.stringify(new URL('../llm/prepare.mjs', import.meta.url).href)};
await prepareEnvironment({backend:'mlx', environment:${JSON.stringify(f.environment)}, python:'3.12'}, {platform:'darwin', arch:'x64'});`;
    await expect(exec(process.execPath, ['--input-type=module', '-e', source], { env: f.env })).rejects.toThrow('Apple Silicon');
    await expect(readFile(f.log)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
