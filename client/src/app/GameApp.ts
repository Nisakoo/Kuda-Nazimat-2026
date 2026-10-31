import type { CameraView, RenderAdapter } from '../render/RenderAdapter';
import { ThreeRenderer } from '../render/three/ThreeRenderer';
import type { Entity, GameCommand, WorldEvent, WorldSnapshot } from '../core/types';
import type { GameSession } from '../session/GameSession';
import { LocalSession } from '../session/LocalSession';
import { answerDemoDialog, openDemoDialog } from '../session/demoDialogue';
import type { DemoDialog } from '../session/demoDialogue';
import { InputController } from '../input/InputController';
import { DEMO_BOUNDS, DEMO_NPCS, DEMO_SPAWN } from '../shared/demo';
import { GameLoop } from './GameLoop';
import type { ClientConfig } from './config';
import { AssetManager, HttpAssetSource } from '../map/AssetManager';

const localEntities: readonly Entity[] = [
  {
    id: 'local-player', character: { kind: 'player', name: 'Исследователь' },
    transform: { position: DEMO_SPAWN, rotationY: Math.PI },
    movement: { direction: { x: 0, z: 0 }, speed: 3 },
    renderable: { assetId: 'demo-player' }, animationState: { name: 'idle' },
  },
  ...DEMO_NPCS.map((npc): Entity => ({
    id: npc.id, character: { kind: 'npc', name: npc.name },
    transform: { position: { x: npc.x, y: 0, z: npc.z }, rotationY: 0 },
    interactable: { radius: 2.2, label: 'Поговорить' },
    renderable: { assetId: npc.id }, animationState: { name: 'idle' },
  })),
  { id: 'floating-tablet', transform: { position: { x: 0, y: 0, z: -2.5 }, rotationY: 0 }, renderable: { assetId: 'demo-tablet' }, animationState: { name: 'idle' } },
];

interface Nearby { readonly id: string; readonly name: string }
export interface AppSnapshot {
  readonly phase: 'idle' | 'running' | 'stopped' | 'unavailable' | 'error' | 'disposed';
  readonly message: string | null;
  readonly screen: 'welcome' | 'playing';
  readonly nearby: Nearby | null;
  readonly dialog: DemoDialog | null;
  readonly debug: boolean;
  readonly coordinates: string;
  readonly capture: 'idle' | 'requesting' | 'locked' | 'error';
  readonly captureError: string | null;
  readonly visualLoading: boolean;
  readonly visualError: string | null;
  readonly modelStats: string;
}

/** Composition root; all UI/input commands cross this facade. */
export class GameApp {
  private renderer: RenderAdapter | null = null;
  private modelAssets: AssetManager | null = null;
  private session: GameSession | null = null;
  private loop: GameLoop | null = null;
  private input: InputController | null = null;
  private unsubscribeSession: (() => void) | null = null;
  private previous: WorldSnapshot | null = null;
  private current: WorldSnapshot | null = null;
  private camera: CameraView = { yaw: 0, pitch: 0.7, distance: 15 };
  private host: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private snapshot: AppSnapshot;
  private readonly listeners = new Set<(snapshot: AppSnapshot) => void>();

