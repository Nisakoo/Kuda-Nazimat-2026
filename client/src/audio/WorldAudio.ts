import { WorldBudget, type BudgetLease } from '../map/WorldBudget';
import manifest from '../../public/assets/audio/manifest.json';

export type AudioOrigin = 'live' | 'snapshot' | 'history' | 'correction';
export interface AudioMovement {
  readonly entityId: string;
  readonly tick: number;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly grounded: boolean;
  readonly sprinting: boolean;
  readonly jumpStarted: boolean;
  readonly origin: AudioOrigin;
}
export interface AudioMessage {
  readonly id: string;
  readonly stream: string;
  readonly sequence: number;
  readonly origin: AudioOrigin;
}
export interface WorldAudioOptions {
  readonly createContext?: () => AudioContext;
  readonly fetch?: typeof fetch;
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}
export const AUDIO_LIMITS = Object.freeze({ sources: 8, pending: 2, buffers: 7, entities: 8, streams: 32, messageIds: 512 });
export const AUDIO_VOLUME_KEY = 'babylon.world-audio.volume.v1';
type Clip = 'wind' | 'birds' | 'grass' | 'step' | 'sprint' | 'jump' | 'mumble';
interface Cached { buffer: AudioBuffer; lease: BudgetLease }
interface Loading { controller: AbortController; reader: ReadableStreamDefaultReader<Uint8Array> | null; chunks: Uint8Array[]; input: BudgetLease; decoded: BudgetLease; canceled: boolean; promise: Promise<AudioBuffer | null> }
interface Motion { tick: number; position: AudioMovement['position']; grounded: boolean; jumpStarted: boolean; distance: number }
let nextInstance = 0;

/** Browser-only presentation. It never accepts intentions, text, or writes game state.
 * Non-live samples silently advance the baselines. Monotonic ticks/sequences must
 * retain their meaning across reconnect. Create one instance per scene lifetime.
 */
export class WorldAudio {
  private readonly instance = ++nextInstance;
  private readonly options: WorldAudioOptions;
  private readonly storage: WorldAudioOptions['storage'];
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private disposed = false;
  private level = 0.3;
  private clock = 0;
  private nextWind = 60;
  private nextBirds = 110;
  private nextGrass = 17;
  private reservedBytes = 0;
  private failures = 0;
  private readonly buffers = new Map<Clip, Cached>();
  private readonly loading = new Map<Clip, Loading>();
  private readonly failedClips = new Set<Clip>();
  private readonly sources = new Map<AudioBufferSourceNode, { lease: BudgetLease; release: () => void }>();
  private readonly motions = new Map<string, Motion>();
  private retainedEntities: Set<string> | null = null;
  private readonly streams = new Map<string, number>();
  private readonly messageIds = new Set<string>();
  private readonly lastPlayed = new Map<Clip, number>();
  private readonly waitingPlayback = new Set<Clip>();
  private waitingMumbles = 0;
  private playbackEpoch = 0;
  private mumbleVariation = 0;

  constructor(private readonly budget: WorldBudget, options: WorldAudioOptions = {}) {
    this.options = options;
    let storage = options.storage;
    if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
    this.storage = storage;
    try {
      const raw = storage?.getItem(AUDIO_VOLUME_KEY);
      if (raw !== null && raw !== undefined && raw.trim() !== '') {
        const value = Number(raw);
        if (Number.isFinite(value) && value >= 0 && value <= 1) this.level = value;
      }
    } catch { /* Storage is optional, including in private browsing. */ }
  }

  get volume(): number { return this.level; }
  get stats() {
    return { sources: this.sources.size, buffers: this.buffers.size, pending: this.loading.size,
      reservedBytes: this.reservedBytes, failures: this.failures, unlocked: this.context?.state === 'running',
      entities: this.motions.size, streams: this.streams.size, messageIds: this.messageIds.size };
  }

  setVolume(value: number): void {
    if (this.disposed || !Number.isFinite(value)) return;
    this.level = Math.min(1, Math.max(0, value));
    try { if (this.gain) this.gain.gain.value = this.level; } catch { this.failures++; }
    if (this.level === 0) this.stopSources();
    try { this.storage?.setItem(AUDIO_VOLUME_KEY, String(this.level)); } catch { /* Never block play. */ }
  }

