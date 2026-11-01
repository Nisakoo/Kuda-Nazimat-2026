import type { ServerMessage } from '../../../shared/protocol/types.ts';
import type { Direction } from '../../../shared/world/types.ts';
import type { HandRequest, HandResultMessage, SceneStateMessage } from '../../../shared/world-life/types.ts';
import { handFailure } from '../../../shared/world-life/validate.ts';
import type { WorldLifeStore } from './worldLifePorts.ts';
import type { Clock, Scheduler, TimerHandle } from '../common/time.ts';
import type { Logger } from '../common/logger.ts';
import type { PlayerIdentity, PlayerStore, SavedPosition } from '../contracts.ts';
import type { PlayerLocation } from '../world/access.ts';
import type { NpcDefinition } from '../world/npcContent.ts';
import { AoiStream } from './AoiStream.ts';
import type { Channel } from './ports.ts';
import type { PlacedPlayer, World } from './World.ts';

export interface GameSettings { readonly maxPlayers: number; readonly disconnectGraceMs: number; readonly broadcastEvery: number; readonly initialSpawn?: (playerId: string) => { mapId: string; position: { x: number; y: number; z: number }; force?: boolean } | null; readonly didSpawn?: (playerId: string) => void }

interface Seat {
  readonly identity: PlayerIdentity;
  channel: Channel | null;
  stream: AoiStream | null;
  grace: TimerHandle | null;
  lifeRevision: number;
  lifeSentAt: number;
}

export type JoinResult =
  | { readonly ok: true; readonly message: (requestId: string) => ServerMessage }
  | { readonly ok: false; readonly reason: 'not-controlling' | 'already-joined' | 'unknown-map' };
export type InteractResult = { readonly ok: true; readonly npc: NpcDefinition } | { readonly ok: false; readonly reason: 'not-joined' | 'not-found' | 'too-far' };

export const TAKEOVER_REASON = 'Игра открыта в другом окне.';

/** Use cases of the shared world: seats, join, input, interaction, chat, AOI broadcast and presence. */
export class GameService {
  private readonly seats = new Map<string, Seat>();
  private readonly startedAt: string;
  private chatCounter = 0;
  private readonly world: World;
  private readonly players: PlayerStore;
  private readonly clock: Clock;
  private readonly scheduler: Scheduler;
  private readonly settings: GameSettings;
  private readonly log: Logger;
  private readonly lifeStore?: WorldLifeStore;

  constructor(world: World, players: PlayerStore, clock: Clock, scheduler: Scheduler, settings: GameSettings, log: Logger, lifeStore?: WorldLifeStore) {
    this.lifeStore = lifeStore;
    this.world = world; this.players = players; this.clock = clock; this.scheduler = scheduler; this.settings = settings; this.log = log;
    this.startedAt = clock.now().toString(36);
  }

  /** SERVER-006: an account that already has a seat may always reconnect; a new one needs a free slot. */
  canAdmit(accountId: string): boolean {
    return this.seats.has(accountId) || this.seats.size < this.settings.maxPlayers;
  }

  /** AUTH-005: the newest connection takes control; the previous one is closed. False when no slot is free. */
  attach(identity: PlayerIdentity, channel: Channel): boolean {
    if (!this.canAdmit(identity.accountId)) return false;
    let seat = this.seats.get(identity.accountId);
    if (!seat) { seat = { identity, channel: null, stream: null, grace: null, lifeRevision: -1, lifeSentAt: -Infinity }; this.seats.set(identity.accountId, seat); }
    if (seat.grace) { this.scheduler.clearTimeout(seat.grace); seat.grace = null; }
    const previous = seat.channel;
    seat.channel = channel;
    seat.stream = null;
    seat.lifeRevision = -1;
    seat.lifeSentAt = -Infinity;
    this.world.resetInput(identity.playerId);
    if (previous) previous.close(TAKEOVER_REASON);
    return true;
  }

  canAct(accountId: string, sessionKey: string): boolean { const seat = this.seats.get(accountId); return !!seat?.stream && seat.channel?.sessionKey === sessionKey; }

  isControlling(channel: Channel): boolean { return this.seatOf(channel) !== undefined; }

