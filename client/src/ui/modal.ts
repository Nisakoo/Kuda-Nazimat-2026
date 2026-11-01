/** Native modality traps focus. Restore the opener if the browser leaves focus on the body. */
const openModals: HTMLDialogElement[] = [];
const controls = 'button, input:not([type="hidden"]), select, textarea, a[href], [tabindex]';

function usable(node: HTMLDialogElement, element: HTMLElement): boolean {
  if (!element.isConnected || !node.contains(element) || element.matches(':disabled') || element.tabIndex < 0 || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (let current: HTMLElement | null = element; current && current !== node; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

export function modal(node: HTMLDialogElement) {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  node.showModal();
  openModals.push(node);
  let last = document.activeElement instanceof HTMLElement && node.contains(document.activeElement) ? document.activeElement : null;
  let pending: HTMLElement | null = null;
  let fallback: HTMLElement | null = null;
  let internal = false;
  let destroyed = false;
  let interactionRevision = 0;
  let lockFrame: number | null = null;
  let focusFrame: number | null = null;
  const isTop = () => !destroyed && node.isConnected && node.open && openModals.at(-1) === node;
  const focus = (element: HTMLElement) => {
    internal = true;
    element.focus();
    internal = false;
    return document.activeElement === element;
  };
  const onFocus = (event: FocusEvent) => {
    if (internal) return;
    interactionRevision++;
    pending = null; fallback = null;
    if (event.target instanceof HTMLElement && node.contains(event.target)) last = event.target;
  };
  const onInteraction = () => { interactionRevision++; pending = null; fallback = null; };
  const cancelLockFrame = () => { if (lockFrame !== null) { cancelAnimationFrame(lockFrame); lockFrame = null; } };
  const recoverAfterUnlock = () => {
    if (!isTop() || !document.hasFocus() || document.pointerLockElement || document.activeElement !== document.body) return;
    if (last && usable(node, last) && focus(last)) return;
    for (const candidate of node.querySelectorAll<HTMLElement>(controls)) {
      if (usable(node, candidate) && focus(candidate)) { last = candidate; return; }
    }
  };
  const onFocusOut = (event: FocusEvent) => {
    if (internal || !isTop() || !(event.target instanceof Element) || !node.contains(event.target)) return;
    if (focusFrame !== null) cancelAnimationFrame(focusFrame);
    const revision = interactionRevision;
    focusFrame = requestAnimationFrame(() => {
      focusFrame = null;
      if (interactionRevision === revision && document.hasFocus()) recoverAfterUnlock();
    });
  };
  node.addEventListener('focusout', onFocusOut);
  const onPointerLockChange = () => {
    cancelLockFrame();
    if (document.pointerLockElement || !isTop()) return;
    const revision = interactionRevision;
    recoverAfterUnlock();
    lockFrame = requestAnimationFrame(() => {
      lockFrame = null;
      if (interactionRevision === revision) recoverAfterUnlock();
    });
  };
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('focusin', onFocus, true);
  document.addEventListener('pointerdown', onInteraction, true);
  document.addEventListener('keydown', onInteraction, true);
  const observer = new MutationObserver(() => {
    if (!isTop()) return;
    if (pending && fallback && document.activeElement === fallback && usable(node, pending)) {
      const previous = pending;
      pending = null; fallback = null;
      if (focus(previous)) last = previous;
      return;
    }
    if (document.activeElement !== document.body || !last || usable(node, last)) return;
    const previous = last;
    for (const candidate of node.querySelectorAll<HTMLElement>(controls)) {
      if (usable(node, candidate) && focus(candidate)) {
        pending = previous; fallback = candidate; last = candidate;
        return;
      }
    }
  });
  observer.observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'inert', 'aria-hidden', 'tabindex'] });
  return { destroy: () => {
    destroyed = true;
    observer.disconnect();
    cancelLockFrame();
    if (focusFrame !== null) cancelAnimationFrame(focusFrame);
    node.removeEventListener('focusout', onFocusOut);
    document.removeEventListener('pointerlockchange', onPointerLockChange);
    document.removeEventListener('focusin', onFocus, true);
    document.removeEventListener('pointerdown', onInteraction, true);
    document.removeEventListener('keydown', onInteraction, true);
    const index = openModals.indexOf(node);
    if (index !== -1) openModals.splice(index, 1);
    node.close();
    const top = openModals.at(-1);
    const active = document.activeElement;
    if (opener?.isConnected && (!top || top.contains(opener)) &&
        (active === document.body || active === null || node.contains(active))) opener.focus();
  } };
}
