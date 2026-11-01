export type GraphicsQuality = 'low' | 'balanced' | 'high';

export const GRAPHICS_PROFILES = {
  low: { pixelRatio: 1, antialias: false, shadowSize: 0, farWindInterval: 100 },
  balanced: { pixelRatio: 1, antialias: true, shadowSize: 1024, farWindInterval: 100 },
  high: { pixelRatio: 2, antialias: true, shadowSize: 2048, farWindInterval: 0 },
} as const;

export function isGraphicsQuality(value: unknown): value is GraphicsQuality {
  return value === 'low' || value === 'balanced' || value === 'high';
}
