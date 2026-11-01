import type { EquipmentState, ToolId } from '../../../shared/equipment/types';
import { parseEquipmentState } from '../../../shared/equipment/validate';
import { readBoundedJson } from './readBoundedJson';
import type { ServerSession } from '../../../shared/protocol/types';
export interface EquipmentView { readonly state: EquipmentState | null; readonly busy: boolean; readonly error: string | null }
export class EquipmentClient {
  private controller: AbortController | null = null;
  private disposed = false;
  private value: EquipmentView = { state: null, busy: false, error: null };
  constructor(private readonly url: string, private readonly session: ServerSession, private readonly changed: (view: EquipmentView) => void, private readonly unauthorized: () => void) {}
  load(): Promise<boolean> { return this.request(); }
  save(tool: ToolId | null): Promise<boolean> { return this.request({ tool }); }
  private async request(selection?: EquipmentState): Promise<boolean> {
    if (this.disposed || this.controller) return false;
    const controller = new AbortController(); this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 10000); this.patch({ busy: true, error: null });
    try {
      const response = await fetch(`${this.url.replace(/\/$/, '')}/api/equipment`, { method: selection ? 'POST' : 'GET', headers: { Authorization: `Bearer ${this.session.token}`, ...(selection ? { 'Content-Type': 'application/json' } : {}) }, ...(selection ? { body: JSON.stringify(selection) } : {}), cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal });
      if (this.disposed || this.controller !== controller) return false;
      if (response.status === 401) { this.unauthorized(); return false; }
      const raw = await readBoundedJson(response);
      if (!response.ok) { const message = (raw as { error?: { message?: unknown } })?.error?.message; throw new Error(typeof message === 'string' ? message.slice(0, 500) : 'Сервер не подтвердил действие.'); }
      const state = parseEquipmentState(raw);
      if (this.disposed || this.controller !== controller) return false;
      this.patch({ state }); return true;
    } catch (error) { if (!this.disposed) this.patch({ error: controller.signal.aborted ? 'Сервер не ответил за 10 секунд.' : error instanceof Error ? error.message : 'Не удалось связаться с сервером.' }); return false; }
    finally { clearTimeout(timer); if (this.controller === controller) { this.controller = null; this.patch({ busy: false }); } }
  }
  private patch(update: Partial<EquipmentView>): void { if (!this.disposed) { this.value = Object.freeze({ ...this.value, ...update }); this.changed(this.value); } }
  dispose(): void { this.disposed = true; this.controller?.abort(); this.controller = null; }
}
