import { afterEach, expect, it, vi } from 'vitest';
import { BabylonClient, type BabylonView } from './BabylonClient';
import { EMPTY_INVENTORY, type BabylonRequest, type BabylonState } from '../../../shared/babylon/types';

const state: BabylonState = { v: 2, playerId: 'p', backend: 'test', languages: ['ru', 'en'], profile: null, introSeen: false, party: null, availableParty: null, task: '', taskTitle: '', taskTarget: null, partyPositions: [], goatGuide: null, inventory: EMPTY_INVENTORY, fed: [], stones: [], words: [], messages: [], replies: [] };
const clients: BabylonClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.dispose()); vi.unstubAllGlobals(); });
function fixture() {
  let view!: BabylonView;
  const unauthorized = vi.fn();
  const client = new BabylonClient('http://localhost', { token: 'test', expiresAt: Date.now() + 60000 }, value => { view = value; }, unauthorized);
  clients.push(client); return { client, unauthorized, get view() { return view; } };
}
function response(packet: BabylonRequest, data = state) { return new Response(JSON.stringify({ v: 2, requestId: packet.requestId, state: data }), { status: 200 }); }

it('does not overwrite an action result with an older polling response', async () => {
  let finish!: (value: Response) => void, poll!: BabylonRequest;
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
    const packet = JSON.parse(String(options.body)) as BabylonRequest;
    if (packet.action.type === 'state') { poll = packet; return new Promise<Response>(resolve => { finish = resolve; }); }
    return Promise.resolve(response(packet, { ...state, introSeen: true }));
  }));
  const f = fixture(), pending = f.client.start();
  expect(await f.client.send({ type: 'intro-seen' })).toBe(true);
  finish(response(poll)); await pending;
  expect(f.view.state?.introSeen).toBe(true);
});

it('retries the identical action and request ID after an ambiguous network failure', async () => {
  const packets: BabylonRequest[] = [];
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
    const packet = JSON.parse(String(options.body)) as BabylonRequest; packets.push(packet);
    return packets.length === 1 ? Promise.reject(new Error('network')) : Promise.resolve(response(packet));
  }));
  const f = fixture();
  expect(await f.client.send({ type: 'buy', item: 'dates', targetId: 'fruit-seller' })).toBe(false);
  expect(f.view.canRetry).toBe(true); expect(await f.client.repeat()).toBe(true);
  expect(packets[1]).toEqual(packets[0]); expect(f.view.canRetry).toBe(false);
});

it('aborts on disposal and rejects invalid or unauthorized responses before updating the UI', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ v: 2, state: {} }))));
  const f = fixture(); expect(await f.client.send({ type: 'intro-seen' })).toBe(false); expect(f.view.state).toBeNull();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
  expect(await f.client.repeat()).toBe(false); expect(f.unauthorized).toHaveBeenCalledOnce();
  let signal!: AbortSignal;
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => { signal = options.signal!; signal.addEventListener('abort', () => reject(new Error('aborted'))); })));
  const pending = f.client.send({ type: 'intro-seen' }); f.client.dispose(); await pending; expect(signal.aborted).toBe(true);
});

it('loads entry state and sends commands on HTTP LAN without randomUUID', async () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal('crypto', { getRandomValues });
  const packets: BabylonRequest[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
    const packet = JSON.parse(String(options.body)) as BabylonRequest;
    packets.push(packet); return response(packet);
  }));
  const f = fixture();
  await f.client.start();
  expect(f.view.state).toEqual(state);
  expect(await f.client.send({ type: 'intro-seen' })).toBe(true);
  for (const packet of packets) expect(packet.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(new Set(packets.map(packet => packet.requestId)).size).toBe(2);
});

it('clears a polling connection error when server state is available again', async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockImplementation(async (_url: string, options: RequestInit) => response(JSON.parse(String(options.body)) as BabylonRequest));
    vi.stubGlobal('fetch', fetcher);
    const f = fixture(); await f.client.start();
    expect(f.view.error).toBe('Connection lost');
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.view.state).toEqual(state); expect(f.view.error).toBeNull();
    f.client.dispose();
  } finally { vi.useRealTimers(); }
});

it.each([400, 403, 409])('keeps a permanent HTTP %i action error across polls without offering a futile retry', async status => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
    const packet = JSON.parse(String(options.body)) as BabylonRequest;
    return packet.action.type === 'state' ? response(packet) : new Response(JSON.stringify({ error: { message: 'Permanent action refusal' } }), { status });
  }));
  const f = fixture();
  expect(await f.client.send({ type: 'create', size: 1 })).toBe(false);
  await f.client.start();
  expect(f.view.error).toBe('Permanent action refusal'); expect(f.view.canRetry).toBe(false);
  expect(await f.client.repeat()).toBe(false);
  f.client.clearError(); expect(f.view.error).toBeNull();
});

it.each([408, 429, 503])('allows the same operation receipt to be retried after transient HTTP %i', async status => {
  const packets: BabylonRequest[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
    const packet = JSON.parse(String(options.body)) as BabylonRequest; packets.push(packet);
    return packets.length === 1 ? new Response(JSON.stringify({ error: { message: 'Try again' } }), { status }) : response(packet);
  }));
  const f = fixture(); expect(await f.client.send({ type: 'join' })).toBe(false);
  expect(f.view.canRetry).toBe(true); expect(await f.client.repeat()).toBe(true);
  expect(packets[1]).toEqual(packets[0]); expect(f.view.error).toBeNull();
});

it('ignores a late failed poll after a successful command', async () => {
  let reject!: (reason: Error) => void;
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
    const packet = JSON.parse(String(options.body)) as BabylonRequest;
    if (packet.action.type === 'state') return new Promise<Response>((_done, fail) => { reject = fail; });
    return Promise.resolve(response(packet));
  }));
  const f = fixture(), polling = f.client.start();
  expect(await f.client.send({ type: 'languages', native: 'ru', learning: 'en' })).toBe(true);
  reject(new Error('Old network failure')); await polling;
  expect(f.view.error).toBeNull();
});

it('cancels an NPC request and ignores its late result without clearing a newer action', async () => {
  let finish!: (value: Response) => void, npc!: BabylonRequest, signal!: AbortSignal;
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
    const packet = JSON.parse(String(options.body)) as BabylonRequest;
    if (packet.action.type === 'npc') { npc = packet; signal = options.signal!; return new Promise<Response>(resolve => { finish = resolve; }); }
    return Promise.resolve(response(packet, { ...state, introSeen: true }));
  }));
  const f = fixture();
  const pending = f.client.send({ type: 'npc', targetId: 'shepherd', text: 'Hello' });
  f.client.cancelNpc();
  expect(signal.aborted).toBe(true); expect(f.view.busy).toBe(false); expect(f.view.canRetry).toBe(false);
  expect(await f.client.send({ type: 'intro-seen' })).toBe(true);
  finish(response(npc)); expect(await pending).toBe(false);
  expect(f.view.state?.introSeen).toBe(true); expect(f.view.error).toBeNull(); expect(f.view.busy).toBe(false);
});