  /** Call synchronously from a trusted click/key handler. Never rejects. */
  async unlock(): Promise<void> {
    if (this.disposed) return;
    try {
      if (!this.context) {
        const context = this.options.createContext?.() ?? new AudioContext();
        this.context = context;
        this.gain = context.createGain();
        this.gain.gain.value = this.level;
        this.gain.connect(context.destination);
      }
      // Invoke resume before the first await, while user activation is present.
      if (this.context.state !== 'running') await this.context.resume();
    } catch { this.failures++; }
  }

  /** No background timer and no special menu/visibility mode. No catch-up bursts. */
  update(deltaSeconds: number): void {
    if (this.disposed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    this.clock += Math.min(deltaSeconds, 0.25);
    if (this.clock >= this.nextWind) { this.nextWind = this.clock + 67; this.play('wind'); }
    if (this.clock >= this.nextBirds) { this.nextBirds = this.clock + 119; this.play('birds'); }
    if (this.clock >= this.nextGrass) { this.nextGrass = this.clock + 23; this.play('grass'); }
  }

  /** Call before movement() with the complete authoritative set of present players.
   * Tracks at most 8 IDs. Absent players release their slots; newly retained players
   * establish a silent first sample, even if it reports an in-progress jump.
   * Once used, samples outside the retained set are ignored until retained again.
   */
  retainEntities(ids: readonly string[]): void {
    if (this.disposed) return;
    const retained = new Set<string>();
    for (const id of ids) {
      if (id) retained.add(id);
      if (retained.size >= AUDIO_LIMITS.entities) break;
    }
    for (const id of this.motions.keys()) if (!retained.has(id)) this.motions.delete(id);
    this.retainedEntities = retained;
  }

  movement(sample: AudioMovement): void {
    if (this.disposed || !sample.entityId || (this.retainedEntities !== null && !this.retainedEntities.has(sample.entityId)) || !Number.isSafeInteger(sample.tick) || sample.tick < 0
      || ![sample.position.x, sample.position.y, sample.position.z].every(Number.isFinite)) return;
    if (sample.origin !== 'live') this.playbackEpoch++;
    const previous = this.motions.get(sample.entityId);
    if (previous && sample.tick <= previous.tick) return;
    // Refuse new tracking slots rather than evicting a deduplication baseline.
    if (!previous && this.motions.size >= AUDIO_LIMITS.entities) return;
    const current: Motion = { tick: sample.tick, position: { ...sample.position }, grounded: sample.grounded, jumpStarted: sample.jumpStarted, distance: previous?.distance ?? 0 };
    this.motions.set(sample.entityId, current);
    if (sample.origin !== 'live') { current.distance = 0; return; }
    if (!previous && this.retainedEntities !== null) return;
    if (sample.jumpStarted) { current.distance = 0; if (!previous?.jumpStarted) this.play('jump'); return; }
    if (!previous || !sample.grounded || !previous.grounded) { current.distance = 0; return; }
    const distance = Math.hypot(sample.position.x - previous.position.x, sample.position.z - previous.position.z);
    // Discontinuities/teleports and long sample gaps are not footsteps.
    if (distance > 1.5 || sample.tick - previous.tick > 30) { current.distance = 0; return; }
    if (distance < 0.001) return;
    current.distance += distance;
    const stride = sample.sprinting ? 0.95 : 0.72;
    if (current.distance >= stride) { current.distance %= stride; this.play(sample.sprinting ? 'sprint' : 'step'); }
  }

  message(message: AudioMessage): void {
    if (this.disposed || !message.id || !message.stream || !Number.isSafeInteger(message.sequence) || message.sequence < 0) return;
    const previous = this.streams.get(message.stream);
    if (previous !== undefined && message.sequence <= previous) return;
    if (previous === undefined && this.streams.size >= AUDIO_LIMITS.streams) return;
    this.streams.set(message.stream, message.sequence);
    const seen = this.messageIds.has(message.id);
    if (this.messageIds.size >= AUDIO_LIMITS.messageIds) this.messageIds.delete(this.messageIds.values().next().value!);
    this.messageIds.add(message.id);
    if (message.origin === 'live' && !seen) this.play('mumble');
    else if (message.origin !== 'live') this.playbackEpoch++;
  }

  private reserve(key: string, bytes: number, memory: number): BudgetLease {
    const lease = this.budget.reserve(`audio:${this.instance}:${key}`, bytes, memory);
    this.reservedBytes += memory;
    let active = true;
    return { release: () => { if (active) { active = false; this.reservedBytes -= memory; lease.release(); } } };
  }

  private play(clip: Clip): void {
    const context = this.context;
    if (this.disposed || !context || context.state !== 'running' || this.level === 0 || !this.gain) return;
    if (this.sources.size >= AUDIO_LIMITS.sources) return;
    const cached = this.buffers.get(clip);
    if (!cached) {
      // One short-lived load per clip. Distinct mumbles can share that load,
      // bounded by the source cap and the oldest event's deadline/epoch.
      if (this.waitingPlayback.has(clip)) {
        if (clip === 'mumble') this.waitingMumbles = Math.min(AUDIO_LIMITS.sources, this.waitingMumbles + 1);
        return;
      }
      this.waitingPlayback.add(clip);
      if (clip === 'mumble') this.waitingMumbles = 1;
      const requestedAt = context.currentTime; const requestedWall = performance.now(); const epoch = this.playbackEpoch;
      void this.load(clip).then(buffer => {
        this.waitingPlayback.delete(clip);
        const count = clip === 'mumble' ? this.waitingMumbles : 1;
        if (clip === 'mumble') this.waitingMumbles = 0;
        if (buffer && !this.disposed && epoch === this.playbackEpoch && context.currentTime - requestedAt <= 0.25 && performance.now() - requestedWall <= 250) {
          for (let event = 0; event < count; event++) this.play(clip);
        }
      }).catch(() => { this.waitingPlayback.delete(clip); if (clip === 'mumble') this.waitingMumbles = 0; });
      return;
    }
    const cooldown = clip === 'step' || clip === 'sprint' ? 0.075 : clip === 'jump' ? 0.08 : 1;
    if (clip !== 'mumble' && context.currentTime - (this.lastPlayed.get(clip) ?? -Infinity) < cooldown) return;
    let source: AudioBufferSourceNode | null = null;
    let lease: BudgetLease | null = null;
    try {
      // Reserve a conservative playback copy as well as the shared decoded buffer.
      lease = this.reserve(`source:${clip}:${context.currentTime}:${this.sources.size}`, 0, cached.buffer.length * cached.buffer.numberOfChannels * 4 + 512);
      source = context.createBufferSource();
      source.buffer = cached.buffer;
      if (clip === 'mumble') {
        // A small deterministic timbre/tempo set. No extra source or text input.
        source.playbackRate.value = [0.94, 1.03, 1.09, 0.98][this.mumbleVariation % 4]!;
        this.mumbleVariation++;
      }
      source.connect(this.gain);
      const node = source; const reservation = lease;
      const release = () => {
        node.onended = null;
        try { node.disconnect(); } catch { /* Already disconnected. */ }
        node.buffer = null;
        this.sources.delete(node);
        reservation.release();
      };
      this.sources.set(source, { lease, release });
      source.onended = release;
      source.start();
      this.lastPlayed.set(clip, context.currentTime);
    } catch {
      if (source) {
        const active = this.sources.get(source);
        if (active) active.release();
        else { try { source.disconnect(); } catch { /* No connection. */ } source.buffer = null; }
      }
      lease?.release(); this.failures++;
    }
  }

  private load(clip: Clip): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(clip);
    if (cached) return Promise.resolve(cached.buffer);
    const pending = this.loading.get(clip);
    if (pending) return pending.promise;
    if (this.disposed || this.failedClips.has(clip) || this.loading.size >= AUDIO_LIMITS.pending || !this.context) return Promise.resolve(null);
    const asset = manifest.files.find(file => file.name === clip)!;
    let input: BudgetLease;
    let decoded: BudgetLease;
    try {
      // Reader chunks + contiguous WAV coexist. Reserve before HTTP/createBuffer.
      input = this.reserve(`input:${clip}`, asset.bytes, asset.bytes * 2);
      try { decoded = this.reserve(`decoded:${clip}`, 0, asset.frames * 4); }
      catch (error) { input.release(); throw error; }
    } catch { this.failures++; return Promise.resolve(null); }
    const operation: Loading = { controller: new AbortController(), reader: null, chunks: [], input, decoded, canceled: false, promise: Promise.resolve(null) };
    this.loading.set(clip, operation);
    operation.promise = this.read(clip, operation).finally(() => { if (this.loading.get(clip) === operation) this.loading.delete(clip); });
    return operation.promise;
  }

