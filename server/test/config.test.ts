import { expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadServerConfig, parseConfig, serverArguments } from '../src/app/config.ts';

const path = resolve('/srv/kn/server/config.json');

it('SERVER-009: presets differ per environment and production never allows passwordless login', () => {
  const dev = parseConfig({}, path, 'development'); const prod = parseConfig({}, path, 'production'); const test = parseConfig({}, path, 'test');
  expect([dev.env, prod.env, test.env]).toEqual(['development', 'production', 'test']);
  expect(dev).toMatchObject({ dbPath: resolve('/srv/kn/server/data/dev.sqlite'), corsOrigins: ['https://localhost:5173'], clientDebug: true, auth: { passwordless: true }, logs: { consoleLevel: 'debug', fileLevel: 'debug' }, monitoring: { validateOutgoing: true } });
  expect(prod).toMatchObject({ dbPath: resolve('/srv/kn/server/data/game.sqlite'), corsOrigins: [], clientDebug: false, auth: { passwordless: false, maxSessions: 5 }, logs: { consoleLevel: 'info', fileLevel: 'debug', dir: resolve('/srv/kn/server/data/logs') }, monitoring: { token: null, validateOutgoing: false } });
  expect(test).toMatchObject({ dbPath: resolve('/srv/kn/server/data/test.sqlite'), auth: { passwordless: true }, logs: { consoleLevel: 'warn', fileLevel: 'off' } });
  expect(() => parseConfig({ auth: { passwordless: true } }, path, 'production')).toThrow('production');
  // The file overrides the preset, key by key inside nested sections.
  expect(parseConfig({ dbPath: 'other.sqlite', logs: { consoleLevel: 'error' } }, path, 'development')).toMatchObject({ dbPath: resolve('/srv/kn/server/other.sqlite'), logs: { consoleLevel: 'error', fileLevel: 'debug' } });
  for (const input of [{ env: 'production' }, { auth: { extra: 1 } }, { logs: { consoleLevel: 'loud' } }, { logs: { maxFileMb: 500, maxTotalMb: 100 } }, { monitoring: { token: 'short' } }, { monitoring: { pingIntervalMs: 10 } }, { clientDebug: 'yes' }])
    expect(() => parseConfig(input, path, 'production'), JSON.stringify(input)).toThrow();
  expect(parseConfig({ monitoring: { token: 'x'.repeat(32) } }, path, 'production').monitoring.token).toBe('x'.repeat(32));
});

it('SERVER-009: --env beats APP_ENV, --port beats PORT, positional words are kept and unknown flags fail', () => {
  expect(serverArguments([], {})).toMatchObject({ env: 'development', rest: [] });
  expect(serverArguments([], { APP_ENV: 'production', PORT: '9000' })).toMatchObject({ env: 'production', port: 9000 });
  expect(serverArguments(['--env', 'test', '--port', '9100'], { APP_ENV: 'production', PORT: '9000' })).toMatchObject({ env: 'test', port: 9100 });
  expect(serverArguments(['backup.sqlite', '--env', 'production'], {})).toMatchObject({ env: 'production', rest: ['backup.sqlite'] });
  for (const args of [['--env', 'staging'], ['--port', '0'], ['--verbose', '1'], ['--env']]) expect(() => serverArguments(args, {})).toThrow();
  expect(() => serverArguments([], { APP_ENV: 'prod' })).toThrow('Неизвестное окружение');
});

it('SERVER-009: defaults → preset → file → HOST/PORT → --port', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'config-')); const file = join(dir, 'config.json');
  try {
    writeFileSync(file, JSON.stringify({ port: 7000, host: '127.0.0.1' }));
    expect((await loadServerConfig(['--config', file, '--env', 'production'], {})).config).toMatchObject({ env: 'production', port: 7000, host: '127.0.0.1' });
    expect((await loadServerConfig(['--config', file], { PORT: '7100', HOST: '0.0.0.0' })).config).toMatchObject({ env: 'development', port: 7100, host: '0.0.0.0' });
    expect((await loadServerConfig(['--config', file, '--port', '7200'], { PORT: '7100' })).config.port).toBe(7200);
    await expect(loadServerConfig(['--config', join(dir, 'missing.json')], {})).rejects.toThrow('Не удалось прочитать');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
