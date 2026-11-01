// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabylonRequest, BabylonState } from '../../../shared/babylon/types.ts';
import { EMPTY_INVENTORY } from '../../../shared/babylon/types.ts';
import { parseBabylonResult } from '../../../shared/babylon/validate.ts';
import { initialMotion, motionStatus } from '../../../shared/movement/simulation.ts';
import type { ClientMessage } from '../../../shared/protocol/types.ts';
import type { Entity } from '../core/types';
import { MockNetworkAdapter } from '../multiplayer/MockNetworkAdapter';
import type { RenderAdapter } from '../render/RenderAdapter';
import { MARKET_WORLD } from '../shared/marketWorld.generated';
import { GameApp, type AppSnapshot } from './GameApp';
import { parseConfig } from './config';

// Unit boundaries only: no server, Socket.IO connection, map asset requests, or LAN acceptance.
const playerId = 'map-player', nearId = 'near-task-peer', farId = 'far-task-peer';
function taskState(): BabylonState {
  return {
    v: 2, playerId, backend: 'test', languages: ['ru', 'en', 'es'],
    profile: { native: 'ru', learning: 'en' }, introSeen: true,
    party: { id: 'map-task', size: 3, count: 3, role: 1, members: [
      { id: playerId, name: 'Me', role: 1 }, { id: nearId, name: 'Near peer', role: 2 }, { id: farId, name: 'Far peer', role: 3 },
    ], started: true, completed: false, seconds: 10 },
    availableParty: null,
    partyPositions: [{ id: nearId, name: 'Near peer', x: 10, z: 11 }, { id: farId, name: 'Far peer', x: -100, z: -80 }],
    task: 'Task map unit fixture', taskTitle: 'Task', taskTarget: { x: 0, z: -34 }, goatGuide: null,
    inventory: { ...EMPTY_INVENTORY }, fed: [], stones: [], words: [], messages: [], replies: [],
  };
}
function actor(id: string, name: string, x: number, z: number): Entity {
  const position = { x, y: 0, z };
  return { id, character: { kind: 'player', name }, transform: { position, rotationY: 0 }, motion: motionStatus(initialMotion(position)) };
}

const frames = new Map<number, FrameRequestCallback>();
let frameId = 0, timestamp = 0;
let app: GameApp | undefined;
let pointerLockProperty: PropertyDescriptor | undefined, exitLockProperty: PropertyDescriptor | undefined;
function frame(ms = 20) {
  timestamp += ms;
  const callbacks = [...frames.values()]; frames.clear();
  for (const callback of callbacks) callback(timestamp);
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  frames.clear(); frameId = 0; timestamp = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  pointerLockProperty = Object.getOwnPropertyDescriptor(document, 'pointerLockElement');
  exitLockProperty = Object.getOwnPropertyDescriptor(document, 'exitPointerLock');
});
afterEach(() => {
  app?.dispose(); app = undefined;
  if (pointerLockProperty) Object.defineProperty(document, 'pointerLockElement', pointerLockProperty); else Reflect.deleteProperty(document, 'pointerLockElement');
  if (exitLockProperty) Object.defineProperty(document, 'exitPointerLock', exitLockProperty); else Reflect.deleteProperty(document, 'exitPointerLock');
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

async function openTaskMap() {
  let state = taskState(), snapshot!: AppSnapshot, transport!: MockNetworkAdapter;
  const sent: ClientMessage[] = [];
  const host = document.createElement('div');
  host.getBoundingClientRect = () => new DOMRect(0, 0, 640, 480);
  let locked: Element | null = null;
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
  Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: () => { locked = null; document.dispatchEvent(new Event('pointerlockchange')); } });
  Object.defineProperty(host, 'requestPointerLock', { configurable: true, value: () => { locked = host; document.dispatchEvent(new Event('pointerlockchange')); return Promise.resolve(); } });
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
    if (String(input).endsWith('/api/avatar')) return Promise.resolve(new Response(JSON.stringify({ avatarId: 'lukas' })));
    if (String(input).endsWith('/api/auth/logout')) return Promise.resolve(new Response(null, { status: 204 }));
    if (String(input) !== 'http://task-map.unit/api/babylon' || typeof options?.body !== 'string') throw new Error(`Unexpected task-map fetch: ${String(input)}`);
    const packet = JSON.parse(options.body) as BabylonRequest;
    if (packet.action.type !== 'state' && packet.action.type !== 'join') throw new Error('Unexpected task-map action');
    const result = { v: 2 as const, requestId: packet.requestId, state };
    parseBabylonResult(result);
    return Promise.resolve(new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } }));
  }));
  const renderer: RenderAdapter = {
    setSceneState: vi.fn(), mount: vi.fn(), render: vi.fn(), resize: vi.fn(), syncWorld: vi.fn(), setCamera: vi.fn(), setBuildingSymbols: vi.fn(),
    registerModels: vi.fn(), loadChunk: vi.fn().mockResolvedValue(undefined), unloadChunk: vi.fn(), retryFailedModels: vi.fn(),
    getDiagnostics: vi.fn(() => ({ chunks: [], entities: [], models: 0, instances: 0, queued: 0, pending: 0, errors: [], geometries: 0, textures: 0, drawCalls: 0 })), dispose: vi.fn(),
  };
  app = new GameApp(parseConfig({ session: 'online', mapId: 'market' }, 'http://task-map.unit'), () => renderer, undefined, null, (_mock, _url, clock) => {
    transport = new MockNetworkAdapter(clock, (message, network) => {
      sent.push(message);
      if (message.type === 'join') network.receive({ v: 3, type: 'joined', requestId: message.requestId, playerId, revision: 0,
        snapshot: { tick: 0, entities: [actor(playerId, 'Me', 0, 8), actor(nearId, 'AOI display name', 2, 3), actor('unrelated-actor', 'Outsider', 4, 5)] }, world: MARKET_WORLD });
    });
    // Adapt only the test boundary. GameApp still uses a real OnlineSession and server context.
    const connect = transport.connect.bind(transport);
    vi.spyOn(transport, 'connect').mockImplementation(() => connect({ kind: 'mock' }));
    return transport;
  });
  app.subscribe(value => { snapshot = value; });
  app.start(host);
  app.provideServerSession({ token: 'm'.repeat(43), expiresAt: Date.now() + 60_000 });
  await vi.advanceTimersByTimeAsync(0);
  expect(snapshot.babylonPanel).toBe('setup');
  expect(await app.connectEntryGame(app.config.serverUrl)).toBe(true);
  await vi.advanceTimersByTimeAsync(100);
  frame(0);
  expect(snapshot.phase).toBe('running');
  app.enterWorld();
  await vi.advanceTimersByTimeAsync(0);
  expect(snapshot.screen).toBe('playing');
  app.toggleHudPanel('map');
  expect(snapshot).toMatchObject({ phase: 'stopped', mapOpen: true });
  const game = app;
  return { game, sent, transport, get snapshot() { return snapshot; },
    setPoll(next: BabylonState['partyPositions']) { state = { ...state, partyPositions: next }; },
    async poll() { await vi.advanceTimersByTimeAsync(1000); frame(); frame(); },
    async delta(revision: number, upsert: Entity[], remove: string[] = []) {
      transport.receive({ v: 3, type: 'delta', revision, baseRevision: revision - 1, tick: revision, upsert, remove });
      await vi.advanceTimersByTimeAsync(1); frame(); frame();
    },
  };
}

