import type { RenderAdapter } from '../render/RenderAdapter';
import { ThreeRenderer } from '../render/three/ThreeRenderer';
import type { ClientConfig } from './config';

export interface AppSnapshot {
  readonly phase: 'idle' | 'running' | 'stopped' | 'unavailable' | 'error' | 'disposed';
  readonly message: string | null;
}

/** Composition root. Simulation and sessions arrive in their own implementation steps. */
export class GameApp {
  private renderer: RenderAdapter | null = null;
  private host: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private frameId: number | null = null;
  private lastTime: number | null = null;
  private elapsed = 0;
  private snapshot: AppSnapshot = Object.freeze({ phase: 'idle', message: null });
  private readonly listeners = new Set<(snapshot: AppSnapshot) => void>();

  constructor(
    readonly config: ClientConfig,
    private readonly createRenderer: () => RenderAdapter = () => new ThreeRenderer(),
  ) {}

  subscribe(listener: (snapshot: AppSnapshot) => void): () => void {
    if (this.snapshot.phase === 'disposed') return () => {};
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => { this.listeners.delete(listener); };
  }

  start(host: HTMLElement): void {
    if (this.snapshot.phase === 'disposed') throw new Error('Приложение уже завершено.');
    if (this.snapshot.phase === 'running') return;
    if (this.config.session === 'online') {
      this.setState('unavailable', 'Сетевой режим будет доступен после подключения сервера.');
      return;
    }
    try {
      if (this.host && this.host !== host) this.releaseRenderer();
      this.host = host;
      if (!this.renderer) {
        this.renderer = this.createRenderer();
        this.renderer.mount(host);
      }
      this.resize();
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(host);
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      window.addEventListener('resize', this.resize);
      this.setState('running');
      this.onVisibilityChange();
    } catch {
      this.fail();
    }
  }

  stop(): void {
    if (this.snapshot.phase !== 'running') return;
    this.detach();
    this.setState('stopped');
  }

  restart(host: HTMLElement): void {
    if (this.snapshot.phase === 'disposed') throw new Error('Приложение уже завершено.');
    this.detach();
    this.releaseRenderer();
    this.setState('idle');
    this.start(host);
  }

  dispose(): void {
    if (this.snapshot.phase === 'disposed') return;
    this.detach();
    this.releaseRenderer();
    this.setState('disposed');
    this.listeners.clear();
  }

  private setState(phase: AppSnapshot['phase'], message: string | null = null): void {
    this.snapshot = Object.freeze({ phase, message });
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private readonly resize = (): void => {
    if (!this.host) return;
    const { width, height } = this.host.getBoundingClientRect();
    this.renderer?.resize(Math.max(1, width), Math.max(1, height), Math.min(window.devicePixelRatio || 1, 2));
  };

  private readonly frame = (timestamp: number): void => {
    this.frameId = null;
    if (this.snapshot.phase !== 'running') return;
    if (this.lastTime !== null) this.elapsed += Math.min(Math.max(0, timestamp - this.lastTime), 100) / 1000;
    this.lastTime = timestamp;
    try {
      this.renderer?.render(this.elapsed);
      this.frameId = requestAnimationFrame(this.frame);
    } catch {
      this.fail();
    }
  };

  private readonly onVisibilityChange = (): void => {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.lastTime = null;
    if (!document.hidden && this.snapshot.phase === 'running') {
      this.frameId = requestAnimationFrame(this.frame);
    }
  };

  private detach(): void {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.lastTime = null;
    this.observer?.disconnect();
    this.observer = null;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('resize', this.resize);
  }

  private releaseRenderer(): void {
    this.renderer?.dispose();
    this.renderer = null;
    this.host = null;
    this.elapsed = 0;
  }

  private fail(): void {
    this.detach();
    this.releaseRenderer();
    this.setState('error', 'Не удалось открыть 3D-сцену. Проверьте поддержку WebGL 2 и аппаратное ускорение браузера.');
  }
}
