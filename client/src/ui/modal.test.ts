// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { modal } from './modal';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function dialog() {
  const node = document.createElement('dialog');
  const button = document.createElement('button');
  node.append(button); document.body.append(node);
  vi.spyOn(node, 'showModal').mockImplementation(() => { node.open = true; button.focus(); });
  vi.spyOn(node, 'close').mockImplementation(() => { node.open = false; button.blur(); });
  return { node, button };
}

it('restores the opener when closing leaves focus on the body', () => {
  const opener = document.createElement('button'); document.body.append(opener); opener.focus();
  const { node } = dialog(); const action = modal(node);
  action.destroy(); expect(document.activeElement).toBe(opener);
});

it('does not restore a removed opener', () => {
  const opener = document.createElement('button'); document.body.append(opener); opener.focus();
  const { node } = dialog(); const action = modal(node); const focus = vi.spyOn(opener, 'focus');
  opener.remove(); action.destroy(); expect(focus).not.toHaveBeenCalled();
});

it('does not steal focus from a newer modal', () => {
  const opener = document.createElement('button'); document.body.append(opener); opener.focus();
  const first = dialog(); const a = modal(first.node);
  const second = dialog(); const b = modal(second.node);
  const focus = vi.spyOn(opener, 'focus'); a.destroy();
  expect(document.activeElement).toBe(second.button); expect(focus).not.toHaveBeenCalled();
  b.destroy();
});

it('recovers from a disabled action and restores it after acknowledgement', async () => {
  const { node, button } = dialog();
  const action = modal(node);
  const alternative = document.createElement('button'); node.append(alternative);
  button.blur(); button.disabled = true;
  await vi.waitFor(() => expect(document.activeElement).toBe(alternative));
  button.disabled = false;
  await vi.waitFor(() => expect(document.activeElement).toBe(button));
  action.destroy();
});

it('recovers when the focused action is removed', async () => {
  const { node, button } = dialog();
  const action = modal(node);
  const alternative = document.createElement('button'); node.append(alternative);
  button.remove(); button.blur();
  await vi.waitFor(() => expect(document.activeElement).toBe(alternative));
  action.destroy();
});

it('does not restore after keyboard or focus choice', async () => {
  const { node, button } = dialog(); const action = modal(node);
  const alternative = document.createElement('button'); const input = document.createElement('input'); node.append(alternative, input);
  button.blur(); button.disabled = true;
  await vi.waitFor(() => expect(document.activeElement).toBe(alternative));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); input.focus();
  button.disabled = false;
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(document.activeElement).toBe(input); action.destroy();
});

it('does not restore after pointer interaction even if focus stays on the fallback', async () => {
  const { node, button } = dialog(); const action = modal(node);
  const alternative = document.createElement('button'); node.append(alternative);
  button.blur(); button.disabled = true;
  await vi.waitFor(() => expect(document.activeElement).toBe(alternative));
  alternative.dispatchEvent(new Event('pointerdown', { bubbles: true })); button.disabled = false;
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(document.activeElement).toBe(alternative); action.destroy();
});

it('does not recover or restore into a background modal', async () => {
  const first = dialog(); const a = modal(first.node);
  const alternative = document.createElement('button'); first.node.append(alternative);
  first.button.blur(); first.button.disabled = true;
  await vi.waitFor(() => expect(document.activeElement).toBe(alternative));
  const second = dialog(); const b = modal(second.node);
  first.button.disabled = false;
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(document.activeElement).toBe(second.button); b.destroy();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(document.activeElement).not.toBe(first.button); a.destroy();
});

it('does not recover when the dialog is detached', async () => {
  const { node, button } = dialog(); const action = modal(node);
  const alternative = document.createElement('button'); node.append(alternative);
  const spy = vi.spyOn(alternative, 'focus');
  button.blur(); button.disabled = true; node.remove();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(spy).not.toHaveBeenCalled(); action.destroy();
});

function frames() {
  let next = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++next, callback); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id); });
  return { callbacks, run: () => { for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(0); } } };
}

it('recovers body focus on pointer-lock exit and on the bounded follow-up', () => {
  const raf = frames(); const { node, button } = dialog(); const action = modal(node);
  button.blur(); document.dispatchEvent(new Event('pointerlockchange'));
  expect(document.activeElement).toBe(button);
  button.blur(); raf.run(); expect(document.activeElement).toBe(button);
  expect(raf.callbacks.size).toBe(0); action.destroy();
});

