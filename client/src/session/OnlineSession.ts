import { GameWorld } from '../core/GameWorld';
import type { Direction, GameCommand, Vector3, WorldEvent, WorldSnapshot } from '../core/types';
import type { GameSession } from './GameSession';
import type { AccessContext, Clock, NetworkAdapter } from '../multiplayer/NetworkAdapter';
import type { ClientMessage, NetworkState, ServerMessage, WorldDescriptor } from '../../../shared/protocol/types.ts';
import { LIMITS } from '../../../shared/protocol/types.ts';
import { NPC_TIMING, npcRequestWaitMs, validNpcTimeoutMs } from '../../../shared/protocol/npcTiming.ts';
import { MOVEMENT } from '../../../shared/movement/simulation.ts';
import type { HandRequest, SceneStateMessage, WorldLifeServerMessage } from '../../../shared/world-life/types.ts';
import { WORLD_LIFE_LIMITS } from '../../../shared/world-life/types.ts';

export type ChatMessage = Extract<ServerMessage, { type: 'chat' }>;
export interface CarryState {
  readonly pending: boolean;
  readonly error: string | null;
  readonly heldItemId: string | null;
  readonly hint: string | null;
}
export type OnlineNotice =
  | { readonly type: 'status'; readonly state: NetworkState }
  | { readonly type: 'joined'; readonly world: WorldDescriptor }
  | { readonly type: 'chat'; readonly message: ChatMessage }
  | { readonly type: 'carry'; readonly state: CarryState }
  | { readonly type: 'scene'; readonly state: SceneStateMessage }
  | { readonly type: 'world'; readonly snapshot: WorldSnapshot; readonly origin: 'live' | 'snapshot' }
  | { readonly type: 'npc'; readonly targetId: string; readonly requestId: string; readonly text: string }
  | { readonly type: 'request-error'; readonly requestId: string; readonly message: string };
