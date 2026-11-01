import { LIMITS, type ServerMessage } from '../../../shared/protocol/types.ts';
import type { Direction } from '../../../shared/world/types.ts';
import type { HandRequest, HandResultMessage, SceneStateMessage } from '../../../shared/world-life/types.ts';
import { handFailure } from '../../../shared/world-life/validate.ts';
import type { WorldLifeStore } from './worldLifePorts.ts';
import type { Clock, Scheduler, TimerHandle } from '../common/time.ts';
import type { Logger } from '../common/logger.ts';
import type { AvatarStore, EquipmentStore, PlayerPresence, PlayerIdentity, PlayerStore, SavedPosition, SceneReset, SceneView } from '../contracts.ts';
import type { ToolId } from '../../../shared/equipment/types.ts';
import type { AvatarId } from '../../../shared/avatar/types.ts';
import { MetricsRegistry, type Counter, type Histogram, type Metrics } from '../common/metrics.ts';
import type { PlayerLocation } from '../world/access.ts';
import type { NpcDefinition } from '../world/npcContent.ts';
import { AoiStream } from './AoiStream.ts';
import { chooseSpawn, isFree } from './spawn.ts';
import type { Channel } from './ports.ts';
import type { PlacedPlayer, World } from './World.ts';

export interface GameSettings { readonly maxPlayers: number; readonly disconnectGraceMs: number; readonly broadcastEvery: number; readonly initialSpawn?: (playerId: string) => { mapId: string; position: { x: number; y: number; z: number }; force?: boolean } | null; readonly didSpawn?: (playerId: string) => void }

interface Seat {
  readonly identity: PlayerIdentity;
  channel: Channel | null;
  stream: AoiStream | null;
  grace: TimerHandle | null;
  releaseAt: number | null;
  lifeRevision: number;
  lifeSentAt: number;
  readonly seatedAt: number;
  /** Attach times within the last 10 minutes, for the unstable-connection warning (OBS-010). */
  attaches: number[];
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
  private readonly avatars: AvatarStore | undefined;
  private readonly equipment: EquipmentStore | undefined;
  private readonly lifeStore?: WorldLifeStore;
  private readonly seatEvents: Counter;
  private readonly spawnFallbacks: Counter;
  private readonly deltaBytes: Histogram;
  private readonly packets: Counter;

  constructor(world: World, players: PlayerStore, clock: Clock, scheduler: Scheduler, settings: GameSettings, log: Logger, avatars?: AvatarStore, equipment?: EquipmentStore, metrics: Metrics = new MetricsRegistry(), lifeStore?: WorldLifeStore) {
    this.avatars = avatars; this.equipment = equipment;
    this.lifeStore = lifeStore;
    this.world = world; this.players = players; this.clock = clock; this.scheduler = scheduler; this.settings = settings; this.log = log;
    this.startedAt = clock.now().toString(36);
    this.seatEvents = metrics.counter('game_seat_events_total', 'События мест: attach, detach, release, takeover');
    this.spawnFallbacks = metrics.counter('game_spawn_fallback_total', 'Появления в базовой точке без свободного места');
    this.deltaBytes = metrics.histogram('game_delta_bytes', 'Оценка размера delta на соединение', [512, 2048, 8192, 32768, 65536, 131072, 196608, 262144]);
    this.packets = metrics.counter('game_packets_out_total', 'Игровые пакеты сервера по типу');
    metrics.gauge('game_players', 'Игроки по состоянию места', () => {
      const connected = [...this.seats.values()].filter((seat) => seat.channel).length;
      return [{ labels: { state: 'connected' }, value: connected }, { labels: { state: 'grace' }, value: this.seats.size - connected }];
    });
  }

  /** SERVER-006: an account that already has a seat may always reconnect; a new one needs a free slot. */
  canAdmit(accountId: string): boolean {
    return this.seats.has(accountId) || this.seats.size < this.settings.maxPlayers;
  }

