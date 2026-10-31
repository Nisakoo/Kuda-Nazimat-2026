import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fixtures from '../../shared/protocol/fixtures.json';
import { parseClientMessage, parseServerMessage } from '../../shared/protocol/validate.ts';
import { isWalkable } from '../../shared/map/walkability.ts';

it.each(fixtures)('shared fixture $direction valid=$valid', (fixture) => {
  const parse = fixture.direction === 'client' ? parseClientMessage : parseServerMessage;
  if (fixture.valid) expect(parse(fixture.packet)).toEqual(fixture.packet);
  else expect(() => parse(fixture.packet)).toThrowError(expect.objectContaining({ code: fixture.code ?? 'INVALID' }));
});
it('shared movement probes block missing tiles, obstacles and map edges', () => {
  const manifest = { origin: { x: 0, z: 0 }, chunkSize: 4, collisionResolution: 4 };
  const data = new Uint8Array(16); data[5] = 1;
  const collision = ({ x, z }: { x: number; z: number }) => x === 0 && z === 0 ? data : undefined;
  expect(isWalkable(manifest, collision, 2.5, 2.5)).toBe(true);
  expect(isWalkable(manifest, collision, 1.5, 1.5)).toBe(false);
  expect(isWalkable(manifest, collision, 0, 1)).toBe(false);
  expect(isWalkable(manifest, collision, 4, 1)).toBe(false);
});
it('import rules reject a forbidden IO dependency in the domain', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'import-rules-'));
  const server = fileURLToPath(new URL('..', import.meta.url));
  try {
    mkdirSync(join(cwd, 'src/game'), { recursive: true });
    writeFileSync(join(cwd, 'src/game/World.ts'), "import { readFileSync } from 'node:fs'; export const read = readFileSync;");
    writeFileSync(join(cwd, 'rules.cjs'), `const config = require(${JSON.stringify(`${server}/.dependency-cruiser.cjs`)}); config.options.tsConfig.fileName = ${JSON.stringify(`${server}/tsconfig.json`)}; module.exports = config;`);
    let output: string;
    try {
      output = execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/dependency-cruiser/bin/dependency-cruise.mjs', import.meta.url)), '--config', 'rules.cjs', '--output-type', 'json', 'src'], { cwd, encoding: 'utf8', stdio: 'pipe' });
    } catch (error) { output = String((error as { stdout?: string }).stdout); }
    const graph = JSON.parse(output) as { summary: { error: number; violations: { rule: { name: string } }[] } };
    expect(graph.summary.error).toBeGreaterThan(0);
    expect(graph.summary.violations.some((v) => v.rule.name === 'domain-is-pure-node')).toBe(true);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
