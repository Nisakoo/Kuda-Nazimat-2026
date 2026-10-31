import type { AccessContext, Clock, NetworkAdapter } from './NetworkAdapter';
import type { ClientMessage, NetworkState, ServerMessage } from '../shared/protocol/types';
import { parseClientMessage, parseServerMessage } from '../shared/protocol/validate';

/** Controlled test transport. No Socket.IO or real authentication is used here. */
export class MockNetworkAdapter implements NetworkAdapter {
  private value: NetworkState = { status: 'unauthorized', error: null };
  private readonly messages = new Set<(message: ServerMessage) => void>();
  private readonly states = new Set<(state: NetworkState) => void>();
  private readonly timers = new Set<number>();
  private disposed = false;
  constructor(private readonly clock: Clock, private readonly onSend: (message: ClientMessage, transport: MockNetworkAdapter) => void = () => {}) {}
  get state(): NetworkState { return this.value; }
  connect(context?: AccessContext): void {
    if (this.disposed) return;
    this.clear();
    if (context?.kind !== 'mock') { this.set('unauthorized', 'Для тестового транспорта нужен явный тестовый контекст.'); return; }
    this.set('connecting'); this.later(() => this.set('connected'), 0);
  }
  send(message: ClientMessage): boolean {
    if (this.disposed || this.value.status !== 'connected') return false;
    const parsed = parseClientMessage(message);
    this.later(() => { try { this.onSend(parsed, this); } catch { this.fail('Ошибка тестового обмена.'); } }, 40); return true;
  }
  receive(raw: unknown, delay = 0): void {
    if (this.disposed || this.value.status !== 'connected') return;
    let message: ServerMessage;
    try { message = parseServerMessage(raw); } catch { this.fail('Некорректное тестовое сообщение протокола.'); return; }
    this.later(() => { for (const listener of this.messages) listener(message); }, delay);
  }
  drop(error = 'Тестовый разрыв связи.'): void { if (this.disposed) return; this.clear(); this.set('lost', error); }
  fail(error = 'Тестовая ошибка соединения.'): void { if (this.disposed) return; this.clear(); this.set('error', error); }
  disconnect(): void { this.clear(); if (!this.disposed) this.set('disconnected'); }
  private clear(): void { for (const timer of this.timers) this.clock.clear(timer); this.timers.clear(); }
  private later(callback: () => void, delay: number): void {
    if (this.timers.size >= 256) { this.fail('Переполнен буфер тестовой доставки.'); return; }
    const timer = this.clock.set(() => { this.timers.delete(timer); if (!this.disposed) callback(); }, delay); this.timers.add(timer);
  }
  subscribe(listener: (message: ServerMessage) => void): () => void { if (this.disposed) return () => {}; this.messages.add(listener); return () => { this.messages.delete(listener); }; }
  subscribeState(listener: (state: NetworkState) => void): () => void { if (this.disposed) return () => {}; this.states.add(listener); listener(this.value); return () => { this.states.delete(listener); }; }
  private set(status: NetworkState['status'], error: string | null = null): void { this.value = Object.freeze({ status, error }); for (const listener of this.states) listener(this.value); }
  dispose(): void { if (this.disposed) return; this.disconnect(); this.disposed = true; this.messages.clear(); this.states.clear(); }
}
