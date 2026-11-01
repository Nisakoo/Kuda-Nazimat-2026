import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import { SERVER_REQUEST_ID } from '../../../shared/protocol/types.ts';
import type { ClientMessage, ErrorCode, ServerMessage } from '../../../shared/protocol/types.ts';
import { ProtocolError, parseClientMessage, parseServerMessage, peekRequestId } from '../../../shared/protocol/validate.ts';
import type { Logger } from '../common/logger.ts';
import { MetricsRegistry, type Counter, type Metrics } from '../common/metrics.ts';
import type { Clock, Scheduler, TimerHandle } from '../common/time.ts';
import type { NpcAnswer, NpcQuestions, PlayerIdentity, SessionVerifier } from '../contracts.ts';
import type { GameService } from '../game/GameService.ts';
import type { Channel } from '../game/ports.ts';
import { hashToken } from '../auth/AuthService.ts';
import { TokenBucket } from '../common/TokenBucket.ts';
import type { WorldLifeServerMessage } from '../../../shared/world-life/types.ts';
import { handFailure, parseWorldLifeClientMessage, parseWorldLifeServerMessage, WorldLifeError } from '../../../shared/world-life/validate.ts';
import { PartialThrottle } from './PartialThrottle.ts';

export interface GatewayDeps {
  readonly babylon?: { enrolled(playerId: string): boolean };
  readonly game: GameService;
  readonly sessions: SessionVerifier;
  readonly npc: NpcQuestions;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
  readonly metrics?: Metrics;
  readonly corsOrigins: readonly string[];
  /** Engine.IO heartbeat; also the RTT sample period (OBS-010). Default 25 s as in Socket.IO. */
  readonly pingIntervalMs?: number;
  /** OBS-005: every outgoing packet passes parseServerMessage (development). */
  readonly validateOutgoing?: boolean;
}

interface GatewayMetrics { readonly packetsIn: Counter; readonly packetsOut: Counter; readonly invalid: Counter; readonly limited: Counter; readonly handshakes: Counter }

const PACKET_LIMIT = 262144 + 4096;
const CONTROL = /[\x00-\x09\x0b-\x1f\x7f]/;
const INVALID_LIMIT = 10;
const INVALID_WINDOW_MS = 10_000;
const MAX_TIMER_MS = 2_147_000_000;
const MAX_CONTROL_IDS = 4096;
const MAX_OUTBOUND_PACKETS = 32;
const MAX_OUTBOUND_BYTES = 1024 * 1024;
/** PROTO-007: npc-partial at most 10 times per second per question. */
const PARTIAL_INTERVAL_MS = 100;

class HandshakeError extends Error {
  readonly data: { code: ErrorCode; message: string };
  constructor(code: ErrorCode, message: string) { super(message); this.data = { code, message }; }
}

/** REALTIME-001…009: Socket.IO namespace /game speaking PROTO v3. Thin: parse → service → serialize. */
export function attachGateway(server: HttpServer, deps: GatewayDeps): { close(): Promise<void> } {
  const io = new Server(server, {
    path: '/socket.io',
    serveClient: false,
    maxHttpBufferSize: PACKET_LIMIT,
    ...(deps.pingIntervalMs ? { pingInterval: deps.pingIntervalMs } : {}),
    ...(deps.corsOrigins.length ? { cors: { origin: [...deps.corsOrigins] } } : {}),
  });
  const log = deps.logger.child('realtime');
  const registry = deps.metrics ?? new MetricsRegistry();
  const metrics: GatewayMetrics = {
    packetsIn: registry.counter('realtime_packets_in_total', 'Игровые пакеты клиента по типу'),
    packetsOut: registry.counter('realtime_packets_out_total', 'Игровые пакеты сервера по типу'),
    invalid: registry.counter('realtime_invalid_packets_total', 'Отклонённые пакеты клиента'),
    limited: registry.counter('realtime_rate_limited_total', 'Пакеты, отброшенные лимитами, по типу'),
    handshakes: registry.counter('realtime_handshakes_total', 'Handshake по результату'),
  };
  const nsp = io.of('/game');
  registry.gauge('realtime_connections', 'Открытые соединения /game', () => nsp.sockets.size);

  nsp.use((socket, next) => {
    const reject = (code: ErrorCode, message: string, reason: string) => {
      metrics.handshakes.inc({ result: code });
      log.info('realtime.handshake.rejected', 'Подключение отклонено', { code, reason, ip: socket.handshake.address });
      next(new HandshakeError(code, message));
    };
    const auth = socket.handshake.auth as { version?: unknown; token?: unknown } | undefined;
    if (auth?.version !== 3) { reject('VERSION', 'Несовместимая версия игрового протокола.', `version ${String(auth?.version)}`); return; }
    if (typeof auth.token !== 'string' || auth.token.length > 512) { reject('UNAUTHORIZED', 'Нужна серверная сессия.', 'no token'); return; }
    deps.sessions.verify(auth.token).then((check) => {
      if (!check.ok) { reject('UNAUTHORIZED', 'Сессия отсутствует или истекла.', 'session'); return; }
      if (!deps.game.canAdmit(check.identity.accountId)) { reject('UNAVAILABLE', 'Сервер заполнен: в мире уже 4 игрока.', 'full'); return; }
      metrics.handshakes.inc({ result: 'ok' });
      socket.data.sessionKey = hashToken(auth.token as string);
      socket.data.identity = check.identity;
      socket.data.expiresAt = check.expiresAt;
      socket.data.sessionId = check.sessionId;
      next();
    }, (error: unknown) => { log.error('realtime.handshake.failed', 'Проверка сессии упала', { error }); reject('UNAVAILABLE', 'Сервер временно недоступен.', 'verify failed'); });
  });

  nsp.on('connection', socket => { void new Connection(socket, deps, log, metrics).start(); });

  return { close: () => new Promise<void>((resolve) => { void io.close(() => resolve()); }) };
}

