import { GameWorld } from '../core/GameWorld';
import type { Direction, GameCommand, Vector3, WorldEvent, WorldSnapshot } from '../core/types';
import type { GameSession } from './GameSession';
import type { AccessContext, Clock, NetworkAdapter } from '../multiplayer/NetworkAdapter';
import type { ClientMessage, NetworkState, ServerMessage, WorldDescriptor } from '../../../shared/protocol/types.ts';
import { LIMITS } from '../../../shared/protocol/types.ts';

export type ChatMessage = Extract<ServerMessage, { type: 'chat' }>;
export type OnlineNotice =
  | { readonly type: 'status'; readonly state: NetworkState }
  | { readonly type: 'joined'; readonly world: WorldDescriptor }
  | { readonly type: 'chat'; readonly message: ChatMessage }
  | { readonly type: 'npc'; readonly targetId: string; readonly requestId: string; readonly text: string }
  | { readonly type: 'request-error'; readonly requestId: string; readonly message: string };
type RequestType = 'join' | 'resync' | 'interact' | 'npc-question' | 'chat-send';
interface Pending { readonly type: RequestType; readonly timer: number; readonly targetId?: string }
interface Buffered { readonly time: number; readonly snapshot: WorldSnapshot }

export class OnlineSession implements GameSession {
  readonly mode = 'online';
  private id: string | null = null;
  get playerId(): string | null { return this.id; }
  private readonly world = new GameWorld('replica');
  private readonly listeners = new Set<(events: readonly WorldEvent[]) => void>();
  private readonly notices = new Set<(notice: OnlineNotice) => void>();
  private readonly pending = new Map<string, Pending>();
  private readonly seenChat = new Set<string>();
  private history: Buffered[] = [];
  private updates: Extract<ServerMessage, { type: 'snapshot' | 'delta' }>[] = [];
  private updateOverflow = false;
  private context: AccessContext | undefined;
  private value: NetworkState = { status: 'unauthorized', error: null };
  get state(): NetworkState { return this.value; }
  private revision = -1;
  private joinId: string | null = null;
  private resyncId: string | null = null;
  private epoch = 0;
  private requestCount = 0;
  private sequence = 0;
  private elapsed = 0;
  private lastInputAt = -Infinity;
  private inputTimer: number | null = null;
  private direction: Direction = { x: 0, z: 0 };
  private prepared: readonly string[] = [];
  private guard: ((position: Vector3) => boolean) | null = null;
  private disposed = false;
  private readonly unsubscribe: readonly (() => void)[];

  constructor(private readonly network: NetworkAdapter, private readonly mapId: string, private readonly clock: Clock) {
    this.unsubscribe = [network.subscribe(this.receive), network.subscribeState(this.connection)];
  }
  connect(context?: AccessContext): void { if (this.disposed) return; this.context = context; this.network.connect(context); }
  reconnect(): void { this.connect(this.context); }
  private readonly connection = (state: NetworkState): void => {
    if (this.disposed) return;
    this.clearPending('Связь прервана. Действие не будет отправлено повторно.');
    this.direction = { x: 0, z: 0 }; this.history = []; this.prepared = [];
    this.updates = []; this.updateOverflow = false;
    this.joinId = null; this.resyncId = null; this.revision = -1; this.sequence = 0; this.elapsed = 0;
    if (this.inputTimer !== null) this.clock.clear(this.inputTimer); this.inputTimer = null; this.lastInputAt = -Infinity;
    if (state.status === 'connected') {
      this.epoch++; this.requestCount = 0;
      this.status({ status: 'connecting', error: null });
      this.joinId = this.request('join', (requestId) => ({ v: 1, type: 'join', requestId, mapId: this.mapId }));
    } else { if (state.status === 'unauthorized') this.context = undefined; this.status(state); }
  };
  private status(state: NetworkState): void { this.value = Object.freeze({ ...state }); this.publish({ type: 'status', state: this.value }); }

