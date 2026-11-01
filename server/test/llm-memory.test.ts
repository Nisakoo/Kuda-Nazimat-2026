import { describe, expect, it } from 'vitest';
import type { execFile, ExecFileException } from 'node:child_process';
import { memoryBytesForTest } from '../src/npc/adapters/localLlm.ts';

// Replace only this measurement's command callback, not the global Node module.
function command(stdout: string, error: ExecFileException | null = null, timeout = process.platform === 'darwin' ? 1500 : 500): typeof execFile {
  return ((file: string, args: readonly string[], options: unknown,
    callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
    expect(file).toBe('/bin/ps'); expect(args).toEqual(['-axo', 'pid=,ppid=,pgid=,rss=,stat=']);
    expect(options).toMatchObject({ timeout, maxBuffer: 1024 * 1024, encoding: 'utf8', env: { LC_ALL: 'C' } });
    callback(error, stdout, 'private stderr /Users/private/path');
  }) as typeof execFile;
}
const nodeRow = `${process.pid} 1 10 100 S`;

describe('bounded LLM process-table measurement', () => {
  it.each([['darwin', 1500], ['linux', 500]] as const)('bounds %s RSS commands at %i ms without changing measurement scope', async (platform, timeout) => {
    expect(await memoryBytesForTest(7000, command(nodeRow, null, timeout), platform)).toBe(100 * 1024);
  });
  it('counts all Node descendants and reparented owned-group descendants, not unrelated processes', async () => {
    const [child, grandchild, owned, unrelated, escaped] = [1, 2, 3, 4, 5].map(offset => process.pid + offset);
    const table = [nodeRow, `${child} ${process.pid} 10 20 S`, `${grandchild} ${child} 10 30 S`,
      `${owned} 1 7000 40 S`, `${unrelated} 1 8000 999999 S`, `${escaped} ${owned} 8000 10 S`].join('\n');
    expect(await memoryBytesForTest(7000, command(table))).toBe(200 * 1024);
  });
  it.each([
    [{ code: 'ETIMEDOUT', killed: true }, 'memory_sample_ps_timeout'],
    [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true }, 'memory_sample_ps_limit'],
    [{ code: 'EACCES' }, 'memory_sample_ps_failed'],
  ] as const)('classifies a failed command safely (%j)', async (fields, reason) => {
    const error = Object.assign(new Error('private command details and prompt'), fields);
    await expect(memoryBytesForTest(7000, command(nodeRow, error))).rejects.toThrow(new RegExp(`^${reason}$`));
  });
  it.each(['', 'private raw process output', `${process.pid} 1 10 - S`,
    `${process.pid} 1 10 999999999999999999 S`])('rejects malformed or unsafe rows without exposing them (%s)', async (table) => {
    await expect(memoryBytesForTest(7000, command(table))).rejects.toThrow(/^memory_sample_parse$/);
  });
  it('rejects a table with no mandatory Node row', async () => {
    await expect(memoryBytesForTest(7000, command(`${process.pid + 1} 1 7000 40 S`))).rejects.toThrow(/^memory_sample_missing$/);
  });
});
