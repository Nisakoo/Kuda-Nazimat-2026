// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderAdapter } from '../render/RenderAdapter';
import { LocalSession } from '../session/LocalSession';
import { GameApp } from './GameApp';
import { parseConfig } from './config';

describe('application lifecycle', () => {
  const pending = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  let observerCount = 0;
  let app: GameApp;
  let host: HTMLDivElement;
  let renderer: RenderAdapter;
  let createRenderer: ReturnType<typeof vi.fn<() => RenderAdapter>>;

  function advance(timestamp: number): void {
    const callbacks = [...pending.values()];
    pending.clear();
    for (const callback of callbacks) callback(timestamp);
  }

  beforeEach(() => {
    pending.clear();
    nextFrame = 0;
    observerCount = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pending.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending.delete(id); });
    vi.stubGlobal('ResizeObserver', class {
      observe(): void { observerCount++; }
      disconnect(): void { observerCount--; }
    });
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    host = document.createElement('div');
    host.getBoundingClientRect = () => new DOMRect(0, 0, 640, 480);
    renderer = { mount: vi.fn(), render: vi.fn(), resize: vi.fn(), syncWorld: vi.fn(), setCamera: vi.fn(), dispose: vi.fn() };
    createRenderer = vi.fn(() => renderer);
    app = new GameApp(parseConfig({}, 'http://school.local'), createRenderer);
  });

  afterEach(() => {
    app.dispose();
    vi.unstubAllGlobals();
  });

  it('has one loop and observer across repeated start/stop, and releases everything on dispose', () => {
    app.start(host);
    app.start(host);
    expect(pending.size).toBe(1);
    expect(observerCount).toBe(1);
    expect(createRenderer).toHaveBeenCalledTimes(1);
    advance(100);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    app.stop();
    app.stop();
    expect(pending.size).toBe(0);
    expect(observerCount).toBe(0);
    advance(200);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    app.start(host);
    expect(pending.size).toBe(1);
    expect(observerCount).toBe(1);
    app.dispose();
    app.dispose();
    expect(pending.size).toBe(0);
    expect(observerCount).toBe(0);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(() => app.start(host)).toThrow('завершено');
  });

  it('replaces the renderer on restart, retaining only one active loop', () => {
    app.start(host);
    app.restart(host);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(createRenderer).toHaveBeenCalledTimes(2);
    expect(pending.size).toBe(1);
    expect(observerCount).toBe(1);
  });

  it('allows a fresh application after disposing the previous instance', () => {
    app.start(host);
    app.dispose();
    const previousRenderer = renderer;
    renderer = { mount: vi.fn(), render: vi.fn(), resize: vi.fn(), syncWorld: vi.fn(), setCamera: vi.fn(), dispose: vi.fn() };
    app = new GameApp(parseConfig({}, 'http://school.local'), () => renderer);
    app.start(host);
    advance(100);
    expect(previousRenderer.dispose).toHaveBeenCalledTimes(1);
    expect(previousRenderer.render).not.toHaveBeenCalled();
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(pending.size).toBe(1);
    expect(observerCount).toBe(1);
  });

  it('resizes from the actual viewport and removes resize listeners when stopped', () => {
    app.start(host);
    expect(renderer.resize).toHaveBeenCalledWith(640, 480, 1);
    app.stop();
    vi.mocked(renderer.resize).mockClear();
    window.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(renderer.resize).not.toHaveBeenCalled();
    expect(pending.size).toBe(0);
  });

  it('suspends a hidden page and avoids a time jump on return', () => {
    app.start(host);
    advance(100);
    advance(116);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(pending.size).toBe(0);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    advance(100_000);
    expect(renderer.render).toHaveBeenLastCalledWith(0.016, expect.any(Number));
  });

  it('reports initialization failure, cleans partial resources and allows retry', () => {
    const listener = vi.fn();
    app.subscribe(listener);
    vi.mocked(renderer.mount).mockImplementationOnce(() => { throw new Error('No WebGL'); });
    app.start(host);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'error' }));
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(pending.size).toBe(0);
    app.restart(host);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'running', message: null }));
    expect(pending.size).toBe(1);
  });

  it('cleans up after a rendering error without leaving a frame or observer', () => {
    const listener = vi.fn();
    app.subscribe(listener);
    app.start(host);
    vi.mocked(renderer.render).mockImplementationOnce(() => { throw new Error('Render failed'); });
    advance(100);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'error' }));
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(observerCount).toBe(0);
    expect(pending.size).toBe(0);
  });

  it('does not create a renderer or connection for the unavailable online mode', () => {
    app.dispose();
    app = new GameApp(parseConfig({ session: 'online' }, 'http://school.local'), createRenderer);
    const listener = vi.fn();
    app.subscribe(listener);
    app.start(host);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'unavailable' }));
    expect(createRenderer).not.toHaveBeenCalled();
    expect(pending.size).toBe(0);
  });

  it('supports unsubscribing and clears subscriptions on dispose', () => {
    const listener = vi.fn();
    const unsubscribe = app.subscribe(listener);
    unsubscribe();
    app.start(host);
    expect(listener).toHaveBeenCalledTimes(1);
    app.subscribe(listener);
    app.dispose();
    const calls = listener.mock.calls.length;
    app.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(calls);
  });

  it('updates LocalSession with fixed steps and keeps simulation data out of UI notifications', () => {
    const listener = vi.fn();
    app.subscribe(listener);
    app.start(host);
    expect(app.send({ type: 'move', direction: { x: 1, z: 0 } })).toBe(true);
    advance(0);
    advance(100);
    expect(app.getWorldSnapshot()?.tick).toBe(5);
    const player = app.getWorldSnapshot()?.entities.find((entity) => entity.id === 'local-player');
    expect(player?.transform?.position.x).toBeCloseTo(0.25);
    expect(listener).toHaveBeenCalledTimes(2); // initial state and start only
    app.stop();
    expect(app.send({ type: 'move', direction: { x: 0, z: 0 } })).toBe(false);
    advance(1000);
    expect(app.getWorldSnapshot()?.tick).toBe(5);
    app.restart(host);
    expect(app.getWorldSnapshot()?.tick).toBe(0);
    app.dispose();
    expect(app.getWorldSnapshot()).toBeNull();
  });

  it('cleans the session when WebGL initialization fails', () => {
    const session = new LocalSession('test', [{ id: 'test', character: { kind: 'player', name: 'Test' } }]);
    const disposed = vi.spyOn(session, 'dispose');
    app.dispose();
    app = new GameApp(parseConfig({}, 'http://school.local'), createRenderer, () => session);
    vi.mocked(renderer.mount).mockImplementationOnce(() => { throw new Error('No WebGL'); });
    app.start(host);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(app.getWorldSnapshot()).toBeNull();
    expect(pending.size).toBe(0);
  });

  it('publishes the final coordinates on pause and resumes without replaying held movement', () => {
    const lockProperty = Object.getOwnPropertyDescriptor(document, 'pointerLockElement');
    const exitProperty = Object.getOwnPropertyDescriptor(document, 'exitPointerLock');
    let locked: Element | null = null;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
    Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: () => {
      locked = null;
      document.dispatchEvent(new Event('pointerlockchange'));
    } });
    Object.defineProperty(host, 'requestPointerLock', { value: () => {
      locked = host;
      document.dispatchEvent(new Event('pointerlockchange'));
      return Promise.resolve();
    } });
    try {
      app.dispose();
      app = new GameApp(parseConfig({ debug: true }, 'http://school.local'), createRenderer);
      const listener = vi.fn();
      app.subscribe(listener);
      app.start(host);
      app.enterWorld();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      advance(0);
      advance(50); // less than the HUD's ordinary six-step refresh interval
      const position = app.getWorldSnapshot()?.entities[0]?.transform?.position;
      expect(position).toBeDefined();
      app.stop();
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
        phase: 'stopped', coordinates: `X ${position!.x.toFixed(1)} · Z ${position!.z.toFixed(1)}`,
      }));
      app.resume();
      advance(1000);
      advance(1020);
      expect(app.getWorldSnapshot()?.entities[0]?.transform?.position).toEqual(position);
    } finally {
      app.dispose();
      if (lockProperty) Object.defineProperty(document, 'pointerLockElement', lockProperty);
      else Reflect.deleteProperty(document, 'pointerLockElement');
      if (exitProperty) Object.defineProperty(document, 'exitPointerLock', exitProperty);
      else Reflect.deleteProperty(document, 'exitPointerLock');
    }
  });

  it('cleans the loop, session and renderer when a simulation step fails', () => {
    const session = new LocalSession('test', [{ id: 'test', character: { kind: 'player', name: 'Test' } }]);
    vi.spyOn(session, 'update').mockImplementationOnce(() => { throw new Error('Simulation failed'); });
    const disposed = vi.spyOn(session, 'dispose');
    app.dispose();
    app = new GameApp(parseConfig({}, 'http://school.local'), createRenderer, () => session);
    const listener = vi.fn();
    app.subscribe(listener);
    app.start(host);
    advance(0);
    advance(20);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'error' }));
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(pending.size).toBe(0);
    expect(observerCount).toBe(0);
  });
});
