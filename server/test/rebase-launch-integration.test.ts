import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { loadLaunchConfig, launchArguments } from '../src/app/launch.ts';
import { parseConfig } from '../src/app/config.ts';

const home = vi.hoisted(() => `/tmp/rebase-no-profiles-${process.pid}-${Math.random().toString(16).slice(2)}`);
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => home }));
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

it('launch combines main environment/network precedence and NPC overrides without rewriting a file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rebase-launch-')); dirs.push(dir);
  const file = join(dir, 'config.json');
  const bytes = JSON.stringify({ host: '127.0.0.1', port: 7000, npc: { timeoutMs: 15000, streamTimeoutMs: 45000 } });
  await writeFile(file, bytes);
  const base = await loadLaunchConfig(['--config', file], { APP_ENV: 'production', HOST: '0.0.0.0', PORT: '7100' });
  expect(base.config).toMatchObject({ env: 'production', host: '0.0.0.0', port: 7100, auth: { passwordless: false }, npc: { timeoutMs: 15000, streamTimeoutMs: 45000 } });
  const changed = await loadLaunchConfig(['--config', file, '--env', 'test', '--port', '7200', '--npc-timeout', '300'], { APP_ENV: 'production', PORT: '7100', KUDA_NPC_TIMEOUT: '60' });
  expect(changed.config).toMatchObject({ env: 'test', port: 7200, auth: { passwordless: true }, npc: { timeoutMs: 300000, streamTimeoutMs: 300000 } });
  expect(await readFile(file, 'utf8')).toBe(bytes);
  const fromMake = await loadLaunchConfig(['--config', file], { KUDA_NPC_TIMEOUT: '60' });
  expect(fromMake.config.npc).toMatchObject({ timeoutMs: 60000, streamTimeoutMs: 60000 });
});

it('launch preserves profile flags with main flags, rejects duplicate/unknown flags and incomplete pairs', () => {
  expect(launchArguments(['--env', 'production', '--port', '9000', '--backend', 'ollama', '--model', '0.8b', '--npc-timeout', '60'], {}))
    .toMatchObject({ env: 'production', serverArgs: ['--env', 'production', '--port', '9000'], selection: { backend: 'ollama', model: '0.8b' }, npcTimeoutMs: 60000 });
  expect(() => launchArguments(['--env', 'production', '--env', 'test'], {})).toThrow();
  expect(() => launchArguments(['--port', '9000', '--backend', 'ollama'], { KUDA_LLM_MODEL: '2b' })).toThrow('вместе');
  expect(() => launchArguments(['--env', 'production', '--unknown', 'x'], {})).toThrow();
  expect(() => launchArguments([], { APP_ENV: 'staging' })).toThrow();
});

it('validates separate legacy stream deadlines and both 300-second ceilings without losing main config sections', () => {
  const path = '/tmp/config.json';
  for (const timeoutMs of [1, 8000, 9000, 10000, 30000, 60000, 300000]) {
    const config = parseConfig({ npc: { timeoutMs, streamTimeoutMs: timeoutMs } }, path);
    expect(config.npc.timeoutMs).toBe(timeoutMs); expect(config.npc.streamTimeoutMs).toBe(timeoutMs);
    expect(config.language).toEqual({ adapter: 'test', options: {} });
  }
  for (const value of [0, -1, 300001, 1.5, NaN, Infinity, '30000', null]) {
    expect(() => parseConfig({ npc: { timeoutMs: value } }, path)).toThrow('npc.timeoutMs');
    expect(() => parseConfig({ npc: { streamTimeoutMs: value } }, path)).toThrow('npc.streamTimeoutMs');
  }
  expect(() => parseConfig({ auth: { passwordless: true } }, path, 'production')).toThrow();
  for (const adapter of ['ollama', 'mlx']) expect(() => parseConfig({ npc: { adapter, maxConcurrent: 2 } }, path)).toThrow('maxConcurrent');
});
