/** Native modality traps focus and restores it when the panel is removed. */
export function modal(node: HTMLDialogElement) {
  node.showModal();
  return { destroy: () => { node.close(); } };
}
