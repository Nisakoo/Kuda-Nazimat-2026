import type { AvatarId, AvatarState } from '../../../shared/avatar/types';
import { parseAvatarState } from '../../../shared/avatar/validate';
import { readBoundedJson } from './readBoundedJson';
import type { ServerSession } from '../../../shared/protocol/types';

export interface AvatarView { readonly state: AvatarState | null; readonly busy: boolean; readonly error: string | null }
/** Authenticated appearance preference adapter. No local storage or optimistic success. */
export class AvatarClient {
  private request: AbortController | null = null;
  private disposed = false;
  private value: AvatarView = { state: null, busy: false, error: null };
  constructor(private readonly serverUrl: string, private readonly session: ServerSession, private readonly changed: (view: AvatarView) => void, private readonly unauthorized: () => void) {}
  load(): Promise<boolean> { return this.send(); }
  save(avatarId: AvatarId): Promise<boolean> { return this.send(avatarId); }
  private async send(avatarId?: AvatarId): Promise<boolean> {
    if (this.disposed || this.request) return false;
    const request = new AbortController(); this.request = request;
    const timer = setTimeout(() => request.abort(), 10000);
    this.patch({ busy: true, error: null });
    try {
      const response = await fetch(`${this.serverUrl.replace(/\/$/, '')}/api/avatar`, {
        method: avatarId ? 'POST' : 'GET', headers: { Authorization: `Bearer ${this.session.token}`, ...(avatarId ? { 'Content-Type': 'application/json' } : {}) },
        ...(avatarId ? { body: JSON.stringify({ avatarId }) } : {}), cache: 'no-store', redirect: 'error', credentials: 'omit', signal: request.signal,
      });
      if (this.disposed || this.request !== request) return false;
      if (response.status === 401) { this.unauthorized(); return false; }
      const raw = await readBoundedJson(response);
      if (!response.ok) {
        const message = (raw as { error?: { message?: unknown } })?.error?.message;
        throw new Error(typeof message === 'string' ? message.slice(0, 500) : 'Не удалось сохранить облик.');
      }
      const state = parseAvatarState(raw);
      if (this.disposed || this.request !== request) return false;
      this.patch({ state }); return true;
    } catch (error) {
      if (!this.disposed && this.request === request) this.patch({ error: request.signal.aborted ? 'Сервер не ответил за 10 секунд. Повторите запрос.' : error instanceof Error ? error.message : 'Сервер недоступен. Облик не сохранён.' });
      return false;
    } finally {
      clearTimeout(timer);
      if (this.request === request) { this.request = null; this.patch({ busy: false }); }
    }
  }
  private patch(changes: Partial<AvatarView>): void { if (!this.disposed) { this.value = Object.freeze({ ...this.value, ...changes }); this.changed(this.value); } }
  dispose(): void { this.disposed = true; this.request?.abort(); this.request = null; }
}
