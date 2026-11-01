// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabylonRequest, BabylonState } from '../../../shared/babylon/types.ts';
import { EMPTY_INVENTORY } from '../../../shared/babylon/types.ts';
import { parseBabylonResult } from '../../../shared/babylon/validate.ts';
import type { NetworkAdapter } from '../multiplayer/NetworkAdapter';
import type { RenderAdapter } from '../render/RenderAdapter';
import { GameApp, type AppSnapshot } from './GameApp';
import { parseConfig } from './config';

// These are isolated entry-flow fixtures, not evidence of a real server or LAN session.
function savedState(): BabylonState {
  return {
    v: 2, playerId: 'entry-player', backend: 'test', languages: ['ru', 'en', 'es'],
    profile: { native: 'es', learning: 'ru' }, introSeen: true,
    party: { id: 'saved-party', size: 3, count: 3, role: 2, members: [
      { id: 'task-peer', name: 'Peer', role: 1 },
      { id: 'entry-player', name: 'Returning', role: 2 },
      { id: 'third-peer', name: 'Third', role: 3 },
    ], started: true, completed: false, seconds: 42 },
    availableParty: null, partyPositions: [{ id: 'task-peer', name: 'Peer', x: -5, z: -26 }],
    task: 'Continue the saved task', taskTitle: 'Saved task', taskTarget: { x: 0, z: -34 }, goatGuide: null,
    inventory: { ...EMPTY_INVENTORY, dates: 2, water: 1 }, fed: ['white-goat'],
    stones: [], words: [], messages: [], replies: [],
  };
}
function newState(): BabylonState {
  return { ...savedState(), profile: null, introSeen: false, party: null, partyPositions: [], task: '', taskTitle: '', taskTarget: null, inventory: { ...EMPTY_INVENTORY }, fed: [] };
}
const session = { token: 'e'.repeat(43), expiresAt: Date.now() + 60_000 };
const apps: GameApp[] = [];

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
});
afterEach(() => {
  for (const app of apps.splice(0)) app.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(initial: BabylonState) {
  let state = structuredClone(initial);
  let snapshot!: AppSnapshot;
  const packets: BabylonRequest[] = [];
  const success = (packet: BabylonRequest, nextState = state) => {
    const result = { v: 2 as const, requestId: packet.requestId, state: nextState };
    // Ensure the fixture exercises the same strict boundary as a server response.
    parseBabylonResult(result);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  let commandReply = (packet: BabylonRequest): Response | Promise<Response> => {
    if (packet.action.type === 'languages') state = { ...state, profile: { native: packet.action.native, learning: packet.action.learning } };
    else if (packet.action.type === 'create') state = {
      ...state,
      party: { id: 'new-party', size: packet.action.size, count: 1, role: 1, members: [{ id: state.playerId, name: 'New player', role: 1 }], started: packet.action.size === 1, completed: false, seconds: 0 },
      task: 'Wait for the task group', taskTitle: 'New task',
      taskTarget: packet.action.size === 1 ? { x: 0, z: -34 } : null,
    };
    return success(packet);
  };
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
    if (String(input).endsWith('/api/avatar')) return Promise.resolve(new Response(JSON.stringify({ avatarId: 'lukas' })));
    if (String(input).endsWith('/api/auth/logout')) return Promise.resolve(new Response(null, { status: 204 }));
    if (String(input) !== 'http://entry.unit/api/babylon' || options?.method !== 'POST' || typeof options.body !== 'string') throw new Error(`Unexpected entry-flow fetch: ${String(input)}`);
    const packet = JSON.parse(options.body) as BabylonRequest;
    packets.push(packet);
    expect(options.headers).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` });
    return Promise.resolve(packet.action.type === 'state' ? success(packet) : commandReply(packet));
  }));
  const transport: NetworkAdapter = {
    state: { status: 'unauthorized', error: null }, connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(() => false), sendWorldLife: vi.fn(() => false), subscribeWorldLife: vi.fn(() => () => {}),
    subscribe: vi.fn(() => () => {}), subscribeState: vi.fn(() => () => {}), dispose: vi.fn(),
  };
  const network = vi.fn(() => transport);
  // No joined packet is supplied. World rendering and asset loading must not run in this test.
  const renderer = vi.fn((): RenderAdapter => { throw new Error('Unexpected renderer creation during entry'); });
  const app = new GameApp(parseConfig({ session: 'online', mapId: 'market' }, 'http://entry.unit'), renderer, undefined, null, network);
  apps.push(app);
  app.subscribe(value => { snapshot = value; });
  const host = document.createElement('div');
  app.start(host);
  app.provideServerSession(session);
  const commands = () => packets.filter(packet => packet.action.type !== 'state');
  return { app, network, transport, renderer, commands, success,
    get snapshot() { return snapshot; },
    reply(fn: typeof commandReply) { commandReply = fn; },
  };
}

async function ready(f: ReturnType<typeof fixture>) {
  await vi.waitFor(() => expect(f.snapshot.babylon?.state).toMatchObject({ v: 2 }));
  expect(f.snapshot.babylonPanel).toBe('setup');
  expect(f.network).not.toHaveBeenCalled();
  expect(f.transport.connect).not.toHaveBeenCalled();
  expect(f.renderer).not.toHaveBeenCalled();
}

describe('market entry confirmation', () => {
  it('shows setup for a returning profile and waits for explicit completion before transport', async () => {
    const f = fixture(savedState());
    await ready(f);
    expect(f.snapshot.authRequired).toBe(false);
    expect(f.snapshot.babylon?.state?.profile).toEqual({ native: 'es', learning: 'ru' });
    expect(f.snapshot.babylon?.state?.party?.size).toBe(3);
    expect(f.commands()).toEqual([]);
  });

  it('updates only languages for a returning player and preserves the saved task before transport starts', async () => {
    const initial = savedState(), f = fixture(initial);
    await ready(f);
    // A different requested size must not re-enroll or replace the saved party/mode.
    expect(await f.app.saveEntryLanguages('ru', 'en')).toBe(true);
    expect(f.network).not.toHaveBeenCalled();
    expect(await f.app.connectEntryGame('http://entry.unit')).toBe(true);
    expect(f.commands()).toHaveLength(2);
    expect(f.commands()[1]?.action).toEqual({ type: 'join' });
    expect(f.commands()[0]?.action).toEqual({ type: 'languages', native: 'ru', learning: 'en' });
    expect(f.commands().some(packet => packet.action.type === 'enroll')).toBe(false);
    expect(f.snapshot.babylon?.state).toMatchObject({
      profile: { native: 'ru', learning: 'en' }, party: initial.party,
      inventory: initial.inventory, fed: initial.fed, task: initial.task, taskTitle: initial.taskTitle, taskTarget: initial.taskTarget,
    });
    expect(f.snapshot.babylonPanel).toBeNull();
    expect(f.network).toHaveBeenCalledOnce();
    expect(f.transport.connect).toHaveBeenCalledExactlyOnceWith({ kind: 'server', session });
    expect(f.renderer).not.toHaveBeenCalled();
  });

  it('does not advance after failure and retries the exact receipt before transport starts', async () => {
    const f = fixture(savedState());
    await ready(f);
    f.reply(() => new Response(JSON.stringify({ v: 2, error: { code: 'UNAVAILABLE', message: 'Command not confirmed' } }), { status: 503 }));
    expect(await f.app.connectEntryGame('http://entry.unit')).toBe(false);
    expect(f.snapshot.babylonPanel).toBe('setup');
    expect(f.snapshot.babylon).toMatchObject({ busy: false, canRetry: true, error: 'Command not confirmed' });
    expect(f.network).not.toHaveBeenCalled();
    const first = f.commands()[0]!;
    let finish!: (response: Response) => void;
    f.reply(() => new Promise<Response>(resolve => { finish = resolve; }));
    // New UI values must not replace the action or requestId of an uncertain receipt.
    const retry = f.app.retryEntryAction();
    expect(f.commands()).toHaveLength(2);
    expect(f.commands()[1]).toEqual(first);
    expect(f.snapshot.babylonPanel).toBe('setup');
    expect(f.network).not.toHaveBeenCalled();
    finish(f.success(first, { ...savedState(), profile: { native: 'ru', learning: 'en' } }));
    expect(await retry).toBe(true);
    expect(f.snapshot.babylonPanel).toBeNull();
    expect(f.transport.connect).toHaveBeenCalledOnce();
  });

  it('creates a new game after saving the independent profile with the selected size and starts transport only after confirmation', async () => {
    const f = fixture(newState());
    await ready(f);
    expect(f.snapshot.babylon?.state?.profile).toBeNull();
    expect(await f.app.createEntryGame(4)).toBe(false);
    expect(await f.app.saveEntryLanguages('ru', 'es')).toBe(true);
    expect(f.network).not.toHaveBeenCalled();
    expect(f.snapshot.babylon?.state?.party).toBeNull();
    expect(await f.app.createEntryGame(4)).toBe(true);
    expect(f.commands()).toHaveLength(2);
    expect(f.commands()[1]?.action).toEqual({ type: 'create', size: 4 });
    expect(f.snapshot.babylon?.state?.party?.size).toBe(4);
    expect(f.snapshot.babylonPanel).toBeNull();
    expect(f.snapshot.entryStage).toBe('loading');
    expect(f.network).toHaveBeenCalledOnce();
    expect(f.transport.connect).toHaveBeenCalledExactlyOnceWith({ kind: 'server', session });
  });
});
