import { isGraphicsQuality, type GraphicsQuality } from '../render/GraphicsQuality';

export const GRAPHICS_QUALITY_KEY = 'world.graphics-quality';

/** Device facts available before the scene exists. Missing values mean "unknown", not "weak". */
export interface DeviceHints { readonly renderer: string | null; readonly cores?: number | undefined; readonly memoryGb?: number | undefined }

const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|microsoft basic render|software/i;
// Integrated and mobile GPUs; Intel Arc is discrete. AMD "Radeon Graphics"/"Vega N Graphics" are APUs.
const INTEGRATED = /intel(?!.*\barc\b)|mali|adreno|powervr|videocore|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|radeon r[2-7]\b/i;

/** First-run profile. Never chooses high: that remains an explicit, saved user choice. */
export function recommendGraphicsQuality(hints: DeviceHints): GraphicsQuality {
  const renderer = hints.renderer ?? '';
  if (SOFTWARE.test(renderer) || INTEGRATED.test(renderer)) return 'low';
  if (hints.cores !== undefined && hints.cores > 0 && hints.cores <= 4) return 'low';
  if (hints.memoryGb !== undefined && hints.memoryGb > 0 && hints.memoryGb <= 4) return 'low';
  return 'balanced';
}

/** One short-lived WebGL context; released immediately so it never competes with the game canvas. */
export function probeDevice(): DeviceHints {
  const nav = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { deviceMemory?: number };
  const hints = { cores: nav?.hardwareConcurrency, memoryGb: nav?.deviceMemory };
  try {
    if (typeof document === 'undefined') return { renderer: null, ...hints };
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (!gl) return { renderer: null, ...hints };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { renderer: typeof renderer === 'string' ? renderer : null, ...hints };
  } catch { return { renderer: null, ...hints }; }
}

/** Saved choice wins; otherwise the device recommendation, which is not saved until the user applies settings. */
export function readGraphicsQuality(detect: () => DeviceHints = probeDevice): GraphicsQuality {
  try {
    const value = localStorage.getItem(GRAPHICS_QUALITY_KEY);
    if (isGraphicsQuality(value)) return value;
  } catch { /* Storage is optional. */ }
  try { return recommendGraphicsQuality(detect()); } catch { return 'balanced'; }
}
export function rememberGraphicsQuality(value: GraphicsQuality): void {
  try { localStorage.setItem(GRAPHICS_QUALITY_KEY, value); } catch { /* Storage is optional. */ }
}