  /** REALTIME-006: keep the entity for the grace period, then save and free the seat. */
  detach(channel: Channel): void {
    const seat = this.seatOf(channel);
    if (!seat) return;
    seat.channel = null;
    seat.stream = null;
    this.world.resetInput(seat.identity.playerId);
    seat.grace = this.scheduler.setTimeout(() => this.release(seat), this.settings.disconnectGraceMs);
  }

  private release(seat: Seat): void {
    seat.grace = null;
    if (seat.channel) return;
    const placed = this.world.locate(seat.identity.playerId);
    if (placed) this.persist([placed]);
    this.world.remove(seat.identity.playerId);
    this.seats.delete(seat.identity.accountId);
  }

  join(channel: Channel, mapId: string): JoinResult {
    const seat = this.seatOf(channel);
    if (!seat) return { ok: false, reason: 'not-controlling' };
    if (seat.stream) return { ok: false, reason: 'already-joined' };
    const map = this.world.map(mapId);
    if (!map) return { ok: false, reason: 'unknown-map' };
    const { playerId, displayName } = seat.identity;
    const current = this.world.locate(playerId);
    const initial = this.settings.initialSpawn?.(playerId);
    const force = initial?.mapId === mapId && initial.force === true;
    if (!current || current.mapId !== mapId || force) {
      if (current) this.world.remove(playerId);
      const saved = this.loadSaved(playerId);
      const usable = !force && saved !== null && saved.mapId === mapId && this.world.isSafeSupport(mapId, saved.position);
      const spawn = initial?.mapId === mapId && this.world.isSafeSupport(mapId, initial.position) ? initial.position : map.spawn;
      this.world.add({ id: playerId, name: displayName, mapId, position: usable ? saved.position : spawn, rotationY: usable ? saved.rotationY : Math.PI });
    }
    if (force) {
      // Save the role spawn before acknowledging it, so a reconnect never restores an old demo position.
      const placed = this.world.locate(playerId)!;
      this.players.save([{ id: playerId, mapId, position: placed.position, rotationY: placed.rotationY }]);
      this.settings.didSpawn?.(playerId);
    }
    const stream = new AoiStream();
    const entities = this.world.aoi(playerId);
    stream.reset(entities);
    seat.stream = stream;
    const snapshot = { tick: this.world.tick, entities };
    return { ok: true, message: (requestId) => ({ v: 3, type: 'joined', requestId, playerId, revision: stream.revision, snapshot, world: map.bootstrap }) };
  }

  syncLife(channel: Channel, periodic = false, cache?: Map<string, SceneStateMessage>, now = this.clock.now()): void {
    const seat = this.joinedSeat(channel); const life = this.world.life;
    if (!seat || !life) return;
    const changed = seat.lifeRevision !== life.currentRevision();
    if (periodic && !changed && now-seat.lifeSentAt < 1000) return;
    const player = this.world.locate(seat.identity.playerId);
    if (!player) return;
    const packet = cache?.get(player.mapId) ?? life.snapshot(player.mapId, now);
    if (!packet) return;
    cache?.set(player.mapId,packet);
    // Changed authoritative state must not be lost behind MOVE deltas. Only clock heartbeats are volatile.
    channel.sendLife?.(packet, periodic && !changed);
    seat.lifeRevision = packet.revision; seat.lifeSentAt = now;
  }

  hand(channel: Channel, request: HandRequest): HandResultMessage {
    const seat = this.joinedSeat(channel);
    if (!seat) return handFailure(request.requestId, 'NOT_READY', 'Сначала войдите в мир.');
    const life = this.world.life; const store = this.lifeStore;
    if (!life || !store) return handFailure(request.requestId, 'NOT_READY', 'Сцена недоступна.');
    const player = this.world.locate(seat.identity.playerId)!;
    try {
      const { result, apples, changed } = store.execute(player.id, player.mapId, request, state => life.decideHand(player, request, state, this.world.placedPlayers(), this.world.isGrounded(player.id)));
      life.setApples(apples, changed);
      return result;
    } catch (error) {
      this.log.error('Не удалось сохранить переносимый предмет', { error: error instanceof Error ? error.message : String(error) });
      return handFailure(request.requestId, 'UNAVAILABLE', 'Не удалось сохранить действие. Повторите с тем же requestId.');
    }
  }

  input(channel: Channel, sequence: number, direction: Direction, preparedChunks: readonly string[], sprint = false, jumpId = 0): void {
    const seat = this.joinedSeat(channel);
    if (seat) this.world.setIntent(seat.identity.playerId, sequence, direction, preparedChunks, this.clock.now(), sprint, jumpId);
  }

