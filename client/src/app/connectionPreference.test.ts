import { describe, expect, it } from 'vitest';
import { parseConfig } from './config';
import { rememberConnection, restoreConnection } from './connectionPreference';

describe('server address preference', () => {
  const config = parseConfig({ session: 'online', mapId: 'market' }, 'http://localhost:5173');
  it('restores only a validated public address', () => {
    expect(restoreConnection(config, { getItem: () => 'http://192.168.1.5:3000' }, 'http://localhost').serverUrl).toBe('http://192.168.1.5:3000');
    for (const value of ['javascript:alert(1)', 'http://name:password@localhost', 'http://localhost?token=secret']) {
      expect(restoreConnection(config, { getItem: () => value }, 'http://localhost')).toBe(config);
    }
  });
  it('handles missing and inaccessible storage without hiding startup', () => {
    expect(restoreConnection(config, { getItem: () => null }, 'http://localhost')).toBe(config);
    expect(restoreConnection(config, { getItem: () => { throw new Error('denied'); } }, 'http://localhost')).toBe(config);
    expect(rememberConnection(config.serverUrl, { setItem: () => { throw new Error('denied'); } })).toBe(false);
  });
  it('writes no session or password data', () => {
    const values: Record<string, string> = {};
    expect(rememberConnection(config.serverUrl, { setItem: (key, value) => { values[key] = value; } })).toBe(true);
    expect(values).toEqual({ 'babylon.serverUrl': config.serverUrl });
  });
});
