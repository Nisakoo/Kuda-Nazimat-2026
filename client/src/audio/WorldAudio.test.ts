import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { WorldBudget } from '../map/WorldBudget';
import { AUDIO_LIMITS, AUDIO_VOLUME_KEY, WorldAudio, type AudioMovement, type AudioMessage } from './WorldAudio';
import manifest from '../../public/assets/audio/manifest.json';

class FakeSource {
  buffer: AudioBuffer | null = null;
  playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  connect = vi.fn(); disconnect = vi.fn(); start = vi.fn(); stop = vi.fn();
  end(): void { this.onended?.(); }
}
class FakeContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = {};
  nodes: FakeSource[] = [];
  gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  createGain = vi.fn(() => this.gain);
  createBuffer = vi.fn((channels: number, length: number, sampleRate: number) => {
    const data = new Float32Array(length);
    return { length, sampleRate, numberOfChannels: channels, getChannelData: () => data } as unknown as AudioBuffer;
  });
  createBufferSource = vi.fn(() => { const node = new FakeSource(); this.nodes.push(node); return node; });
  get started(): number { return this.nodes.filter(node => node.start.mock.calls.length > 0).length; }
}
const bytes = (name: string) => new Uint8Array(readFileSync(new URL(`../../public/assets/audio/${name}.wav`, import.meta.url)));
const flush = async () => { await new Promise<void>(resolve => setImmediate(resolve)); };
function fixture(budget = new WorldBudget(), fetchOverride?: typeof fetch) {
  const context = new FakeContext();
  // Keep both expiry clocks deterministic. Host load must not age fake events.
  vi.spyOn(performance, 'now').mockImplementation(() => context.currentTime * 1000);
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const fetcher = vi.fn(fetchOverride ?? (async (input: RequestInfo | URL) => {
    const name = String(input).split('/').at(-1)!.replace('.wav', '');
    return new Response(bytes(name));
  }));
  const audio = new WorldAudio(budget, { createContext: () => context as unknown as AudioContext, storage, fetch: fetcher });
  return { audio, budget, context, storage, values, fetcher };
}
const movement = (changes: Partial<AudioMovement> = {}): AudioMovement => ({ entityId: 'player', tick: 1, position: { x: 0, y: 0, z: 0 }, grounded: true, sprinting: false, jumpStarted: false, origin: 'live', ...changes });
const message = (sequence: number, changes: Partial<AudioMessage> = {}): AudioMessage => ({ id: `message-${sequence}`, stream: 'chat', sequence, origin: 'live', ...changes });

