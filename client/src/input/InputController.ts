import type { Direction } from '../core/types';

export interface InputActions {
  canControl(): boolean;
  cameraYaw(): number;
  move(direction: Direction): void;
  sprint(held: boolean): void;
  jump(): void;
  clearInput(): void;
  look(dx: number, dy: number): void;
  zoom(delta: number): void;
  interact(): void;
  controlsHint?(visible: boolean): void;
  shortcut?(code: string): boolean;
  carry(): void;
  menu(): void;
  captured(): void;
  interrupted(): void;
  captureFailed(message: string): void;
}

const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
function textEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}
const captureError = 'Не удалось захватить мышь. Разрешите захват в браузере и нажмите кнопку восстановления управления или вернитесь в меню.';

/** DOM/pointer-lock adapter. Gameplay listeners exist only while capture is confirmed. */
export class InputController {
  private readonly keys = new Set<string>();
  private readonly hintKeys = new Set<string>();
  private readonly ownerAbort = new AbortController();
  private playAbort: AbortController | null = null;
  private last: Direction = { x: 0, z: 0 };
  private sprintHeld = false;
  private dirty = false;
  private desired = false;
  private held = false;
  private pending = false;
  private legacyPending = false;
  private disposed = false;
  private requestId = 0;
  private readonly target: HTMLElement;