  /** AUTH-005: the newest connection takes control; the previous one is closed. False when no slot is free. */
  attach(identity: PlayerIdentity, channel: Channel): boolean {
    if (!this.canAdmit(identity.accountId)) return false;
    const now = this.clock.now();
    let seat = this.seats.get(identity.accountId);
    if (!seat) { seat = { identity, channel: null, stream: null, grace: null, releaseAt: null, seatedAt: now, attaches: [], lifeRevision: -1, lifeSentAt: -Infinity }; this.seats.set(identity.accountId, seat); }
    seat.attaches = [...seat.attaches.filter((time) => now - time < 600_000), now];
    if (seat.grace) { this.scheduler.clearTimeout(seat.grace); seat.grace = null; seat.releaseAt = null; }
    const previous = seat.channel;
    seat.channel = channel;
    seat.stream = null;
    seat.lifeRevision = -1;
    seat.lifeSentAt = -Infinity;
    this.world.resetInput(identity.playerId);
    this.seatEvents.inc({ event: previous ? 'takeover' : 'attach' });
    this.log.info('game.seat.attach', previous ? 'Управление перехвачено новым соединением' : 'Игрок занял место', { playerId: identity.playerId, connectionId: channel.id, takeover: previous !== null, reconnects: seat.attaches.length - 1 });
    if (previous) previous.close(TAKEOVER_REASON);
    return true;
  }

  canAct(accountId: string, sessionKey: string): boolean { const seat = this.seats.get(accountId); return !!seat?.stream && seat.channel?.sessionKey === sessionKey; }

  controlId(accountId: string, sessionKey: string): string | null {
    const seat = this.seats.get(accountId);
    return seat?.stream && seat.channel?.sessionKey === sessionKey ? seat.channel.id : null;
  }

  isControlling(channel: Channel): boolean { return this.seatOf(channel) !== undefined; }

  /** REALTIME-006: keep the entity for the grace period, then save and free the seat. */
  detach(channel: Channel): void {
    const seat = this.seatOf(channel);
    if (!seat) return;
    seat.channel = null;
    seat.stream = null;
    this.world.resetInput(seat.identity.playerId);
    seat.releaseAt = this.clock.now() + this.settings.disconnectGraceMs;
    seat.grace = this.scheduler.setTimeout(() => this.release(seat), this.settings.disconnectGraceMs);
    this.seatEvents.inc({ event: 'detach' });
    this.log.info('game.seat.detach', 'Соединение потеряно, место удерживается', { playerId: seat.identity.playerId, connectionId: channel.id, graceMs: this.settings.disconnectGraceMs });
  }

