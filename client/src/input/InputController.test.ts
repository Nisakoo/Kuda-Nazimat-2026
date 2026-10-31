// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputController } from './InputController';
import type { InputActions } from './InputController';

describe('input intentions and blocking', () => {
  let input: InputController;
  let surface: HTMLDivElement;
  let allowed: boolean;
  let yaw: number;
  let actions: InputActions;
  beforeEach(() => {
    allowed = true;
    yaw = 0;
    surface = document.createElement('div');
    document.body.append(surface);
    actions = { canControl: () => allowed, cameraYaw: () => yaw, move: vi.fn(), look: vi.fn(), zoom: vi.fn(), interact: vi.fn(), menu: vi.fn() };
    input = new InputController(surface, actions);
  });
  afterEach(() => { input.dispose(); document.body.replaceChildren(); });

  it('uses physical keys, samples camera-relative directions and clears movement on release/blur', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'ц' }));
    input.sample();
    expect(actions.move).toHaveBeenLastCalledWith({ x: 0, z: -1 });
    yaw = Math.PI / 2;
    input.sample();
    expect(actions.move).toHaveBeenLastCalledWith({ x: -1, z: expect.closeTo(0) });
    window.dispatchEvent(new Event('blur'));
    expect(actions.move).toHaveBeenLastCalledWith({ x: 0, z: 0 });
    input.sample();
    expect(actions.move).toHaveBeenCalledTimes(3);
  });

  it('blocks text entry and menus, accepts E once and removes all listeners on dispose', () => {
    const field = document.createElement('input');
    document.body.append(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    input.sample();
    expect(actions.move).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', repeat: true }));
    expect(actions.interact).toHaveBeenCalledTimes(1);
    allowed = false;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    input.sample();
    expect(actions.move).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    expect(actions.menu).toHaveBeenCalledTimes(1);
    input.dispose();
    allowed = true;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    expect(actions.interact).toHaveBeenCalledTimes(1);
    expect(actions.menu).toHaveBeenCalledTimes(1);
  });

  it('turns right-drag and wheel events into camera commands without changing game data', () => {
    surface.dispatchEvent(new PointerEvent('pointerdown', { button: 2, clientX: 10, clientY: 20 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 30, clientY: 15 }));
    expect(actions.look).toHaveBeenCalledWith(20, -5);
    surface.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }));
    expect(actions.zoom).toHaveBeenCalledWith(120);
    window.dispatchEvent(new PointerEvent('pointerup'));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 20 }));
    expect(actions.look).toHaveBeenCalledTimes(1);
    allowed = false;
    surface.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }));
    expect(actions.zoom).toHaveBeenCalledTimes(1);
  });
});