class Connection implements Channel {
  readonly id: string;
  readonly sessionKey: string;
  private readonly socket: Socket;
  private readonly deps: GatewayDeps;
  private readonly log: Logger;
  private readonly identity: PlayerIdentity;
  private readonly expiresAt: number;
  /** Device address for operational logs (OFFLINE-016). */
  private readonly ip: string;
  private readonly usedRequestIds = new Set<string>();
  private readonly inputBucket: TokenBucket;
  private readonly chatBucket: TokenBucket;
  private readonly lifeBucket: TokenBucket;
  private readonly controlBucket: TokenBucket;
  private outboundPackets = 0;
  private outboundBytes = 0;
  /** Streamed questions still waiting for their terminal message. */
  private readonly streams = new Map<string, PartialThrottle>();
  private invalidTimes: number[] = [];
  private expiry: TimerHandle | null = null;
  private closed = false;
  private readonly metrics: GatewayMetrics;
  /** Heartbeat RTT samples of the last minute (OBS-010). */
  private rtt: { at: number; ms: number }[] = [];
  private pingAt = 0;
  private droppedInputs = 0;
  private invalidPackets = 0;

  constructor(socket: Socket, deps: GatewayDeps, log: Logger, metrics: GatewayMetrics) {
    this.socket = socket; this.deps = deps; this.metrics = metrics;
    this.id = socket.id; this.sessionKey = socket.data.sessionKey as string;
    this.identity = socket.data.identity as PlayerIdentity;
    this.expiresAt = socket.data.expiresAt as number;
    this.ip = socket.handshake.address;
    this.log = log.child('realtime', { playerId: this.identity.playerId, connectionId: this.id });
    this.inputBucket = new TokenBucket(deps.clock, 30, 30);
    this.chatBucket = new TokenBucket(deps.clock, 1, 3);
    this.lifeBucket = new TokenBucket(deps.clock, 5, 5);
    this.controlBucket = new TokenBucket(deps.clock, 5, 10);
  }

  async start(): Promise<void> {
    this.log.info('realtime.connect', 'Соединение открыто', { ip: this.ip, sessionId: this.socket.data.sessionId as string | undefined });
    // RTT without client code: time from the server's Engine.IO ping to the client's pong.
    this.socket.conn.on('packetCreate', (packet: { type: string }) => { if (packet.type === 'ping') this.pingAt = performance.now(); });
    this.socket.conn.on('packet', (packet: { type: string }) => {
      if (packet.type !== 'pong' || !this.pingAt) return;
      const now = this.deps.clock.now();
      this.rtt = [...this.rtt.filter((sample) => now - sample.at < 60_000), { at: now, ms: performance.now() - this.pingAt }];
      this.pingAt = 0;
    });
    this.socket.on('disconnect', reason => this.onDisconnect(reason));
    try {
      const check = await this.deps.sessions.verify((this.socket.handshake.auth as { token: string }).token);
      if (this.closed) return;
      if (!check.ok) { this.close('Сессия отозвана или истекла.'); return; }
      if (!this.deps.game.attach(this.identity, this)) { this.fail('UNAVAILABLE', 'Сервер заполнен: в мире уже 4 игрока.'); return; }
      this.scheduleExpiry();
      this.socket.on('game', (raw: unknown) => this.receive(raw));
      this.socket.on('world-life', (raw: unknown) => this.receiveLife(raw));
      this.socket.conn.on('drain', () => { this.outboundPackets = 0; this.outboundBytes = 0; });
    } catch { this.fail('UNAVAILABLE', 'Сервер временно недоступен.'); }

  }

