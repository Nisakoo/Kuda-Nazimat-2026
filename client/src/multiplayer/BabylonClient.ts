import type { BabylonAction, BabylonRequest, BabylonResult, BabylonState } from '../../../shared/babylon/types.ts';
import { parseBabylonRequest, parseBabylonResult } from '../../../shared/babylon/validate.ts';
import type { ServerSession } from '../../../shared/protocol/types.ts';
export interface BabylonView { state: BabylonState | null; busy: boolean; error: string | null; notice: string | null; suggestion: string | null; canRetry: boolean }
/** Transport and request lifecycle only; gameplay remains on the server. */
export class BabylonClient {
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly requests = new Set<AbortController>();
  private revision = 0;
  private retry: BabylonRequest | null = null;
  private view: BabylonView = { state: null, busy: false, error: null, notice: null, suggestion: null, canRetry: false };
  constructor(private readonly url: string, private readonly session: ServerSession, private readonly changed: (view: BabylonView) => void, private readonly unauthorized: () => void) {}
  async start(): Promise<void> { await this.poll(); }
  async send(action: BabylonAction, requestId?: string): Promise<boolean> {
    if (this.disposed || this.view.busy) return false;
    let packet: BabylonRequest;
    try { packet = parseBabylonRequest({ v: 2, requestId: requestId ?? crypto.randomUUID(), action }); }
    catch (error) { this.patch({ error: (error as Error).message }); return false; }
    this.revision++; this.patch({ busy: true, error: null, notice: null, suggestion: null, canRetry: false });
    try {
      const result = await this.request(packet);
      if (this.disposed) return false;
      this.retry = null; this.patch({ state: result.state, notice: result.notice ?? null, suggestion: result.suggestion ?? null, canRetry: false }); return true;
    } catch (error) {
      if (!this.disposed) { this.retry = packet; this.patch({ error: (error as Error).message, canRetry: true }); } return false;
    } finally { this.revision++; if (!this.disposed) this.patch({ busy: false }); }
  }
  async repeat(): Promise<boolean> { return this.retry ? this.send(this.retry.action, this.retry.requestId) : false; }
  private patch(update: Partial<BabylonView>): void { this.view = { ...this.view, ...update }; this.changed(this.view); }
  private async request(packet: BabylonRequest): Promise<BabylonResult> {
    const controller = new AbortController(); this.requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${this.url.replace(/\/$/, '')}/api/babylon`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.session.token}` }, body: JSON.stringify(packet), signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
      if (response.status === 401) { this.unauthorized(); throw new Error('Сессия истекла. Войдите снова.'); }
      // All collections have server-side caps; still bound received bytes before parsing.
      const reader = response.body?.getReader(); if (!reader) throw new Error('Пустой ответ сервера');
      const chunks: Uint8Array[] = []; let bytes = 0;
      for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 8 * 1024 * 1024) { await reader.cancel(); throw new Error('Слишком большой ответ сервера'); } chunks.push(next.value); }
      const buffer = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
      const raw = JSON.parse(new TextDecoder().decode(buffer)) as { error?: { message?: unknown } };
      if (!response.ok) throw new Error(typeof raw.error?.message === 'string' ? raw.error.message.slice(0, 500) : 'Операция не выполнена');
      const result = parseBabylonResult(raw);
      if (result.requestId !== packet.requestId) throw new Error('Ответ не соответствует запросу');
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Сервер не ответил вовремя. Повтор безопасен: предмет или сообщение не продублируются.');
      throw error;
    } finally { clearTimeout(timeout); this.requests.delete(controller); }
  }
  private async poll(): Promise<void> {
    if (this.disposed) return;
    const revision = this.revision;
    try {
      const result = await this.request({ v: 2, requestId: crypto.randomUUID(), action: { type: 'state' } });
      if (!this.disposed && revision === this.revision) this.patch({ state: result.state });
    } catch (error) { if (!this.disposed && !this.view.busy) this.patch({ error: (error as Error).message }); }
    finally { if (!this.disposed) this.timer = setTimeout(() => void this.poll(), 1000); }
  }
  dispose(): void { this.disposed = true; if (this.timer) clearTimeout(this.timer); for (const request of this.requests) request.abort(); this.requests.clear(); }
}
