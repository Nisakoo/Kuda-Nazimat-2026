import { describe, expect, it, vi } from 'vitest';
import { FrameFence } from './FrameFence';

function fixture() {
  const handle = {} as WebGLSync;
  const gl = {
    ALREADY_SIGNALED: 0x911a as const, TIMEOUT_EXPIRED: 0x911b as const, CONDITION_SATISFIED: 0x911c as const, SYNC_GPU_COMMANDS_COMPLETE: 0x9117 as const,
    fenceSync: vi.fn((): WebGLSync | null => handle), clientWaitSync: vi.fn((): number => 0x911b), deleteSync: vi.fn(), flush: vi.fn(),
  };
  return { gl, handle, fence: new FrameFence(gl) };
}

describe('non-blocking frame fence', () => {
  it('submits one frame, polls with timeout zero and submits again only after completion', () => {
    const { gl, handle, fence } = fixture();
    expect(fence.canSubmit()).toBe(true); fence.submitted();
    expect(gl.fenceSync).toHaveBeenCalledWith(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); expect(gl.flush).toHaveBeenCalledOnce();
    expect(fence.canSubmit()).toBe(false); expect(fence.canSubmit()).toBe(false);
    expect(gl.clientWaitSync).toHaveBeenCalledWith(handle, 0, 0); expect(gl.deleteSync).not.toHaveBeenCalled();
    gl.clientWaitSync.mockReturnValueOnce(gl.CONDITION_SATISFIED);
    expect(fence.canSubmit()).toBe(true); expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(handle);
    fence.submitted(); gl.clientWaitSync.mockReturnValueOnce(gl.ALREADY_SIGNALED);
    expect(fence.canSubmit()).toBe(true); expect(gl.deleteSync).toHaveBeenCalledTimes(2);
  });
  it('fails closed and deletes the handle on wait failure, and can recover only after restoration', () => {
    const { gl, handle, fence } = fixture(); fence.submitted(); gl.clientWaitSync.mockReturnValueOnce(0x911d);
    expect(fence.canSubmit()).toBe(false); expect(fence.failed).toBe(true); expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(handle);
    expect(fence.canSubmit()).toBe(false); expect(gl.clientWaitSync).toHaveBeenCalledOnce();
    fence.contextRestored(); expect(fence.failed).toBe(false); expect(fence.canSubmit()).toBe(true);
  });
  it('fails closed if a fence cannot be inserted or a GL operation throws', () => {
    const a = fixture(); a.gl.fenceSync.mockReturnValueOnce(null); a.fence.submitted();
    expect(a.fence.failed).toBe(true); expect(a.fence.canSubmit()).toBe(false); expect(a.gl.flush).not.toHaveBeenCalled();
    const b = fixture(); b.gl.flush.mockImplementationOnce(() => { throw new Error('lost'); }); b.fence.submitted();
    expect(b.fence.failed).toBe(true); expect(b.gl.deleteSync).toHaveBeenCalledExactlyOnceWith(b.handle);
    const c = fixture(); c.fence.submitted(); c.gl.clientWaitSync.mockImplementationOnce(() => { throw new Error('lost'); });
    expect(c.fence.canSubmit()).toBe(false); expect(c.gl.deleteSync).toHaveBeenCalledExactlyOnceWith(c.handle);
  });
  it('cleans the fence on context loss and disposal without submitting to a lost context', () => {
    const { gl, handle, fence } = fixture(); fence.submitted(); fence.contextLost();
    expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(handle); expect(fence.canSubmit()).toBe(false);
    fence.contextRestored(); expect(fence.canSubmit()).toBe(true); fence.submitted(); fence.dispose(); fence.dispose();
    expect(gl.deleteSync).toHaveBeenCalledTimes(2); fence.contextRestored(); expect(fence.canSubmit()).toBe(false);
  });
});
