import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
const exec = promisify(execFile), roots: string[] = [];
const script = fileURLToPath(new URL('../llm/manifest.mjs', import.meta.url));
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'llm-manifest-')); roots.push(root);
  const snapshot = join(root, 'snapshot'); await mkdir(snapshot); return { root, snapshot, manifest: join(root, 'sha256.json') };
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
it('pins prepared files with bounded streaming hashes without loading a model', async () => {
  const { snapshot, manifest } = await fixture();
  await mkdir(join(snapshot, 'nested')); await writeFile(join(snapshot, 'nested/tokenizer.json'), 'fixture');
  await exec(process.execPath, [script, snapshot, manifest]);
  expect(JSON.parse(await readFile(manifest, 'utf8'))).toEqual({ 'nested/tokenizer.json': createHash('sha256').update('fixture').digest('hex') });
});
it('never overwrites an approved manifest', async () => {
  const { snapshot, manifest } = await fixture(); await writeFile(join(snapshot, 'config.json'), '{}'); await writeFile(manifest, 'existing pin');
  await expect(exec(process.execPath, [script, snapshot, manifest])).rejects.toThrow(); expect(await readFile(manifest, 'utf8')).toBe('existing pin');
});
it('rejects empty and symlinked snapshots rather than pinning external files', async () => {
  const { root, snapshot, manifest } = await fixture();
  await expect(exec(process.execPath, [script, snapshot, manifest])).rejects.toThrow('пуст');
  await writeFile(join(root, 'external'), 'outside'); await symlink(join(root, 'external'), join(snapshot, 'link'));
  await expect(exec(process.execPath, [script, snapshot, manifest])).rejects.toThrow('symlink');
});
it('supports an internal manifest without including its own hash', async () => {
  const { snapshot } = await fixture(); await writeFile(join(snapshot, 'tokenizer.json'), '{}'); const path = join(snapshot, 'sha256.json');
  await exec(process.execPath, [script, snapshot, path]); expect(Object.keys(JSON.parse(await readFile(path, 'utf8')))).toEqual(['tokenizer.json']);
});