it('does not steal focus from a user choice before the unlock follow-up', () => {
  const raf = frames(); const { node } = dialog(); const action = modal(node);
  const input = document.createElement('input'); node.append(input);
  document.dispatchEvent(new Event('pointerlockchange'));
  input.focus(); raf.run(); expect(document.activeElement).toBe(input);
  input.blur(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); raf.run(); expect(document.activeElement).toBe(document.body);
  action.destroy();
});

it('does not recover after a key or pointer choice before the follow-up', () => {
  const raf = frames(); const { node, button } = dialog(); const action = modal(node);
  document.dispatchEvent(new Event('pointerlockchange'));
  button.blur(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  raf.run(); expect(document.activeElement).toBe(document.body);
  button.focus(); document.dispatchEvent(new Event('pointerlockchange'));
  button.blur(); document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  raf.run(); expect(document.activeElement).toBe(document.body);
  action.destroy();
});

it('does not steal focus from a newer modal on unlock follow-up', () => {
  const raf = frames(); const first = dialog(); const a = modal(first.node);
  document.dispatchEvent(new Event('pointerlockchange'));
  const second = dialog(); const b = modal(second.node);
  raf.run(); expect(document.activeElement).toBe(second.button);
  b.destroy(); a.destroy();
});

it('cancels the follow-up on disposal or a new pointer lock', () => {
  const raf = frames(); const { node } = dialog(); const action = modal(node);
  document.dispatchEvent(new Event('pointerlockchange')); expect(raf.callbacks.size).toBe(1);
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: node });
  document.dispatchEvent(new Event('pointerlockchange')); expect(raf.callbacks.size).toBe(0);
  Reflect.deleteProperty(document, 'pointerLockElement');
  document.dispatchEvent(new Event('pointerlockchange')); expect(raf.callbacks.size).toBe(1);
  action.destroy(); expect(raf.callbacks.size).toBe(0);
});

it('recovers delayed focus loss after unlock without requiring another unlock event', () => {
  const raf = frames(); vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const { node, button } = dialog(); const action = modal(node);
  document.dispatchEvent(new Event('pointerlockchange')); raf.run();
  button.blur(); expect(document.activeElement).toBe(document.body);
  raf.run(); expect(document.activeElement).toBe(button); expect(raf.callbacks.size).toBe(0);
  action.destroy();
});

it('falls back to an enabled button when the lost focus was a scrollable div', () => {
  const raf = frames(); vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const { node, button } = dialog(); const action = modal(node);
  const scroll = document.createElement('div'); scroll.tabIndex = -1; node.append(scroll); scroll.focus();
  scroll.blur(); raf.run(); expect(document.activeElement).toBe(button); action.destroy();
});

it('does not steal from editable focus or a later user action after focusout', () => {
  const raf = frames(); vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const { node, button } = dialog(); const action = modal(node);
  const input = document.createElement('input'); node.append(input);
  button.blur(); input.focus(); raf.run(); expect(document.activeElement).toBe(input);
  input.blur(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  raf.run(); expect(document.activeElement).toBe(document.body); action.destroy();
});

it('does not recover focusout after another modal opens or document loses focus', () => {
  const raf = frames(); const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const first = dialog(); const a = modal(first.node);
  first.button.blur(); const second = dialog(); const b = modal(second.node);
  raf.run(); expect(document.activeElement).toBe(second.button);
  b.destroy(); first.button.blur(); hasFocus.mockReturnValue(false);
  raf.run(); expect(document.activeElement).toBe(document.body); a.destroy();
});

it('cancels focusout recovery on disposal', () => {
  const raf = frames(); vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const { node, button } = dialog(); const action = modal(node);
  button.blur(); expect(raf.callbacks.size).toBe(1);
  action.destroy(); expect(raf.callbacks.size).toBe(0);
});

it('does not recover after the dialog is destroyed', async () => {
  const { node, button } = dialog(); const action = modal(node);
  const alternative = document.createElement('button'); node.append(alternative);
  const spy = vi.spyOn(alternative, 'focus');
  button.blur(); button.disabled = true; action.destroy();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(spy).not.toHaveBeenCalled();
});


it('restores focus after a disable/enable ACK batch before the next frame', async () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const { node, button } = dialog(); const action = modal(node);
  button.disabled = true; button.blur(); button.disabled = false;
  await vi.waitFor(() => expect(document.activeElement).toBe(button));
  action.destroy();
});
