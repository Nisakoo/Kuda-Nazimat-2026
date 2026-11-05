import { afterEach, expect, it, vi } from 'vitest';
import { GRAPHICS_QUALITY_KEY, readGraphicsQuality, recommendGraphicsQuality, rememberGraphicsQuality } from './graphicsPreference';
afterEach(() => vi.unstubAllGlobals());
const discrete = () => ({ renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)', cores: 12, memoryGb: 16 });
it('restores only supported profiles and tolerates unavailable local storage', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) });
  expect(readGraphicsQuality(discrete)).toBe('balanced'); rememberGraphicsQuality('low'); expect(readGraphicsQuality(discrete)).toBe('low');
  values.set(GRAPHICS_QUALITY_KEY, 'broken'); expect(readGraphicsQuality(discrete)).toBe('balanced');
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
  expect(readGraphicsQuality(discrete)).toBe('balanced'); expect(() => rememberGraphicsQuality('high')).not.toThrow();
});
it('recommends the light profile for integrated, mobile and software GPUs or small machines, never high', () => {
  for (const renderer of ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)', 'Intel(R) Iris(TM) Plus Graphics 655', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)',
    'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0)', 'AMD Radeon Vega 8 Graphics', 'Mali-G78', 'Adreno (TM) 650', 'Google SwiftShader', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Microsoft Basic Render Driver']) {
    expect(recommendGraphicsQuality({ renderer, cores: 8, memoryGb: 8 }), renderer).toBe('low');
  }
  for (const renderer of ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11)', 'AMD Radeon RX 6700 XT', null]) {
    expect(recommendGraphicsQuality({ renderer, cores: 8, memoryGb: 8 }), String(renderer)).toBe('balanced');
  }
  expect(recommendGraphicsQuality({ renderer: 'Apple GPU', cores: 4 })).toBe('low');
  expect(recommendGraphicsQuality({ renderer: 'Apple GPU', cores: 8, memoryGb: 4 })).toBe('low');
  expect(recommendGraphicsQuality({ renderer: null })).toBe('balanced');
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  expect(readGraphicsQuality(() => { throw new Error('no probe'); })).toBe('balanced');
});