  send(message: ServerMessage): void { if (this.outgoing(message)) this.sendPacket('game', message, false); }

  sendLife(message: WorldLifeServerMessage, volatile = false): void {
    if (this.closed) return;
    if (this.deps.validateOutgoing) {
      try { parseWorldLifeServerMessage(message); }
      catch { this.log.error('invariant.violated', 'Исходящий пакет не проходит общий контракт', { invariant: 'outgoing.valid', type: message.type }); return; }
    }
    this.metrics.packetsOut.inc({ type: message.type });
    this.sendPacket('world-life', message, volatile);
  }

  private sendPacket(event: 'game' | 'world-life', message: ServerMessage | WorldLifeServerMessage, volatile: boolean): void {
    if (this.closed) return;
    if (volatile) { this.socket.volatile.emit(event, message); return; }
    const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8');
    if (this.outboundPackets >= MAX_OUTBOUND_PACKETS || this.outboundBytes + bytes > MAX_OUTBOUND_BYTES) {
      this.log.warn('realtime.slow_consumer', 'Закрыто медленное соединение', { packets: this.outboundPackets, bytes: this.outboundBytes });
      this.closed = true;
      this.socket.conn.close(true);
      return;
    }
    this.outboundPackets++; this.outboundBytes += bytes;
    this.socket.emit(event, message);
  }

  /** Droppable packets (npc-partial) must not pile up in Socket.IO's offline buffer. */
  private sendVolatile(message: ServerMessage): void { if (this.outgoing(message)) this.socket.volatile.emit('game', message); }

  private outgoing(message: ServerMessage): boolean {
    if (this.closed) return false;
    if (this.deps.validateOutgoing) {
      try { parseServerMessage(message); }
      catch { this.log.error('invariant.violated', 'Исходящий пакет не проходит общий контракт', { invariant: 'outgoing.valid', type: message.type }); return false; }
    }
    this.metrics.packetsOut.inc({ type: message.type });
    return true;
  }

  rttMs(): number | null {
    if (!this.rtt.length) return null;
    const sorted = this.rtt.map((sample) => sample.ms).sort((a, b) => a - b);
    return Math.round(sorted[Math.floor(sorted.length / 2)]!);
  }

  close(reason: string): void {
    if (!this.closed) this.log.info('realtime.closed_by_server', 'Соединение закрыто сервером', { ip: this.ip, reason });
    this.fail('UNAUTHORIZED', reason);
  }

  private receiveLife(raw: unknown): void {
    if (this.deps.clock.now() >= this.expiresAt) { this.close('Сессия истекла.'); return; }
    if (this.closed || !this.deps.game.isControlling(this)) return;
    const candidate = raw && typeof raw === 'object' ? (raw as { requestId?: unknown }).requestId : undefined;
    const requestId = typeof candidate === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(candidate) ? candidate : 'server';
    if (!this.lifeBucket.take()) { this.sendLife(handFailure(requestId, 'RATE_LIMIT', 'Слишком часто.')); return; }
    let request;
    try { request = parseWorldLifeClientMessage(raw); }
    catch (error) {
      this.sendLife(handFailure(requestId, error instanceof WorldLifeError ? error.code : 'INVALID', 'Некорректный запрос живого мира.'));
      this.countInvalid(); return;
    }
    if (!this.deps.game.identityOf(this)) { this.sendLife(handFailure(request.requestId, 'NOT_READY', 'Сначала войдите в мир.')); return; }
    if (request.type === 'hand') this.sendLife(this.deps.game.hand(this, request));
    this.deps.game.syncLife(this);
  }

  private fail(code: ErrorCode, message: string): void {
    if (this.closed) return;
    this.send({ v: 3, type: 'error', requestId: SERVER_REQUEST_ID, code, message });
    this.closed = true;
    this.socket.disconnect(true);
  }

