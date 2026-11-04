import { describe, expect, it, vi } from 'vitest';
import { GpuTimer } from './GpuTimer';

function fixture(available = true) {
  let serial = 0, disjoint = false, ready = false, result = 2500000;
  const gl = {
    QUERY_RESULT_AVAILABLE: 0x8867 as const, QUERY_RESULT: 0x8866 as const,
    getExtension: vi.fn(() => available ? { TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 } : null),
    getParameter: vi.fn(() => disjoint), createQuery: vi.fn(() => ({ id: ++serial } as unknown as WebGLQuery)),
    deleteQuery: vi.fn(), beginQuery: vi.fn(), endQuery: vi.fn(),
    getQueryParameter: vi.fn((_query: WebGLQuery, key: number) => key === 0x8867 ? ready : result),
  };
  const timer = new GpuTimer(gl);
  return { gl, timer, ready: () => { ready = true; }, disjoint: () => { disjoint = true; }, invalid: () => { result = NaN; } };
}

describe('nonblocking GPU elapsed queries', () => {
  it('reports unavailable without allocating queries or inventing zero duration', () => {
    const { gl, timer } = fixture(false); const accept = vi.fn();
    timer.begin(); timer.end(accept); timer.poll();
    expect(timer.stats.status).toBe('unavailable'); expect(gl.createQuery).not.toHaveBeenCalled(); expect(accept).not.toHaveBeenCalled();
  });
  it('caps unfinished queries and only reads ready results, converting ns to ms', () => {
    const { gl, timer, ready } = fixture(); const accept = vi.fn();
    for (let i = 0; i < 8; i++) { timer.begin(); timer.end(accept); }
    expect(timer.stats.queries).toBe(4); timer.poll();
    expect(gl.getQueryParameter.mock.calls.every(call => call[1] === gl.QUERY_RESULT_AVAILABLE)).toBe(true);
    expect(accept).not.toHaveBeenCalled(); ready(); timer.poll();
    expect(accept.mock.calls).toEqual([[2.5], [2.5], [2.5], [2.5]]);
    expect(gl.deleteQuery).toHaveBeenCalledTimes(4); expect(timer.stats.queries).toBe(0);
  });
  it('discards disjoint and invalid samples instead of reporting GPU timings', () => {
    const a = fixture(), accept = vi.fn(); a.timer.begin(); a.timer.end(accept); a.disjoint(); a.timer.poll();
    expect(a.timer.stats.rejected).toBe(1); expect(a.gl.deleteQuery).toHaveBeenCalledTimes(1);
    const b = fixture(); b.timer.begin(); b.timer.end(accept); b.invalid(); b.ready(); b.timer.poll();
    expect(b.timer.stats.rejected).toBe(1); expect(accept).not.toHaveBeenCalled();
  });
  it('clears pending and active handles on context loss/disposal and reacquires the extension', () => {
    const { timer, gl } = fixture(); timer.begin(); timer.end(vi.fn()); timer.begin();
    timer.contextLost(); expect(timer.stats.queries).toBe(0); expect(gl.deleteQuery).toHaveBeenCalledTimes(2);
    timer.begin(); expect(gl.createQuery).toHaveBeenCalledTimes(2);
    timer.contextRestored(); timer.begin(); timer.dispose(); timer.dispose(); timer.contextRestored(); timer.begin();
    expect(gl.getExtension).toHaveBeenCalledTimes(2); expect(gl.createQuery).toHaveBeenCalledTimes(3);
    expect(gl.deleteQuery).toHaveBeenCalledTimes(3); expect(timer.stats.status).toBe('disposed');
  });
});
