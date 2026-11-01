// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputController } from './InputController';
import type { InputActions } from './InputController';

describe('confirmed pointer lock and input intentions', () => {
  let input: InputController;
  let surface: HTMLDivElement;
  let locked: Element | null;
  let allowed: boolean;
  let yaw: number;
  let actions: InputActions;
  let exit: ReturnType<typeof vi.fn>;
  const originalLock = Object.getOwnPropertyDescriptor(document, 'pointerLockElement');
  const originalExit = Object.getOwnPropertyDescriptor(document, 'exitPointerLock');

  function grant() {
    locked = surface;
    document.dispatchEvent(new Event('pointerlockchange'));
  }
  function moveMouse(x: number, y: number) {
    const event = new MouseEvent('mousemove');
    Object.defineProperties(event, { movementX: { value: x }, movementY: { value: y } });
    document.dispatchEvent(event);
  }

  beforeEach(() => {
    allowed = true;
    yaw = 0;
    locked = null;
    surface = document.createElement('div');
    document.body.append(surface);
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
    exit = vi.fn(() => { locked = null; document.dispatchEvent(new Event('pointerlockchange')); });
    Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: exit });
    Object.defineProperty(surface, 'requestPointerLock', { configurable: true, value: vi.fn(() => { grant(); return Promise.resolve(); }) });
    actions = {
      canControl: () => allowed, cameraYaw: () => yaw,
      move: vi.fn(), sprint: vi.fn(), jump: vi.fn(), clearInput: vi.fn(), look: vi.fn(), zoom: vi.fn(), interact: vi.fn(), carry: vi.fn(), menu: vi.fn(),
      captured: vi.fn(), interrupted: vi.fn(), captureFailed: vi.fn(),
    };
    input = new InputController(surface, actions);
  });

  afterEach(() => {
    input.dispose();
    document.body.replaceChildren();
    if (originalLock) Object.defineProperty(document, 'pointerLockElement', originalLock);
    else Reflect.deleteProperty(document, 'pointerLockElement');
    if (originalExit) Object.defineProperty(document, 'exitPointerLock', originalExit);
    else Reflect.deleteProperty(document, 'exitPointerLock');
  });

  it('uses physical keys relative to the camera only after capture and clears old input on resume', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'ц' }));
    input.sample();
    expect(actions.move).not.toHaveBeenCalled();
    input.requestCapture();
    expect(input.hasCapture).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'ц' }));
    input.sample();
    expect(actions.move).toHaveBeenLastCalledWith({ x: 0, z: -1 });
    yaw = Math.PI / 2;
    input.sample();
    expect(actions.move).toHaveBeenLastCalledWith({ x: -1, z: expect.closeTo(0) });
    input.stop();
    expect(actions.move).toHaveBeenLastCalledWith({ x: 0, z: 0 });
    expect(locked).toBeNull();
    const count = vi.mocked(actions.move).mock.calls.length;
    input.requestCapture();
    input.sample();
    expect(actions.move).toHaveBeenCalledTimes(count);
  });

  it('consumes repeated relative movement without buttons or cursor coordinates', () => {
    input.requestCapture();
    for (let index = 0; index < 20; index++) moveMouse(100, -10);
    expect(actions.look).toHaveBeenCalledTimes(20);
    expect(actions.look).toHaveBeenLastCalledWith(100, -10);
    surface.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }));
    expect(actions.zoom).toHaveBeenCalledWith(120);
    input.stop();
    moveMouse(100, -10);
    expect(actions.look).toHaveBeenCalledTimes(20);
  });

  it('jumps once on physical Space, tracks both Shifts, and clears unsent input on blur', () => {
    input.requestCapture();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', repeat: true }));
    input.sample(); input.sample(); expect(actions.jump).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    expect(actions.jump).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' })); input.sample();
    expect(actions.sprint).toHaveBeenLastCalledWith(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftRight' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft' })); input.sample();
    expect(actions.sprint).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftRight' })); input.sample();
    expect(actions.sprint).toHaveBeenLastCalledWith(false);
    window.dispatchEvent(new Event('blur')); expect(actions.clearInput).toHaveBeenCalled();
    input.requestCapture(); input.sample(); expect(actions.jump).toHaveBeenCalledTimes(2);
  });

  it('uses the physical F edge once, resets on interruption, and preserves MOVE', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'а' }));
    expect(actions.carry).not.toHaveBeenCalled();
    input.requestCapture();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'а' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', repeat: true }));
    input.sample();
    expect(actions.carry).toHaveBeenCalledTimes(1);
    expect(actions.move).toHaveBeenLastCalledWith({ x: 0, z: -1 });
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
    expect(actions.carry).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('blur'));
    expect(actions.clearInput).toHaveBeenCalled();
    input.requestCapture();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', repeat: true }));
    expect(actions.carry).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
    expect(actions.carry).toHaveBeenCalledTimes(3);
  });

  it('blocks F for text entry, modified keys, unavailable controls, and disposed input', () => {
    input.requestCapture();
    const field = document.createElement('textarea'); document.body.append(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', ctrlKey: true }));
    allowed = false;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
    allowed = true;
    input.dispose();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
    expect(actions.carry).not.toHaveBeenCalled();
  });

  it('does not enable movement or look while the request is pending', () => {
    Object.defineProperty(surface, 'requestPointerLock', { value: () => new Promise<void>(() => {}) });
    input.requestCapture();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    moveMouse(100, 10);
    input.sample();
    expect(actions.move).not.toHaveBeenCalled();
    expect(actions.look).not.toHaveBeenCalled();
    expect(actions.captured).not.toHaveBeenCalled();
    input.stop();
    grant();
    expect(locked).toBeNull();
    expect(actions.captured).not.toHaveBeenCalled();
  });

  it('blocks text, handles E once, and releases capture when a text field gains focus', () => {
    input.requestCapture();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', repeat: true }));
    expect(actions.interact).toHaveBeenCalledTimes(1);
    const field = document.createElement('input');
    document.body.append(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    input.sample();
    expect(actions.move).not.toHaveBeenCalled();
    field.focus();
    expect(locked).toBeNull();
    expect(actions.interrupted).toHaveBeenCalledTimes(1);
  });

  it.each(['blur', 'loss'])('interrupts on %s and does not revive held keys after a fresh gesture', (reason) => {
    input.requestCapture();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    input.sample();
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    else { locked = null; document.dispatchEvent(new Event('pointerlockchange')); }
    expect(actions.interrupted).toHaveBeenCalledTimes(1);
    expect(actions.move).toHaveBeenLastCalledWith({ x: 0, z: 0 });
    input.requestCapture();
    const count = vi.mocked(actions.move).mock.calls.length;
    input.sample();
    expect(actions.move).toHaveBeenCalledTimes(count);
  });

  it('does not toggle the menu again when Escape is followed by its unlock event', () => {
    input.requestCapture();
    vi.mocked(actions.menu).mockImplementation(() => input.stop());
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    document.dispatchEvent(new Event('pointerlockchange'));
    expect(actions.menu).toHaveBeenCalledTimes(1);
    expect(actions.interrupted).not.toHaveBeenCalled();
    expect(locked).toBeNull();
  });

  it('reports a rejected capture and allows a new successful attempt', async () => {
    Object.defineProperty(surface, 'requestPointerLock', { value: vi.fn().mockRejectedValueOnce(new Error('denied')).mockImplementationOnce(() => { grant(); return Promise.resolve(); }) });
    input.requestCapture();
    await Promise.resolve();
    expect(actions.captureFailed).toHaveBeenCalledTimes(1);
    expect(input.hasCapture).toBe(false);
    input.requestCapture();
    expect(input.hasCapture).toBe(true);
  });

  it('reports unsupported APIs without enabling input', () => {
    Object.defineProperty(surface, 'requestPointerLock', { value: undefined });
    input.requestCapture();
    expect(actions.captureFailed).toHaveBeenCalledWith(expect.stringContaining('не поддерживает'));
    expect(input.hasCapture).toBe(false);
  });

  it('ignores stale global errors after a promise-based successful capture', () => {
    input.requestCapture();
    document.dispatchEvent(new Event('pointerlockerror'));
    expect(input.hasCapture).toBe(true);
    expect(actions.captureFailed).not.toHaveBeenCalled();
  });

  it('supports legacy event-only errors and a successful retry', () => {
    Object.defineProperty(surface, 'requestPointerLock', { value: () => undefined });
    input.requestCapture();
    document.dispatchEvent(new Event('pointerlockerror'));
    expect(actions.captureFailed).toHaveBeenCalledTimes(1);
    expect(input.hasCapture).toBe(false);
    input.requestCapture();
    grant();
    expect(input.hasCapture).toBe(true);
  });

  it('releases capture and interrupts when the tab becomes hidden', () => {
    input.requestCapture();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(locked).toBeNull();
    expect(actions.interrupted).toHaveBeenCalledTimes(1);
  });

  it('revokes a late promise grant after disposal without calling the old app', async () => {
    let settle: (() => void) | undefined;
    Object.defineProperty(surface, 'requestPointerLock', { value: () => new Promise<void>((resolve) => { settle = resolve; }) });
    input.requestCapture();
    input.dispose();
    locked = surface;
    settle?.();
    await Promise.resolve();
    expect(locked).toBeNull();
    expect(actions.captured).not.toHaveBeenCalled();
    expect(actions.captureFailed).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    expect(actions.interact).not.toHaveBeenCalled();
  });

  it('cleans a late grant from a legacy void API after disposal', () => {
    Object.defineProperty(surface, 'requestPointerLock', { value: () => undefined });
    input.requestCapture();
    input.dispose();
    grant();
    expect(locked).toBeNull();
    expect(actions.captured).not.toHaveBeenCalled();
  });

  it('releases owned capture and removes input listeners on dispose', () => {
    input.requestCapture();
    input.dispose();
    moveMouse(100, 10);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    expect(actions.look).not.toHaveBeenCalled();
    expect(actions.interact).not.toHaveBeenCalled();
    expect(actions.menu).not.toHaveBeenCalled();
    expect(locked).toBeNull();
  });
});
