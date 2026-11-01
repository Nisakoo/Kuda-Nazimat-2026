import { isGraphicsQuality, type GraphicsQuality } from '../render/GraphicsQuality';

export const GRAPHICS_QUALITY_KEY = 'world.graphics-quality';
export function readGraphicsQuality(): GraphicsQuality {
  try {
    const value = localStorage.getItem(GRAPHICS_QUALITY_KEY);
    if (isGraphicsQuality(value)) return value;
  } catch { /* Storage is optional. */ }
  return 'balanced';
}
export function rememberGraphicsQuality(value: GraphicsQuality): void {
  try { localStorage.setItem(GRAPHICS_QUALITY_KEY, value); } catch { /* Storage is optional. */ }
}
