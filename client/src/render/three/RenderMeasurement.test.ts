import { expect, it, vi } from 'vitest';
import { RenderMeasurement } from './RenderMeasurement';

function fixture() {
  let id = 0, ready = false, active = false;
  const gl = {
    QUERY_RESULT_AVAILABLE: 0x8867 as const, QUERY_RESULT: 0x8866 as const,
    getExtension: () => ({ TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 }), getParameter: () => false,
    createQuery: () => ({ id: ++id } as unknown as WebGLQuery), deleteQuery: vi.fn(),
    beginQuery: vi.fn(() => { expect(active).toBe(false); active = true; }),
    endQuery: vi.fn(() => { expect(active).toBe(true); active = false; }),
    getQueryParameter: (query: WebGLQuery, name: number) => name === 0x8867 ? ready : (query as unknown as { id: number }).id * 2e6,
  };
  return { gl, ready: () => { ready = true; } };
}

it('times sequential shadow/main queries without nesting or inventing whole-render GPU timing', () => {
  const { gl, ready } = fixture(), probe = new RenderMeasurement(gl, true);
  probe.begin(); probe.startGpu(); expect(gl.beginQuery).not.toHaveBeenCalled();
  probe.beginShadow(true); probe.endShadow(.5, 100, 20000); probe.finish(true, 300, 80000);
  expect(gl.beginQuery).toHaveBeenCalledTimes(2); expect(gl.endQuery).toHaveBeenCalledTimes(2);
  expect(probe.read().samples[0]).toMatchObject({ gpuMs: null, gpuShadowMs: null, gpuMainMs: null, shadowCalls: 100 });
  ready(); probe.begin();
  expect(probe.read().samples[0]).toMatchObject({ gpuMs: null, gpuShadowMs: 2, gpuMainMs: 4, cpuShadowMs: .5, shadowTriangles: 20000 });
  probe.dispose(); expect(gl.deleteQuery).toHaveBeenCalledTimes(2);
});

it('does not query disabled shadows, discards failed submissions and bounds capture', () => {
  const { gl, ready } = fixture(), probe = new RenderMeasurement(gl, true);
  probe.begin(); probe.startGpu(); probe.beginShadow(false); probe.endShadow(0, 0, 0); probe.finish(false);
  expect(gl.beginQuery).toHaveBeenCalledTimes(1); ready(); probe.begin();
  expect(probe.read().samples[0]).toMatchObject({ shadowEnabled: false, gpuShadowMs: null, gpuMainMs: null });
  for (let i = 0; i < 12001; i++) { probe.begin(); probe.finish(false); }
  expect(probe.read().samples).toHaveLength(12000); expect(probe.read().dropped).toBe(2);
  probe.dispose();
});