// These tests use real delivered PCM bytes, but fake browser audio. They do not prove listening quality.
describe('WorldAudio', () => {
  it('starts at 30%, persists one volume, clamps it, and honors persisted zero', async () => {
    const { audio, values, context, storage } = fixture();
    expect(audio.volume).toBe(0.3);
    await audio.unlock(); expect(context.gain.gain.value).toBe(0.3);
    audio.setVolume(0.72); expect(values.get(AUDIO_VOLUME_KEY)).toBe('0.72');
    expect(context.gain.gain.value).toBe(0.72);
    audio.setVolume(8); expect(audio.volume).toBe(1);
    audio.setVolume(-1); expect(audio.volume).toBe(0);
    audio.setVolume(NaN); expect(audio.volume).toBe(0);
    const next = new WorldAudio(new WorldBudget(), { storage });
    expect(next.volume).toBe(0); audio.dispose(); next.dispose();
  });

  it.each(['garbage', '', '-1', '2', 'Infinity'])('ignores invalid stored volume %j', raw => {
    const audio = new WorldAudio(new WorldBudget(), { storage: { getItem: () => raw, setItem: () => {} } });
    expect(audio.volume).toBe(0.3); audio.dispose();
  });

  it('survives blocked storage and unavailable audio', async () => {
    const audio = new WorldAudio(new WorldBudget(), {
      storage: { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } },
      createContext: () => { throw Error('unsupported'); },
    });
    expect(audio.volume).toBe(0.3);
    expect(() => audio.setVolume(0.4)).not.toThrow();
    await expect(audio.unlock()).resolves.toBeUndefined();
    audio.movement(movement()); audio.message(message(1)); audio.update(0.1); audio.dispose();
    expect(audio.stats.sources).toBe(0);
  });

  it('does not create context, load, or play before explicit user unlock', () => {
    const { audio, context, fetcher } = fixture();
    audio.message(message(1)); audio.movement(movement({ jumpStarted: true }));
    for (let i = 0; i < 600; i++) audio.update(0.25);
    expect(context.createGain).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    expect(audio.stats.reservedBytes).toBe(0); audio.dispose();
  });

  it('invokes resume synchronously and permits a new user-action retry after autoplay rejection', async () => {
    const { audio, context, fetcher } = fixture();
    context.resume.mockRejectedValueOnce(Error('NotAllowedError'));
    const unlock = audio.unlock(); expect(context.resume).toHaveBeenCalledTimes(1);
    await unlock; audio.message(message(1)); expect(fetcher).not.toHaveBeenCalled();
    await audio.unlock(); audio.message(message(2)); await flush();
    expect(context.started).toBe(1); expect(audio.stats.failures).toBe(1); audio.dispose();
  });

  it('plays only actual grounded distance, not walls, airborne input, snapshots, corrections, or duplicate ticks', async () => {
    const { audio, context } = fixture(); await audio.unlock();
    audio.movement(movement());
    for (let tick = 2; tick < 10; tick++) audio.movement(movement({ tick }));
    expect(audio.stats.pending).toBe(0);
    audio.movement(movement({ tick: 10, grounded: false, position: { x: 1, y: 1, z: 0 } }));
    audio.movement(movement({ tick: 11, position: { x: 2, y: 0, z: 0 } }));
    expect(context.started).toBe(0);
    audio.movement(movement({ tick: 12, position: { x: 2.4, y: 0, z: 0 } }));
    audio.movement(movement({ tick: 13, position: { x: 2.8, y: 0, z: 0 } })); await flush();
    expect(context.started).toBe(1);
    audio.movement(movement({ tick: 13, position: { x: 3.8, y: 0, z: 0 } }));
    audio.movement(movement({ tick: 14, origin: 'correction', position: { x: 30, y: 0, z: 0 } }));
    audio.movement(movement({ tick: 15, origin: 'snapshot', position: { x: 40, y: 0, z: 0 } }));
    audio.movement(movement({ tick: 16, origin: 'history', position: { x: 50, y: 0, z: 0 } }));
    expect(context.started).toBe(1); audio.dispose();
  });

  it('uses the sprint clip only with grounded movement and rejects teleports/long gaps', async () => {
    const { audio, fetcher } = fixture(); await audio.unlock();
    audio.movement(movement());
    audio.movement(movement({ tick: 2, sprinting: true, position: { x: 1, y: 0, z: 0 } })); await flush();
    expect(fetcher.mock.calls[0]?.[0]).toBe('/assets/audio/sprint.wav');
    audio.movement(movement({ tick: 3, position: { x: 20, y: 0, z: 0 } }));
    audio.movement(movement({ tick: 60, position: { x: 21, y: 0, z: 0 } }));
    expect(fetcher).toHaveBeenCalledTimes(1); audio.dispose();
  });

  it('plays each confirmed jump edge once and never plays jump from a restored snapshot', async () => {
    const { audio, context, fetcher } = fixture(); await audio.unlock();
    audio.movement(movement({ jumpStarted: true, grounded: false })); await flush();
    expect(context.started).toBe(1); expect(fetcher.mock.calls[0]?.[0]).toBe('/assets/audio/jump.wav');
    context.currentTime += 1;
    audio.movement(movement({ tick: 1, jumpStarted: true, grounded: false }));
    audio.movement(movement({ tick: 2, jumpStarted: true, grounded: false }));
    audio.movement(movement({ tick: 3, jumpStarted: true, grounded: false, origin: 'snapshot' }));
    expect(context.started).toBe(1);
    audio.movement(movement({ tick: 4 }));
    audio.movement(movement({ tick: 5, jumpStarted: true, grounded: false }));
    expect(context.started).toBe(2); audio.dispose();
  });

  it('deduplicates live messages, polling/history and stable reconnect sequences without reading text', async () => {
    const { audio, context } = fixture(); await audio.unlock();
    audio.message(message(1, { origin: 'history' })); await flush(); expect(context.started).toBe(0);
    audio.message(message(2)); await flush(); expect(context.started).toBe(1);
    context.currentTime += 1;
    audio.message(message(2)); audio.message(message(1)); audio.message(message(3, { id: 'message-2' }));
    expect(context.started).toBe(1);
    audio.message(message(50, { origin: 'snapshot' })); audio.message(message(49));
    audio.message(message(51, { origin: 'correction' })); audio.message(message(51));
    expect(context.started).toBe(1);
    audio.message(message(52)); expect(context.started).toBe(2); audio.dispose();
  });

  it.each(['cold', 'warm'] as const)('plays both distinct question/answer identities in one poll with a %s mumble buffer', async cache => {
    const { audio, context, fetcher, budget } = fixture(); await audio.unlock();
    if (cache === 'warm') {
      audio.message(message(0, { id: 'warm-up' })); await flush(); context.nodes.at(-1)!.end();
    }
    const before = context.started;
    audio.message(message(1, { id: 'reply-1:question' }));
    audio.message(message(2, { id: 'reply-1:answer' }));
    audio.message(message(1, { id: 'reply-1:question' }));
    audio.message(message(2, { id: 'reply-1:answer' }));
    await flush();
    expect(context.started).toBe(before + 2);
    expect(audio.stats.sources).toBe(2); expect(audio.stats.buffers).toBe(1);
    expect(fetcher).toHaveBeenCalledOnce(); expect(context.createBuffer).toHaveBeenCalledOnce();
    expect(budget.stats.memory).toBe(12568 * 4 + 2 * (12568 * 4 + 512));
    audio.message(message(3, { id: 'reply-1:answer' }));
    expect(context.started).toBe(before + 2);
    audio.dispose(); expect(budget.stats.memory).toBe(0);
  });

  it('bounds a cold same-poll mumble burst to 8 sources and one shared load', async () => {
    const { audio, context, fetcher, budget } = fixture(); await audio.unlock();
    for (let sequence = 1; sequence <= 100; sequence++) audio.message(message(sequence));
    expect(audio.stats.pending).toBe(1); await flush();
    expect(context.started).toBe(AUDIO_LIMITS.sources);
    expect(fetcher).toHaveBeenCalledOnce(); expect(audio.stats.buffers).toBe(1);
    expect(budget.stats.memory).toBe(12568 * 4 + AUDIO_LIMITS.sources * (12568 * 4 + 512));
    audio.dispose(); expect(budget.stats.memory).toBe(0);
  });

  it.each(['expired', 'history', 'disposed'] as const)('does not replay the cold question/answer pair after it is %s', async reason => {
    let finish!: (response: Response) => void;
    const { audio, context, budget } = fixture(new WorldBudget(), async () => new Promise<Response>(resolve => { finish = resolve; }));
    await audio.unlock();
    audio.message(message(1, { id: 'reply-1:question' }));
    audio.message(message(2, { id: 'reply-1:answer' }));
    if (reason === 'expired') context.currentTime = 1;
    if (reason === 'history') audio.message(message(3, { id: 'restored', origin: 'history' }));
    if (reason === 'disposed') audio.dispose();
    finish(new Response(bytes('mumble'))); await flush();
    expect(context.started).toBe(0); expect(audio.stats.sources).toBe(0);
    if (reason !== 'disposed') {
      audio.message(message(4, { id: 'fresh-after-load' })); expect(context.started).toBe(1);
    }
    audio.dispose(); expect(budget.stats.memory).toBe(0);
  });

  it('cycles four small mumble variations with one source per fresh message and no text synthesis', async () => {
    const { audio, context, fetcher } = fixture(); await audio.unlock();
    audio.message(message(1)); await flush();
    for (let sequence = 2; sequence <= 5; sequence++) { context.currentTime += 1; audio.message(message(sequence)); }
    expect(context.nodes.map(node => node.playbackRate.value)).toEqual([0.94, 1.03, 1.09, 0.98, 0.94]);
    expect(context.started).toBe(5); expect(fetcher).toHaveBeenCalledOnce();
    expect(context.createBuffer).toHaveBeenCalledOnce(); audio.dispose();
  });

  it('keeps deduplication state bounded and refuses overflow streams/entities rather than replaying them', async () => {
    const { audio } = fixture();
    for (let n = 0; n < 600; n++) {
      audio.message(message(n));
      audio.movement(movement({ entityId: `player-${n}` }));
      audio.message(message(n, { stream: `npc-${n}` }));
    }
    expect(audio.stats.messageIds).toBeLessThanOrEqual(AUDIO_LIMITS.messageIds);
    expect(audio.stats.streams).toBe(AUDIO_LIMITS.streams); expect(audio.stats.entities).toBe(AUDIO_LIMITS.entities);
    audio.dispose(); expect(audio.stats.messageIds).toBe(0);
  });

  it('reclaims departed entity slots across 24 distinct player IDs without raising the 8-slot bound', async () => {
    const { audio, context, fetcher } = fixture(); await audio.unlock();
    for (let player = 0; player < 24; player++) {
      const entityId = `visitor-${player}`;
      audio.retainEntities([entityId]);
      expect(audio.stats.entities).toBe(0);
      audio.movement(movement({ entityId, origin: 'snapshot', jumpStarted: true, grounded: false }));
      audio.movement(movement({ entityId, tick: 2, origin: 'correction' }));
      expect(context.started).toBe(player);
      audio.movement(movement({ entityId, tick: 3, position: { x: 0.8, y: 0, z: 0 } }));
      await flush();
      expect(context.started).toBe(player + 1);
      expect(audio.stats.entities).toBe(1);
      expect(audio.stats.entities).toBeLessThanOrEqual(AUDIO_LIMITS.entities);
      context.nodes.at(-1)!.end(); context.currentTime += 1;
    }
    expect(fetcher).toHaveBeenCalledOnce();
    audio.retainEntities([]); expect(audio.stats.entities).toBe(0); audio.dispose();
  });

  it('silently baselines returning players, including live in-progress jumps and restored snapshots', async () => {
    const { audio, context, fetcher } = fixture(); await audio.unlock();
    audio.retainEntities(['player']);
    audio.movement(movement());
    audio.retainEntities([]);
    audio.movement(movement({ tick: 100, jumpStarted: true, grounded: false }));
    expect(audio.stats.entities).toBe(0);
    audio.retainEntities(['player']);
    audio.movement(movement({ tick: 101, jumpStarted: true, grounded: false }));
    audio.movement(movement({ tick: 102, origin: 'snapshot', jumpStarted: true, grounded: false, position: { x: 20, y: 1, z: 0 } }));
    audio.movement(movement({ tick: 103, origin: 'correction', position: { x: 30, y: 0, z: 0 } }));
    audio.movement(movement({ tick: 104, origin: 'history', position: { x: 40, y: 0, z: 0 } }));
    await flush(); expect(fetcher).not.toHaveBeenCalled(); expect(context.started).toBe(0);
    audio.movement(movement({ tick: 105, jumpStarted: true, grounded: false, position: { x: 40, y: 0.2, z: 0 } }));
    await flush(); expect(context.started).toBe(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/assets/audio/jump.wav'); audio.dispose();
  });

  it('retains at most 8 IDs, ignores absent samples, and admits the next group after authoritative removal', () => {
    const { audio } = fixture();
    const first = Array.from({ length: 12 }, (_, index) => `first-${index}`);
    audio.retainEntities(['', first[0]!, first[0]!, ...first]);
    for (const entityId of first) audio.movement(movement({ entityId }));
    expect(audio.stats.entities).toBe(AUDIO_LIMITS.entities);
    const next = Array.from({ length: 8 }, (_, index) => `next-${index}`);
    audio.retainEntities(next); expect(audio.stats.entities).toBe(0);
    for (const entityId of first) audio.movement(movement({ entityId, tick: 2 }));
    expect(audio.stats.entities).toBe(0);
    for (const entityId of next) audio.movement(movement({ entityId }));
    expect(audio.stats.entities).toBe(AUDIO_LIMITS.entities);
    audio.dispose(); audio.retainEntities(next); audio.movement(movement({ entityId: next[0]! }));
    expect(audio.stats.entities).toBe(0);
  });

  it('does not reset a present player stride when retaining the same authoritative set', async () => {
    const { audio, context } = fixture(); await audio.unlock();
    audio.retainEntities(['player']); audio.movement(movement());
    audio.movement(movement({ tick: 2, position: { x: 0.4, y: 0, z: 0 } }));
    audio.retainEntities(['player']);
    audio.movement(movement({ tick: 3, position: { x: 0.8, y: 0, z: 0 } }));
    await flush(); expect(context.started).toBe(1); audio.dispose();
  });

  it('plays only the three requested ambient types at bounded intervals without catch-up bursts', async () => {
    const { audio, context, fetcher } = fixture(); await audio.unlock();
    for (let i = 0; i < 450; i++) { audio.update(0.25); context.currentTime += 0.25; await flush(); }
    const urls = new Set(fetcher.mock.calls.map(call => call[0]));
    expect(urls).toEqual(new Set(['/assets/audio/grass.wav', '/assets/audio/wind.wav', '/assets/audio/birds.wav']));
    expect(audio.stats.buffers).toBe(3); expect(context.started).toBe(7);
    audio.update(10000); await flush(); expect(context.started).toBe(7); audio.dispose();
  });

  it('sets zero gain, stops all active sources, and does not load or start while silent', async () => {
    const { audio, context, fetcher } = fixture(); await audio.unlock();
    audio.message(message(1)); await flush(); expect(audio.stats.sources).toBe(1);
    audio.setVolume(0); expect(context.gain.gain.value).toBe(0); expect(audio.stats.sources).toBe(0);
    expect(context.nodes[0]?.stop).toHaveBeenCalledOnce(); expect(context.nodes[0]?.buffer).toBeNull();
    audio.movement(movement({ jumpStarted: true })); audio.message(message(2)); await flush();
    expect(fetcher).toHaveBeenCalledTimes(1); expect(context.started).toBe(1); audio.dispose();
  });

  it('bounds simultaneous sources, shares one decoded buffer, and releases source leases on end', async () => {
    const { audio, context, budget } = fixture(); await audio.unlock();
    audio.message(message(1)); await flush();
    for (let n = 2; n <= 30; n++) { context.currentTime += 1; audio.message(message(n)); }
    expect(context.started).toBe(AUDIO_LIMITS.sources); expect(audio.stats.buffers).toBe(1);
    expect(context.createBuffer).toHaveBeenCalledOnce();
    for (const node of context.nodes) node.end();
    expect(audio.stats.sources).toBe(0); expect(budget.stats.memory).toBe(12568 * 4);
    audio.dispose(); expect(budget.stats.memory).toBe(0);
  });

  it('reserves input, decoded and playback payloads in the existing budget before allocation', async () => {
    const { audio, context, budget } = fixture();
    const other = budget.reserve('world', 1000, 2000); await audio.unlock();
    audio.message(message(1));
    expect(budget.stats.memory).toBe(2000 + 25180 * 2 + 12568 * 4);
    expect(context.createBuffer).not.toHaveBeenCalled(); await flush();
    expect(budget.stats.memory).toBe(2000 + 12568 * 4 * 2 + 512);
    expect(audio.stats.reservedBytes).toBe(budget.stats.memory - 2000);
    audio.dispose(); expect(budget.stats.memory).toBe(2000); other.release();
  });

  it('never requests bytes if the shared 64 MiB guard has no room', async () => {
    const budget = new WorldBudget(); const other = budget.reserve('world', 0, budget.memoryLimit);
    const { audio, fetcher } = fixture(budget); await audio.unlock();
    audio.message(message(1)); await flush(); expect(fetcher).not.toHaveBeenCalled();
    expect(audio.stats.reservedBytes).toBe(0); expect(budget.stats.memory).toBe(64 * 1024 * 1024);
    audio.dispose(); other.release();
  });

  it('rolls back the input lease when decoded reservation fails', async () => {
    const { audio, fetcher, budget } = fixture(new WorldBudget(25180 * 2 + 1)); await audio.unlock();
    audio.message(message(1)); await flush(); expect(fetcher).not.toHaveBeenCalled();
    expect(budget.stats.memory).toBe(0); audio.dispose();
  });

  it.each(['http', 'length', 'oversized', 'truncated', 'format', 'rejected'])('handles %s file failure without blocking or leaking', async failure => {
    const fetcher: typeof fetch = async () => {
      if (failure === 'rejected') throw Error('network');
      if (failure === 'http') return new Response(null, { status: 404 });
      if (failure === 'length') return new Response(bytes('mumble'), { headers: { 'content-length': '9999999' } });
      if (failure === 'oversized') return new Response(new Uint8Array(25181));
      if (failure === 'truncated') return new Response(new Uint8Array(10));
      return new Response(new Uint8Array(25180));
    };
    const { audio, budget, context } = fixture(new WorldBudget(), fetcher); await audio.unlock();
    audio.message(message(1)); await flush();
    expect(audio.stats.failures).toBe(1); expect(budget.stats.memory).toBe(0); expect(context.started).toBe(0);
    audio.message(message(2)); await flush(); expect(audio.stats.failures).toBe(1); audio.dispose();
  });

  it('cancels pending loads on dispose and late responses cannot allocate or retain bytes', async () => {
    let finish!: (response: Response) => void;
    let signal: AbortSignal | null | undefined;
    const { audio, context, budget } = fixture(new WorldBudget(), async (_url, init) => {
      signal = init?.signal; return new Promise<Response>(resolve => { finish = resolve; });
    });
    await audio.unlock(); audio.message(message(1)); expect(audio.stats.pending).toBe(1);
    audio.dispose(); audio.dispose(); expect(signal?.aborted).toBe(true);
    expect(budget.stats.memory).toBe(0); expect(audio.stats.pending).toBe(0);
    finish(new Response(bytes('mumble'))); await flush();
    expect(context.createBuffer).not.toHaveBeenCalled(); expect(context.started).toBe(0);
    expect(budget.stats.memory).toBe(0); expect(context.close).toHaveBeenCalledOnce();
  });

  it('cancels a streaming reader and releases all reservations immediately', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel });
    const { audio, budget } = fixture(new WorldBudget(), async () => new Response(stream));
    await audio.unlock(); audio.message(message(1)); await flush();
    controller.enqueue(bytes('mumble').subarray(0, 100)); await flush();
    audio.dispose(); expect(budget.stats.memory).toBe(0); await flush(); expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not replay a slow first load or a load superseded by a snapshot', async () => {
    let finish!: (response: Response) => void;
    const { audio, context } = fixture(new WorldBudget(), async () => new Promise<Response>(resolve => { finish = resolve; }));
    await audio.unlock(); audio.message(message(1)); context.currentTime += 1;
    finish(new Response(bytes('mumble'))); await flush(); expect(context.started).toBe(0);
    audio.message(message(2)); expect(context.started).toBe(1); audio.dispose();
    const second = fixture(); await second.audio.unlock();
    second.audio.message(message(1)); second.audio.message(message(2, { origin: 'snapshot' })); await flush();
    expect(second.context.started).toBe(0); second.audio.dispose();
  });

  it('limits in-flight loads and does not duplicate requests for a shared clip', async () => {
    const { audio, fetcher } = fixture(new WorldBudget(), async () => new Promise<Response>(() => {})); await audio.unlock();
    for (let n = 1; n < 100; n++) audio.message(message(n));
    audio.movement(movement({ jumpStarted: true }));
    audio.movement(movement({ entityId: 'other' }));
    audio.movement(movement({ entityId: 'other', tick: 2, position: { x: 1, y: 0, z: 0 } }));
    expect(fetcher).toHaveBeenCalledTimes(AUDIO_LIMITS.pending); expect(audio.stats.pending).toBe(AUDIO_LIMITS.pending);
    audio.dispose(); expect(audio.stats.reservedBytes).toBe(0);
  });

  it('does not deduplicate independent actual buffers between concurrent instances', async () => {
    const budget = new WorldBudget(); const first = fixture(budget); const second = fixture(budget);
    await first.audio.unlock(); await second.audio.unlock();
    first.audio.message(message(1)); second.audio.message(message(1)); await flush();
    expect(budget.stats.memory).toBe(first.audio.stats.reservedBytes + second.audio.stats.reservedBytes);
    first.audio.dispose(); expect(budget.stats.memory).toBe(second.audio.stats.reservedBytes);
    second.audio.dispose(); expect(budget.stats.memory).toBe(0);
  });

  it('returns to the same non-audio baseline after five enter/exit cycles', async () => {
    const budget = new WorldBudget(); const world = budget.reserve('world', 1000, 2000);
    for (let cycle = 0; cycle < 5; cycle++) {
      const { audio, context } = fixture(budget); await audio.unlock();
      audio.message(message(1)); audio.movement(movement({ jumpStarted: true })); await flush();
      expect(audio.stats.sources).toBe(2); audio.dispose();
      expect(audio.stats).toMatchObject({ sources: 0, pending: 0, buffers: 0, reservedBytes: 0 });
      expect(budget.stats.memory).toBe(2000); expect(budget.stats.resources).toBe(1);
      expect(context.gain.disconnect).toHaveBeenCalledOnce(); expect(context.close).toHaveBeenCalledOnce();
    }
    world.release(); expect(budget.stats.memory).toBe(0);
  });

  it('absorbs source creation/start failures and frees the playback lease', async () => {
    const { audio, context, budget } = fixture(); await audio.unlock();
    context.createBufferSource.mockImplementationOnce(() => { throw Error('source'); });
    audio.message(message(1)); await flush();
    expect(budget.stats.memory).toBe(12568 * 4); expect(audio.stats.sources).toBe(0);
    context.currentTime += 1;
    const node = new FakeSource(); node.start.mockImplementationOnce(() => { throw Error('start'); });
    context.createBufferSource.mockReturnValueOnce(node); audio.message(message(2));
    expect(audio.stats.sources).toBe(0); expect(budget.stats.memory).toBe(12568 * 4); audio.dispose();
  });
});