type RequestType = 'join' | 'resync' | 'interact' | 'npc-question' | 'chat-send';
interface Pending { readonly type: RequestType; readonly timer: number; readonly targetId?: string }
interface Buffered { readonly time: number; readonly snapshot: WorldSnapshot }
export interface RuntimeConfigRequest { readonly result: Promise<number>; cancel(): void }

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
  private sprint = false;
  private jumpId = 0;
  private jumpCounter = 0;
  private prepared: readonly string[] = [];
  private guard: ((position: Vector3) => boolean) | null = null;
  private pathGuard: ((from: Vector3, to: Vector3) => boolean) | null = null;
  private disposed = false;
  private runtimeRequest: RuntimeConfigRequest | null = null;
  private npcTimeoutMs: number | null = null;
  private readonly unsubscribe: readonly (() => void)[];
  private scene: SceneStateMessage | null = null;
  get worldLife(): SceneStateMessage | null { return this.scene; }
  private handPending: { readonly packet: HandRequest; readonly timer: number } | null = null;
  private handError: string | null = null;
  private readonly handPrefix: string;
  get carryState(): CarryState {
    const heldItemId = this.scene?.apples.find(apple => apple.state === 'held' && apple.holderId === this.id)?.id ?? null;
    const hint = this.value.status !== 'connected' || !this.scene ? null : heldItemId ? 'Положить яблоко' : this.nearestApple() ? 'Поднять яблоко' : null;
    return { pending: this.handPending !== null, error: this.handError, heldItemId, hint };
  }

  constructor(private readonly network: NetworkAdapter, private readonly mapId: string, private readonly clock: Clock, private readonly runtimeConfig?: () => RuntimeConfigRequest) {
    this.handPrefix = `h${clock.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    this.unsubscribe = [network.subscribe(this.receive), network.subscribeWorldLife(this.receiveWorldLife), network.subscribeState(this.connection)];
  }
  connect(context?: AccessContext): void { if (this.disposed) return; this.runtimeRequest?.cancel(); this.runtimeRequest = null; this.npcTimeoutMs = null; this.context = context; this.network.connect(context); }
  reconnect(): void { this.connect(this.context); }
  private readonly connection = (state: NetworkState): void => {
    if (this.disposed) return;
    this.runtimeRequest?.cancel(); this.runtimeRequest = null; this.npcTimeoutMs = null;
    this.clearPending('Связь прервана. Действие не будет отправлено повторно.');
    this.clearHand(this.handPending ? 'Связь прервана. Действие не будет отправлено повторно.' : null);
    this.scene = null;
    this.direction = { x: 0, z: 0 }; this.sprint = false; this.jumpId = 0; this.jumpCounter = 0; this.history = []; this.prepared = [];
    this.updates = []; this.updateOverflow = false;
    this.joinId = null; this.resyncId = null; this.revision = -1; this.sequence = 0; this.elapsed = 0;
    if (this.inputTimer !== null) this.clock.clear(this.inputTimer); this.inputTimer = null; this.lastInputAt = -Infinity;
    if (state.status === 'connected') {
      this.epoch++; this.requestCount = 0;
      if (this.context?.kind === 'mock') this.npcTimeoutMs = NPC_TIMING.defaultMs;
      else if (this.runtimeConfig) {
        try {
          const request = this.runtimeConfig(); this.runtimeRequest = request;
          void request.result.then((value) => {
            if (this.runtimeRequest === request && validNpcTimeoutMs(value)) this.npcTimeoutMs = value;
          }).catch(() => { /* NPC requests remain disabled until the next connection. */ });
        } catch { /* NPC requests remain disabled until the next connection. */ }
      }
      this.status({ status: 'connecting', error: null });
      this.joinId = this.request('join', (requestId) => ({ v: 3, type: 'join', requestId, mapId: this.mapId }));
    } else { if (state.status === 'unauthorized') this.context = undefined; this.status(state); }
    this.publishCarry();
  };
  private status(state: NetworkState): void { this.value = Object.freeze({ ...state }); this.publish({ type: 'status', state: this.value }); }

  send(command: GameCommand): void {
    if (this.disposed || this.value.status !== 'connected' || !this.id || this.resyncId) return;
    if (command.type === 'clear-input') {
      this.direction = { x: 0, z: 0 }; this.sprint = false;
      this.jumpId = 0;
      this.flushInput();
    } else if (command.type === 'jump') this.jumpId = ++this.jumpCounter;
    else if (command.type === 'sprint') { this.sprint = command.held; this.flushInput(); }
    else if (command.type === 'move') {
      const { x, z } = command.direction;
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      const divisor = Math.max(1, Math.hypot(x, z)); this.direction = { x: x / divisor, z: z / divisor };
      if (x === 0 && z === 0) this.flushInput();
    } else this.request('interact', (requestId) => ({ v: 3, type: 'interact', requestId, targetId: command.targetId }), command.targetId);
  }
  private nearestApple(): string | null {
    const position = this.getSnapshot().entities.find(entity => entity.id === this.id)?.transform?.position;
    if (!position || !this.scene) return null;
    const candidates = this.scene.apples.flatMap(apple => {
      if (apple.state !== 'world' || apple.mapId !== this.mapId) return [];
      const distance = Math.hypot(position.x - apple.position.x, position.y - apple.position.y, position.z - apple.position.z);
      if (distance > WORLD_LIFE_LIMITS.pickupDistance || (this.pathGuard && !this.pathGuard(position, apple.position))) return [];
      return [{ id: apple.id, distance }];
    });
    candidates.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
    return candidates[0]?.id ?? null;
  }
  /** Sends one intention only. Ownership changes exclusively through scene-state. */
  carry(): string | null {
    if (this.disposed || this.handPending) return null;
    if (this.value.status !== 'connected' || !this.scene || this.resyncId) {
      this.handError = 'Нет подтверждённого состояния мира. Повторите подключение.'; this.publishCarry(); return null;
    }
    const state = this.carryState;
    const targetId = state.heldItemId ? null : this.nearestApple();
    if (!state.heldItemId && !targetId) { this.handError = 'Рядом нет доступного яблока.'; this.publishCarry(); return null; }
    const requestId = `${this.handPrefix}_${this.nextId()}`;
    const packet: HandRequest = state.heldItemId ? { v: 1, type: 'hand', action: 'place', requestId } : { v: 1, type: 'hand', action: 'pickup', targetId: targetId!, requestId };
    const timer = this.clock.set(() => {
      this.clearHand('Сервер не подтвердил действие за 10 секунд. Ожидайте синхронизации; действие не повторяется автоматически.');
      this.syncScene();
    }, LIMITS.requestMs);
    this.handPending = { packet, timer }; this.handError = null; this.publishCarry();
    try { if (this.network.sendWorldLife(packet)) return requestId; } catch { /* report failed validation/send below */ }
    this.clearHand('Не удалось отправить действие. Проверьте связь.'); return null;
  }
  private publishCarry(): void { this.publish({ type: 'carry', state: this.carryState }); }
  private clearHand(error: string | null): void {
    if (this.handPending) this.clock.clear(this.handPending.timer);
    this.handPending = null; this.handError = error; this.publishCarry();
  }
  private syncScene(): void {
    if (this.disposed || this.value.status !== 'connected') return;
    try { this.network.sendWorldLife({ v: 1, type: 'scene-sync', requestId: `${this.handPrefix}_${this.nextId()}` }); } catch { /* transport reports invalid packets */ }
  }
  private readonly receiveWorldLife = (message: WorldLifeServerMessage): void => {
    if (this.disposed || this.value.status !== 'connected' || !this.id) return;
    if (message.type === 'scene-state') {
      if (message.definition.mapId !== this.mapId) return;
      if (this.scene?.sceneId === message.sceneId && (message.revision < this.scene.revision || message.serverTimeMs < this.scene.serverTimeMs)) return;
      this.scene = message;
      this.publish({ type: 'scene', state: message }); this.publishCarry();
      return;
    }
    const pending = this.handPending;
    if (!pending || pending.packet.requestId !== message.requestId) return;
    if (message.ok && (message.action !== pending.packet.action || (pending.packet.action === 'pickup' && message.apple.id !== pending.packet.targetId))) return;
    // A receipt can describe an earlier commit. Never patch current scene state from it.
    this.clearHand(message.ok ? null : message.message);
    this.syncScene();
  };
  chat(text: string): string | null { return this.request('chat-send', (requestId) => ({ v: 3, type: 'chat-send', requestId, text: text.trim() })); }
  askNpc(targetId: string, text: string): string | null { return this.request('npc-question', (requestId) => ({ v: 3, type: 'npc-question', requestId, targetId, text: text.trim() }), targetId); }
  setMovementGuard(guard: (position: Vector3) => boolean, path?: (from: Vector3, to: Vector3) => boolean): void { this.guard = guard; this.pathGuard = path ?? null; }
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
    if (!position) direction = { x: 0, z: 0 };
    else if (this.guard || this.pathGuard) {
      const step = (this.sprint ? MOVEMENT.sprintSpeed : MOVEMENT.walkSpeed) * MOVEMENT.substep;
      const dx = direction.x * step; const dz = direction.z * step;
      const available = [[dx, dz], [dx, 0], [0, dz]].some(([x, z]) => {
        if (x === 0 && z === 0) return false;
        const to = { x: position.x + x!, y: position.y, z: position.z + z! };
        return (!this.guard || this.guard(to)) && (!this.pathGuard || this.pathGuard(position, to));
      });
      if (!available) direction = { x: 0, z: 0 };
    }
    this.network.send({ v: 3, type: 'input', sprint: !this.resyncId && this.sprint, jumpId: this.resyncId ? (player?.motion?.jumpAck ?? 0) : this.jumpId, requestId: this.nextId(), sequence: ++this.sequence, direction, preparedChunks: this.prepared });
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
    if (type === 'npc-question' && this.npcTimeoutMs === null) { this.publish({ type: 'request-error', requestId: 'npc-config', message: 'Настройки диалога недоступны. Проверьте связь и переподключитесь.' }); return null; }
    if (this.pending.size >= LIMITS.pending) { this.publish({ type: 'request-error', requestId: 'limit', message: 'Слишком много ожидающих действий.' }); return null; }
    const requestId = this.nextId();
    const timeoutMs = type === 'npc-question' ? npcRequestWaitMs(this.npcTimeoutMs!) : LIMITS.requestMs;
    const timer = this.clock.set(() => {
      const pending = this.pending.get(requestId); this.pending.delete(requestId);
      if (!pending) return;
      this.publish({ type: 'request-error', requestId, message: `Сервер не подтвердил действие за ${timeoutMs / 1000} секунд.` });
      if (pending.type === 'join' || pending.type === 'resync') this.status({ status: 'error', error: 'Не удалось синхронизировать мир. Повторите подключение.' });
    }, timeoutMs);
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
    this.history = []; this.direction = { x: 0, z: 0 }; this.sprint = false; this.jumpId = this.getSnapshot().entities.find(e => e.id === this.id)?.motion?.jumpAck ?? 0;
    this.flushInput();
    this.resyncId = this.request('resync', (requestId) => ({ v: 3, type: 'resync', requestId, revision: Math.max(0, this.revision) }));
  }
  private apply(snapshot: WorldSnapshot, revision: number, origin: 'live' | 'snapshot' = 'snapshot'): void {
    this.world.applySnapshot(snapshot); this.revision = revision;
    if (this.scene) this.publishCarry();
    this.history.push({ time: this.clock.now(), snapshot: this.world.getSnapshot() }); this.history = this.history.slice(-8);
    const events = this.world.drainEvents(); for (const listener of this.listeners) listener(events);
    this.publish({ type: 'world', snapshot: this.world.getSnapshot(), origin });
  }
  private readonly receive = (message: ServerMessage): void => {
    if (this.disposed) return;
    if (message.type === 'joined') {
      if (message.requestId !== this.joinId || this.pending.get(message.requestId)?.type !== 'join') return;
      this.finish(message.requestId); this.joinId = null; this.id = message.playerId;
      this.apply(message.snapshot, message.revision); this.status({ status: 'connected', error: null });
      this.publish({ type: 'joined', world: message.world }); this.syncScene(); return;
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
      this.history = []; this.apply(message.snapshot, message.revision); return;
    }
    if (message.type === 'delta') {
      if (message.revision <= this.revision || this.resyncId) return;
      if (message.baseRevision !== this.revision || message.revision !== this.revision + 1 || message.tick < this.getSnapshot().tick) { this.resync(); return; }
      const entities = new Map(this.getSnapshot().entities.map((entity) => [entity.id, entity]));
      for (const id of message.remove) entities.delete(id);
      for (const entity of message.upsert) entities.set(entity.id, entity);
      if (entities.size > LIMITS.entities || !entities.get(this.id)?.transform) { this.resync(); return; }
      this.apply({ tick: message.tick, entities: [...entities.values()] }, message.revision, 'live'); return;
    }
  }
  subscribe(listener: (events: readonly WorldEvent[]) => void): () => void { if (this.disposed) return () => {}; this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  subscribeNotices(listener: (notice: OnlineNotice) => void): () => void { if (this.disposed) return () => {}; this.notices.add(listener); listener({ type: 'status', state: this.value }); return () => { this.notices.delete(listener); }; }
  private publish(notice: OnlineNotice): void { for (const listener of this.notices) listener(notice); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.runtimeRequest?.cancel(); this.runtimeRequest = null; this.npcTimeoutMs = null; this.clearPending('Сессия завершена.'); this.clearHand(null); this.scene = null;
    if (this.inputTimer !== null) this.clock.clear(this.inputTimer); this.inputTimer = null;
    for (const unsubscribe of this.unsubscribe) unsubscribe(); this.network.dispose();
    this.context = undefined; this.listeners.clear(); this.notices.clear(); this.history = []; this.updates = []; this.seenChat.clear(); this.direction = { x: 0, z: 0 };
  }
}
