import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { AccessContext, Clock, NetworkAdapter } from './NetworkAdapter';
import type { ClientMessage, NetworkState, ServerMessage, ServerSession } from '../../../shared/protocol/types.ts';
import { parseClientMessage, parseServerMessage, parseServerSession, ProtocolError } from '../../../shared/protocol/validate.ts';

export type SocketFactory = (url: string, options: Parameters<typeof io>[1]) => Socket;

export class SocketIOAdapter implements NetworkAdapter {
  private socket: Socket | null = null;
  private session: ServerSession | null = null;
  private disposed = false;
  private retry: number | null = null;
  private expiry: number | null = null;
  private attempts = 0;
  private readonly messages = new Set<(message: ServerMessage) => void>();
  private readonly states = new Set<(state: NetworkState) => void>();
  private value: NetworkState = { status: 'unauthorized', error: null };
  constructor(private readonly url: string, private readonly clock: Clock, private readonly factory: SocketFactory = io) {}
  get state(): NetworkState { return this.value; }

  connect(context?: AccessContext): void {
    if (this.disposed) return;
    this.close();
    if (context?.kind !== 'server') { this.set('unauthorized', 'Для подключения нужна серверная сессия.'); return; }
    try { this.session = parseServerSession(context.session, this.clock.now()); }
    catch { this.set('unauthorized', 'Серверная сессия отсутствует или истекла.'); return; }
    this.attempts = 0;
    let address: URL;
    try { address = new URL(this.url); } catch { this.set('error', 'Некорректный адрес сервера.'); this.session = null; return; }
    if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password || address.search || address.hash) { this.set('error', 'Некорректный адрес сервера.'); this.session = null; return; }
    this.socket = this.factory(`${address.origin}/game`, {
      path: `${address.pathname.replace(/\/$/, '')}/socket.io`, autoConnect: false, reconnection: false,
      timeout: 5000, forceNew: true, multiplex: false, auth: { version: 3, token: this.session.token },
    });
    const socket = this.socket;
    socket.on('connect', () => { if (this.socket !== socket) return; this.cancelRetry(); this.attempts = 0; this.set('connected'); });
    socket.on('disconnect', () => { socket.sendBuffer.length = 0; if (this.socket === socket) this.scheduleRetry(); });
    socket.on('connect_error', (error: Error & { data?: { code?: string } }) => {
      if (this.socket !== socket) return;
      if (error.data?.code === 'UNAUTHORIZED') this.unauthorized();
      else if (error.data?.code === 'VERSION') this.fatal('Несовместимая версия игрового протокола.');
      else this.scheduleRetry();
    });
    socket.on('game', (raw: unknown) => {
      if (this.socket !== socket) return;
      try {
        const message = parseServerMessage(raw);
        for (const listener of this.messages) listener(message);
        if (message.type === 'error' && message.code === 'UNAUTHORIZED') this.unauthorized(message.message);
        else if (message.type === 'error' && message.code === 'VERSION') this.fatal(message.message);
      } catch (error) { this.fatal(error instanceof ProtocolError ? error.message : 'Ошибка игрового протокола.'); }
    });
    this.scheduleExpiry();
    this.set('connecting'); socket.connect();
  }
  private scheduleRetry(): void {
    if (!this.session || this.disposed || this.retry !== null) return;
    if (this.clock.now() >= this.session.expiresAt) { this.unauthorized(); return; }
    if (this.attempts >= 3) { this.set('error', 'Сервер недоступен. Повторите подключение в меню.'); return; }
    this.set('lost', 'Связь потеряна. Ожидаем повторного подключения.');
    const delay = 1000 * 2 ** this.attempts++;
    this.retry = this.clock.set(() => { this.retry = null; if (this.session && !this.disposed) { this.set('connecting'); this.socket?.connect(); } }, delay);
  }
  private scheduleExpiry(): void {
    if (!this.session) return;
    this.expiry = this.clock.set(() => {
      this.expiry = null;
      if (this.session && this.clock.now() < this.session.expiresAt) this.scheduleExpiry(); else this.unauthorized();
    }, Math.min(2_147_000_000, this.session.expiresAt - this.clock.now()));
  }
  private unauthorized(message = 'Серверная сессия истекла или отклонена. Войдите снова.'): void { this.close(); this.set('unauthorized', message); }
  private fatal(error: string): void { this.close(); this.set('error', error); }
  private cancelRetry(): void { if (this.retry !== null) this.clock.clear(this.retry); this.retry = null; }
  private close(): void {
    this.cancelRetry();
    if (this.expiry !== null) this.clock.clear(this.expiry); this.expiry = null;
    this.session = null;
    const socket = this.socket; this.socket = null;
    if (socket) socket.sendBuffer.length = 0;
    socket?.removeAllListeners(); socket?.disconnect();
  }
  send(message: ClientMessage): boolean {
    if (this.disposed || this.value.status !== 'connected' || !this.session) return false;
    if (this.clock.now() >= this.session.expiresAt) { this.unauthorized(); return false; }
    if (!this.socket?.connected) return false;
    const packet = parseClientMessage(message);
    // Movement can be dropped, but join/chat/NPC must survive a polling → WebSocket upgrade.
    if (packet.type === 'input') this.socket.volatile.emit('game', packet);
    else this.socket.emit('game', packet);
    // Socket.IO may detect a ping timeout during emit: never retain that offline backlog.
    if (this.socket.sendBuffer.length) { this.socket.sendBuffer.length = 0; return false; }
    return true;
  }
  disconnect(): void { this.close(); if (!this.disposed) this.set('disconnected'); }
  subscribe(listener: (message: ServerMessage) => void): () => void { if (this.disposed) return () => {}; this.messages.add(listener); return () => { this.messages.delete(listener); }; }
  subscribeState(listener: (state: NetworkState) => void): () => void { if (this.disposed) return () => {}; this.states.add(listener); listener(this.value); return () => { this.states.delete(listener); }; }
  private set(status: NetworkState['status'], error: string | null = null): void { this.value = Object.freeze({ status, error }); for (const listener of this.states) listener(this.value); }
  dispose(): void { if (this.disposed) return; this.disconnect(); this.disposed = true; this.messages.clear(); this.states.clear(); }
}