  constructor(
    readonly config: ClientConfig,
    private readonly createRenderer: (assets: AssetManager) => RenderAdapter = (assets) => new ThreeRenderer(assets),
    private readonly createSession: () => GameSession = () => new LocalSession('local-player', localEntities, DEMO_BOUNDS),
  ) {
    this.snapshot = Object.freeze({
      phase: 'idle', message: null, screen: 'welcome', nearby: null, dialog: null,
      debug: config.debug, coordinates: '',
      capture: 'idle', captureError: null,
      visualLoading: false, visualError: null, modelStats: '',
    });
  }

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
      if (this.host && this.host !== host) this.releaseResources();
      this.host = host;
      if (!this.renderer) {
        this.session = this.createSession();
        this.modelAssets = new AssetManager(new HttpAssetSource(new URL(`${import.meta.env.BASE_URL}assets/models/`, window.location.href).href));
        this.renderer = this.createRenderer(this.modelAssets);
        this.renderer.mount(host);
        this.renderer.registerModels({ 'demo-tablet': 'demo/tablet.glb', 'demo-tablet-json': 'demo/tablet.gltf' });
        this.previous = this.current = this.session.getSnapshot();
        this.renderer.syncWorld(this.previous, this.current, this.session.playerId);
        this.renderer.setCamera(this.camera);
        this.unsubscribeSession = this.session.subscribe(this.onSessionEvents);
        this.input = new InputController(host, {
          canControl: () => this.canControl(),
          cameraYaw: () => this.camera.yaw,
          move: (direction) => { this.session?.send({ type: 'move', direction }); },
          interact: () => this.interact(),
          menu: () => this.toggleMenu(),
          captured: () => {
            this.patch({ capture: 'locked', captureError: null, screen: 'playing' });
            if (this.host) this.start(this.host);
            this.updateHud(true);
          },
          interrupted: () => {
            this.patch({ capture: 'idle', captureError: null });
            if (!this.snapshot.dialog && this.snapshot.screen === 'playing') this.stop();
          },
          captureFailed: (captureError) => this.patch({ capture: 'error', captureError }),
          look: (dx, dy) => {
            this.camera = { ...this.camera, yaw: this.camera.yaw - dx * 0.004, pitch: Math.max(0.5, Math.min(1.05, this.camera.pitch + dy * 0.003)) };
            this.renderer?.setCamera(this.camera);
          },
          zoom: (delta) => {
            this.camera = { ...this.camera, distance: Math.max(9, Math.min(22, this.camera.distance + delta * 0.01)) };
            this.renderer?.setCamera(this.camera);
          },
        });
        this.loop = new GameLoop({
          request: (callback) => requestAnimationFrame(callback),
          cancel: (id) => cancelAnimationFrame(id),
        }, {
          beforeUpdate: () => this.input?.sample(),
          update: (delta) => {
            this.previous = this.current;
            this.session?.update(delta);
            this.current = this.session?.getSnapshot() ?? null;
            if (this.previous && this.current) this.renderer?.syncWorld(this.previous, this.current, this.session?.playerId ?? null);
            this.updateHud();
          },
          render: (alpha, elapsed) => { this.renderer?.render(elapsed, alpha); this.updateVisualStatus(); },
          onError: () => this.fail('Не удалось обновить сцену. Попробуйте перезапустить прогулку.'),
        });
        this.loadDemoDecorations();
      }
      this.resize();
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(host);
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      window.addEventListener('resize', this.resize);
      this.setState('running');
      this.onVisibilityChange();
      this.loop?.start();
    } catch {
      this.fail();
    }
  }

  enterWorld(): void {
    if (this.snapshot.phase !== 'running') return;
    this.requestPlay();
  }

  resume(): void {
    if (this.snapshot.phase === 'stopped' && this.host) this.requestPlay();
  }

  private requestPlay(): void {
    if (!this.input || this.snapshot.capture === 'requesting') return;
    this.patch({ capture: 'requesting', captureError: null });
    this.input.requestCapture();
  }

  stop(): void {
    if (this.snapshot.phase !== 'running') return;
    this.input?.stop();
    this.patch({ capture: 'idle', captureError: null });
    this.detach();
    this.updateHud(true);
    this.setState('stopped');
  }

  toggleMenu(): void {
    if (this.snapshot.dialog) { this.closeDialog(); return; }
    if (this.snapshot.screen !== 'playing' || !this.host) return;
    if (this.snapshot.phase === 'running') this.stop();
  }

  restart(host: HTMLElement): void {
    if (this.snapshot.phase === 'disposed') throw new Error('Приложение уже завершено.');
    const screen = this.snapshot.screen;
    this.detach();
    this.releaseResources();
    this.camera = { yaw: 0, pitch: 0.7, distance: 15 };
    this.patch({ screen, dialog: null, nearby: null, coordinates: '', capture: 'idle', captureError: null });
    this.setState('idle');
    this.start(host);
    if (screen === 'playing' && this.snapshot.phase === 'running') this.requestPlay();
  }

  leaveWorld(): void {
    if (!this.host) return;
    this.patch({ screen: 'welcome', dialog: null, nearby: null });
    this.restart(this.host);
  }

  interact(): void {
    if (!this.canControl()) return;
    this.updateHud(true);
    if (this.snapshot.nearby) this.send({ type: 'interact', targetId: this.snapshot.nearby.id });
  }

  closeDialog(): void {
    this.input?.stop();
    this.patch({ dialog: null });
    this.stop();
  }

  submitDialog(text: string): void {
    if (this.snapshot.dialog && text.trim()) this.patch({ dialog: answerDemoDialog(this.snapshot.dialog, text) });
  }

  setDebug(debug: boolean): void {
    this.patch({ debug });
    this.updateHud(true);
  }

  retryVisuals(): void {
    this.renderer?.retryFailedModels();
    if (this.current) this.renderer?.syncWorld(this.current, this.current, this.session?.playerId ?? null);
    this.loadDemoDecorations();
  }

  private loadDemoDecorations(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    for (const [id, x] of [['demo-west', -2], ['demo-east', 2]] as const) {
      void renderer.loadChunk({ id, objects: [{ id: `${id}-tablet`, assetId: 'demo-tablet', transform: { position: { x, y: 0, z: 2.3 }, rotationY: x < 0 ? 0.4 : -0.4 }, animation: 'idle' }] }).catch(() => { if (this.renderer === renderer) this.updateVisualStatus(); });
    }
  }

  private updateVisualStatus(): void {
    const diagnostics = this.renderer?.getDiagnostics();
    if (!diagnostics) return;
    const visualLoading = diagnostics.pending > 0;
    const visualError = diagnostics.errors.length ? 'Не удалось загрузить часть оформления. Откройте меню, чтобы повторить загрузку.' : null;
    const modelStats = `Модели: ${diagnostics.models} · Экземпляры: ${diagnostics.instances}`;
    if (visualLoading !== this.snapshot.visualLoading || visualError !== this.snapshot.visualError || (this.snapshot.debug && modelStats !== this.snapshot.modelStats)) {
      this.patch({ visualLoading, visualError, modelStats });
    }
  }

  dispose(): void {
    if (this.snapshot.phase === 'disposed') return;
    this.detach();
    this.releaseResources();
    this.setState('disposed');
    this.listeners.clear();
  }

  getWorldSnapshot(): WorldSnapshot | null { return this.session?.getSnapshot() ?? null; }

  send(command: GameCommand): boolean {
    if (this.snapshot.phase !== 'running' || !this.session) return false;
    this.session.send(command);
    return true;
  }

  private canControl(): boolean {
    return this.snapshot.phase === 'running' && this.snapshot.screen === 'playing' && this.snapshot.capture === 'locked' && !this.snapshot.dialog;
  }

  private readonly onSessionEvents = (events: readonly WorldEvent[]): void => {
    for (const event of events) {
      if (event.type !== 'interacted' || event.actorId !== this.session?.playerId) continue;
      const dialog = openDemoDialog(event.targetId);
      if (dialog) { this.input?.stop(); this.patch({ dialog, capture: 'idle', captureError: null }); }
    }
  };

  private updateHud(force = false): void {
    if (!this.current || this.snapshot.screen !== 'playing') return;
    const player = this.current.entities.find((entity) => entity.id === this.session?.playerId)?.transform?.position;
    if (!player) return;
    let nearby: Nearby | null = null;
    let distance = Infinity;
    for (const entity of this.current.entities) {
      if (!entity.interactable || !entity.transform || entity.character?.kind !== 'npc') continue;
      const p = entity.transform.position;
      const candidate = Math.hypot(player.x - p.x, player.y - p.y, player.z - p.z);
      if (candidate <= entity.interactable.radius && candidate < distance) {
        nearby = { id: entity.id, name: entity.character.name };
        distance = candidate;
      }
    }
    const changes: Partial<AppSnapshot> = {};
    if (nearby?.id !== this.snapshot.nearby?.id) Object.assign(changes, { nearby });
    if (this.snapshot.debug && (force || this.current.tick % 6 === 0)) {
      const coordinates = 'X ' + player.x.toFixed(1) + ' · Z ' + player.z.toFixed(1);
      if (coordinates !== this.snapshot.coordinates) Object.assign(changes, { coordinates });
    }
    if (Object.keys(changes).length > 0) this.patch(changes);
  }

  private patch(changes: Partial<AppSnapshot>): void {
    this.snapshot = Object.freeze({ ...this.snapshot, ...changes });
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private setState(phase: AppSnapshot['phase'], message: string | null = null): void {
    this.patch({ phase, message, ...(['disposed', 'error', 'unavailable'].includes(phase) ? { capture: 'idle' as const, captureError: null } : {}) });
  }

  private readonly resize = (): void => {
    if (!this.host) return;
    const { width, height } = this.host.getBoundingClientRect();
    this.renderer?.resize(Math.max(1, width), Math.max(1, height), Math.min(window.devicePixelRatio || 1, 2));
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.input?.reset();
    this.loop?.setSuspended(document.hidden);
  };

  private detach(): void {
    this.loop?.stop();
    this.observer?.disconnect();
    this.observer = null;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('resize', this.resize);
  }

  private releaseResources(): void {
    this.loop?.dispose();
    this.loop = null;
    this.input?.dispose();
    this.input = null;
    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    this.session?.dispose();
    this.session = null;
    this.previous = this.current = null;
    this.renderer?.dispose();
    this.modelAssets?.dispose();
    this.modelAssets = null;
    this.renderer = null;
    this.host = null;
  }

  private fail(message = 'Не удалось открыть 3D-сцену. Проверьте поддержку WebGL 2 и аппаратное ускорение браузера.'): void {
    this.detach();
    this.releaseResources();
    this.setState('error', message);
  }
}
