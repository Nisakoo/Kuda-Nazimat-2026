/** No engine objects cross the rendering boundary. */
export interface RenderAdapter {
  mount(container: HTMLElement): void;
  resize(width: number, height: number, pixelRatio: number): void;
  render(elapsedSeconds: number): void;
  dispose(): void;
}
