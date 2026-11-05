export type GraphicsQuality = 'low' | 'balanced' | 'high';

/** viewDistance is where fog becomes opaque; the camera far plane sits just behind it,
 * so fully fogged geometry is frustum-culled instead of shaded. */
export const GRAPHICS_PROFILES = {
  low: { pixelRatio: 1, antialias: false, shadowSize: 0, farWindInterval: 100, viewDistance: 60 },
  balanced: { pixelRatio: 1, antialias: true, shadowSize: 1024, farWindInterval: 100, viewDistance: 80 },
  high: { pixelRatio: 1.5, antialias: true, shadowSize: 2048, farWindInterval: 0, viewDistance: 80 },
} as const;

export function isGraphicsQuality(value: unknown): value is GraphicsQuality {
  return value === 'low' || value === 'balanced' || value === 'high';
}
