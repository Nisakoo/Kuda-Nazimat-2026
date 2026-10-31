import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import { SERVER_REQUEST_ID } from '../../../shared/protocol/types.ts';
import type { ClientMessage, ErrorCode, ServerMessage } from '../../../shared/protocol/types.ts';
import { ProtocolError, parseClientMessage, peekRequestId } from '../../../shared/protocol/validate.ts';
import type { Logger } from '../common/logger.ts';
import type { Clock, Scheduler, TimerHandle } from '../common/time.ts';
import type { NpcAnswer, NpcQuestions, PlayerIdentity, SessionVerifier } from '../contracts.ts';
import type { GameService } from '../game/GameService.ts';
import type { Channel } from '../game/ports.ts';
import { TokenBucket } from './TokenBucket.ts';

export interface GatewayDeps {
  readonly game: GameService;
  readonly sessions: SessionVerifier;
  readonly npc: NpcQuestions;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
  readonly corsOrigins: readonly string[];
}

const PACKET_LIMIT = 262144 + 4096;
const CONTROL = /[\x00-\x09\x0b-\x1f\x7f]/;
const INVALID_LIMIT = 10;
const INVALID_WINDOW_MS = 10_000;
const MAX_TIMER_MS = 2_147_000_000;

class HandshakeError extends Error {
  readonly data: { code: ErrorCode; message: string };
  constructor(code: ErrorCode, message: string) { super(message); this.data = { code, message }; }
}

/** REALTIME-001…009: Socket.IO namespace /game speaking PROTO v1. Thin: parse → service → serialize. */
export function attachGateway(server: HttpServer, deps: GatewayDeps): { close(): Promise<void> } {
  const io = new Server(server, {
    path: '/socket.io',
    serveClient: false,
    maxHttpBufferSize: PACKET_LIMIT,
    ...(deps.corsOrigins.length ? { cors: { origin: [...deps.corsOrigins] } } : {}),
  });
  const log = deps.logger.child('realtime');
  const nsp = io.of('/game');

  nsp.use((socket, next) => {
    const auth = socket.handshake.auth as { version?: unknown; token?: unknown } | undefined;
    if (auth?.version !== 1) { next(new HandshakeError('VERSION', 'Несовместимая версия игрового протокола.')); return; }
    if (typeof auth.token !== 'string' || auth.token.length > 512) { next(new HandshakeError('UNAUTHORIZED', 'Нужна серверная сессия.')); return; }
    deps.sessions.verify(auth.token).then((check) => {
      if (!check.ok) { next(new HandshakeError('UNAUTHORIZED', 'Сессия отсутствует или истекла.')); return; }
      if (!deps.game.canAdmit(check.identity.accountId)) { next(new HandshakeError('UNAVAILABLE', 'Сервер заполнен: в мире уже 4 игрока.')); return; }
      socket.data.identity = check.identity;
      socket.data.expiresAt = check.expiresAt;
      next();
    }, () => next(new HandshakeError('UNAVAILABLE', 'Сервер временно недоступен.')));
  });

  nsp.on('connection', (socket) => new Connection(socket, deps, log).start());

  return { close: () => new Promise<void>((resolve) => { void io.close(() => resolve()); }) };
}

class Connection implements Channel {
  readonly id: string;
  private readonly socket: Socket;
  private readonly deps: GatewayDeps;
  private readonly log: Logger;
  private readonly identity: PlayerIdentity;
  private readonly expiresAt: number;
  private readonly usedRequestIds = new Set<string>();
  private readonly inputBucket: TokenBucket;
  private readonly chatBucket: TokenBucket;
  private invalidTimes: number[] = [];
  private expiry: TimerHandle | null = null;
  private closed = false;

  constructor(socket: Socket, deps: GatewayDeps, log: Logger) {
    this.socket = socket; this.deps = deps; this.log = log;
    this.id = socket.id;
    this.identity = socket.data.identity as PlayerIdentity;
    this.expiresAt = socket.data.expiresAt as number;
    this.inputBucket = new TokenBucket(deps.clock, 30, 30);
    this.chatBucket = new TokenBucket(deps.clock, 1, 3);
  }

  start(): void {
    if (!this.deps.game.attach(this.identity, this)) { this.fail('UNAVAILABLE', 'Сервер заполнен: в мире уже 4 игрока.'); return; }
    this.scheduleExpiry();
    this.socket.on('game', (raw: unknown) => this.receive(raw));
    this.socket.on('disconnect', () => this.onDisconnect());
  }

  send(message: ServerMessage): void { if (!this.closed) this.socket.emit('game', message); }

  close(reason: string): void { this.fail('UNAUTHORIZED', reason); }

  private fail(code: ErrorCode, message: string): void {
    if (this.closed) return;
    this.send({ v: 1, type: 'error', requestId: SERVER_REQUEST_ID, code, message });
    this.closed = true;
    this.socket.disconnect(true);
  }

  private scheduleExpiry(): void {
    const remaining = this.expiresAt - this.deps.clock.now();
    if (remaining <= 0) { this.close('Сессия истекла.'); return; }
    this.expiry = this.deps.scheduler.setTimeout(() => this.scheduleExpiry(), Math.min(remaining, MAX_TIMER_MS));
  }