  constructor(surface: HTMLElement, private readonly actions: InputActions) {
    this.target = surface.querySelector('canvas') ?? surface;
    const options = { signal: this.ownerAbort.signal };
    document.addEventListener('pointerlockchange', this.captureChange, options);
    // Promise APIs already correlate failures with a request ID. Event-only failures
    // belong to legacy void APIs; a stale global error must not cancel a new grant.
    document.addEventListener('pointerlockerror', () => { if (this.legacyPending) this.captureFailure(); }, options);
    window.addEventListener('blur', this.interrupt, options);
    window.addEventListener('keydown', (event) => {
      if ((event.code === 'AltLeft' || event.code === 'AltRight') && !event.ctrlKey && !event.metaKey && !event.isComposing && !textEntry(event.target) && this.hasCapture && this.actions.canControl()) {
        event.preventDefault();
        this.hintKeys.add(event.code);
        this.actions.controlsHint?.(true);
        return;
      }
      if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || textEntry(event.target)) return;
      // Enter must still activate a focused control, including form buttons.
      if (!this.hasCapture && event.code === 'Enter' && event.target instanceof Element && event.target.closest('button, a, summary')) return;
      if (this.actions.shortcut?.(event.code)) event.preventDefault();
    }, options);
    window.addEventListener('keyup', (event) => {
      if (this.hintKeys.delete(event.code)) this.actions.controlsHint?.(this.hintKeys.size > 0);
    }, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.interrupt(); }, options);
    document.addEventListener('focusin', (event) => {
      if (textEntry(event.target) && (this.held || this.desired)) this.interrupt();
    }, options);
  }

  get hasCapture(): boolean { return !this.disposed && this.held && document.pointerLockElement === this.target; }

  /** Must be called directly from the user's click, before any await. */
  requestCapture(): void {
    if (this.disposed || this.pending) return;
    if (typeof this.target.requestPointerLock !== 'function') {
      this.actions.captureFailed('Этот браузер не поддерживает захват мыши. Откройте демо в браузере с Pointer Lock или вернитесь в меню.');
      return;
    }
    this.reset();
    this.desired = true;
    this.pending = true;
    const id = ++this.requestId;
    try {
      const request = this.target.requestPointerLock as () => Promise<void> | void;
      const result = request.call(this.target);
      this.legacyPending = result === undefined;
      if (result) {
        void result.then(() => {
          if (this.disposed || !this.desired) { this.releaseOwnedCapture(); return; }
          if (id === this.requestId) this.captureChange();
        }, () => { if (!this.disposed && id === this.requestId && this.desired) this.captureFailure(); });
      }
    } catch { this.captureFailure(); }
  }

  /** A pending browser request cannot be cancelled; late grants are immediately released. */
  stop(): void {
    this.desired = false;
    this.pending = false;
    this.held = false;
    this.requestId++;
    this.detachGameplay();
    this.releaseOwnedCapture();
  }

  sample(): void {
    if (!this.hasCapture || !this.actions.canControl()) { this.reset(); return; }
    const x = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const z = Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) - Number(this.keys.has('KeyW') || this.keys.has('ArrowUp'));
    const yaw = this.actions.cameraYaw();
    const direction = { x: x * Math.cos(yaw) + z * Math.sin(yaw), z: -x * Math.sin(yaw) + z * Math.cos(yaw) };
    const divisor = Math.max(1, Math.hypot(direction.x, direction.z)); direction.x /= divisor; direction.z /= divisor;
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    if (sprint !== this.sprintHeld) { this.sprintHeld = sprint; this.actions.sprint(sprint); }
    if (Math.abs(direction.x - this.last.x) + Math.abs(direction.z - this.last.z) > 1e-8) {
      this.actions.move(direction);
      this.last = direction;
    }
  }

  readonly reset = (): void => {
    if (this.hintKeys.size) { this.hintKeys.clear(); this.actions.controlsHint?.(false); }
    this.keys.clear();
    this.sprintHeld = false;
    if (this.dirty) this.actions.clearInput();
    this.dirty = false;
    if (this.last.x !== 0 || this.last.z !== 0) this.actions.move({ x: 0, z: 0 });
    this.last = { x: 0, z: 0 };
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    // Legacy void APIs report completion only through change/error events.
    // Retain only that cleanup guard until an outstanding result is delivered.
    if (!this.legacyPending) this.ownerAbort.abort();
  }

  private releaseOwnedCapture(): void {
    if (document.pointerLockElement === this.target) document.exitPointerLock();
  }

  private detachGameplay(): void {
    this.reset();
    this.playAbort?.abort();
    this.playAbort = null;
  }

  private readonly captureChange = (): void => {
    const owned = document.pointerLockElement === this.target;
    if (owned && (!this.desired || this.disposed)) {
      this.legacyPending = false;
      this.releaseOwnedCapture();
      if (this.disposed) this.ownerAbort.abort();
      return;
    }
    if (owned) {
      this.pending = false;
      this.legacyPending = false;
      if (!this.held) {
        this.held = true;
        this.attachGameplay();
        this.actions.captured();
      }
    } else if (this.held) {
      this.stop();
      if (!this.disposed) this.actions.interrupted();
    }
  };

  private readonly captureFailure = (): void => {
    this.legacyPending = false;
    if (this.disposed) { this.ownerAbort.abort(); return; }
    if (!this.desired) return;
    this.stop();
    this.actions.captureFailed(captureError);
  };

  private readonly interrupt = (): void => {
    if (!this.desired && !this.held) return;
    this.stop();
    if (!this.disposed) this.actions.interrupted();
  };

  private attachGameplay(): void {
    this.detachGameplay();
    this.playAbort = new AbortController();
    const options = { signal: this.playAbort.signal };
    window.addEventListener('keydown', this.keyDown, options);
    window.addEventListener('keyup', this.keyUp, options);
    document.addEventListener('mousemove', (event) => {
      if (this.hasCapture && this.actions.canControl()) this.actions.look(event.movementX, event.movementY);
    }, options);
    this.target.addEventListener('contextmenu', (event) => event.preventDefault(), options);
    this.target.addEventListener('wheel', (event) => {
      if (!this.hasCapture || !this.actions.canControl()) return;
      event.preventDefault();
      this.actions.zoom(event.deltaY);
    }, { ...options, passive: false });
  }

  private readonly keyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      if (!event.repeat) this.actions.menu();
      return;
    }
    if (textEntry(event.target) || event.ctrlKey || event.metaKey || event.altKey || !this.hasCapture || !this.actions.canControl()) return;
    if (movementKeys.has(event.code)) { event.preventDefault(); this.keys.add(event.code); this.dirty = true; }
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') { event.preventDefault(); this.keys.add(event.code); this.dirty = true; }
    if (event.code === 'Space') { event.preventDefault(); if (!event.repeat && !this.keys.has('Space')) this.actions.jump(); this.keys.add('Space'); this.dirty = true; }
    if (event.code === 'KeyE' && !event.repeat) { event.preventDefault(); this.actions.interact(); }
    if (event.code === 'KeyF') {
      event.preventDefault();
      if (!event.repeat && !this.keys.has('KeyF')) this.actions.carry();
      this.keys.add('KeyF'); this.dirty = true;
    }
  };

  private readonly keyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };
}
