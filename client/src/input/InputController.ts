import type { Direction } from '../core/types';

export interface InputActions {
  canControl(): boolean;
  cameraYaw(): number;
  move(direction: Direction): void;
  look(dx: number, dy: number): void;
  zoom(delta: number): void;
  interact(): void;
  menu(): void;
}

const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
function textEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

/** DOM events become intentions; no renderer or network objects are imported here. */
export class InputController {
  private readonly keys = new Set<string>();
  private readonly abort = new AbortController();
  private last: Direction = { x: 0, z: 0 };
  private dragging = false;
  private pointer = { x: 0, y: 0 };

  constructor(surface: HTMLElement, private readonly actions: InputActions) {
    const options = { signal: this.abort.signal };
    window.addEventListener('keydown', this.keyDown, options);
    window.addEventListener('keyup', this.keyUp, options);
    window.addEventListener('blur', this.reset, options);
    window.addEventListener('pointerup', () => { this.dragging = false; }, options);
    window.addEventListener('pointermove', (event) => {
      if (this.dragging && actions.canControl()) {
        actions.look(event.clientX - this.pointer.x, event.clientY - this.pointer.y);
        this.pointer = { x: event.clientX, y: event.clientY };
      }
    }, options);
    surface.addEventListener('pointerdown', (event) => {
      if (event.button !== 2 || !actions.canControl()) return;
      event.preventDefault();
      this.dragging = true;
      this.pointer = { x: event.clientX, y: event.clientY };
    }, options);
    surface.addEventListener('contextmenu', (event) => { if (actions.canControl()) event.preventDefault(); }, options);
    surface.addEventListener('wheel', (event) => {
      if (!actions.canControl()) return;
      event.preventDefault();
      actions.zoom(event.deltaY);
    }, { ...options, passive: false });
  }

  sample(): void {
    if (!this.actions.canControl()) { this.reset(); return; }
    const x = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const z = Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) - Number(this.keys.has('KeyW') || this.keys.has('ArrowUp'));
    const yaw = this.actions.cameraYaw();
    const direction = { x: x * Math.cos(yaw) + z * Math.sin(yaw), z: -x * Math.sin(yaw) + z * Math.cos(yaw) };
    if (Math.abs(direction.x - this.last.x) + Math.abs(direction.z - this.last.z) > 1e-8) {
      this.actions.move(direction);
      this.last = direction;
    }
  }

  readonly reset = (): void => {
    this.keys.clear();
    this.dragging = false;
    if (this.last.x !== 0 || this.last.z !== 0) this.actions.move({ x: 0, z: 0 });
    this.last = { x: 0, z: 0 };
  };

  dispose(): void { this.reset(); this.abort.abort(); }

  private readonly keyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') {
      event.preventDefault();
      if (!event.repeat) this.actions.menu();
      return;
    }
    if (textEntry(event.target) || event.ctrlKey || event.metaKey || event.altKey || !this.actions.canControl()) return;
    if (movementKeys.has(event.code)) { event.preventDefault(); this.keys.add(event.code); }
    if (event.code === 'KeyE' && !event.repeat) { event.preventDefault(); this.actions.interact(); }
  };

  private readonly keyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };
}