  private onDisconnect(): void {
    this.closed = true;
    if (this.expiry) this.deps.scheduler.clearTimeout(this.expiry);
    this.deps.npc.cancelConnection(this.id);
    this.deps.game.detach(this);
  }

  private error(requestId: string, code: ErrorCode, message: string): void {
    this.send({ v: 1, type: 'error', requestId, code, message });
  }

  private receive(raw: unknown): void {
    if (this.closed || !this.deps.game.isControlling(this)) return;
    let message: ClientMessage;
    try { message = parseClientMessage(raw); }
    catch (error) {
      const requestId = peekRequestId(raw) ?? SERVER_REQUEST_ID;
      if (error instanceof ProtocolError && error.code === 'VERSION') { this.error(requestId, 'VERSION', error.message); this.closed = true; this.socket.disconnect(true); return; }
      this.error(requestId, 'INVALID', 'Некорректное сообщение игрового протокола.');
      this.countInvalid();
      return;
    }
    if (this.usedRequestIds.has(message.requestId)) { this.error(message.requestId, 'INVALID', 'Повтор requestId.'); return; }
    this.usedRequestIds.add(message.requestId);
    this.dispatch(message);
  }

  private countInvalid(): void {
    const now = this.deps.clock.now();
    this.invalidTimes = this.invalidTimes.filter((time) => now - time < INVALID_WINDOW_MS);
    this.invalidTimes.push(now);
    if (this.invalidTimes.length > INVALID_LIMIT) { this.log.warn('Слишком много неверных пакетов', { playerId: this.identity.playerId }); this.closed = true; this.socket.disconnect(true); }
  }

  private dispatch(message: ClientMessage): void {
    const game = this.deps.game;
    if (message.type === 'join') {
      const result = game.join(this, message.mapId);
      if (result.ok) this.send(result.message(message.requestId));
      else if (result.reason === 'unknown-map') this.error(message.requestId, 'INVALID', 'Неизвестная карта.');
      else if (result.reason === 'already-joined') this.error(message.requestId, 'INVALID', 'Вход в мир уже выполнен.');
      return;
    }
    if (!game.identityOf(this)) { this.error(message.requestId, 'NOT_READY', 'Сначала войдите в мир.'); return; }
    switch (message.type) {
      case 'input':
        if (this.inputBucket.take()) game.input(this, message.sequence, message.direction, message.preparedChunks);
        return;
      case 'resync': {
        const snapshot = game.resync(this);
        if (snapshot) this.send(snapshot);
        return;
      }
      case 'interact': {
        const result = game.interact(this, message.targetId);
        if (result.ok) this.send({ v: 1, type: 'interacted', requestId: message.requestId, targetId: message.targetId });
        else this.error(message.requestId, 'FORBIDDEN', result.reason === 'too-far' ? 'Слишком далеко.' : 'Объект недоступен.');
        return;
      }
      case 'chat-send': {
        const text = message.text.trim();
        if (CONTROL.test(text)) { this.error(message.requestId, 'INVALID', 'Сообщение содержит недопустимые символы.'); return; }
        if (!this.chatBucket.take()) { this.error(message.requestId, 'RATE_LIMIT', 'Слишком часто. Подождите немного.'); return; }
        game.chat(this, message.requestId, text);
        return;
      }
      case 'npc-question':
        this.ask(message.requestId, message.targetId, message.text.trim());
        return;
    }
  }

  /** NPC-001: target and distance are checked here; queueing and answering belong to NpcQuestions. */
  private ask(requestId: string, targetId: string, question: string): void {
    const target = this.deps.game.interact(this, targetId);
    if (!target.ok) { this.error(requestId, 'FORBIDDEN', target.reason === 'too-far' ? 'Подойдите ближе.' : 'Собеседник недоступен.'); return; }
    const { id, name, topic, persona, greeting } = target.npc;
    this.deps.npc.ask({ connectionId: this.id, requestId, player: this.identity, npc: { id, name, topic, persona, greeting }, question })
      .then((answer) => this.deliver(requestId, targetId, answer), () => this.deliver(requestId, targetId, { ok: false, reason: 'unavailable' }));
  }

  private deliver(requestId: string, targetId: string, answer: NpcAnswer): void {
    if (this.closed || !this.deps.game.isControlling(this)) return;
    if (answer.ok) { this.send({ v: 1, type: 'npc-answer', requestId, targetId, text: answer.text }); return; }
    switch (answer.reason) {
      case 'cancelled': return;
      case 'player-busy': this.error(requestId, 'RATE_LIMIT', 'Дождитесь ответа на предыдущий вопрос.'); return;
      case 'server-busy': this.error(requestId, 'UNAVAILABLE', 'Собеседники заняты. Попробуйте чуть позже.'); return;
      case 'timeout': this.error(requestId, 'UNAVAILABLE', 'Собеседник не успел ответить.'); return;
      case 'unavailable': this.error(requestId, 'UNAVAILABLE', 'Собеседник сейчас недоступен.'); return;
    }
  }
}
