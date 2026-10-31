import type { CameraView, RenderAdapter } from '../render/RenderAdapter';
import { ThreeRenderer } from '../render/three/ThreeRenderer';
import type { Entity, GameCommand, WorldEvent, WorldSnapshot } from '../core/types';
import type { GameSession } from '../session/GameSession';
import { BabylonClient } from '../multiplayer/BabylonClient';
import type { BabylonView } from '../multiplayer/BabylonClient';
import type { BabylonAction } from '../../../shared/babylon/types.ts';
import { MARKET_GOATS } from '../session/MarketSession';
import { MarketSession } from '../session/MarketSession';
import type { MarketState, MarketItem, Stone } from '../session/MarketSession';
import { MARKET_WORLD } from '../shared/marketWorld.generated';
import { surfaceHeight } from '../../../shared/map/manifest.ts';
import { LocalSession } from '../session/LocalSession';
import { answerDemoDialog, openDemoDialog } from '../session/demoDialogue';
import type { DemoDialog } from '../session/demoDialogue';
import { InputController } from '../input/InputController';
import { DEMO_NPCS, DEMO_SPAWN } from '../shared/demo';
import { GameLoop } from './GameLoop';
import { parseConfig } from './config';
import type { ClientConfig } from './config';
import { AssetManager, HttpAssetSource } from '../map/AssetManager';
import { WorldBudget } from '../map/WorldBudget';
import { HttpMapSource } from '../map/HttpMapSource';
import { ChunkManager } from '../map/ChunkManager';
import type { MapSource } from '../map/types';
import { DEMO_WORLD, SCIENCE_WORLD } from '../shared/demoWorld.generated';
import { OnlineSession } from '../session/OnlineSession';
import type { OnlineNotice } from '../session/OnlineSession';
import { SocketIOAdapter } from '../multiplayer/SocketIOAdapter';
import { createMockDemo } from '../multiplayer/mockDemo';
import { MockNetworkAdapter } from '../multiplayer/MockNetworkAdapter';
import type { Clock, NetworkAdapter } from '../multiplayer/NetworkAdapter';
import type { ConnectionStatus, ServerSession, WorldDescriptor } from '../../../shared/protocol/types.ts';
import { parseServerSession } from '../../../shared/protocol/validate.ts';
import { guestName, requestGuestSession } from '../multiplayer/GuestAuth';
import { FrameMetrics } from './FrameMetrics';

const browserClock: Clock = { now: () => Date.now(), set: (callback, ms) => window.setTimeout(callback, ms), clear: (id) => window.clearTimeout(id) };
export type BabylonPanel = 'setup' | 'languages' | 'intro' | 'task' | 'inventory' | 'stone' | 'words' | 'interaction' | 'chat';
export type { BabylonView };
export type MarketPanel = 'intro' | 'task' | 'inventory' | 'stone' | 'words' | 'interaction' | 'results';
export type ClientMode = 'local' | 'mock' | 'online';

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
  readonly babylon: BabylonView | null;
  readonly babylonPanel: BabylonPanel | null;
  readonly babylonTarget: string | null;
  readonly babylonWord: string;
  readonly phase: 'idle' | 'running' | 'stopped' | 'unavailable' | 'error' | 'disposed';
  readonly message: string | null;
  readonly screen: 'welcome' | 'playing';
  readonly nearby: Nearby | null;
  readonly dialog: DemoDialog | null;
  readonly debug: boolean;
  readonly buildingSymbols: boolean;
  readonly coordinates: string;
  readonly capture: 'idle' | 'requesting' | 'locked' | 'error';
  readonly captureError: string | null;
  readonly visualLoading: boolean;
  readonly visualError: string | null;
  readonly modelStats: string;
  readonly worldReady: boolean;
  readonly worldWaiting: boolean;
  readonly region: string;
  readonly cacheStats: string;
  readonly chunkRadius: number;
  readonly mode: ClientMode;
  readonly mapId: string;
  readonly settingsOpen: boolean;
  readonly settingsError: string | null;
  readonly authRequired: boolean;
  readonly authPending: boolean;
  readonly authError: string | null;
  readonly authName: string;
  readonly networkStatus: ConnectionStatus;
  readonly networkError: string | null;
  readonly chatOpen: boolean;
  readonly chatMessages: readonly { readonly id: string; readonly name: string; readonly text: string }[];
  readonly chatError: string | null;
  readonly dialogPending: boolean;
  readonly dialogError: string | null;
  readonly market: MarketState | null;
  readonly marketPanel: MarketPanel | null;
  readonly marketTarget: string | null;
  readonly performance: string;
  readonly renderStats: string;
  readonly stamina: number;
  readonly sprintBlocked: boolean;
}