describe('task map merges polled positions with authoritative AOI', () => {
  it('retains the task peer outside the current AOI snapshot', async () => {
    const f = await openTaskMap();
    expect(f.game.getWorldSnapshot()?.entities.some(entity => entity.id === farId)).toBe(false);
    expect(f.snapshot.mapPeers).toContainEqual({ id: farId, name: 'Far peer', x: -100, z: -80 });
  });

  it('prefers the AOI transform for the same peer without duplicating or adding extra map fields', async () => {
    const f = await openTaskMap();
    expect(f.snapshot.babylon?.state?.partyPositions.find(peer => peer.id === nearId)).toMatchObject({ x: 10, z: 11 });
    expect(f.snapshot.mapPeers.filter(peer => peer.id === nearId)).toEqual([{ id: nearId, name: 'Near peer', x: 2, z: 3 }]);
    for (const peer of f.snapshot.mapPeers) expect(Object.keys(peer).sort()).toEqual(['id', 'name', 'x', 'z']);
  });

  it('excludes the caller and nonmember AOI actors', async () => {
    const f = await openTaskMap();
    expect(f.game.getWorldSnapshot()?.entities.some(entity => entity.id === 'unrelated-actor')).toBe(true);
    expect(f.snapshot.mapPeers.map(peer => peer.id).sort()).toEqual([farId, nearId].sort());
    expect(f.snapshot.mapPeers.some(peer => peer.id === playerId || peer.id === 'unrelated-actor')).toBe(false);
  });

  it('removes markers after polling and the active snapshot no longer contain the peers', async () => {
    const f = await openTaskMap();
    f.setPoll([]);
    await f.poll();
    // Only the still-active AOI peer remains; the old far marker must not be cached.
    expect(f.snapshot.mapPeers).toEqual([{ id: nearId, name: 'Near peer', x: 2, z: 3 }]);
    await f.delta(1, [], [nearId]);
    expect(f.game.getWorldSnapshot()?.entities.some(entity => entity.id === nearId)).toBe(false);
    expect(f.snapshot.mapPeers).toEqual([]);
  });

  it('continues polling and applying peer deltas while the map blocks movement', async () => {
    const f = await openTaskMap();
    expect(f.game.send({ type: 'move', direction: { x: 1, z: 0 } })).toBe(false);
    f.setPoll([{ id: farId, name: 'Far peer', x: -120, z: -90 }]);
    await f.poll();
    await f.delta(1, [actor(nearId, 'AOI display name', 7, 9)]);
    expect(f.snapshot).toMatchObject({ phase: 'stopped', mapOpen: true, mapPeers: expect.arrayContaining([
      { id: farId, name: 'Far peer', x: -120, z: -90 }, { id: nearId, name: 'Near peer', x: 7, z: 9 },
    ]) });
    expect(f.game.send({ type: 'move', direction: { x: 0, z: 1 } })).toBe(false);
    expect(f.sent.filter(message => message.type === 'input').every(message => message.direction.x === 0 && message.direction.z === 0)).toBe(true);
  });
});
