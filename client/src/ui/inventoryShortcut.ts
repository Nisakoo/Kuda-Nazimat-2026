/** Close only an inventory dialog, without changing pointer capture. */
export function inventoryShortcut(event: KeyboardEvent, panel: string | null, close: () => void): void {
  if (panel !== 'inventory' || event.code !== 'KeyI' || event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  event.preventDefault();
  close();
}
