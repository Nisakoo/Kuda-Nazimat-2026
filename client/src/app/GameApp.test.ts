import { initialMotion, motionStatus } from '../../../shared/movement/simulation.ts';
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderAdapter } from '../render/RenderAdapter';
import { LocalSession } from '../session/LocalSession';
import { GameApp } from './GameApp';
import { parseConfig } from './config';
import { MockNetworkAdapter } from '../multiplayer/MockNetworkAdapter';
import type { ServerSession } from '../../../shared/protocol/types.ts';
import type { NetworkAdapter } from '../multiplayer/NetworkAdapter';
import type { MapSource, WorldManifest } from '../map/types';
import { DEMO_WORLD } from '../shared/demoWorld.generated';

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
    // Unit tests never contact the LAN. Individual tests override this stub for their own routes.
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input).endsWith('/api/auth/logout') && options?.method === 'POST') return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.reject(new Error(`Unexpected unit-test fetch: ${String(input)}`));
    }));
    vi.stubGlobal('ResizeObserver', class {
      observe(): void { observerCount++; }
      disconnect(): void { observerCount--; }
    });
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    host = document.createElement('div');
    host.getBoundingClientRect = () => new DOMRect(0, 0, 640, 480);
    renderer = { mount: vi.fn(), render: vi.fn(), resize: vi.fn(), syncWorld: vi.fn(), setCamera: vi.fn(), setBuildingSymbols: vi.fn(), registerModels: vi.fn(), loadChunk: vi.fn().mockResolvedValue(undefined), unloadChunk: vi.fn(), retryFailedModels: vi.fn(), getDiagnostics: vi.fn(() => ({ chunks: [], entities: [], models: 0, instances: 0, queued: 0, pending: 0, errors: [], geometries: 0, textures: 0, drawCalls: 0 })), dispose: vi.fn() };
    createRenderer = vi.fn(() => renderer);
    app = new GameApp(parseConfig({}, 'http://school.local'), createRenderer, undefined, null);
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
    renderer = { mount: vi.fn(), render: vi.fn(), resize: vi.fn(), syncWorld: vi.fn(), setCamera: vi.fn(), setBuildingSymbols: vi.fn(), registerModels: vi.fn(), loadChunk: vi.fn().mockResolvedValue(undefined), unloadChunk: vi.fn(), retryFailedModels: vi.fn(), getDiagnostics: vi.fn(() => ({ chunks: [], entities: [], models: 0, instances: 0, queued: 0, pending: 0, errors: [], geometries: 0, textures: 0, drawCalls: 0 })), dispose: vi.fn() };
    app = new GameApp(parseConfig({}, 'http://school.local'), () => renderer, undefined, null);
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

  it('shows login without creating a renderer or connection before authorization', () => {
    app.dispose();
    app = new GameApp(parseConfig({ session: 'online' }, 'http://school.local'), createRenderer, undefined, null);
    const listener = vi.fn();
    app.subscribe(listener);
    app.start(host);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'idle', authRequired: true }));
    expect(createRenderer).not.toHaveBeenCalled();
    expect(pending.size).toBe(0);
  });

  it('passes a supplied server session through the integration boundary and closes it on logout', () => {
    app.dispose();
    const transport: NetworkAdapter = { state: { status: 'unauthorized', error: null }, connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(() => false), subscribe: vi.fn(() => () => {}), subscribeState: vi.fn((listener) => { listener({ status: 'unauthorized', error: null }); return () => {}; }), dispose: vi.fn() };
    const factory = vi.fn(() => transport);
    app = new GameApp(parseConfig({ session: 'online' }, 'http://school.local'), createRenderer, undefined, null, factory);
    app.start(host); expect(factory).not.toHaveBeenCalled();
    const context = { token: 'test-server-session-opaque', expiresAt: Date.now() + 60000 };
    app.provideServerSession(context);
    expect(transport.connect).toHaveBeenCalledWith({ kind: 'server', session: context });
    app.logout(); expect(transport.dispose).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('http://school.local/api/auth/logout', expect.objectContaining({ method: 'POST', headers: { Authorization: `Bearer ${context.token}` } }));
    expect(factory).toHaveBeenCalledOnce(); expect(pending.size).toBe(0);
  });

  it('does not start a world or transport for a first avatar until the server confirms selection', async () => {
    app.dispose(); let finish!: (response: Response) => void;
    const fetcher = vi.fn((_url: string, options: RequestInit) => options.method === 'POST'
      ? new Promise<Response>(resolve => { finish = resolve; })
      : Promise.resolve(new Response(JSON.stringify({ avatarId: null }))));
    vi.stubGlobal('fetch', fetcher);
    const transport: NetworkAdapter = { state: { status: 'unauthorized', error: null }, connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(() => false), subscribe: vi.fn(() => () => {}), subscribeState: vi.fn(() => () => {}), dispose: vi.fn() };
    const factory = vi.fn(() => transport);
    app = new GameApp(parseConfig({ session: 'online' }, 'http://school.local'), createRenderer, undefined, null, factory);
    const listener = vi.fn(); app.subscribe(listener); app.start(host);
    app.provideServerSession({ token: 'x'.repeat(43), expiresAt: Date.now() + 60000 }, true);
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ avatarOpen: true, avatarPurpose: 'first', avatar: expect.objectContaining({ state: { avatarId: null }, busy: false }) })));
    app.start(host); expect(factory).not.toHaveBeenCalled(); expect(createRenderer).not.toHaveBeenCalled();
    const saving = app.saveAvatar('dan'); expect(factory).not.toHaveBeenCalled(); expect(createRenderer).not.toHaveBeenCalled();
    finish(new Response(JSON.stringify({ avatarId: 'dan' })));
    expect(await saving).toBe(true); expect(factory).toHaveBeenCalledOnce(); expect(transport.connect).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ avatarOpen: false, authRequired: false }));
  });

  it('ignores a late avatar save after settings selector closes', async () => {
    app.dispose(); let finish!: (response: Response) => void; let saveSignal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
      if (options.method === 'POST') { saveSignal = options.signal!; return new Promise<Response>(resolve => { finish = resolve; }); }
      return Promise.resolve(new Response(JSON.stringify({ avatarId: 'nic' })));
    }));
    const transport: NetworkAdapter = { state: { status: 'unauthorized', error: null }, connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(() => false), subscribe: vi.fn(() => () => {}), subscribeState: vi.fn(() => () => {}), dispose: vi.fn() };
    app = new GameApp(parseConfig({ session: 'online' }, 'http://school.local'), createRenderer, undefined, null, () => transport);
    const listener = vi.fn(); app.subscribe(listener); app.start(host);
    app.provideServerSession({ token: 'x'.repeat(43), expiresAt: Date.now() + 60000 }); app.openAvatar();
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ avatar: expect.objectContaining({ state: { avatarId: 'nic' }, busy: false }) })));
    const saving = app.saveAvatar('dan'); app.closeAvatar(); expect(saveSignal.aborted).toBe(true);
    app.closeSettings(); expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ avatarOpen: false, settingsOpen: false }));
    finish(new Response(JSON.stringify({ avatarId: 'dan' })));
    expect(await saving).toBe(false); expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ avatarOpen: false, settingsOpen: false, avatar: null }));
  });

  it('prepares the authoritative saved position instead of the manifest spawn in an online session', async () => {
    app.dispose(); vi.useFakeTimers();
    const manifest: WorldManifest = { mapId: 'demo', version: 3, worldBytes: DEMO_WORLD.worldBytes, chunkSize: 32, collisionResolution: 4, spawn: { x: 8, y: 0, z: 8 }, origin: { x: 0, z: 0 }, models: {}, assets: {}, chunks: Array.from({ length: 5 }, (_, x) => ({ id: String(x), x, z: 0, region: 'test', url: String(x), bytes: 1, collisionUrl: 'c', collisionBytes: 16, assets: [] })) };
    const source: MapSource = { bootstrap: DEMO_WORLD, budgetEpoch: 0, manifest: async () => manifest, chunk: vi.fn(async (entry) => ({ entry, visual: { id: entry.id, objects: [] }, collision: new Uint8Array(16), release: vi.fn() })), dispose: vi.fn() };
    try {
      app = new GameApp(parseConfig({ session: 'online' }, 'http://school.local'), createRenderer, undefined, () => source, (_mock, _url, clock) => new MockNetworkAdapter(clock, (message, transport) => {
        if (message.type === 'join') transport.receive({ v: 3, type: 'joined', requestId: message.requestId, playerId: 'saved-player', revision: 0, snapshot: { tick: 0, entities: [{ id: 'saved-player', motion: motionStatus(initialMotion({ x: 100, y: 0, z: 8 })), character: { kind: 'player', name: 'Saved' }, transform: { position: { x: 100, y: 0, z: 8 }, rotationY: 0 } }] }, world: DEMO_WORLD });
      }));
      app.start(host); await vi.advanceTimersByTimeAsync(0);
      app.applySettings('mock', 'http://school.local', 'demo', 1, false);
      await vi.advanceTimersByTimeAsync(100);
      const loaded = vi.mocked(source.chunk).mock.calls.map(([entry]) => entry.id);
      expect(loaded[0]).toBe('3'); expect(loaded).not.toContain('0');
      expect(app.getWorldSnapshot()?.entities[0]!.transform!.position.x).toBe(100);
    } finally { app.dispose(); vi.useRealTimers(); }
  });

  it('applies authoritative online deltas while the map has stopped gameplay', async () => {
    app.dispose(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const lockProperty = Object.getOwnPropertyDescriptor(document, 'pointerLockElement');
    const exitProperty = Object.getOwnPropertyDescriptor(document, 'exitPointerLock');
    let locked: Element | null = null; let transport!: MockNetworkAdapter;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
    Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: () => { locked = null; document.dispatchEvent(new Event('pointerlockchange')); } });
    Object.defineProperty(host, 'requestPointerLock', { configurable: true, value: () => { locked = host; document.dispatchEvent(new Event('pointerlockchange')); return Promise.resolve(); } });
    const player = (x: number) => ({ id: 'saved-player', motion: motionStatus(initialMotion({ x, y: 0, z: 8 })), character: { kind: 'player' as const, name: 'Saved' }, transform: { position: { x, y: 0, z: 8 }, rotationY: 0 } });
    try {
      app = new GameApp(parseConfig({ session: 'online' }, 'http://school.local'), createRenderer, undefined, null, (_mock, _url, clock) => transport = new MockNetworkAdapter(clock, (message, network) => {
        if (message.type === 'join') network.receive({ v: 3, type: 'joined', requestId: message.requestId, playerId: 'saved-player', revision: 0, snapshot: { tick: 0, entities: [player(8)] }, world: DEMO_WORLD });
      }));
      const listener = vi.fn(); app.subscribe(listener); app.start(host); app.applySettings('mock', 'http://school.local', 'demo', 1, false);
      await vi.advanceTimersByTimeAsync(100); advance(0); app.enterWorld(); app.toggleHudPanel('map');
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'stopped', mapOpen: true }));
      transport.receive({ v: 3, type: 'delta', revision: 1, baseRevision: 0, tick: 6, upsert: [player(9)], remove: [] });
      await vi.advanceTimersByTimeAsync(1);
      expect(transport.state.status).toBe('connected');
      expect(pending.size).toBeGreaterThan(0);
      advance(100); advance(120);
      expect(app.getWorldSnapshot()?.entities[0]?.transform?.position.x).toBe(9);
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ mapPlayer: expect.objectContaining({ x: 9, authoritative: true }) }));
    } finally {
      app.dispose(); vi.useRealTimers();
      if (lockProperty) Object.defineProperty(document, 'pointerLockElement', lockProperty); else Reflect.deleteProperty(document, 'pointerLockElement');
      if (exitProperty) Object.defineProperty(document, 'exitPointerLock', exitProperty); else Reflect.deleteProperty(document, 'exitPointerLock');
    }
  });

  it('submits one login, passes the validated session to the transport and forgets it on logout', async () => {
    let resolve!: (session: ServerSession) => void;
    const login = vi.fn(() => new Promise<ServerSession>((done) => { resolve = done; }));
    const transport: NetworkAdapter = { state: { status: 'unauthorized', error: null }, connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(() => false), subscribe: vi.fn(() => () => {}), subscribeState: vi.fn(() => () => {}), dispose: vi.fn() };
    const factory = vi.fn(() => transport); app.dispose();
    app = new GameApp(parseConfig({ session: 'online' }, 'http://school.local'), createRenderer, undefined, null, factory, login);
    const listener = vi.fn(); app.subscribe(listener); app.start(host);
    await app.login('  '); expect(login).not.toHaveBeenCalled();
    const pendingLogin = app.login(' Аня '); await app.login('Борис'); expect(login).toHaveBeenCalledOnce(); expect(factory).not.toHaveBeenCalled();
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ authPending: true }));
    const session = { token: 'x'.repeat(43), expiresAt: Date.now() + 10000 }; resolve(session); await pendingLogin;
    expect(transport.connect).toHaveBeenCalledWith({ kind: 'server', session });
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ authRequired: false, authPending: false }));
    app.logout(); expect(transport.dispose).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ authRequired: true, authName: '' }));
  });

  it.each(['settings', 'logout', 'restart', 'dispose'] as const)('cancels pending login on %s and ignores stale results', async (action) => {
    let resolve!: (session: ServerSession) => void; let signal!: AbortSignal;
    const login = vi.fn((_url: string, _name: string, requestSignal: AbortSignal) => { signal = requestSignal; return new Promise<ServerSession>((done) => { resolve = done; }); });
    const network = vi.fn(); app.dispose();
    app = new GameApp(parseConfig({ session: 'online' }, 'http://school.local'), createRenderer, undefined, null, network, login);
    app.start(host); const pendingLogin = app.login('Аня');
    if (action === 'settings') app.applySettings('online', 'http://another.local', 'demo', 1, false);
    if (action === 'logout') app.logout(); if (action === 'restart') app.restart(host); if (action === 'dispose') app.dispose();
    expect(signal.aborted).toBe(true);
    resolve({ token: 'x'.repeat(43), expiresAt: Date.now() + 10000 }); await pendingLogin;
    expect(network).not.toHaveBeenCalled();
  });

  it('times out login after ten seconds and allows retry without accepting the late response', async () => {
    vi.useFakeTimers(); let resolve!: (session: ServerSession) => void; const login = vi.fn(() => new Promise<ServerSession>((done) => { resolve = done; }));
    app.dispose(); const network = vi.fn();
    app = new GameApp(parseConfig({ session: 'online' }, 'http://school.local'), createRenderer, undefined, null, network, login);
    const listener = vi.fn(); app.subscribe(listener); app.start(host);
    try {
      const pendingLogin = app.login('Аня'); await vi.advanceTimersByTimeAsync(10000);
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ authPending: false, authRequired: true, authError: expect.stringContaining('10 секунд') }));
      resolve({ token: 'x'.repeat(43), expiresAt: Date.now() + 10000 }); await pendingLogin; expect(network).not.toHaveBeenCalled();
      login.mockRejectedValueOnce(new Error('Сервер недоступен')); await app.login('Аня');
      expect(login).toHaveBeenCalledTimes(2); expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ authError: 'Сервер недоступен', authPending: false }));
    } finally { app.dispose(); vi.useRealTimers(); }
  });

  it('explains registration timeout recovery and revokes a cancelled late issued token', async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    const fetch = vi.fn((url: string, init?: RequestInit): Promise<Response> => {
      if (url.endsWith('/api/auth/register')) return new Promise(done => { resolve = done; });
      if (url.endsWith('/api/auth/logout')) { expect(init?.headers).toEqual({ Authorization: `Bearer ${'x'.repeat(43)}` }); return Promise.resolve(new Response(null, { status: 204 })); }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    app.dispose(); const network = vi.fn();
    app = new GameApp(parseConfig({ session: 'online' }, 'http://school.local'), createRenderer, undefined, null, network);
    const listener = vi.fn(); app.subscribe(listener); app.start(host);
    try {
      const pending = app.register('Аня', 'registration-password');
      await vi.advanceTimersByTimeAsync(10000);
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ authRequired: true, authPending: false, authError: expect.stringContaining('Аккаунт мог быть создан') }));
      expect(listener.mock.lastCall?.[0].authError).toContain('Вход');
      resolve(new Response(JSON.stringify({ token: 'x'.repeat(43), expiresAt: Date.now() + 10000 }), { status: 201 }));
      await pending;
      expect(fetch.mock.calls.map(([url]) => url)).toEqual(['http://school.local/api/auth/register', 'http://school.local/api/auth/logout']);
      expect(network).not.toHaveBeenCalled();
      expect(listener.mock.lastCall?.[0].authError).toContain('Аккаунт мог быть создан');
    } finally { app.dispose(); vi.useRealTimers(); }
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
    app = new GameApp(parseConfig({}, 'http://school.local'), createRenderer, () => session, null);
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
      app = new GameApp(parseConfig({ debug: true }, 'http://school.local'), createRenderer, undefined, null);
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
        phase: 'stopped', coordinates: `X ${position!.x.toFixed(1)} · Z ${position!.z.toFixed(1)} · Y ${position!.y.toFixed(1)}`,
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

  it('switches HUD panels and blocks capture until the map closes', () => {
    const lockProperty = Object.getOwnPropertyDescriptor(document, 'pointerLockElement');
    const exitProperty = Object.getOwnPropertyDescriptor(document, 'exitPointerLock');
    let locked: Element | null = null;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
    Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: () => { locked = null; document.dispatchEvent(new Event('pointerlockchange')); } });
    const request = vi.fn(() => { locked = host; document.dispatchEvent(new Event('pointerlockchange')); return Promise.resolve(); });
    Object.defineProperty(host, 'requestPointerLock', { configurable: true, value: request });
    try {
      app.dispose(); app = new GameApp(parseConfig({ mapId: 'market' }, 'http://school.local'), createRenderer, undefined, null);
      const listener = vi.fn(); app.subscribe(listener); app.start(host); app.closeMarketPanel(); app.enterWorld();
      expect(locked).toBe(host);
      app.toggleHudPanel('inventory');
      expect(locked).toBeNull();
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ marketPanel: 'inventory', mapOpen: false, phase: 'stopped' }));
      app.toggleHudPanel('map');
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ marketPanel: null, mapOpen: true, mapPlayer: expect.objectContaining({ authoritative: false }) }));
      app.resume(); expect(request).toHaveBeenCalledTimes(1);
      app.toggleHudPanel('words');
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ mapOpen: false, marketPanel: 'words' }));
      app.toggleHudPanel('words');
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ marketPanel: null, phase: 'stopped' }));
      app.resume(); expect(request).toHaveBeenCalledTimes(2);
    } finally {
      app.dispose();
      if (lockProperty) Object.defineProperty(document, 'pointerLockElement', lockProperty); else Reflect.deleteProperty(document, 'pointerLockElement');
      if (exitProperty) Object.defineProperty(document, 'exitPointerLock', exitProperty); else Reflect.deleteProperty(document, 'exitPointerLock');
    }
  });

  it('waits for queued visuals before capture and still requires explicit start or resume', () => {
    const lockProperty = Object.getOwnPropertyDescriptor(document, 'pointerLockElement');
    const exitProperty = Object.getOwnPropertyDescriptor(document, 'exitPointerLock');
    let locked: Element | null = null, loading = true;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
    Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: () => { locked = null; document.dispatchEvent(new Event('pointerlockchange')); } });
    const request = vi.fn(() => { locked = host; document.dispatchEvent(new Event('pointerlockchange')); return Promise.resolve(); });
    Object.defineProperty(host, 'requestPointerLock', { configurable: true, value: request });
    const diagnostics = renderer.getDiagnostics();
    vi.mocked(renderer.getDiagnostics).mockImplementation(() => ({ ...diagnostics, pending: loading ? 1 : 0 }));
    const listener = vi.fn(); app.subscribe(listener);
    try {
      app.start(host); advance(100); app.enterWorld();
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ visualLoading: true, capture: 'idle' }));
      expect(request).not.toHaveBeenCalled();
      loading = false; advance(200);
      expect(request).not.toHaveBeenCalled();
      app.enterWorld(); expect(request).toHaveBeenCalledTimes(1);
      loading = true; app.stop(); app.resume();
      expect(request).toHaveBeenCalledTimes(1); expect(locked).toBeNull();
      loading = false; advance(300);
      expect(request).toHaveBeenCalledTimes(1);
      app.resume(); expect(request).toHaveBeenCalledTimes(2);
    } finally {
      app.dispose();
      if (lockProperty) Object.defineProperty(document, 'pointerLockElement', lockProperty); else Reflect.deleteProperty(document, 'pointerLockElement');
      if (exitProperty) Object.defineProperty(document, 'exitPointerLock', exitProperty); else Reflect.deleteProperty(document, 'exitPointerLock');
    }
  });

  it('opens inventory with I and leaves capture idle until an explicit resume', () => {
    const lockProperty = Object.getOwnPropertyDescriptor(document, 'pointerLockElement');
    const exitProperty = Object.getOwnPropertyDescriptor(document, 'exitPointerLock');
    let locked: Element | null = null;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
    Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: () => { locked = null; document.dispatchEvent(new Event('pointerlockchange')); } });
    const request = vi.fn(() => { locked = host; document.dispatchEvent(new Event('pointerlockchange')); return Promise.resolve(); });
    Object.defineProperty(host, 'requestPointerLock', { configurable: true, value: request });
    try {
      app.dispose(); app = new GameApp(parseConfig({ mapId: 'market' }, 'http://school.local'), createRenderer, undefined, null);
      const listener = vi.fn(); app.subscribe(listener); app.start(host); app.closeMarketPanel(); app.enterWorld();
      expect(locked).toBe(host); expect(request).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI' }));
      expect(locked).toBeNull();
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ marketPanel: 'inventory', phase: 'stopped', capture: 'idle' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI' }));
      expect(locked).toBeNull(); expect(request).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ marketPanel: 'inventory', phase: 'stopped', capture: 'idle' }));
      app.toggleHudPanel('inventory');
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ marketPanel: null, phase: 'stopped', capture: 'idle' }));
      expect(locked).toBeNull(); expect(request).toHaveBeenCalledTimes(1);
      app.resume(); expect(locked).toBe(host); expect(request).toHaveBeenCalledTimes(2);
    } finally {
      app.dispose();
      if (lockProperty) Object.defineProperty(document, 'pointerLockElement', lockProperty); else Reflect.deleteProperty(document, 'pointerLockElement');
      if (exitProperty) Object.defineProperty(document, 'exitPointerLock', exitProperty); else Reflect.deleteProperty(document, 'exitPointerLock');
    }
  });

  it('cleans the loop, session and renderer when a simulation step fails', () => {
    const session = new LocalSession('test', [{ id: 'test', character: { kind: 'player', name: 'Test' } }]);
    vi.spyOn(session, 'update').mockImplementationOnce(() => { throw new Error('Simulation failed'); });
    const disposed = vi.spyOn(session, 'dispose');
    app.dispose();
    app = new GameApp(parseConfig({}, 'http://school.local'), createRenderer, () => session, null);
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