  private release(seat: Seat): void {
    seat.grace = null; seat.releaseAt = null;
    if (seat.channel) return;
    const placed = this.world.locate(seat.identity.playerId);
    if (placed) this.persist([placed]);
    this.world.remove(seat.identity.playerId);
    this.seats.delete(seat.identity.accountId);
    this.seatEvents.inc({ event: 'release' });
    this.log.info('game.seat.release', 'Место освобождено', { playerId: seat.identity.playerId });
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
      // REALTIME-010: never stack players; a free saved position is kept with its rotation.
      const others = this.world.playerPositions(mapId);
      const placement = usable && isFree(saved.position, others) ? { position: saved.position, rotationY: saved.rotationY }
        : chooseSpawn(usable ? saved.position : spawn, (x, z) => this.world.isSafeSupport(mapId, { x, y: map.heightAt(x, z), z }), others);
      if ('fallback' in placement) { this.spawnFallbacks.inc(); this.log.warn('game.spawn.fallback', 'Нет свободной точки появления, использована базовая', { playerId, mapId }); }
      this.world.add({ id: playerId, name: displayName, mapId, position: placement.position, rotationY: placement.rotationY });
      this.log.debug('game.spawn', 'Точка появления выбрана', { playerId, mapId, position: placement.position, saved: usable });
      this.world.setAvatar(playerId, this.avatars?.load(playerId) ?? null);
      this.world.setEquipment(playerId, this.equipment?.load(playerId) ?? null);
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

  setAvatar(playerId: string, avatarId: AvatarId): void { this.world.setAvatar(playerId, avatarId); }
  setEquipment(playerId: string, tool: ToolId | null): void { this.world.setEquipment(playerId, tool); }
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
      this.log.error('world.hand.persist_failed', 'Не удалось сохранить переносимый предмет', { error: error instanceof Error ? error.message : String(error) });
      return handFailure(request.requestId, 'UNAVAILABLE', 'Не удалось сохранить действие. Повторите с тем же requestId.');
    }
  }

  /** ADMIN-SRV-005: the NPC is in the live set (enabled and not deleted). */
  hasNpc(npcId: string): boolean { return this.world.hasNpc(npcId); }

  sceneView(mapId: string): SceneView | null { return this.world.life?.view(mapId) ?? null; }

  /** ADMIN-SRV-008: pots and apples of the map back home; players get the next scene-state as usual. */
  resetScene(mapId: string): SceneReset | null {
    const life = this.world.life; const store = this.lifeStore;
    if (!life || !store?.resetApples) return null;
    const plan = life.resetPots(mapId, this.world.placedPlayers());
    if (!plan) return null;
    const apples = store.resetApples(mapId, plan.apples);
    life.setApples(apples, true);
    return { revision: life.currentRevision(), reset: { pots: plan.reset, apples: plan.apples.length }, skipped: { pots: plan.skipped, apples: plan.skippedApples } };
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

  playerLocation(playerId: string): PlayerLocation | null {
    const actor = this.world.locate(playerId);
    return actor ? { mapId: actor.mapId, position: { ...actor.position } } : null;
  }

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
      const entities = this.world.aoi(seat.identity.playerId);
      if (new Set(entities.map((entity) => entity.id)).size !== entities.length) this.log.error('invariant.violated', 'Повтор ID сущности в AOI', { invariant: 'aoi.unique-ids', playerId: seat.identity.playerId });
      const delta = seat.stream.diff(entities);
      if (!delta) continue;
      this.deltaBytes.observe(delta.bytes);
      const { bytes, ...body } = delta;
      if (bytes > LIMITS.packetBytes - 4096) {
        // OBS-003: an oversized delta would be rejected by the client; the revision gap makes it resync.
        this.log.error('game.packet.oversize', 'Delta больше лимита пакета, не отправлена', { playerId: seat.identity.playerId, bytes, entities: entities.length });
        continue;
      }
      if (bytes > LIMITS.packetBytes * 0.75) this.log.warn('game.delta.large', 'Delta близка к лимиту пакета', { playerId: seat.identity.playerId, bytes, entities: entities.length });
      this.packets.inc({ type: 'delta' });
      seat.channel.send({ v: 3, type: 'delta', tick: this.world.tick, ...body });
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

  presence(): PlayerPresence[] {
    const now = this.clock.now();
    return [...this.seats.values()].map((seat) => ({
      name: seat.identity.displayName, mapId: this.world.locate(seat.identity.playerId)?.mapId ?? null,
      connected: seat.channel !== null, releaseInMs: seat.releaseAt === null ? null : Math.max(0, seat.releaseAt - now),
      rttMs: seat.channel?.rttMs?.() ?? null, reconnects: Math.max(0, seat.attaches.filter((time) => now - time < 600_000).length - 1),
      seatedSeconds: Math.floor((now - seat.seatedAt) / 1000),
    }));
  }

  /** AUTH-012: every connection of a revoked session is closed with the reason; the seat follows the normal grace. */
  closeSessions(sessionKeys: ReadonlySet<string>, message: string): void {
    for (const seat of this.seats.values()) if (seat.channel?.sessionKey && sessionKeys.has(seat.channel.sessionKey)) seat.channel.close(message);
  }

  /** OBS-004 dump state: counts and IDs only. */
  state(): Record<string, unknown> {
    return { tick: this.world.tick, seats: [...this.seats.values()].map((seat) => ({ playerId: seat.identity.playerId, connected: seat.channel !== null, joined: seat.stream !== null, revision: seat.stream?.revision ?? null, releaseAt: seat.releaseAt })) };
  }

  private loadSaved(playerId: string): SavedPosition | null {
    try { return this.players.load(playerId); }
    catch (error) { this.log.error('db.transaction.failed', 'Не удалось прочитать позицию игрока', { operation: 'players.load', playerId, error }); return null; }
  }

  private persist(placed: readonly PlacedPlayer[]): void {
    if (placed.length === 0) return;
    try { this.players.save(placed.map((entry) => this.world.savedLocation(entry.id) ?? entry).map(({ id, mapId, position, rotationY }) => ({ id, mapId, position, rotationY }))); }
    catch (error) { this.log.error('db.transaction.failed', 'Не удалось сохранить позиции игроков', { operation: 'players.save', count: placed.length, error }); }
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