describe('delivered original audio assets', () => {
  it('contains only the seven agreed sound types and less than 1 MiB decoded PCM', () => {
    expect(manifest.files.map(file => file.name)).toEqual(['wind', 'birds', 'grass', 'step', 'sprint', 'jump', 'mumble']);
    expect(manifest.files.reduce((sum, file) => sum + file.frames * 4, 0)).toBeLessThan(1024 * 1024);
  });
  it.each(manifest.files)('$file matches its provenance hash, bounded format, and non-silent unclipped signal', asset => {
    const data = bytes(asset.name); const view = new DataView(data.buffer);
    expect(data.byteLength).toBe(asset.bytes);
    expect(createHash('sha256').update(data).digest('hex')).toBe(asset.sha256);
    expect(view.getUint32(24, true)).toBe(22050); expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16); expect(view.getUint32(40, true)).toBe(asset.frames * 2);
    let peak = 0; let energy = 0;
    for (let frame = 0; frame < asset.frames; frame++) {
      const value = view.getInt16(44 + frame * 2, true) / 32768;
      peak = Math.max(peak, Math.abs(value)); energy += value * value;
    }
    expect(peak).toBeGreaterThan(0.015); expect(peak).toBeLessThan(0.81);
    expect(Math.sqrt(energy / asset.frames)).toBeGreaterThan(0.001);
    expect(Math.abs(view.getInt16(44, true))).toBeLessThan(10);
    expect(Math.abs(view.getInt16(data.byteLength - 2, true))).toBeLessThan(10);
  });
});