  private async read(clip: Clip, operation: Loading): Promise<AudioBuffer | null> {
    let keepDecoded = false;
    try {
      const asset = manifest.files.find(file => file.name === clip)!;
      const fetcher = this.options.fetch ?? globalThis.fetch;
      const response = await fetcher(`/assets/audio/${asset.file}`, { signal: operation.controller.signal, cache: 'no-store', redirect: 'error', credentials: 'same-origin' });
      if (operation.canceled || this.disposed) { await response.body?.cancel(); return null; }
      if (!response.ok || !response.body || response.redirected) throw new Error('Audio response failed');
      const declared = response.headers.get('content-length');
      if (declared !== null && Number(declared) !== asset.bytes) { await response.body.cancel(); throw new Error('Audio length mismatch'); }
      operation.reader = response.body.getReader();
      let length = 0;
      while (true) {
        const part = await operation.reader.read();
        if (operation.canceled || this.disposed) return null;
        if (part.done) break;
        length += part.value.byteLength;
        if (length > asset.bytes) throw new Error('Audio exceeds declared budget');
        if (part.value.byteLength > 0) operation.chunks.push(part.value);
        if (operation.chunks.length > 1024) throw new Error('Audio stream has too many chunks');
      }
      if (length !== asset.bytes) throw new Error('Truncated audio');
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of operation.chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      operation.chunks.length = 0;
      const view = new DataView(bytes.buffer);
      const text = (start: number, size: number) => String.fromCharCode(...bytes.subarray(start, start + size));
      if (text(0, 4) !== 'RIFF' || text(8, 8) !== 'WAVEfmt ' || text(36, 4) !== 'data'
        || view.getUint32(4, true) !== length - 8 || view.getUint32(16, true) !== 16
        || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== asset.sampleRate
        || view.getUint32(28, true) !== asset.sampleRate * 2 || view.getUint16(32, true) !== 2
        || view.getUint16(34, true) !== 16 || view.getUint32(40, true) !== asset.frames * 2) throw new Error('Unsupported audio format');
      // Fixed PCM16 assets need no asynchronous native decoder or uncancelable job.
      const buffer = this.context!.createBuffer(1, asset.frames, asset.sampleRate);
      const channel = buffer.getChannelData(0);
      for (let frame = 0; frame < asset.frames; frame++) channel[frame] = view.getInt16(44 + frame * 2, true) / 32768;
      this.buffers.set(clip, { buffer, lease: operation.decoded });
      keepDecoded = true;
      return buffer;
    } catch {
      if (!operation.canceled && !this.disposed) { this.failures++; this.failedClips.add(clip); }
      return null;
    } finally {
      operation.chunks.length = 0;
      if (operation.reader) { try { await operation.reader.cancel(); } catch { /* Abort already canceled it. */ } }
      operation.input.release();
      if (!keepDecoded) operation.decoded.release();
    }
  }

  private stopSources(): void {
    for (const [source, active] of this.sources) {
      try { source.stop(); } catch { /* The node may already have ended. */ }
      active.release();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopSources();
    for (const operation of this.loading.values()) {
      operation.canceled = true;
      operation.controller.abort();
      if (operation.reader) void operation.reader.cancel().catch(() => {});
      operation.chunks.length = 0;
      operation.input.release(); operation.decoded.release();
    }
    this.loading.clear();
    for (const cached of this.buffers.values()) cached.lease.release();
    this.buffers.clear(); this.motions.clear(); this.retainedEntities = null; this.streams.clear(); this.messageIds.clear(); this.lastPlayed.clear(); this.failedClips.clear(); this.waitingPlayback.clear(); this.waitingMumbles = 0;
    try { this.gain?.disconnect(); } catch { /* Optional browser audio. */ }
    this.gain = null;
    try { void this.context?.close().catch(() => {}); } catch { /* Optional browser audio. */ }
    this.context = null;
  }
}
