import { afterEach, expect, it, vi } from 'vitest';
import { GRAPHICS_QUALITY_KEY, readGraphicsQuality, rememberGraphicsQuality } from './graphicsPreference';
afterEach(() => vi.unstubAllGlobals());
it('restores only supported profiles and tolerates unavailable local storage', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) });
  expect(readGraphicsQuality()).toBe('balanced'); rememberGraphicsQuality('low'); expect(readGraphicsQuality()).toBe('low');
  values.set(GRAPHICS_QUALITY_KEY, 'broken'); expect(readGraphicsQuality()).toBe('balanced');
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
  expect(readGraphicsQuality()).toBe('balanced'); expect(() => rememberGraphicsQuality('high')).not.toThrow();
});
