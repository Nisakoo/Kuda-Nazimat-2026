import { requestId as createRequestId } from '../shared/requestId';
import type { BabylonAction, BabylonRequest, BabylonResult, BabylonState } from '../../../shared/babylon/types.ts';
import { parseBabylonRequest, parseBabylonResult } from '../../../shared/babylon/validate.ts';
import type { ServerSession } from '../../../shared/protocol/types.ts';
export interface BabylonView { state: BabylonState | null; busy: boolean; error: string | null; notice: string | null; suggestion: string | null; canRetry: boolean }
class RequestFailure extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}
/** Transport and request lifecycle only; gameplay remains on the server. */
export class BabylonClient {
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly requests = new Set<AbortController>();
  private revision = 0;
  private npcRequest: AbortController | null = null;
  private retry: BabylonRequest | null = null;
  private actionError: string | null = null;
  private view: BabylonView = { state: null, busy: false, error: null, notice: null, suggestion: null, canRetry: false };
  constructor(private readonly url: string, private readonly session: ServerSession, private readonly changed: (view: BabylonView) => void, private readonly unauthorized: () => void) {}
  async start(): Promise<void> { await this.poll(); }
  async send(action: BabylonAction, requestId?: string): Promise<boolean> {
    if (this.disposed || this.view.busy) return false;
    let packet: BabylonRequest;
    try { packet = parseBabylonRequest({ v: 2, requestId: requestId ?? createRequestId(), action }); }
    catch (error) { this.retry = null; this.actionError = (error as Error).message; this.patch({ error: this.actionError, canRetry: false }); return false; }
    this.actionError = null;
    const revision = ++this.revision; this.patch({ busy: true, error: null, notice: null, suggestion: null, canRetry: false });
    try {
      const result = await this.request(packet);
      if (this.disposed || revision !== this.revision) return false;
      this.retry = null; this.patch({ state: result.state, notice: result.notice ?? null, suggestion: result.suggestion ?? null, canRetry: false }); return true;
    } catch (error) {
      if (!this.disposed && revision === this.revision) {
        const retryable = !(error instanceof RequestFailure) || error.retryable;
        this.retry = retryable ? packet : null;
        this.actionError = (error as Error).message;
        this.patch({ error: this.actionError, canRetry: retryable });
      } return false;
    } finally { if (revision === this.revision) { this.revision++; if (!this.disposed) this.patch({ busy: false }); } }
  }
  cancelNpc(): void {
    if (!this.npcRequest) return;
    this.revision++;
    this.npcRequest.abort(); this.npcRequest = null;
    this.retry = null; this.actionError = null;
    this.patch({ busy: false, error: null, canRetry: false, notice: 'Ответ отменён.' });
  }
  async repeat(): Promise<boolean> { return this.retry ? this.send(this.retry.action, this.retry.requestId) : false; }
  clearError(): void {
    if (this.disposed || this.view.busy) return;
    this.actionError = null; this.retry = null;
    this.patch({ error: null, canRetry: false });
  }
  private patch(update: Partial<BabylonView>): void { this.view = { ...this.view, ...update }; this.changed(this.view); }
  private async request(packet: BabylonRequest): Promise<BabylonResult> {
    const controller = new AbortController(); this.requests.add(controller);
    if (packet.action.type === 'npc') this.npcRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${this.url.replace(/\/$/, '')}/api/babylon`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.session.token}` }, body: JSON.stringify(packet), signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
      controller.signal.throwIfAborted();
      if (response.status === 401) { this.unauthorized(); throw new RequestFailure('Сессия истекла. Войдите снова.', false); }
      // All collections have server-side caps; still bound received bytes before parsing.
      const reader = response.body?.getReader(); if (!reader) throw new Error('Пустой ответ сервера');
      const chunks: Uint8Array[] = []; let bytes = 0;
      for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 8 * 1024 * 1024) { await reader.cancel(); throw new Error('Слишком большой ответ сервера'); } chunks.push(next.value); }
      const buffer = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
      const raw = JSON.parse(new TextDecoder().decode(buffer)) as { error?: { message?: unknown } };
      if (!response.ok) throw new RequestFailure(typeof raw.error?.message === 'string' ? raw.error.message.slice(0, 500) : 'Операция не выполнена', response.status >= 500 || response.status === 408 || response.status === 429);
      const result = parseBabylonResult(raw);
      if (result.requestId !== packet.requestId) throw new Error('Ответ не соответствует запросу');
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Сервер не ответил вовремя. Повтор безопасен: предмет или сообщение не продублируются.');
      if (error instanceof TypeError) throw new Error('Сервер недоступен. Проверьте подключение и повторите попытку.');
      throw error;
    } finally { clearTimeout(timeout); this.requests.delete(controller); if (this.npcRequest === controller) this.npcRequest = null; }
  }
  private async poll(): Promise<void> {
    if (this.disposed) return;
    const revision = this.revision;
    try {
      const result = await this.request({ v: 2, requestId: createRequestId(), action: { type: 'state' } });
      if (!this.disposed && revision === this.revision) this.patch({ state: result.state, ...(!this.actionError ? { error: null } : {}) });
    } catch (error) { if (!this.disposed && revision === this.revision && !this.view.busy && !this.actionError) this.patch({ error: (error as Error).message }); }
    finally { if (!this.disposed) this.timer = setTimeout(() => void this.poll(), 1000); }
  }
  dispose(): void { this.disposed = true; if (this.timer) clearTimeout(this.timer); for (const request of this.requests) request.abort(); this.requests.clear(); }
}
