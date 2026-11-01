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
import { WorldAudio, AUDIO_VOLUME_KEY } from '../audio/WorldAudio';
import { MockWorldLife } from '../multiplayer/MockWorldLife';
import type { WorldLifeClientMessage } from '../../../shared/world-life/types.ts';
import type { BabylonRequest, BabylonState } from '../../../shared/babylon/types.ts';

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
    renderer = { mount: vi.fn(), render: vi.fn(), resize: vi.fn(), syncWorld: vi.fn(), setCamera: vi.fn(), setBuildingSymbols: vi.fn(), setSceneState: vi.fn(), registerModels: vi.fn(), loadChunk: vi.fn().mockResolvedValue(undefined), unloadChunk: vi.fn(), retryFailedModels: vi.fn(), getDiagnostics: vi.fn(() => ({ chunks: [], entities: [], models: 0, instances: 0, queued: 0, pending: 0, errors: [], geometries: 0, textures: 0, drawCalls: 0 })), dispose: vi.fn() };
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
    renderer = { mount: vi.fn(), render: vi.fn(), resize: vi.fn(), syncWorld: vi.fn(), setCamera: vi.fn(), setBuildingSymbols: vi.fn(), setSceneState: vi.fn(), registerModels: vi.fn(), loadChunk: vi.fn().mockResolvedValue(undefined), unloadChunk: vi.fn(), retryFailedModels: vi.fn(), getDiagnostics: vi.fn(() => ({ chunks: [], entities: [], models: 0, instances: 0, queued: 0, pending: 0, errors: [], geometries: 0, textures: 0, drawCalls: 0 })), dispose: vi.fn() };
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
    const transport: NetworkAdapter = { state: { status: 'unauthorized', error: null }, connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(() => false), sendWorldLife: vi.fn(() => false), subscribe: vi.fn(() => () => {}), subscribeWorldLife: vi.fn(() => () => {}), subscribeState: vi.fn((listener) => { listener({ status: 'unauthorized', error: null }); return () => {}; }), dispose: vi.fn() };
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
    const transport: NetworkAdapter = { state: { status: 'unauthorized', error: null }, connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(() => false), sendWorldLife: vi.fn(() => false), subscribeWorldLife: vi.fn(() => () => {}), subscribe: vi.fn(() => () => {}), subscribeState: vi.fn(() => () => {}), dispose: vi.fn() };
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
    const transport: NetworkAdapter = { state: { status: 'unauthorized', error: null }, connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(() => false), sendWorldLife: vi.fn(() => false), subscribeWorldLife: vi.fn(() => () => {}), subscribe: vi.fn(() => () => {}), subscribeState: vi.fn(() => () => {}), dispose: vi.fn() };
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
    const transport: NetworkAdapter = { state: { status: 'unauthorized', error: null }, connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(() => false), sendWorldLife: vi.fn(() => false), subscribe: vi.fn(() => () => {}), subscribeWorldLife: vi.fn(() => () => {}), subscribeState: vi.fn(() => () => {}), dispose: vi.fn() };
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

  it('requests native Pointer Lock before optional audio unlock in the same play handler', () => {
    const order: string[] = [];
    const requestLock = vi.fn(() => { order.push('capture'); return Promise.resolve(); });
    Object.defineProperty(host, 'requestPointerLock', { configurable: true, value: requestLock });
    const unlock = vi.spyOn(WorldAudio.prototype, 'unlock').mockImplementation(async () => { order.push('audio'); });
    try {
      app.start(host); app.enterWorld();
      expect(requestLock).toHaveBeenCalledOnce();
      expect(unlock).toHaveBeenCalledOnce();
      expect(order).toEqual(['capture', 'audio']);
    } finally { app.dispose(); unlock.mockRestore(); }
  });

  it('publishes only confirmed hands, forwards scene state, and keeps F pending separate from focus/MOVE', async () => {
    vi.useFakeTimers(); app.dispose();
    const lockProperty = Object.getOwnPropertyDescriptor(document, 'pointerLockElement');
    const exitProperty = Object.getOwnPropertyDescriptor(document, 'exitPointerLock');
    let locked: Element | null = null;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
    Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: () => { locked = null; document.dispatchEvent(new Event('pointerlockchange')); } });
    Object.defineProperty(host, 'requestPointerLock', { value: () => { locked = host; document.dispatchEvent(new Event('pointerlockchange')); return Promise.resolve(); } });
    const actor = { id: 'p1', motion: motionStatus(initialMotion({ x: 0, y: 0, z: 0 })), transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0 }, character: { kind: 'player' as const, name: 'P1' } };
    let transport!: MockNetworkAdapter; const hands: WorldLifeClientMessage[] = [];
    const retain = vi.spyOn(WorldAudio.prototype, 'retainEntities');
    const factory = (_mock: boolean, _url: string, clock: import('../multiplayer/NetworkAdapter').Clock) => {
      const life = new MockWorldLife('demo', clock.now(), actor.transform.position);
      transport = new MockNetworkAdapter(clock, (message, peer) => {
        if (message.type === 'join') peer.receive({ v: 3, type: 'joined', requestId: message.requestId, playerId: actor.id, revision: 0, snapshot: { tick: 0, entities: [actor, { ...actor, id: 'p2' }] }, world: DEMO_WORLD });
      }, (message, peer) => { if (message.type === 'scene-sync') peer.receiveWorldLife(life.snapshot(clock.now())); else hands.push(message); });
      return transport;
    };
    const listener = vi.fn();
    try {
      app = new GameApp(parseConfig({ session: 'online' }, 'http://school.local'), createRenderer, undefined, null, factory);
      app.subscribe(listener); app.applySettings('mock', 'http://school.local', 'demo', 1, false); app.start(host);
      await vi.advanceTimersByTimeAsync(200); advance(0); app.enterWorld();
      transport.receive({ v: 3, type: 'delta', baseRevision: 0, revision: 1, tick: 1, upsert: [], remove: ['p2'] });
      await vi.advanceTimersByTimeAsync(50); advance(20); advance(40);
      expect(retain).toHaveBeenLastCalledWith(['p1']);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'а' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', repeat: true }));
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ carryPending: true, heldItemId: null }));
      await vi.advanceTimersByTimeAsync(100); expect(hands).toHaveLength(1);
      expect(renderer.setSceneState).toHaveBeenCalledWith(expect.objectContaining({ type: 'scene-state' }));
      const hand = hands[0]!;
      if (hand.type !== 'hand') throw new Error('Missing hand request');
      transport.receiveWorldLife({ v: 1, type: 'hand-result', requestId: hand.requestId, ok: false, code: 'BLOCKED', message: 'Занято.' });
      await vi.advanceTimersByTimeAsync(1);
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ carryPending: false, heldItemId: null, carryError: 'Занято.' }));
      app.toggleMenu();
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
      await vi.advanceTimersByTimeAsync(100); expect(hands).toHaveLength(1);
      app.resume(); await vi.advanceTimersByTimeAsync(100); expect(hands).toHaveLength(1);
    } finally {
      app.dispose(); vi.useRealTimers(); retain.mockRestore();
      if (lockProperty) Object.defineProperty(document, 'pointerLockElement', lockProperty); else Reflect.deleteProperty(document, 'pointerLockElement');
      if (exitProperty) Object.defineProperty(document, 'exitPointerLock', exitProperty); else Reflect.deleteProperty(document, 'exitPointerLock');
    }
  });

  it('integrates silent audio baselines, confirmed movement and one jump, volume storage and scene disposal', () => {
    const movement = vi.spyOn(WorldAudio.prototype, 'movement');
    const disposed = vi.spyOn(WorldAudio.prototype, 'dispose');
    localStorage.removeItem(AUDIO_VOLUME_KEY);
    try {
      app.start(host);
      expect(movement).toHaveBeenCalledWith(expect.objectContaining({ tick: 0, origin: 'snapshot', jumpStarted: false }));
      app.send({ type: 'move', direction: { x: 1, z: 0 } });
      advance(0); advance(100);
      expect(movement).toHaveBeenCalledWith(expect.objectContaining({ origin: 'live', grounded: true, position: expect.objectContaining({ x: expect.any(Number) }) }));
      app.send({ type: 'jump' }); advance(120); advance(140);
      expect(movement.mock.calls.filter(([sample]) => sample.jumpStarted)).toHaveLength(1);
      const listener = vi.fn(); app.subscribe(listener); app.setVolume(42);
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ volume: .42 }));
      app.restart(host);
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ volume: .42 }));
      app.setVolume(0); expect(localStorage.getItem(AUDIO_VOLUME_KEY)).toBe('0');
      const count = disposed.mock.calls.length; app.dispose(); expect(disposed.mock.calls.length).toBe(count + 1);
    } finally { localStorage.removeItem(AUDIO_VOLUME_KEY); movement.mockRestore(); disposed.mockRestore(); }
  });

  it('keeps BABEL interaction open/reopen silent for old history and goats, but emits both new reply utterances', async () => {
    app.dispose();
    const messages = vi.spyOn(WorldAudio.prototype, 'message').mockImplementation(() => {});
    let state: BabylonState = {
      v: 2, playerId: 'p1', backend: 'test', languages: ['ru', 'en'], profile: { native: 'ru', learning: 'en' }, introSeen: true,
      party: null, availableParty: null, partyPositions: [], taskTitle: '', taskTarget: null, task: '', goatGuide: null, inventory: { dates: 0, 'red-fruit': 0, 'yellow-fruit': 0, water: 0, fabric: 0 },
      fed: [], stones: [], words: [], messages: [], replies: [{ id: 'old', npcId: 'fruit-seller', question: 'Old question', text: 'Old answer', language: 'en' }],
    };
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, options: RequestInit) => {
      if (String(_url).endsWith('/api/avatar')) return new Response(JSON.stringify({ avatarId: 'dan' }));
      const request = JSON.parse(String(options.body)) as BabylonRequest;
      if (request.action.type === 'npc') state = { ...state, replies: [...state.replies, { id: 'new', npcId: request.action.targetId, question: request.action.text, text: 'New answer', language: 'en' }] };
      return new Response(JSON.stringify({ v: 2, requestId: request.requestId, state }));
    }));
    const network: NetworkAdapter = { state: { status: 'unauthorized', error: null }, connect: vi.fn(), disconnect: vi.fn(), dispose: vi.fn(), send: vi.fn(() => true), sendWorldLife: vi.fn(() => true),
      subscribe: () => () => {}, subscribeWorldLife: () => () => {}, subscribeState: () => () => {} };
    try {
      app = new GameApp(parseConfig({ session: 'online', mapId: 'market' }, 'http://school.local'), createRenderer, undefined, null, () => network);
      app.provideServerSession({ token: 'a'.repeat(64), expiresAt: Date.now() + 60_000 });
      let loaded!: () => void;
      const ready = new Promise<void>(resolve => { loaded = resolve; });
      app.subscribe(snapshot => { if (snapshot.babylon?.state) loaded(); });
      app.start(host); await ready;
      state = { ...state, party: { id: 'audio-party', size: 1, count: 1, role: 1, members: [{ id: 'p1', name: 'Audio', role: 1 }], started: true, completed: false, seconds: 0 } };
      expect(await app.connectEntryGame(app.config.serverUrl)).toBe(true);
      const views = vi.fn(); app.subscribe(views);
      expect(messages.mock.calls.map(([event]) => event)).toEqual([
        expect.objectContaining({ id: 'babel-npc:old:question', origin: 'history' }),
        expect.objectContaining({ id: 'babel-npc:old:answer', origin: 'history' }),
      ]);
      messages.mockClear();
      for (const target of ['fruit-seller', 'fruit-seller', 'white-goat', 'white-goat']) {
        app.openBabylonPanel('interaction', target); await app.closeBabylonPanel();
      }
      expect(messages).not.toHaveBeenCalled();
      app.openBabylonPanel('interaction', 'fruit-seller');
      expect(views).toHaveBeenLastCalledWith(expect.objectContaining({ babylonPanel: 'interaction', babylonTarget: 'fruit-seller' }));
      expect(await app.babylonAction({ type: 'npc', targetId: 'fruit-seller', text: 'New question' })).toBe(true);
      expect(messages.mock.calls.map(([event]) => event)).toEqual([
        expect.objectContaining({ id: 'babel-npc:new:question', origin: 'live' }),
        expect.objectContaining({ id: 'babel-npc:new:answer', origin: 'live' }),
      ]);
      messages.mockClear();
      await app.closeBabylonPanel(); app.openBabylonPanel('interaction', 'fruit-seller');
      await app.babylonAction({ type: 'state' });
      expect(messages).not.toHaveBeenCalled();
    } finally { app.dispose(); messages.mockRestore(); vi.unstubAllGlobals(); }
  });

  it('keeps local market goat controls silent while retaining actual prepared NPC greetings', () => {
    app.dispose();
    const messages = vi.spyOn(WorldAudio.prototype, 'message').mockImplementation(() => {});
    try {
      app = new GameApp(parseConfig({ mapId: 'market' }, 'http://school.local'), createRenderer, undefined, null); app.start(host);
      app.openMarketPanel('interaction', 'white-goat'); app.closeMarketPanel();
      app.openMarketPanel('interaction', 'white-goat');
      expect(messages).not.toHaveBeenCalled();
      app.closeMarketPanel(); app.openMarketPanel('interaction', 'shepherd');
      expect(messages).toHaveBeenCalledOnce();
      expect(messages).toHaveBeenCalledWith(expect.objectContaining({ stream: 'market-npc', origin: 'live' }));
    } finally { app.dispose(); messages.mockRestore(); }
  });

  it('emits separate local demo question and answer mumbles only when those utterances are appended', () => {
    app.dispose();
    const messages = vi.spyOn(WorldAudio.prototype, 'message').mockImplementation(() => {});
    const local = () => new LocalSession('p1', [
      { id: 'p1', character: { kind: 'player', name: 'P1' }, transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0 } },
      { id: 'history-guide', character: { kind: 'npc', name: 'Лея' }, transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0 }, interactable: { radius: 2, label: 'Talk' } },
    ]);
    try {
      app = new GameApp(parseConfig({}, 'http://school.local'), createRenderer, local, null); app.start(host);
      app.send({ type: 'interact', targetId: 'history-guide' }); advance(0); advance(20); messages.mockClear();
      app.submitDialog('Что такое источник?');
      const events = messages.mock.calls.map(([event]) => event);
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ id: expect.stringMatching(/^local-npc:.*:question$/), stream: 'npc:history-guide', origin: 'live' });
      expect(events[1]).toMatchObject({ id: events[0]!.id.replace(/:question$/, ':answer'), stream: 'npc:history-guide', origin: 'live' });
      app.submitDialog('   '); advance(0); advance(20);
      expect(messages).toHaveBeenCalledTimes(2);
      app.closeDialog(); app.restart(host);
      expect(messages.mock.calls.filter(([event]) => event.origin === 'live')).toHaveLength(2);
    } finally { app.dispose(); messages.mockRestore(); }
  });

  it('mumbles a newly appended online question once and its correlated answer once without replay on reconnect', async () => {
    app.dispose(); vi.useFakeTimers();
    const messages = vi.spyOn(WorldAudio.prototype, 'message').mockImplementation(() => {});
    let transport!: MockNetworkAdapter; let question: { requestId: string; targetId: string } | null = null;
    const actor = { id: 'p1', motion: motionStatus(initialMotion({ x: 0, y: 0, z: 0 })), transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0 }, character: { kind: 'player' as const, name: 'P1' } };
    const guide = { id: 'history-guide', character: { kind: 'npc' as const, name: 'Лея' }, transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0 }, interactable: { radius: 2, label: 'Talk' } };
    const factory = (_mock: boolean, _url: string, clock: import('../multiplayer/NetworkAdapter').Clock) => {
      transport = new MockNetworkAdapter(clock, (packet, peer) => {
        if (packet.type === 'join') peer.receive({ v: 3, type: 'joined', requestId: packet.requestId, playerId: actor.id, revision: 0, snapshot: { tick: 0, entities: [actor, guide] }, world: DEMO_WORLD });
        else if (packet.type === 'interact') peer.receive({ v: 3, type: 'interacted', requestId: packet.requestId, targetId: packet.targetId });
        else if (packet.type === 'npc-question') question = packet;
      });
      return transport;
    };
    try {
      app = new GameApp(parseConfig({}, 'http://school.local'), createRenderer, undefined, null, factory);
      app.applySettings('mock', 'http://school.local', 'demo', 1, false); app.start(host);
      await vi.advanceTimersByTimeAsync(200);
      app.send({ type: 'interact', targetId: 'history-guide' }); await vi.advanceTimersByTimeAsync(100);
      messages.mockClear(); app.submitDialog('Question'); app.submitDialog('Pending duplicate');
      expect(messages).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(100);
      expect(question).not.toBeNull();
      const reply = { v: 3, type: 'npc-answer', requestId: question!.requestId, targetId: question!.targetId, text: 'Answer' };
      transport.receive(reply); transport.receive(reply); await vi.advanceTimersByTimeAsync(1);
      const events = messages.mock.calls.map(([event]) => event);
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ id: `npc-question:${question!.requestId}`, origin: 'live' });
      expect(events[1]).toMatchObject({ id: `npc-answer:${question!.requestId}`, origin: 'live' });
      app.reconnect(); await vi.advanceTimersByTimeAsync(200);
      expect(messages.mock.calls.filter(([event]) => event.origin === 'live')).toHaveLength(2);
    } finally { app.dispose(); messages.mockRestore(); vi.useRealTimers(); }
  });

  it('publishes bounded-cadence debug audio counters and zeroes them on scene disposal', () => {
    app.dispose();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const stats = vi.spyOn(WorldAudio.prototype, 'stats', 'get').mockReturnValue({ sources: 2, buffers: 3, pending: 1, reservedBytes: 456, failures: 0, unlocked: true, entities: 1, streams: 0, messageIds: 0 });
    try {
      app = new GameApp(parseConfig({ debug: true }, 'http://school.local'), createRenderer, undefined, null);
      const listener = vi.fn(); app.subscribe(listener); app.start(host); advance(0);
      now.mockReturnValue(1100); advance(100);
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ audioStats: 'Источники: 2 · Буферы: 3 · Загрузки: 1 · Память: 456 байт' }));
      app.dispose();
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ audioStats: 'Источники: 0 · Буферы: 0 · Загрузки: 0 · Память: 0 байт' }));
    } finally { now.mockRestore(); stats.mockRestore(); }
  });

  it.each(['pending', 'failed'] as const)('shows a dialog error and sends no NPC request when metadata is %s', async (state) => {
    vi.useFakeTimers(); app.dispose();
    const sent: string[] = [];
    const load = () => state === 'pending' ? new Promise<number>(() => {}) : Promise.reject(new Error('unavailable'));
    app = new GameApp(parseConfig({ session: 'online' }, 'http://school.local'), createRenderer, undefined, null,
      (_mock, _url, clock) => {
        const adapter = new MockNetworkAdapter(clock, (message, peer) => {
          sent.push(message.type);
          if (message.type === 'join') peer.receive({ v: 3, type: 'joined', requestId: message.requestId, playerId: 'p1', revision: 0, snapshot: { tick: 0, entities: [
            { id: 'p1', character: { kind: 'player', name: 'Player' }, transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0 } },
            { id: 'guide', character: { kind: 'npc', name: 'Guide' }, transform: { position: { x: 0, y: 0, z: 1 }, rotationY: 0 }, interactable: { radius: 2, label: 'Talk' } },
          ] }, world: DEMO_WORLD });
          if (message.type === 'interact') peer.receive({ v: 3, type: 'interacted', requestId: message.requestId, targetId: message.targetId });
        });
        const connect = adapter.connect.bind(adapter); adapter.connect = () => connect({ kind: 'mock' }); return adapter;
      }, undefined, load);
    const listener = vi.fn(); app.subscribe(listener);
    try {
      app.start(host); app.provideServerSession({ token: 'x'.repeat(43), expiresAt: Date.now() + 60000 });
      await vi.advanceTimersByTimeAsync(100); app.send({ type: 'interact', targetId: 'guide' }); await vi.advanceTimersByTimeAsync(100);
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ dialog: expect.objectContaining({ npcId: 'guide' }) }));
      app.submitDialog('Question'); await vi.advanceTimersByTimeAsync(100);
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ dialogPending: false, dialogError: expect.stringContaining('недоступны') }));
      expect(sent).not.toContain('npc-question');
    } finally { app.dispose(); vi.useRealTimers(); }
  });

  it('passes the configured server URL to runtime metadata and cancels it on restart', async () => {
    vi.useFakeTimers(); app.dispose();
    const signals: AbortSignal[] = [];
    const load = vi.fn((_url: string, signal: AbortSignal) => { signals.push(signal); return new Promise<number>(() => {}); });
    app = new GameApp(parseConfig({ session: 'online', serverUrl: 'http://real.local:7777' }, 'http://school.local'), createRenderer, undefined, null,
      (_mock, _url, clock) => { const adapter = new MockNetworkAdapter(clock); const connect = adapter.connect.bind(adapter); adapter.connect = () => connect({ kind: 'mock' }); return adapter; }, undefined, load);
    try {
      app.start(host); app.provideServerSession({ token: 'x'.repeat(43), expiresAt: Date.now() + 60000 });
      await vi.advanceTimersByTimeAsync(0);
      expect(load).toHaveBeenCalledWith('http://real.local:7777', expect.any(AbortSignal));
      app.restart(host); expect(signals[0]!.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(0); expect(load).toHaveBeenCalledTimes(2);
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
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ marketPanel: null, phase: 'running', pauseOpen: false }));
      app.resume(); expect(request).toHaveBeenCalledTimes(2);
    } finally {
      app.dispose();
      if (lockProperty) Object.defineProperty(document, 'pointerLockElement', lockProperty); else Reflect.deleteProperty(document, 'pointerLockElement');
      if (exitProperty) Object.defineProperty(document, 'exitPointerLock', exitProperty); else Reflect.deleteProperty(document, 'exitPointerLock');
    }
  });

  it('keeps visual loading active while chunk HTTP is pending even with an empty renderer queue', async () => {
    app.dispose();
    const manifest: WorldManifest = { mapId: 'demo', version: 3, worldBytes: DEMO_WORLD.worldBytes, chunkSize: 32, collisionResolution: 4, spawn: { x: 8, y: 0, z: 8 }, origin: { x: 0, z: 0 }, models: {}, assets: {}, chunks: [{ id: '0', x: 0, z: 0, region: 'test', url: '0', bytes: 1, collisionUrl: 'c', collisionBytes: 16, assets: [] }] };
    let finish!: (value: Awaited<ReturnType<MapSource['chunk']>>) => void;
    const source: MapSource = { bootstrap: DEMO_WORLD, budgetEpoch: 0, manifest: async () => manifest, chunk: vi.fn(() => new Promise<Awaited<ReturnType<MapSource['chunk']>>>(resolve => { finish = resolve; })), dispose: vi.fn() };
    app = new GameApp(parseConfig({}, 'http://school.local'), createRenderer, undefined, () => source);
    const listener = vi.fn(); app.subscribe(listener); app.start(host);
    await vi.waitFor(() => expect(source.chunk).toHaveBeenCalled());
    advance(100);
    expect(renderer.getDiagnostics().pending).toBe(0);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ visualLoading: true }));
    const entry = manifest.chunks[0]!;
    finish({ entry, visual: { id: entry.id, objects: [] }, collision: new Uint8Array(16), release: vi.fn() });
    await vi.waitFor(() => expect(renderer.loadChunk).toHaveBeenCalled());
    await vi.waitFor(() => {
      advance(performance.now());
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ visualLoading: false }));
    });
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

  it('opens tasks with Tab, closes HUD windows into play and preserves only an explicit parent pause', () => {
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
      const key = (code: string) => window.dispatchEvent(new KeyboardEvent('keydown', { code, cancelable: true }));
      for (const oldKey of ['KeyI', 'KeyM', 'KeyK', 'KeyJ', 'KeyL', 'KeyO', 'Enter']) key(oldKey);
      expect(locked).toBe(host);
      key('Tab');
      expect(locked).toBeNull();
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ marketPanel: 'task', phase: 'stopped', capture: 'idle' }));
      key('Digit3');
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ mapOpen: true, marketPanel: null }));
      key('Tab');
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ mapOpen: true, marketPanel: null }));
      key('Digit2');
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ mapOpen: false, marketPanel: 'words' }));
      key('Digit2');
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ marketPanel: null, phase: 'running', capture: 'locked', pauseOpen: false }));
      key('Digit1');
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ chatOpen: true }));
      key('Digit1');
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ chatOpen: false }));
      expect(locked).toBe(host); expect(request).toHaveBeenCalledTimes(3);
      app.toggleMenu();
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ pauseOpen: true, phase: 'stopped' }));
      app.openSettings(); app.toggleMenu();
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ settingsOpen: false, pauseOpen: true, phase: 'stopped' }));
      app.toggleMenu();
      expect(locked).toBe(host); expect(request).toHaveBeenCalledTimes(4);
      app.toggleHudPanel('map'); app.toggleMenu();
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ mapOpen: false, pauseOpen: false, phase: 'running' }));
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