  resync(channel: Channel): ServerMessage | null {
    const seat = this.joinedSeat(channel);
    if (!seat?.stream) return null;
    const entities = this.world.aoi(seat.identity.playerId);
    seat.stream.reset(entities);
    return { v: 3, type: 'snapshot', revision: seat.stream.revision, snapshot: { tick: this.world.tick, entities } };
  }

  interact(channel: Channel, targetId: string): InteractResult {
    const seat = this.joinedSeat(channel);
    if (!seat) return { ok: false, reason: 'not-joined' };
    return this.world.checkInteraction(seat.identity.playerId, targetId);
  }

  /** REALTIME-008: deliver to every joined player of the sender's map, the sender included. */
  chat(channel: Channel, requestId: string, text: string): boolean {
    const seat = this.joinedSeat(channel);
    if (!seat) return false;
    const mapId = this.world.locate(seat.identity.playerId)!.mapId;
    const message: ServerMessage = { v: 3, type: 'chat', requestId, messageId: `m${this.startedAt}_${++this.chatCounter}`, playerId: seat.identity.playerId, name: seat.identity.displayName, text };
    for (const other of this.seats.values()) {
      if (other.channel && other.stream && this.world.locate(other.identity.playerId)?.mapId === mapId) other.channel.send(message);
    }
    return true;
  }

  /** Who is asking, for services that act on behalf of a joined controlling connection. */
  identityOf(channel: Channel): PlayerIdentity | null { return this.joinedSeat(channel)?.identity ?? null; }

  locate(accountId: string): PlayerLocation | null {
    const seat = this.seats.get(accountId);
    const placed = seat && this.world.locate(seat.identity.playerId);
    return placed ? { mapId: placed.mapId, position: placed.position } : null;
  }

  /** One simulation step; every `broadcastEvery` steps the AOI deltas go out. */
  tick(deltaSeconds: number): void {
    this.world.step(deltaSeconds, this.clock.now());
    if (this.world.tick % this.settings.broadcastEvery !== 0) return;
    const scenes = new Map<string,SceneStateMessage>(); const now = this.clock.now();
    for (const seat of this.seats.values()) {
      if (!seat.channel || !seat.stream) continue;
      const channel = seat.channel;
      this.syncLife(channel, true, scenes, now);
      if (seat.channel !== channel || !seat.stream) continue;
      const delta = seat.stream.diff(this.world.aoi(seat.identity.playerId));
      if (delta) channel.send({ v: 3, type: 'delta', tick: this.world.tick, ...delta });
    }
  }

  /** STORE-003: periodic save of moved players; never called from inside a tick. */
  saveMoved(): void { this.persist(this.world.takeDirty()); }

  /** Shutdown: save everyone still in the world and close connections. */
  shutdown(reason: string): void {
    const placed: PlacedPlayer[] = [];
    for (const seat of this.seats.values()) { const p = this.world.locate(seat.identity.playerId); if (p) placed.push(p); }
    this.persist(placed);
    for (const seat of this.seats.values()) {
      if (seat.grace) this.scheduler.clearTimeout(seat.grace);
      const channel = seat.channel; seat.channel = null;
      channel?.close(reason);
    }
    this.seats.clear();
  }

  get activePlayers(): number { return this.seats.size; }

  private loadSaved(playerId: string): SavedPosition | null {
    try { return this.players.load(playerId); }
    catch (error) { this.log.error('Не удалось прочитать позицию игрока', { playerId, error: error instanceof Error ? error.message : String(error) }); return null; }
  }

  private persist(placed: readonly PlacedPlayer[]): void {
    if (placed.length === 0) return;
    try { this.players.save(placed.map((entry) => this.world.savedLocation(entry.id) ?? entry).map(({ id, mapId, position, rotationY }) => ({ id, mapId, position, rotationY }))); }
    catch (error) { this.log.error('Не удалось сохранить позиции игроков', { count: placed.length, error: error instanceof Error ? error.message : String(error) }); }
  }

  private seatOf(channel: Channel): Seat | undefined {
    for (const seat of this.seats.values()) if (seat.channel === channel) return seat;
    return undefined;
  }
  private joinedSeat(channel: Channel): Seat | undefined {
    const seat = this.seatOf(channel);
    return seat?.stream ? seat : undefined;
  }
}
