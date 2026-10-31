import { describe, expect, it } from 'vitest';
import { parseConfig } from './config';

describe('public configuration', () => {
  it.each(['http://192.168.10.4:5173', 'http://127.0.0.1:4173', 'https://school.local']) (
    'uses the page origin without a build-time address (%s)', (origin) => {
      expect(parseConfig({}, origin)).toEqual({
        session: 'local', serverUrl: origin, mapId: 'demo', chunkRadius: null, debug: false,
      });
    },
  );

  it('accepts runtime settings independently of the bundle', () => {
    expect(parseConfig({
      session: 'online', serverUrl: '/game', mapId: 'history-2', chunkRadius: 2, debug: true,
    }, 'http://school.local')).toEqual({
      session: 'online', serverUrl: 'http://school.local/game', mapId: 'history-2', chunkRadius: 2, debug: true,
    });
  });

  it.each([
    null, [], 'local', { session: 'unknown' }, { session: null }, { mapId: '../private' },
    { mapId: null }, { chunkRadius: -1 }, { chunkRadius: 1.2 }, { chunkRadius: '2' },
    { debug: 'false' }, { debug: null }, { serverUrl: '' }, { serverUrl: 42 },
    { serverUrl: 'javascript:alert(1)' }, { serverUrl: 'https://user:pass@example.com' },
    { serverUrl: 'http://school.local/?token=secret' }, { renderer: 'other' },
  ])('rejects malformed or unsupported settings: %j', (raw) => {
    expect(() => parseConfig(raw, 'http://school.local')).toThrow();
  });
});
