// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { inventoryShortcut } from './inventoryShortcut';

afterEach(() => document.body.replaceChildren());
function setup(panel: string = 'inventory') {
  const dialog = document.createElement('dialog'); const button = document.createElement('button');
  const input = document.createElement('input'); const textarea = document.createElement('textarea'); const select = document.createElement('select');
  const editable = document.createElement('div'); editable.setAttribute('contenteditable', ''); const child = document.createElement('span'); editable.append(child);
  const close = vi.fn(); dialog.append(button, input, textarea, select, editable); document.body.append(dialog);
  dialog.addEventListener('keydown', event => inventoryShortcut(event, panel, close));
  return { dialog, button, input, textarea, select, child, close };
}
function press(target: Element, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { code: 'KeyI', bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event); return event;
}

it('closes the inventory from a dialog button and consumes I', () => {
  const { button, close } = setup(); const event = press(button);
  expect(close).toHaveBeenCalledOnce(); expect(event.defaultPrevented).toBe(true);
});

it('does not close from editing controls or another panel', () => {
  const { input, textarea, select, child, close } = setup();
  for (const target of [input, textarea, select, child]) expect(press(target).defaultPrevented).toBe(false);
  expect(close).not.toHaveBeenCalled();
  const other = setup('task'); expect(press(other.button).defaultPrevented).toBe(false); expect(other.close).not.toHaveBeenCalled();
});

it('ignores composition, repeat, modifiers, other keys and handled events', () => {
  const { button, close } = setup();
  for (const options of [{ isComposing: true }, { repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { code: 'KeyE' }]) {
    expect(press(button, options).defaultPrevented).toBe(false);
  }
  button.addEventListener('keydown', event => event.preventDefault());
  expect(press(button).defaultPrevented).toBe(true); expect(close).not.toHaveBeenCalled();
});