  private scheduleExpiry(): void {
    const remaining = this.expiresAt - this.deps.clock.now();
    if (remaining <= 0) { this.close('Сессия истекла.'); return; }
    this.expiry = this.deps.scheduler.setTimeout(() => this.scheduleExpiry(), Math.min(remaining, MAX_TIMER_MS));
  }

  private onDisconnect(reason: string): void {
    this.log.info('realtime.disconnect', 'Игрок отключился', { ip: this.ip, reason, droppedInputs: this.droppedInputs, invalidPackets: this.invalidPackets, rttMs: this.rttMs() });
    this.closed = true;
    if (this.expiry) this.deps.scheduler.clearTimeout(this.expiry);
    for (const stream of this.streams.values()) stream.stop();
    this.streams.clear();
    this.deps.npc.cancelConnection(this.id);
    this.deps.game.detach(this);
  }

  private error(requestId: string, code: ErrorCode, message: string): void {
    this.send({ v: 3, type: 'error', requestId, code, message });
  }

  private receive(raw: unknown): void {
    if (this.closed || !this.deps.game.isControlling(this)) return;
    let message: ClientMessage;
    try { message = parseClientMessage(raw); }
    catch (error) {
      const requestId = peekRequestId(raw) ?? SERVER_REQUEST_ID;
      const type = raw && typeof raw === 'object' && typeof (raw as { type?: unknown }).type === 'string' ? String((raw as { type: string }).type).slice(0, 32) : 'unknown';
      this.invalidPackets++;
      this.metrics.invalid.inc({ reason: error instanceof ProtocolError ? error.code : 'crash' });
      this.log.debug('realtime.packet.invalid', 'Пакет клиента отклонён', { type, requestId, code: error instanceof ProtocolError ? error.code : 'crash' });
      if (error instanceof ProtocolError && error.code === 'VERSION') { this.error(requestId, 'VERSION', error.message); this.closed = true; this.socket.disconnect(true); return; }
      this.error(requestId, 'INVALID', 'Некорректное сообщение игрового протокола.');
      this.countInvalid();
      return;
    }
    this.metrics.packetsIn.inc({ type: message.type });
    // MOVE deduplicates by authoritative sequence without retaining every packet ID.
    if (message.type === 'input') { this.dispatch(message); return; }
    if (!this.controlBucket.take()) { this.metrics.limited.inc({ type: message.type }); this.error(message.requestId, 'RATE_LIMIT', 'Слишком часто.'); return; }
    if (this.usedRequestIds.size >= MAX_CONTROL_IDS) { this.fail('UNAVAILABLE', 'Достигнут лимит команд соединения. Подключитесь снова.'); return; }
    if (this.usedRequestIds.has(message.requestId)) { this.log.debug('realtime.packet.invalid', 'Повтор requestId', { type: message.type, requestId: message.requestId, code: 'DUPLICATE' }); this.error(message.requestId, 'INVALID', 'Повтор requestId.'); return; }
    this.usedRequestIds.add(message.requestId);
    this.dispatch(message);
  }

  private countInvalid(): void {
    const now = this.deps.clock.now();
    this.invalidTimes = this.invalidTimes.filter((time) => now - time < INVALID_WINDOW_MS);
    this.invalidTimes.push(now);
    if (this.invalidTimes.length > INVALID_LIMIT) { this.log.warn('realtime.packet.flood', 'Слишком много неверных пакетов, соединение закрыто', { ip: this.ip, invalid: this.invalidTimes.length }); this.closed = true; this.socket.disconnect(true); }
  }