/** Composition root; all UI/input commands cross this facade. */
export class GameApp {
  private babylonClient: BabylonClient | null = null;
  private renderer: RenderAdapter | null = null;
  private modelAssets: AssetManager | null = null;
  private world: ChunkManager | null = null;
  private worldBudget = new WorldBudget();
  private activeBootstrap: WorldDescriptor | null = null;
  private waitingBudget = false;
  private generation = 0;
  private mock = false;
  private serverSession: ServerSession | null = null;
  private authRequest: AbortController | null = null;
  private authTimer: number | null = null;
  private network: NetworkAdapter | null = null;
  private unsubscribeOnline: (() => void) | null = null;
  private npcRequest: string | null = null;
  private readonly frameMetrics = new FrameMetrics();
  private lastMetrics = 0;
  private worldStarting = false;
  private worldFailure: string | null = null;
  private waitingForWorld = false;
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
    public config: ClientConfig,
    private readonly createRenderer: (assets: AssetManager) => RenderAdapter = (assets) => new ThreeRenderer(assets, false, this.config.mapId === 'market'),
    private readonly createSession: () => GameSession = () => this.config.mapId === 'market' ? new MarketSession() : new LocalSession('local-player', localEntities),
    private readonly createMap: ((budget: WorldBudget) => MapSource) | null | undefined = undefined,
    private readonly createNetwork: (mock: boolean, url: string, clock: Clock) => NetworkAdapter = (mock, url, clock) => mock ? createMockDemo(clock) : new SocketIOAdapter(url, clock),
    private readonly requestLogin = requestGuestSession,
  ) {
    if (config.mapId === 'market') this.camera = { yaw: 0, pitch: .5, distance: 18 };
    this.snapshot = Object.freeze({
      phase: 'idle', message: null, screen: 'welcome', nearby: null, dialog: null,
      babylon: null, babylonPanel: null, babylonTarget: null, babylonWord: '',
      debug: config.debug, buildingSymbols: true, coordinates: '',
      capture: 'idle', captureError: null,
      visualLoading: false, visualError: null, modelStats: '',
      worldReady: createMap === null, worldWaiting: false, region: 'Площадь открытий', cacheStats: '', chunkRadius: config.chunkRadius ?? (config.mapId === 'market' ? 2 : 1),
      authRequired: config.session === 'online', authPending: false, authError: null, authName: '',
      mapId: config.mapId, mode: config.session, settingsOpen: false, settingsError: null, networkStatus: 'unauthorized', networkError: null,
      chatOpen: false, chatMessages: [], chatError: null, dialogPending: false, dialogError: null,
      performance: '', renderStats: '', market: null, marketPanel: null, marketTarget: null, stamina: 100, sprintBlocked: false,
    });
  }

  private presentCamera(): void {
    const courtyard = this.snapshot.region === 'Двор Вавилонской башни';
    this.renderer?.setCamera(courtyard ? { ...this.camera, distance: this.camera.distance + 9, focusHeight: 4.5, fieldOfView: 60 } : this.camera);
  }

  setBuildingSymbols(visible: boolean): void { this.renderer?.setBuildingSymbols(visible); this.patch({ buildingSymbols: visible }); }

  subscribe(listener: (snapshot: AppSnapshot) => void): () => void {
    if (this.snapshot.phase === 'disposed') return () => {};
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => { this.listeners.delete(listener); };
  }

  start(host: HTMLElement): void {
    if (this.snapshot.phase === 'disposed') throw new Error('Приложение уже завершено.');
    if (this.snapshot.phase === 'running' && this.renderer) return;
    try {
      if (this.host && this.host !== host) this.releaseResources();
      this.host = host;
      if (this.config.session === 'online' && !this.session) {
        if (!this.mock && (!this.serverSession || this.serverSession.expiresAt <= browserClock.now())) {
          this.serverSession = null; this.patch({ authRequired: true, worldReady: false }); this.setState('idle'); return;
        }
        if (!this.mock && this.config.mapId === 'market' && this.serverSession) {
          if (!this.babylonClient) { this.startBabylon(); return; }
          if (!this.snapshot.babylon?.state?.profile) return;
        }
        this.network = this.createNetwork(this.mock, this.config.serverUrl, browserClock);
        const online = new OnlineSession(this.network, this.config.mapId, browserClock);
        this.session = online;
        online.setMovementGuard(() => false);
        this.unsubscribeSession = online.subscribe(this.onSessionEvents);
        this.unsubscribeOnline = online.subscribeNotices(this.onOnlineNotice);
        online.connect(this.mock ? { kind: 'mock' } : this.serverSession ? { kind: 'server', session: this.serverSession } : undefined);
        return;
      }
      if (this.config.session === 'online' && !this.activeBootstrap) return;
      if (!this.activeBootstrap) {
        if (!['demo', 'science', 'market'].includes(this.config.mapId)) throw new Error('Unknown local map');
        this.activeBootstrap = this.config.mapId === 'market' ? MARKET_WORLD : this.config.mapId === 'science' ? SCIENCE_WORLD : DEMO_WORLD;
      }
      if (!this.renderer && this.worldBudget.stats.resources > 0) {
        if (!this.waitingBudget) {
          this.waitingBudget = true;
          const generation = this.generation;
          void this.worldBudget.whenEmpty().then(() => { if (this.generation === generation) { this.waitingBudget = false; this.start(host); } });
        }
        return;
      }
      if (!this.renderer) {
        this.session ??= this.createSession();
        if (this.session instanceof MarketSession) this.patch({ market: this.session.market, marketPanel: 'intro' });
        this.worldBudget = new WorldBudget();
        const origin = this.worldRoot();
        const sizes = new Map(Object.entries(this.activeBootstrap.assets).map(([path, size]) => [new URL(path, origin).href, size]));
        this.modelAssets = new AssetManager(new HttpAssetSource(new URL('assets/models/', origin).href, this.httpAccess()), this.createMap !== null ? this.worldBudget : undefined, (url) => sizes.get(url));
        this.renderer = this.createRenderer(this.modelAssets);
        this.renderer.mount(host);
        this.renderer.setBuildingSymbols(this.snapshot.buildingSymbols);
        if (this.config.session === 'local' || this.mock) this.renderer.registerModels({ 'demo-tablet': 'demo/tablet.glb', 'demo-tablet-json': 'demo/tablet.gltf' });
        this.previous = this.current = this.session.getSnapshot();
        this.renderer.syncWorld(this.previous, this.current, this.session.playerId);
        this.presentCamera();
        this.unsubscribeSession ??= this.session.subscribe(this.onSessionEvents);
        if (this.createMap !== null) {
          this.world = new ChunkManager(this.createMap?.(this.worldBudget) ?? new HttpMapSource(this.activeBootstrap, this.worldBudget, origin.href, this.httpAccess()), this.renderer);
          this.world.setRadius(this.snapshot.chunkRadius);
          this.session.setMovementGuard((position) => {
            this.waitingForWorld = !this.world?.isPrepared(position);
            return this.world?.canWalk(position) ?? false;
          }, (from, to) => this.world?.canTraverse(from, to) ?? false);
          this.startWorld();
        }
        this.input = new InputController(host, {
          canControl: () => this.canControl(),
          cameraYaw: () => this.camera.yaw,
          move: (direction) => { this.session?.send({ type: 'move', direction }); },
          sprint: (held) => { this.session?.send({ type: 'sprint', held }); },
          jump: () => { this.session?.send({ type: 'jump' }); },
          clearInput: () => { this.session?.send({ type: 'clear-input' }); },
          interact: () => this.interact(),
          menu: () => this.toggleMenu(),
          captured: () => {
            if (this.session instanceof MarketSession) this.session.beginTour();
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
            this.camera = { ...this.camera, yaw: this.camera.yaw - dx * 0.004, pitch: Math.max(this.config.mapId === 'market' ? .15 : .5, Math.min(1.05, this.camera.pitch + dy * 0.003)) };
            this.presentCamera();
          },
          zoom: (delta) => {
            this.camera = { ...this.camera, distance: Math.max(3.5, Math.min(22, this.camera.distance + delta * 0.01)) };
            this.presentCamera();
          },
        });
        this.loop = new GameLoop({
          request: (callback) => requestAnimationFrame(callback),
          cancel: (id) => cancelAnimationFrame(id),
        }, {
          beforeUpdate: () => this.input?.sample(),
          update: (delta) => {
            if (this.snapshot.phase !== 'running') return;
            if (this.world && !this.world.manifest) return;
            const localPosition = this.current?.entities.find(entity => entity.id === this.session?.playerId)?.transform?.position;
            if (this.world && this.session instanceof LocalSession && localPosition && !this.world.isPrepared(localPosition)) return;
            this.previous = this.current;
            if (this.session instanceof OnlineSession) this.session.setPreparedChunks(this.world?.preparedChunks ?? []);
            this.session?.update(delta);
            this.current = this.session?.getSnapshot() ?? null;
            if (this.previous && this.current) this.renderer?.syncWorld(this.previous, this.current, this.session?.playerId ?? null);
            this.updateHud();
            const player = this.current?.entities.find((entity) => entity.id === this.session?.playerId)?.transform?.position;
            if (player) this.world?.plan(player);
          },
          render: (alpha, elapsed) => {
            const began = this.snapshot.debug ? performance.now() : 0;
            if (this.session instanceof OnlineSession) {
              const presentation = this.session.getRenderState();
              this.renderer?.syncWorld(presentation.previous, presentation.current, this.session.playerId);
              this.renderer?.render(elapsed, presentation.alpha);
            } else this.renderer?.render(elapsed, alpha);
            this.updateVisualStatus();
            if (this.snapshot.debug) this.updateMetrics(began);
            if (this.snapshot.phase === 'stopped' && !this.world?.stats.loading && !this.renderer?.getDiagnostics().pending) this.loop?.stop();
          },
          onError: () => this.fail('Не удалось обновить сцену. Попробуйте перезапустить прогулку.'),
        });
        if ((this.config.session === 'local' || this.mock) && this.config.mapId !== 'market') this.loadDemoDecorations();
      }
      this.resize();
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(host);
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      window.addEventListener('resize', this.resize);
      this.setState('running');
      this.frameMetrics.reset(); this.lastMetrics = performance.now();
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
    if (!this.input || this.snapshot.capture === 'requesting' || !this.snapshot.worldReady || this.snapshot.babylonPanel) return;
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
    if (this.world?.stats.loading || this.renderer?.getDiagnostics().pending) this.loop?.start();
  }

  toggleMenu(): void {
    if (this.snapshot.babylonPanel) { void this.closeBabylonPanel(); return; }
    if (this.snapshot.marketPanel) { this.closeMarketPanel(); return; }
    if (this.snapshot.dialog) { this.closeDialog(); return; }
    if (this.snapshot.screen !== 'playing' || !this.host) return;
    if (this.snapshot.phase === 'running') this.stop();
  }

  restart(host: HTMLElement): void {
    this.cancelLogin();
    if (this.snapshot.phase === 'disposed') throw new Error('Приложение уже завершено.');
    const screen = 'welcome';
    this.detach();
    this.releaseResources();
    this.camera = { yaw: 0, pitch: this.config.mapId === 'market' ? .5 : .7, distance: this.config.mapId === 'market' ? 18 : 15 };
    this.patch({ screen, dialog: null, nearby: null, coordinates: '', capture: 'idle', captureError: null, worldReady: this.createMap === null, chatOpen: false, chatMessages: [], chatError: null, dialogPending: false, dialogError: null, market: null, marketPanel: null, marketTarget: null });
    this.setState('idle');
    this.start(host);
  }

  leaveWorld(): void {
    if (!this.host) return;
    this.patch({ screen: 'welcome', dialog: null, nearby: null });
    this.restart(this.host);
  }

  interact(): void {
    if (!this.canControl()) return;
    this.updateHud(true);
    if (this.snapshot.nearby && this.snapshot.babylon?.state?.profile) { this.openBabylonPanel('interaction', this.snapshot.nearby.id); return; }
    if (this.snapshot.nearby) this.send({ type: 'interact', targetId: this.snapshot.nearby.id });
  }

  closeDialog(): void {
    this.input?.stop();
    this.npcRequest = null;
    this.patch({ dialog: null, dialogPending: false, dialogError: null });
    this.stop();
  }

  submitDialog(text: string): void {
    const dialog = this.snapshot.dialog;
    if (!dialog || !text.trim() || this.snapshot.dialogPending) return;
    if (this.session instanceof OnlineSession) {
      this.npcRequest = this.session.askNpc(dialog.npcId, text);
      if (this.npcRequest) this.patch({ dialog: { ...dialog, messages: [...dialog.messages.slice(-18), { author: 'player', text: text.trim() }] }, dialogPending: true, dialogError: null });
    } else this.patch({ dialog: answerDemoDialog(dialog, text) });
  }

  setDebug(debug: boolean): void {
    this.frameMetrics.reset(); this.lastMetrics = performance.now();
    this.config = Object.freeze({ ...this.config, debug });
    this.patch({ debug });
    this.updateHud(true);
  }

  retryVisuals(): void {
    this.renderer?.retryFailedModels();
    if (this.current) this.renderer?.syncWorld(this.current, this.current, this.session?.playerId ?? null);
    if ((this.config.session === 'local' || this.mock) && this.config.mapId !== 'market') this.loadDemoDecorations();
    if (this.world?.manifest) this.world.retry(); else this.startWorld();
    // The same frame loop drains asynchronous model work while simulation stays paused.
    if (this.snapshot.phase === 'stopped') this.loop?.start();
    this.updateVisualStatus();
  }

  setChunkRadius(radius: number): void {
    if (!Number.isSafeInteger(radius) || radius < 0 || radius > 2) throw new Error('Invalid radius');
    this.world?.setRadius(radius); this.config = Object.freeze({ ...this.config, chunkRadius: radius }); this.patch({ chunkRadius: radius });
  }

  openSettings(): void { this.input?.stop(); this.stop(); this.patch({ settingsOpen: true, settingsError: null }); }
  closeSettings(): void { this.patch({ settingsOpen: false }); if (this.snapshot.screen === 'welcome' && this.host) this.start(this.host); }
  applySettings(mode: ClientMode, serverUrl: string, mapId: string, chunkRadius: number, debug: boolean): boolean {
    try {
      const config = parseConfig({ session: mode === 'local' ? 'local' : 'online', serverUrl, mapId, chunkRadius, debug }, window.location.origin);
      if ((mode === 'local' || mode === 'mock') && !['demo', 'science', 'market'].includes(mapId)) throw new Error('Для локальной прогулки доступны market, demo и science.');
      if (mode === 'mock' && mapId === 'market') throw new Error('Рынок пока доступен в локальной прогулке. Тестовая сеть использует demo или science.');
      this.cancelLogin(); this.stopBabylon();
      if (config.serverUrl !== this.config.serverUrl || mode !== 'online') { this.serverSession = null; this.patch({ authName: '' }); }
      this.mock = mode === 'mock'; this.config = config;
      this.patch({ authRequired: mode === 'online' && !this.serverSession, authPending: false, authError: null, mapId: config.mapId, mode, debug, chunkRadius, settingsOpen: false, settingsError: null, networkError: null, networkStatus: 'unauthorized' });
      if (this.host) this.restart(this.host);
      return true;
    } catch (error) { this.patch({ settingsError: error instanceof Error ? error.message : 'Некорректные настройки.' }); return false; }
  }

  async login(rawName: string): Promise<void> {
    if (this.snapshot.phase === 'disposed' || this.snapshot.mode !== 'online' || !this.snapshot.authRequired || this.authRequest) return;
    let name: string;
    try { name = guestName(rawName); }
    catch (error) { this.patch({ authError: (error as Error).message }); return; }
    const request = new AbortController(); this.authRequest = request;
    this.patch({ authPending: true, authError: null, authName: name });
    this.authTimer = window.setTimeout(() => {
      if (this.authRequest !== request) return;
      this.cancelLogin(); this.patch({ authError: 'Сервер не ответил за 10 секунд. Попробуйте войти снова.' });
    }, 10000);
    try {
      const session = await this.requestLogin(this.config.serverUrl, name, request.signal);
      if (this.authRequest !== request) return;
      this.provideServerSession(session);
    } catch (error) {
      if (this.authRequest === request) this.patch({ authError: error instanceof Error ? error.message : 'Не удалось войти. Попробуйте снова.' });
    } finally { if (this.authRequest === request) this.cancelLogin(); }
  }
  private cancelLogin(): void {
    const request = this.authRequest; this.authRequest = null;
    if (this.authTimer !== null) window.clearTimeout(this.authTimer);
    this.authTimer = null; request?.abort();
    if (this.snapshot.authPending) this.patch({ authPending: false });
  }

  /** Integration boundary: only the local server's login flow supplies this context. */
  provideServerSession(raw: unknown): void {
    const session = parseServerSession(raw, browserClock.now());
    this.cancelLogin();
    this.stopBabylon();
    this.serverSession = session; this.mock = false; this.config = Object.freeze({ ...this.config, session: 'online' });
    this.patch({ authRequired: false, authPending: false, authError: null, mode: 'online', networkError: null, networkStatus: 'unauthorized' });
    if (this.host) this.restart(this.host);
  }
  logout(): void {
    this.cancelLogin(); this.stopBabylon(); this.serverSession = null;
    this.patch({ authRequired: this.snapshot.mode === 'online', authError: null, authName: '', networkError: null, networkStatus: 'unauthorized' });
    if (this.mock) { this.mock = false; this.config = Object.freeze({ ...this.config, session: 'local' }); this.patch({ mode: 'local' }); }
    if (this.host) this.restart(this.host);
  }
  reconnect(): void { if (this.session instanceof OnlineSession) { this.patch({ networkError: null }); this.session.reconnect(); } }
  simulateNetworkLoss(): void { if (this.network instanceof MockNetworkAdapter) this.network.drop(); }
  openChat(): void {
    if (this.snapshot.babylon?.state?.profile) { this.openBabylonPanel('chat'); return; }
    this.input?.stop(); this.stop();
    this.patch({ chatOpen: true, chatError: this.session instanceof OnlineSession ? null : 'Общение игроков доступно в сетевом или тестовом режиме.' });
  }
  closeChat(): void { this.patch({ chatOpen: false }); }
  sendChat(text: string): boolean {
    if (!(this.session instanceof OnlineSession)) return false;
    const requestId = this.session.chat(text);
    if (requestId) this.patch({ chatError: null });
    return requestId !== null;
  }
  private worldRoot(): URL { return this.config.session === 'online' && !this.mock ? new URL(`${this.config.serverUrl.replace(/\/$/, '')}/world/`) : new URL(import.meta.env.BASE_URL, window.location.href); }
  private httpAccess() {
    const session = this.serverSession;
    return this.config.session === 'online' && !this.mock ? {
      token: () => session && session === this.serverSession && session.expiresAt > browserClock.now() ? session.token : null,
      unauthorized: () => { if (session === this.serverSession) this.expireServerSession(); },
    } : undefined;
  }
  private expireServerSession(message = 'Серверная сессия истекла или отклонена. Войдите снова.'): void {
    const host = this.host;
    this.cancelLogin(); this.stopBabylon(); this.serverSession = null;
    this.detach(); this.releaseResources();
    this.host = host;
    this.patch({ authRequired: true, authPending: false, authError: message, screen: 'welcome', worldReady: false, dialog: null, chatOpen: false, chatMessages: [], dialogPending: false, dialogError: null, networkStatus: 'unauthorized', networkError: null });
    this.setState('idle');
  }
  private readonly onOnlineNotice = (notice: OnlineNotice): void => {
    if (notice.type === 'status') {
      this.patch({ networkStatus: notice.state.status, networkError: notice.state.error });
      if (notice.state.status !== 'connected') {
        this.input?.stop(); this.stop(); this.patch({ worldReady: false });
        if (notice.state.status === 'unauthorized' && notice.state.error && !this.mock) this.expireServerSession(notice.state.error);
      }
    } else if (notice.type === 'joined') {
      const host = this.host;
      this.detach(); this.releaseScene();
      this.activeBootstrap = notice.world;
      this.patch({ screen: 'welcome', worldReady: false, capture: 'idle', captureError: null, dialog: null, chatOpen: false });
      this.setState('idle'); if (host) this.start(host);
    } else if (notice.type === 'chat') {
      this.patch({ chatMessages: [...this.snapshot.chatMessages.slice(-49), { id: notice.message.messageId, name: notice.message.name, text: notice.message.text }] });
    } else if (notice.type === 'npc') {
      const dialog = this.snapshot.dialog;
      if (dialog?.npcId === notice.targetId && this.npcRequest === notice.requestId) {
        this.npcRequest = null;
        this.patch({ dialog: { ...dialog, messages: [...dialog.messages.slice(-19), { author: 'npc', text: notice.text }] }, dialogPending: false, dialogError: null });
      }
    } else if (notice.type === 'request-error') {
      if (this.npcRequest === notice.requestId) { this.npcRequest = null; this.patch({ dialogPending: false, dialogError: notice.message }); }
      else if (this.snapshot.chatOpen) this.patch({ chatError: notice.message });
      else this.patch({ networkError: notice.message });
    }
  };

  private startWorld(): void {
    const world = this.world;
    if (!world || this.worldStarting) return;
    this.worldStarting = true;
    this.worldFailure = null;
    const position = this.session instanceof OnlineSession ? this.session.getSnapshot().entities.find((entity) => entity.id === this.session?.playerId)?.transform?.position : undefined;
    void world.start(position, (manifest) => {
      if (manifest.mapId !== this.config.mapId) throw new Error('Map ID mismatch');
      this.renderer?.registerModels(manifest.models);
      if (this.session instanceof LocalSession) {
        this.session.initializeSpawn(manifest.spawn);
        this.session.setSurfaceHeight((x, z) => surfaceHeight(manifest.heightSurfaces, x, z));
        this.session.setCeilings(manifest.ceilingVolumes ?? [], (from, to) => world.ceilingsFor(from, to));
      }
    }).catch((error: unknown) => {
      if (this.world === world) this.worldFailure = error instanceof Error ? error.message : 'World load failed';
    }).finally(() => { if (this.world === world) { this.worldStarting = false; this.updateVisualStatus(); } });
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
    const worldStats = this.world?.stats;
    const visualError = this.worldFailure || worldStats?.errors.length ? 'Не удалось загрузить участок мира. Повторите загрузку в меню.' : diagnostics.errors.length ? 'Не удалось загрузить часть оформления. Откройте меню, чтобы повторить загрузку.' : null;
    const modelStats = `Модели: ${diagnostics.models} · Экземпляры: ${diagnostics.instances}`;
    const position = this.current?.entities.find((entity) => entity.id === this.session?.playerId)?.transform?.position;
    const worldReady = (this.world ? Boolean(position && this.world.isPrepared(position)) : this.createMap === null) && (!(this.session instanceof OnlineSession) || this.session.state.status === 'connected');
    const worldWaiting = this.waitingForWorld && Boolean(worldStats?.loading || worldStats?.deferred);
    const region = position ? this.world?.region(position) || 'Площадь открытий' : 'Площадь открытий';
    const budget = this.worldBudget.stats;
    const cacheStats = `${budget.memory} / ${budget.memoryLimit} байт памяти · Чанки: ${worldStats?.ready ?? 0} · Ожидание: ${worldStats?.loading ?? 0} · Отложено: ${worldStats?.deferred ?? 0}${worldStats?.deferred ? ' (защита памяти)' : ''}`;
    if (visualLoading !== this.snapshot.visualLoading || visualError !== this.snapshot.visualError || worldReady !== this.snapshot.worldReady || worldWaiting !== this.snapshot.worldWaiting || region !== this.snapshot.region || (this.snapshot.debug && (modelStats !== this.snapshot.modelStats || cacheStats !== this.snapshot.cacheStats))) {
      this.patch({ visualLoading, visualError, modelStats, worldReady, worldWaiting, region, cacheStats });
      this.presentCamera();
    }
  }

  private updateMetrics(began: number): void {
    const now = performance.now();
    this.frameMetrics.record(began, now - began);
    if (now - this.lastMetrics < 1000) return;
    this.lastMetrics = now;
    const stats = this.frameMetrics.stats; const render = this.renderer?.getDiagnostics(); const budget = this.worldBudget.stats;
    this.patch({ performance: `FPS ${stats.fps.toFixed(1)} · Кадр ${stats.frameMs.toFixed(1)} ms · P95 ${stats.p95.toFixed(1)} ms · CPU ${stats.renderMs.toFixed(1)} ms`,
      renderStats: `Draw ${render?.drawCalls ?? 0} · Геометрии ${render?.geometries ?? 0} · Текстуры ${render?.textures ?? 0} · Ресурсы ${budget.resources} · Память ${budget.memory} / ${budget.memoryLimit} · Пик ${budget.peakBytes}` });
  }

  dispose(): void {
    if (this.snapshot.phase === 'disposed') return;
    this.cancelLogin(); this.stopBabylon(); this.serverSession = null;
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
    return this.snapshot.phase === 'running' && this.snapshot.screen === 'playing' && this.snapshot.capture === 'locked' && this.snapshot.worldReady && !this.snapshot.dialog && !this.snapshot.chatOpen && !this.snapshot.settingsOpen && !this.snapshot.marketPanel && !this.snapshot.babylonPanel;
  }

  private readonly onSessionEvents = (events: readonly WorldEvent[]): void => {
    for (const event of events) {
      if (event.type !== 'interacted' || event.actorId !== this.session?.playerId) continue;
      if (this.session instanceof MarketSession) { this.openMarketPanel('interaction', event.targetId); continue; }
      const target = this.session?.getSnapshot().entities.find((entity) => entity.id === event.targetId);
      const dialog: DemoDialog | null = this.session instanceof OnlineSession
        ? target?.character?.kind === 'npc' ? { source: this.mock ? 'mock' : 'server', npcId: target.id, name: target.character.name, topic: target.interactable?.label ?? 'Разговор', questions: [], messages: [] } : null
        : openDemoDialog(event.targetId);
      if (dialog) { this.input?.stop(); this.patch({ dialog, capture: 'idle', captureError: null }); }
    }
  };

  openMarketPanel(panel: MarketPanel, target: string | null = null): void {
    if (!(this.session instanceof MarketSession)) return;
    this.input?.stop(); this.stop();
    this.patch({ marketPanel: panel, marketTarget: target, market: this.session.market });
  }
  closeMarketPanel(): void {
    this.patch({ marketPanel: null, marketTarget: null });
    if (this.snapshot.screen === 'welcome' && this.host) this.start(this.host);
  }
  marketBuy(id: MarketItem): void {
    if (!(this.session instanceof MarketSession) || !this.snapshot.marketTarget) return;
    this.session.buy(this.snapshot.marketTarget, id); this.patch({ market: this.session.market });
  }
  marketSelect(id: MarketItem): void { if (this.session instanceof MarketSession) { this.session.select(id); this.patch({ market: this.session.market }); } }
  marketFeed(): void {
    if (!(this.session instanceof MarketSession) || !this.snapshot.marketTarget) return;
    this.session.feed(this.snapshot.marketTarget);
    this.patch({ market: this.session.market, ...(this.session.market.completed ? { marketPanel: 'results' as const } : {}) });
  }
  marketCarve(stone: Stone): boolean {
    if (!(this.session instanceof MarketSession)) return false;
    const result = this.session.carve(stone); this.patch({ market: this.session.market }); return result;
  }
  marketSaveWord(word: string, translation: string, note: string, id?: number): boolean {
    if (!(this.session instanceof MarketSession)) return false;
    const result = this.session.saveWord(word, translation, note, id); this.patch({ market: this.session.market }); return result;
  }
  marketRemoveWord(id: number): void { if (this.session instanceof MarketSession) { this.session.removeWord(id); this.patch({ market: this.session.market }); } }

  private startBabylon(): void {
    if (!this.serverSession) return;
    this.babylonClient = new BabylonClient(this.config.serverUrl, this.serverSession, view => {
      const before = this.snapshot.babylon?.state;
      let panel = this.snapshot.babylonPanel;
      if (view.state && !view.state.profile) panel = 'setup';
      else if (view.state?.profile && (!before?.profile || panel === 'setup')) panel = view.state.introSeen ? null : 'intro';
      if (view.state?.party?.completed && before?.party && !before.party.completed) { this.input?.stop(); this.stop(); panel = 'task'; }
      this.patch({ babylon: view, babylonPanel: panel });
      if (view.state?.profile && !this.session && this.host) this.start(this.host);
    }, () => this.expireServerSession('Сессия истекла. Войдите снова.'));
    this.patch({ babylonPanel: 'setup' });
    void this.babylonClient.start();
  }
  private stopBabylon(): void {
    this.babylonClient?.dispose(); this.babylonClient = null;
    this.patch({ babylon: null, babylonPanel: null, babylonTarget: null, babylonWord: '' });
  }
  openBabylonPanel(panel: BabylonPanel, target: string | null = null): void {
    if (!this.babylonClient) return;
    this.input?.stop(); this.stop(); this.patch({ babylonPanel: panel, babylonTarget: target });
  }
  async closeBabylonPanel(): Promise<void> {
    if (this.snapshot.babylonPanel === 'setup') return;
    if (this.snapshot.babylonPanel === 'intro' && !this.snapshot.babylon?.state?.introSeen) {
      if (!await this.babylonAction({ type: 'intro-seen' })) return;
    }
    this.patch({ babylonPanel: null, babylonTarget: null, babylonWord: '' });
  }
  babylonAction(action: BabylonAction, requestId?: string): Promise<boolean> { return this.babylonClient?.send(action, requestId) ?? Promise.resolve(false); }
  retryBabylon(): Promise<boolean> { return this.babylonClient?.repeat() ?? Promise.resolve(false); }
  learnWord(word: string): void {
    const clean = word.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').slice(0, 200);
    if (!clean) return;
    this.openBabylonPanel('words'); this.patch({ babylonWord: clean });
    void this.babylonAction({ type: 'suggest', word: clean });
  }

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
    if (this.snapshot.babylon?.state?.profile && this.config.mapId === 'market') for (const goat of MARKET_GOATS) {
      const candidate = Math.hypot(player.x - goat.x, player.y, player.z - goat.z);
      if (candidate <= 2.7 && candidate < distance) { nearby = { id: goat.id, name: goat.name }; distance = candidate; }
    }
    const changes: Partial<AppSnapshot> = {};
    const motion = this.current.entities.find(entity => entity.id === this.session?.playerId)?.motion;
    if (motion && (motion.stamina !== this.snapshot.stamina || motion.sprintBlocked !== this.snapshot.sprintBlocked)) Object.assign(changes, { stamina: motion.stamina, sprintBlocked: motion.sprintBlocked });
    if (nearby?.id !== this.snapshot.nearby?.id) Object.assign(changes, { nearby });
    if (this.snapshot.debug && (force || this.current.tick % 6 === 0)) {
      const coordinates = 'X ' + player.x.toFixed(1) + ' · Z ' + player.z.toFixed(1) + ' · Y ' + player.y.toFixed(1);
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
    this.frameMetrics.reset();
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
    this.generation++;
    this.waitingBudget = false;
    this.releaseScene();
    this.unsubscribeOnline?.(); this.unsubscribeOnline = null;
    this.unsubscribeSession?.(); this.unsubscribeSession = null;
    this.session?.dispose(); this.session = null;
    this.network = null; this.activeBootstrap = null; this.npcRequest = null;
    this.host = null;
  }

  private releaseScene(): void {
    this.loop?.dispose();
    this.loop = null;
    this.input?.dispose();
    this.input = null;
    this.world?.dispose();
    this.world = null;
    this.worldStarting = false;
    this.worldFailure = null;
    this.waitingForWorld = false;
    this.previous = this.current = null;
    this.renderer?.dispose();
    this.modelAssets?.dispose();
    this.modelAssets = null;
    this.renderer = null;
  }

  private fail(message = 'Не удалось открыть 3D-сцену. Проверьте поддержку WebGL 2 и аппаратное ускорение браузера.'): void {
    const host = this.host;
    this.detach();
    this.releaseResources();
    this.host = host;
    this.setState('error', message);
  }
}
