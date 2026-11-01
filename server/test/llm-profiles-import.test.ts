import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { importLlmProfiles } from '../src/cli/importLlmProfiles.ts';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture(timeout = 8000) {
  const home = await mkdtemp(join(tmpdir(), 'profiles-import-')); dirs.push(home);
  const work = join(home, 'kuda-llm'); await mkdir(work);
  const python = join(home, 'python'); const executable = join(home, 'ollama');
  const modelsDir = join(home, 'models'); const tokenizerDir = join(home, 'tokenizer');
  const tokenizerManifest = join(home, 'tokenizer.json');
  await Promise.all([writeFile(python, 'dummy', { mode: 0o700 }), writeFile(executable, 'dummy', { mode: 0o700 }), mkdir(modelsDir), mkdir(tokenizerDir)]);
  const inventory = Object.fromEntries(['tokenizer.json', 'tokenizer_config.json', 'vocab.json', 'merges.txt', 'special_tokens_map.json', 'config.json'].map((name) => [name, 'a'.repeat(64)]));
  await Promise.all(Object.keys(inventory).map((name) => writeFile(join(tokenizerDir, name), 'dummy metadata')));
  await writeFile(tokenizerManifest, JSON.stringify(inventory));
  const tags = join(modelsDir, 'manifests-v2', 'ollama.com', 'library', 'qwen3.5');
  const blobs = join(modelsDir, 'blobs');
  await mkdir(tags, { recursive: true }); await mkdir(blobs);
  for (const [tag, hash] of [['2b-q4_K_M', 'b'], ['0.8b-q8_0', 'a']] as const) {
    const blob = join(blobs, `sha256-${hash.repeat(64)}`);
    await writeFile(blob, JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.docker.distribution.manifest.v2+json', config: {}, layers: [] }));
    await symlink(blob, join(tags, tag));
  }
  const options = { python, executable, modelsDir, tokenizerDir, tokenizerManifest, runnerVersion: '0.1.2', model: 'qwen3.5:0.8b-q8_0', modelDigest: 'sha256:' + 'a'.repeat(64), port: 11501 };
  const configPath = join(home, 'config.json'); const backup2bPath = join(work, 'config-before-08b.json');
  const profilesPath = join(work, 'profiles.json'); const migrationBackup = join(work, 'config-before-profiles.json');
  const active = { host: '127.0.0.1', npc: { adapter: 'ollama', timeoutMs: timeout, maxUnfinished: 3, options } };
  const backup = { npc: { adapter: 'ollama', timeoutMs: 8000, options: { ...options, model: 'qwen3.5:2b-q4_K_M', modelDigest: 'sha256:' + 'b'.repeat(64) } } };
  const original = JSON.stringify(active); await writeFile(configPath, original); await writeFile(backup2bPath, JSON.stringify(backup));
  return { home, work, configPath, backup2bPath, profilesPath, migrationBackup, active, backup, original };
}
const args = (f: Awaited<ReturnType<typeof fixture>>) => ({ home: f.home, configPath: f.configPath, backup2bPath: f.backup2bPath, profilesPath: f.profilesPath });

describe('one-time profile import (static fixtures only)', () => {
  it('has no import-time handlers and rejects invalid CLI arguments without revealing values', () => {
    const script = fileURLToPath(new URL('../src/cli/importLlmProfiles.ts', import.meta.url));
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `const n=['SIGINT','SIGTERM','SIGHUP'].map(s=>process.listenerCount(s)); await import(${JSON.stringify(script)}); console.log(['SIGINT','SIGTERM','SIGHUP'].map((s,i)=>process.listenerCount(s)-n[i]).join(','));`], { encoding: 'utf8' });
    expect(output).toBe('0,0,0\n');
    for (const args of [['--bad', 'secret-value'], ['--config', 'secret-value', '--config', 'other']]) {
      const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).not.toContain('secret-value');
    }
  });
  it('preserves both option bundles, selects 2b, and changes only timeout', async () => {
    const f = await fixture();
    expect(await importLlmProfiles(args(f))).toEqual({ profilesPath: f.profilesPath, profiles: 2, timeoutMs: 30000 });
    const catalog = JSON.parse(await readFile(f.profilesPath, 'utf8'));
    expect(catalog.selected).toEqual({ backend: 'ollama', model: '2b' });
    expect(catalog.profiles).toEqual(expect.arrayContaining([
      { backend: 'ollama', model: '0.8b', options: f.active.npc.options },
      { backend: 'ollama', model: '2b', options: f.backup.npc.options },
    ]));
    expect(JSON.parse(await readFile(f.configPath, 'utf8'))).toEqual({ ...f.active, npc: { ...f.active.npc, timeoutMs: 30000 } });
    expect(await readFile(f.migrationBackup, 'utf8')).toBe(f.original);
    expect((await stat(f.profilesPath)).mode & 0o777).toBe(0o600);
    expect((await stat(f.migrationBackup)).mode & 0o777).toBe(0o600);
    await expect(importLlmProfiles(args(f))).rejects.toThrow();
  });
  it('uses the environment destination only for CLI and gives --profiles precedence', async () => {
    const f = await fixture(30000);
    const envPath = join(f.work, 'env.json');
    const explicitPath = join(f.work, 'explicit.json');
    const script = fileURLToPath(new URL('../src/cli/importLlmProfiles.ts', import.meta.url));
    const env = { ...process.env, HOME: f.home, KUDA_LLM_PROFILES: envPath };
    const run = spawnSync(process.execPath, [script, '--config', f.configPath, '--backup-2b', f.backup2bPath, '--profiles', explicitPath], { encoding: 'utf8', env });
    expect(run.status).toBe(0);
    await stat(explicitPath);
    await expect(stat(envPath)).rejects.toThrow();
    const second = spawnSync(process.execPath, [script, '--config', f.configPath, '--backup-2b', f.backup2bPath], { encoding: 'utf8', env });
    expect(second.status).toBe(0);
    await stat(envPath);
  });
  it('leaves already-30-second base bytes unchanged', async () => {
    const f = await fixture(30000); await importLlmProfiles(args(f));
    expect(await readFile(f.configPath, 'utf8')).toBe(f.original);
    await expect(stat(f.migrationBackup)).rejects.toThrow();
  });
  it('accepts the active 2b source when the backup is absent', async () => {
    const f = await fixture(30000); await writeFile(f.configPath, JSON.stringify(f.backup)); await rm(f.backup2bPath);
    expect((await importLlmProfiles(args(f))).profiles).toBe(1);
  });
  it.each(['destination', 'collision', 'missing-2b', 'digest', 'path', 'symlink', 'timeout'])('fails before base changes: %s', async (kind) => {
    const f = await fixture();
    if (kind === 'destination') await writeFile(f.profilesPath, 'keep');
    if (kind === 'collision') await writeFile(f.migrationBackup, 'keep');
    if (kind === 'missing-2b') await rm(f.backup2bPath);
    if (kind === 'digest') { f.backup.npc.options.modelDigest = 'bad'; await writeFile(f.backup2bPath, JSON.stringify(f.backup)); }
    if (kind === 'path') { f.backup.npc.options.executable = join(f.home, 'missing'); await writeFile(f.backup2bPath, JSON.stringify(f.backup)); }
    if (kind === 'symlink') { await rm(f.backup2bPath); await symlink(f.configPath, f.backup2bPath); }
    if (kind === 'timeout') { f.active.npc.timeoutMs = 9000; await writeFile(f.configPath, JSON.stringify(f.active)); }
    const before = await readFile(f.configPath, 'utf8');
    await expect(importLlmProfiles(args(f))).rejects.toThrow();
    expect(await readFile(f.configPath, 'utf8')).toBe(before);
    if (kind === 'destination') expect(await readFile(f.profilesPath, 'utf8')).toBe('keep');
    if (kind === 'collision') expect(await readFile(f.migrationBackup, 'utf8')).toBe('keep');
    if (!['destination', 'collision'].includes(kind)) await expect(stat(f.migrationBackup)).rejects.toThrow();
  });
  it('reports existing profiles and unprepared artifacts as distinct fixed CLI messages', async () => {
    const f = await fixture(30000);
    const script = fileURLToPath(new URL('../src/cli/importLlmProfiles.ts', import.meta.url));
    const argv = [script, '--config', f.configPath, '--backup-2b', f.backup2bPath, '--profiles', f.profilesPath];
    await writeFile(f.profilesPath, 'keep');
    let run = spawnSync(process.execPath, argv, { encoding: 'utf8' });
    expect(run.stderr).toContain('profiles already exist');
    expect(run.stderr).not.toContain(f.home);
    await rm(f.profilesPath);
    await rm(f.active.npc.options.tokenizerManifest);
    run = spawnSync(process.execPath, argv, { encoding: 'utf8' });
    expect(run.stderr).toContain('artifact');
    expect(run.stderr).not.toContain(f.home);
  });
  it('rejects an empty tokenizer inventory before any write', async () => {
    const f = await fixture();
    await writeFile(f.active.npc.options.tokenizerManifest, '{}');
    await expect(importLlmProfiles(args(f))).rejects.toThrow();
    await expect(stat(f.migrationBackup)).rejects.toThrow();
    await expect(stat(f.profilesPath)).rejects.toThrow();
  });
  it.each(['configPath', 'backup2bPath'] as const)('rejects invalid UTF-8 in %s before any write', async (key) => {
    const f = await fixture();
    await writeFile(f[key], Buffer.concat([Buffer.from('{"host":"'), Buffer.from([0xff]), Buffer.from('"}')]));
    await expect(importLlmProfiles(args(f))).rejects.toThrow();
    await expect(stat(f.migrationBackup)).rejects.toThrow();
    await expect(stat(f.profilesPath)).rejects.toThrow();
  });
  it('creates a private new catalog directory', async () => {
    const f = await fixture(30000); const dir = join(f.home, 'new');
    await importLlmProfiles({ ...args(f), profilesPath: join(dir, 'profiles.json') });
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });
});