  private dispatch(message: ClientMessage): void {
    const game = this.deps.game;
    if (message.type === 'join') {
      try {
        if (this.deps.sessions.state?.(this.identity).requiresAvatar) { this.error(message.requestId, 'FORBIDDEN', 'Сначала подтвердите облик персонажа.'); return; }
      } catch { this.error(message.requestId, 'UNAVAILABLE', 'Не удалось проверить облик. Повторите позже.'); return; }
      const result = game.join(this, message.mapId);
      if (result.ok) { this.log.info('realtime.join', 'Вход в мир', { mapId: message.mapId, ip: this.ip, requestId: message.requestId }); this.send(result.message(message.requestId)); game.syncLife(this); }
      else if (result.reason === 'unknown-map') this.error(message.requestId, 'INVALID', 'Неизвестная карта.');
      else if (result.reason === 'already-joined') this.error(message.requestId, 'INVALID', 'Вход в мир уже выполнен.');
      return;
    }
    if (!game.identityOf(this)) { this.error(message.requestId, 'NOT_READY', 'Сначала войдите в мир.'); return; }
    if ((message.type === 'chat-send' || message.type === 'npc-question') && this.deps.babylon?.enrolled(this.identity.playerId) && this.deps.game.locate(this.identity.accountId)?.mapId === 'market') { this.error(message.requestId, 'FORBIDDEN', 'Используйте общение BABEL с выбранным языком.'); return; }
    switch (message.type) {
      case 'input':
        if (this.inputBucket.take()) game.input(this, message.sequence, message.direction, message.preparedChunks, message.sprint, message.jumpId);
        else { this.droppedInputs++; this.metrics.limited.inc({ type: 'input' }); }
        return;
      case 'resync': {
        const snapshot = game.resync(this);
        if (snapshot) this.send(snapshot);
        game.syncLife(this);
        return;
      }
      case 'interact': {
        const result = game.interact(this, message.targetId);
        if (result.ok) this.send({ v: 3, type: 'interacted', requestId: message.requestId, targetId: message.targetId });
        else this.error(message.requestId, 'FORBIDDEN', result.reason === 'too-far' ? 'Слишком далеко.' : 'Объект недоступен.');
        return;
      }
      case 'chat-send': {
        const text = message.text.trim();
        if (CONTROL.test(text)) { this.error(message.requestId, 'INVALID', 'Сообщение содержит недопустимые символы.'); return; }
        if (!this.chatBucket.take()) { this.metrics.limited.inc({ type: 'chat' }); this.log.debug('realtime.rate_limited', 'Чат слишком часто', { requestId: message.requestId }); this.error(message.requestId, 'RATE_LIMIT', 'Слишком часто. Подождите немного.'); return; }
        game.chat(this, message.requestId, text);
        return;
      }
      case 'npc-question':
        this.ask(message.requestId, message.targetId, message.text.trim(), message.stream === true);
        return;
      case 'npc-cancel':
        this.endStream(message.questionId);
        this.deps.npc.cancel(this.id, message.questionId);
        this.send({ v: 3, type: 'npc-cancelled', requestId: message.requestId, questionId: message.questionId });
        return;
    }
  }

  /** NPC-001: target and distance are checked here; queueing and answering belong to NpcQuestions. */
  private ask(requestId: string, targetId: string, question: string, stream: boolean): void {
    const target = this.deps.game.interact(this, targetId);
    if (!target.ok) { this.error(requestId, 'FORBIDDEN', target.reason === 'too-far' ? 'Подойдите ближе.' : 'Собеседник недоступен.'); return; }
    const { id, name, topic, persona, greeting } = target.npc;
    let onPartial: ((text: string) => void) | undefined;
    if (stream) {
      const throttle = new PartialThrottle(this.deps.scheduler, PARTIAL_INTERVAL_MS, (seq, text) => this.sendVolatile({ v: 3, type: 'npc-partial', requestId, targetId, seq, text }));
      this.streams.set(requestId, throttle);
      onPartial = (text) => throttle.push(text);
    }
    this.deps.npc.ask({ connectionId: this.id, requestId, player: this.identity, npc: { id, name, topic, persona, greeting }, question }, onPartial)
      .then((answer) => this.deliver(requestId, targetId, answer), () => this.deliver(requestId, targetId, { ok: false, reason: 'unavailable' }));
  }

  private endStream(requestId: string): void { this.streams.get(requestId)?.stop(); this.streams.delete(requestId); }

  /** Terminal message of a question: a pending partial is dropped so it can never arrive after the answer. */
  private deliver(requestId: string, targetId: string, answer: NpcAnswer): void {
    this.endStream(requestId);
    if (this.closed || !this.deps.game.isControlling(this)) return;
    if (answer.ok) { this.send({ v: 3, type: 'npc-answer', requestId, targetId, text: answer.text }); return; }
    switch (answer.reason) {
      case 'cancelled': return;
      case 'player-busy': this.error(requestId, 'RATE_LIMIT', 'Дождитесь ответа на предыдущий вопрос.'); return;
      case 'server-busy': this.error(requestId, 'UNAVAILABLE', 'Собеседники заняты. Попробуйте чуть позже.'); return;
      case 'timeout': this.error(requestId, 'UNAVAILABLE', 'Собеседник не успел ответить.'); return;
      case 'unavailable': this.error(requestId, 'UNAVAILABLE', 'Собеседник сейчас недоступен.'); return;
    }
  }
}