  send(command: GameCommand): void {
    if (this.disposed || this.value.status !== 'connected' || !this.id || this.resyncId) return;
    if (command.type === 'move') {
      const { x, z } = command.direction;
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      const divisor = Math.max(1, Math.hypot(x, z)); this.direction = { x: x / divisor, z: z / divisor };
      if (x === 0 && z === 0) this.flushInput();
    } else this.request('interact', (requestId) => ({ v: 1, type: 'interact', requestId, targetId: command.targetId }), command.targetId);
  }
  chat(text: string): string | null { return this.request('chat-send', (requestId) => ({ v: 1, type: 'chat-send', requestId, text: text.trim() })); }
  askNpc(targetId: string, text: string): string | null { return this.request('npc-question', (requestId) => ({ v: 1, type: 'npc-question', requestId, targetId, text: text.trim() }), targetId); }
  setMovementGuard(guard: (position: Vector3) => boolean): void { this.guard = guard; }
  setPreparedChunks(ids: readonly string[]): void { this.prepared = [...ids].slice(0, 25); }
  update(deltaSeconds: number): void {
    if (this.disposed || this.value.status !== 'connected' || !this.id) return;
    const updates = this.updates; this.updates = [];
    if (this.updateOverflow) { this.updateOverflow = false; this.resync(); }
    else for (const message of updates) this.applyUpdate(message);
    if (this.resyncId) return;
    this.elapsed += deltaSeconds;
    if (this.elapsed < 1 / LIMITS.inputHz) return;
    this.elapsed %= 1 / LIMITS.inputHz;
    this.flushInput();
  }
  private flushInput(): void {
    if (this.disposed || this.value.status !== 'connected' || !this.id) return;
    const remaining = 1000 / LIMITS.inputHz - (this.clock.now() - this.lastInputAt);
    if (remaining > 0) {
      if (this.inputTimer === null) this.inputTimer = this.clock.set(() => { this.inputTimer = null; this.flushInput(); }, remaining);
      return;
    }
    if (this.inputTimer !== null) this.clock.clear(this.inputTimer); this.inputTimer = null;
    this.lastInputAt = this.clock.now();
    const player = this.getSnapshot().entities.find((entity) => entity.id === this.id);
    let direction = this.resyncId ? { x: 0, z: 0 } : this.direction;
    const position = player?.transform?.position;
    if (!position || (this.guard && !this.guard({ x: position.x + direction.x * (player?.movement?.speed ?? 3) / LIMITS.inputHz, y: position.y, z: position.z + direction.z * (player?.movement?.speed ?? 3) / LIMITS.inputHz }))) direction = { x: 0, z: 0 };
    this.network.send({ v: 1, type: 'input', requestId: this.nextId(), sequence: ++this.sequence, direction, preparedChunks: this.prepared });
  }
  getSnapshot(): WorldSnapshot { return this.world.getSnapshot(); }
  /** Presentation is delayed independently; the authoritative snapshot is never interpolated. */
  getRenderState(): { previous: WorldSnapshot; current: WorldSnapshot; alpha: number } {
    const target = this.clock.now() - 100;
    const upper = this.history.findIndex((item) => item.time >= target);
    const current = (upper < 0 ? this.history.at(-1) : this.history[upper]) ?? { time: target, snapshot: this.getSnapshot() };
    const previous = upper > 0 ? this.history[upper - 1]! : current;
    const alpha = current.time === previous.time ? 1 : Math.max(0, Math.min(1, (target - previous.time) / (current.time - previous.time)));
    // The camera follows the rendered player, so it needs the same interpolation as peers.
    return { previous: previous.snapshot, current: current.snapshot, alpha };
  }
  private nextId(): string { return `c${this.epoch}_${++this.requestCount}`; }
  private request(type: RequestType, create: (requestId: string) => ClientMessage, targetId?: string): string | null {
    if (this.disposed || this.network.state.status !== 'connected' || (type !== 'join' && this.value.status !== 'connected')) { this.publish({ type: 'request-error', requestId: 'offline', message: 'Нет связи с миром. Действие не отправлено.' }); return null; }
    if (this.pending.size >= LIMITS.pending) { this.publish({ type: 'request-error', requestId: 'limit', message: 'Слишком много ожидающих действий.' }); return null; }
    const requestId = this.nextId();
    const timer = this.clock.set(() => {
      const pending = this.pending.get(requestId); this.pending.delete(requestId);
      if (!pending) return;
      this.publish({ type: 'request-error', requestId, message: 'Сервер не подтвердил действие за 10 секунд.' });
      if (pending.type === 'join' || pending.type === 'resync') this.status({ status: 'error', error: 'Не удалось синхронизировать мир. Повторите подключение.' });
    }, LIMITS.requestMs);
    this.pending.set(requestId, { type, timer, ...(targetId ? { targetId } : {}) });
    try { if (this.network.send(create(requestId))) return requestId; } catch { /* invalid intent is surfaced below */ }
    this.finish(requestId);
    this.publish({ type: 'request-error', requestId, message: 'Не удалось отправить действие. Проверьте связь и длину сообщения.' });
    return null;
  }
  private finish(requestId: string): Pending | undefined { const pending = this.pending.get(requestId); if (pending) { this.clock.clear(pending.timer); this.pending.delete(requestId); } return pending; }
  private clearPending(message: string): void { for (const [requestId, pending] of this.pending) { this.clock.clear(pending.timer); if (pending.type !== 'join' && pending.type !== 'resync') this.publish({ type: 'request-error', requestId, message }); } this.pending.clear(); }
  private resync(): void {
    if (this.resyncId) return;
    this.history = []; this.direction = { x: 0, z: 0 };
    this.flushInput();
    this.resyncId = this.request('resync', (requestId) => ({ v: 1, type: 'resync', requestId, revision: Math.max(0, this.revision) }));
  }
  private apply(snapshot: WorldSnapshot, revision: number): void {
    this.world.applySnapshot(snapshot); this.revision = revision;
    this.history.push({ time: this.clock.now(), snapshot: this.world.getSnapshot() }); this.history = this.history.slice(-8);
    const events = this.world.drainEvents(); for (const listener of this.listeners) listener(events);
  }
  private readonly receive = (message: ServerMessage): void => {
    if (this.disposed) return;
    if (message.type === 'joined') {
      if (message.requestId !== this.joinId || this.pending.get(message.requestId)?.type !== 'join') return;
      this.finish(message.requestId); this.joinId = null; this.id = message.playerId;
      this.apply(message.snapshot, message.revision); this.status({ status: 'connected', error: null });
      this.publish({ type: 'joined', world: message.world }); return;
    }
    if (message.type === 'error') {
      const pending = this.finish(message.requestId);
      if (pending) this.publish({ type: 'request-error', requestId: message.requestId, message: message.message });
      if (message.code === 'UNAUTHORIZED') { this.context = undefined; this.network.disconnect(); this.status({ status: 'unauthorized', error: message.message }); }
      else if (message.code === 'VERSION') { this.network.disconnect(); this.status({ status: 'error', error: message.message }); }
      return;
    }
    if (this.value.status !== 'connected' || this.joinId || !this.id) return;
    if (message.type === 'snapshot' || message.type === 'delta') {
      if (this.updateOverflow) return;
      if (this.updates.length >= 8) { this.updates = []; this.updateOverflow = true; }
      else this.updates.push(message);
      return;
    }
    if (message.type === 'interacted') {
      const pending = this.pending.get(message.requestId);
      if (pending?.type !== 'interact' || pending.targetId !== message.targetId) return;
      this.finish(message.requestId);
      for (const listener of this.listeners) listener([{ type: 'interacted', actorId: this.id, targetId: message.targetId }]);
    } else if (message.type === 'npc-answer') {
      const pending = this.pending.get(message.requestId);
      if (pending?.type !== 'npc-question' || pending.targetId !== message.targetId) return;
      this.finish(message.requestId); this.publish({ type: 'npc', requestId: message.requestId, targetId: message.targetId, text: message.text });
    } else if (message.type === 'chat') {
      if (this.seenChat.has(message.messageId)) return;
      this.seenChat.add(message.messageId); if (this.seenChat.size > 100) this.seenChat.delete(this.seenChat.values().next().value!);
      if (message.playerId === this.id) { if (this.pending.get(message.requestId)?.type !== 'chat-send') return; this.finish(message.requestId); }
      this.publish({ type: 'chat', message });
    }
  };
  private applyUpdate(message: Extract<ServerMessage, { type: 'snapshot' | 'delta' }>): void {
    if (!this.id) return;
    if (message.type === 'snapshot') {
      if (message.revision < this.revision || (message.revision === this.revision && !this.resyncId) || message.snapshot.tick < this.getSnapshot().tick) return;
      if (!message.snapshot.entities.some((entity) => entity.id === this.id && entity.transform)) { this.resync(); return; }
      if (this.resyncId) this.finish(this.resyncId); this.resyncId = null;
      this.apply(message.snapshot, message.revision); return;
    }
    if (message.type === 'delta') {
      if (message.revision <= this.revision || this.resyncId) return;
      if (message.baseRevision !== this.revision || message.revision !== this.revision + 1 || message.tick < this.getSnapshot().tick) { this.resync(); return; }
      const entities = new Map(this.getSnapshot().entities.map((entity) => [entity.id, entity]));
      for (const id of message.remove) entities.delete(id);
      for (const entity of message.upsert) entities.set(entity.id, entity);
      if (entities.size > LIMITS.entities || !entities.get(this.id)?.transform) { this.resync(); return; }
      this.apply({ tick: message.tick, entities: [...entities.values()] }, message.revision); return;
    }
  }
  subscribe(listener: (events: readonly WorldEvent[]) => void): () => void { if (this.disposed) return () => {}; this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  subscribeNotices(listener: (notice: OnlineNotice) => void): () => void { if (this.disposed) return () => {}; this.notices.add(listener); listener({ type: 'status', state: this.value }); return () => { this.notices.delete(listener); }; }
  private publish(notice: OnlineNotice): void { for (const listener of this.notices) listener(notice); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.clearPending('Сессия завершена.');
    if (this.inputTimer !== null) this.clock.clear(this.inputTimer); this.inputTimer = null;
    for (const unsubscribe of this.unsubscribe) unsubscribe(); this.network.dispose();
    this.context = undefined; this.listeners.clear(); this.notices.clear(); this.history = []; this.updates = []; this.seenChat.clear(); this.direction = { x: 0, z: 0 };
  }
}
