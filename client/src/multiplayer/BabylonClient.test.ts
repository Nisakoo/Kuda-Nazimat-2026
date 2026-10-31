import { afterEach, expect, it, vi } from 'vitest';
import { BabylonClient, type BabylonView } from './BabylonClient';
import { EMPTY_INVENTORY, type BabylonRequest, type BabylonState } from '../../../shared/babylon/types';

const state: BabylonState = { v: 2, playerId: 'p', backend: 'test', languages: ['ru', 'en'], profile: null, introSeen: false, party: null, availableParty: null, task: '', goatGuide: null, inventory: EMPTY_INVENTORY, fed: [], stones: [], words: [], messages: [], replies: [] };
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
  const pending = f.client.repeat(); f.client.dispose(); await pending; expect(signal.aborted).toBe(true);
});
