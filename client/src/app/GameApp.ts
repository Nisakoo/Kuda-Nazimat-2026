import type { CameraView, RenderAdapter } from '../render/RenderAdapter';
import { ThreeRenderer } from '../render/three/ThreeRenderer';
import type { Entity, GameCommand, WorldEvent, WorldSnapshot } from '../core/types';
import type { GameSession } from '../session/GameSession';
import { BabylonClient } from '../multiplayer/BabylonClient';
import { AvatarClient } from '../multiplayer/AvatarClient';
import { EquipmentClient } from '../multiplayer/EquipmentClient';
import type { EquipmentView } from '../multiplayer/EquipmentClient';
import type { ToolId } from '../../../shared/equipment/types';
export type { EquipmentView };
import type { AvatarView } from '../multiplayer/AvatarClient';
import type { AvatarId } from '../../../shared/avatar/types';
import { ThreeAvatarPreview } from '../render/three/ThreeAvatarPreview';
import type { AvatarPreview, AvatarPreviewEvents } from '../render/AvatarPreview';
export type { AvatarView, AvatarPreview, AvatarPreviewEvents };
import type { BabylonView } from '../multiplayer/BabylonClient';
import type { BabylonAction, Language, PartySize } from '../../../shared/babylon/types.ts';
import { MARKET_GOATS, MARKET_PEOPLE } from '../session/MarketSession';
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
import { rememberConnection } from './connectionPreference';
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
import { requestPasswordSession, revokeSession } from '../multiplayer/PasswordAuth';
import { FrameMetrics } from './FrameMetrics';
import { WorldAudio } from '../audio/WorldAudio';
import type { AudioOrigin } from '../audio/WorldAudio';
import { babylonAudioChanges, babylonAudioHistory } from './audioPresentation';

const browserClock: Clock = { now: () => Date.now(), set: (callback, ms) => window.setTimeout(callback, ms), clear: (id) => window.clearTimeout(id) };
export type BabylonPanel = 'setup' | 'languages' | 'intro' | 'task' | 'inventory' | 'stone' | 'words' | 'interaction' | 'chat';
export type { BabylonView };
export type MarketPanel = 'intro' | 'task' | 'inventory' | 'stone' | 'words' | 'interaction' | 'results';
export type ClientMode = 'local' | 'mock' | 'online';
export type HudPanel = 'inventory' | 'map' | 'words' | 'chat';
export interface MapPlayer { readonly x: number; readonly z: number; readonly yaw: number; readonly authoritative: boolean }
export interface MapPeer { readonly id: string; readonly name: string; readonly x: number; readonly z: number }

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
  readonly pauseOpen: boolean;
  readonly controlsHint: boolean;
  readonly entryStage: 'profile' | 'mode' | 'connect' | 'loading' | null;
  readonly entryReveal: boolean;
  readonly avatarRequired: boolean;
  readonly babylon: BabylonView | null;
  readonly babylonPanel: BabylonPanel | null;
  readonly babylonTarget: string | null;
  readonly babylonWord: string;
  readonly avatar: AvatarView | null;
  readonly equipment: EquipmentView | null;
  readonly avatarOpen: boolean;
  readonly avatarPurpose: 'first' | 'settings';
  readonly mapOpen: boolean;
  readonly mapPlayer: MapPlayer | null;
  readonly mapPeers: readonly MapPeer[];
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
  readonly carryHint: string | null;
  readonly carryPending: boolean;
  readonly carryError: string | null;
  readonly heldItemId: string | null;
  readonly volume: number;
  readonly audioStats: string;
}

/** Composition root; all UI/input commands cross this facade. */
export class GameApp {
  private babylonClient: BabylonClient | null = null;
  private avatarClient: AvatarClient | null = null;
  private equipmentClient: EquipmentClient | null = null;
  private renderer: RenderAdapter | null = null;
  private audio: WorldAudio | null = null;
  private audioPrevious: WorldSnapshot | null = null;
  private audioMessageSequence = 0;
  private modelAssets: AssetManager | null = null;
  private world: ChunkManager | null = null;
  private worldBudget = new WorldBudget();
  private activeBootstrap: WorldDescriptor | null = null;
  private waitingBudget = false;
  private generation = 0;
  private mock = false;
  private serverSession: ServerSession | null = null;
  private requiresAvatar = false;
  private entryPending = false;
  private pendingConnect = false;
  private connectionRequest: AbortController | null = null;
  requestJoinAfterLogin(): void { this.pendingConnect = true; }
  private autoCaptureEntry = false;
  private entryAction: 'create' | 'join' | null = null;
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
    this.audio = new WorldAudio(this.worldBudget);
    this.snapshot = Object.freeze({
      controlsHint: false,
      entryStage: null, entryReveal: false, avatarRequired: false,
      phase: 'idle', message: null, screen: 'welcome', nearby: null, dialog: null, pauseOpen: false,
      babylon: null, babylonPanel: null, babylonTarget: null, babylonWord: '', mapOpen: false, mapPlayer: null, mapPeers: [], avatar: null, avatarOpen: false, avatarPurpose: 'settings', equipment: null,
      debug: config.debug, buildingSymbols: true, coordinates: '',
      capture: 'idle', captureError: null,
      visualLoading: false, visualError: null, modelStats: '',
      worldReady: createMap === null, worldWaiting: false, region: 'Площадь открытий', cacheStats: '', chunkRadius: config.chunkRadius ?? (config.mapId === 'market' ? 2 : 1),
      authRequired: config.session === 'online', authPending: false, authError: null, authName: '',
      mapId: config.mapId, mode: config.session, settingsOpen: false, settingsError: null, networkStatus: 'unauthorized', networkError: null,
      chatOpen: false, chatMessages: [], chatError: null, dialogPending: false, dialogError: null,
      performance: '', renderStats: '', market: null, marketPanel: null, marketTarget: null, stamina: 100, sprintBlocked: false,
      carryHint: null, carryPending: false, carryError: null, heldItemId: null, volume: this.audio.volume, audioStats: this.audioDiagnostics(),
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
      if (this.config.session === 'online' && this.config.mapId !== 'market' && this.requiresAvatar && this.serverSession) { if (!this.snapshot.avatarOpen) this.openAvatar(); return; }
      if (this.config.session === 'online' && !this.session) {
        if (!this.mock && (!this.serverSession || this.serverSession.expiresAt <= browserClock.now())) {
          this.serverSession = null; this.patch({ authRequired: true, worldReady: false }); this.setState('idle'); return;
        }
        if (!this.mock && this.config.mapId === 'market' && this.serverSession) {
          if (!this.babylonClient) { this.startBabylon(); return; }
          if (!this.snapshot.babylon?.state?.party || this.entryPending || this.requiresAvatar) return;
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
        this.audio?.dispose(); this.audio = new WorldAudio(this.worldBudget);
        if (this.snapshot.volume !== this.audio.volume) this.patch({ volume: this.audio.volume });
        this.baselineAudioMessages();
        const origin = this.worldRoot();
        const sizes = new Map(Object.entries(this.activeBootstrap.assets).map(([path, size]) => [new URL(path, origin).href, size]));
        // The explicit synthetic backend shares these four local models, with the same budget guards.
        if (this.mock) for (const name of ['cat', 'bird', 'pushable-pot', 'pickup-apple']) {
          const path = `assets/models/market/${name}.glb`; const size = (MARKET_WORLD as WorldDescriptor).assets[path];
          if (size) sizes.set(new URL(path, origin).href, size);
        }
        this.modelAssets = new AssetManager(new HttpAssetSource(new URL('assets/models/', origin).href, this.httpAccess()), this.createMap !== null ? this.worldBudget : undefined, (url) => sizes.get(url));
        this.renderer = this.createRenderer(this.modelAssets);
        this.renderer.mount(host);
        this.renderer.setBuildingSymbols(this.snapshot.buildingSymbols);
        if (this.mock) this.renderer.registerModels({ 'life-cat': 'market/cat.glb', 'life-bird': 'market/bird.glb', 'life-pot': 'market/pushable-pot.glb', 'life-apple': 'market/pickup-apple.glb' });
        if (this.session instanceof OnlineSession) this.renderer.setSceneState(this.session.worldLife);
        if (this.config.session === 'local' || this.mock) this.renderer.registerModels({ 'demo-tablet': 'demo/tablet.glb', 'demo-tablet-json': 'demo/tablet.gltf' });
        this.previous = this.current = this.session.getSnapshot();
        this.feedAudioMovement(this.current, 'snapshot');
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
          shortcut: code => this.handleShortcut(code),
          controlsHint: visible => this.patch({ controlsHint: visible }),
          carry: () => this.carry(),
          menu: () => this.toggleMenu(),
          captured: () => {
            if (this.session instanceof MarketSession) this.session.beginTour();
            this.patch({ capture: 'locked', captureError: null, screen: 'playing', pauseOpen: false });
            if (this.host) this.start(this.host);
            this.updateHud(true);
          },
          interrupted: () => {
            this.patch({ capture: 'idle', captureError: null, pauseOpen: this.snapshot.screen === 'playing' && !this.overlayOpen });
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
            if (this.snapshot.phase !== 'running') {
              // Menus pause local simulation, not authoritative network delivery.
              if (this.session instanceof OnlineSession) {
                this.session.update(0);
                this.current = this.session.getSnapshot();
                this.updateHud();
              }
              return;
            }
            this.audio?.update(delta);
            if (this.world && !this.world.manifest) return;
            const localPosition = this.current?.entities.find(entity => entity.id === this.session?.playerId)?.transform?.position;
            if (this.world && this.session instanceof LocalSession && localPosition && !this.world.isPrepared(localPosition)) return;
            this.previous = this.current;
            if (this.session instanceof OnlineSession) this.session.setPreparedChunks(this.snapshot.entryStage === 'loading' ? [] : this.world?.preparedChunks ?? []);
            this.session?.update(delta);
            this.current = this.session?.getSnapshot() ?? null;
            if (!(this.session instanceof OnlineSession) && this.current) this.feedAudioMovement(this.current, 'live');
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
            if (this.snapshot.phase === 'stopped' && !(this.session instanceof OnlineSession) && !this.world?.stats.loading && !this.renderer?.getDiagnostics().pending) this.loop?.stop();
          },
          onError: () => this.fail('Не удалось обновить сцену. Попробуйте перезапустить прогулку.'),
        });
        if ((this.config.session === 'local' || this.mock) && this.config.mapId !== 'market') this.loadDemoDecorations();
      }
      this.resize();
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(host);
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      window.addEventListener('blur', this.cancelEntryCapture);
      document.addEventListener('keydown', this.onEntryKey);
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
    if (this.snapshot.phase === 'stopped' && this.host && !this.overlayOpen) {
      this.patch({ pauseOpen: false });
      this.requestPlay();
    }
  }

  private requestPlay(): void {
    this.updateVisualStatus();
    if (!this.input || this.snapshot.capture === 'requesting' || !this.snapshot.worldReady || this.snapshot.visualLoading || this.snapshot.babylonPanel || this.snapshot.mapOpen || this.snapshot.avatarOpen || this.snapshot.settingsOpen || this.snapshot.chatOpen || this.snapshot.marketPanel || this.snapshot.dialog) return;
    this.patch({ capture: 'requesting', captureError: null });
    this.input.requestCapture();
    void this.audio?.unlock();
  }

  stop(): void {
    if (this.snapshot.phase !== 'running') return;
    this.input?.stop();
    this.patch({ capture: 'idle', captureError: null });
    this.detach();
    this.updateHud(true);
    this.setState('stopped');
    if (this.session instanceof OnlineSession || this.world?.stats.loading || this.renderer?.getDiagnostics().pending) this.loop?.start();
  }

  toggleMenu(): void {
    if (this.snapshot.settingsOpen) { this.closeSettings(); return; }
    if (this.snapshot.chatOpen) { this.closeChat(); return; }
    if (this.snapshot.avatarOpen) { this.closeAvatar(); return; }
    if (this.snapshot.mapOpen) { this.closeMap(); return; }
    if (this.snapshot.babylonPanel) { void this.closeBabylonPanel(); return; }
    if (this.snapshot.marketPanel) { this.closeMarketPanel(); return; }
    if (this.snapshot.dialog) { this.closeDialog(); return; }
    if (this.snapshot.screen !== 'playing' || !this.host) return;
    if (this.snapshot.pauseOpen) { this.resume(); return; }
    this.patch({ pauseOpen: true });
    this.stop();
  }

  private get overlayOpen(): boolean {
    const s = this.snapshot;
    return Boolean(s.settingsOpen || s.chatOpen || s.avatarOpen || s.mapOpen || s.babylonPanel || s.marketPanel || s.dialog);
  }

  private returnFromOverlay(): void {
    // A close gesture can restore capture. Browser rejection uses recovery,
    // never an implicit pause menu. Explicitly opened pause keeps its parent role.
    if (this.snapshot.screen === 'playing' && !this.snapshot.entryStage && !this.snapshot.pauseOpen && !this.overlayOpen) this.resume();
  }

  restart(host: HTMLElement): void {
    this.cancelLogin();
    if (this.snapshot.phase === 'disposed') throw new Error('Приложение уже завершено.');
    const screen = 'welcome';
    if (this.serverSession && this.config.mapId === 'market' && !this.entryPending) { this.autoCaptureEntry = true; this.patch({ entryStage: 'loading', entryReveal: false }); }
    this.detach();
    this.releaseResources();
    this.camera = { yaw: 0, pitch: this.config.mapId === 'market' ? .5 : .7, distance: this.config.mapId === 'market' ? 18 : 15 };
    this.patch({ screen, pauseOpen: false, mapOpen: false, mapPlayer: null, mapPeers: [], dialog: null, nearby: null, coordinates: '', capture: 'idle', captureError: null, worldReady: this.createMap === null, chatOpen: false, chatMessages: [], chatError: null, dialogPending: false, dialogError: null, market: null, marketPanel: null, marketTarget: null });
    this.setState('idle');
    this.start(host);
  }

  leaveWorld(): void {
    if (!this.host) return;
    if (this.serverSession && this.config.mapId === 'market') { this.cancelEntry(); return; }
    this.patch({ screen: 'welcome', dialog: null, nearby: null });
    this.restart(this.host);
  }

  interact(): void {
    if (!this.canControl()) return;
    this.updateHud(true);
    if (this.snapshot.nearby && this.snapshot.babylon?.state?.profile) { this.openBabylonPanel('interaction', this.snapshot.nearby.id); return; }
    if (this.snapshot.nearby) this.send({ type: 'interact', targetId: this.snapshot.nearby.id });
  }

  carry(): void {
    if (!this.canControl()) return;
    if (this.session instanceof OnlineSession) this.session.carry();
    else this.patch({ carryError: 'Переноска требует подключения к серверу или явно выбранной тестовой сети.' });
  }

  closeDialog(): void {
    this.input?.stop();
    this.npcRequest = null;
    this.patch({ dialog: null, dialogPending: false, dialogError: null });
    this.stop();
    this.returnFromOverlay();
  }

  submitDialog(text: string): void {
    const dialog = this.snapshot.dialog;
    if (!dialog || !text.trim() || this.snapshot.dialogPending) return;
    if (this.session instanceof OnlineSession) {
      this.npcRequest = this.session.askNpc(dialog.npcId, text);
      if (this.npcRequest) {
        this.audioMessage(`npc-question:${this.npcRequest}`, `npc:${dialog.npcId}`, 'live');
        this.patch({ dialog: { ...dialog, messages: [...dialog.messages.slice(-18), { author: 'player', text: text.trim() }] }, dialogPending: true, dialogError: null });
      }
    } else {
      const answer = answerDemoDialog(dialog, text);
      const pairId = `local-npc:${++this.audioMessageSequence}`;
      this.audioMessage(`${pairId}:question`, `npc:${dialog.npcId}`, 'live');
      this.audioMessage(`${pairId}:answer`, `npc:${dialog.npcId}`, 'live');
      this.patch({ dialog: answer });
    }
  }

  setVolume(percent: number): void {
    if (this.snapshot.phase === 'disposed' || !Number.isFinite(percent)) return;
    this.audio ??= new WorldAudio(this.worldBudget);
    this.audio.setVolume(percent / 100);
    void this.audio.unlock();
    this.patch({ volume: this.audio.volume });
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

  openSettings(): void {
    this.babylonClient?.cancelNpc();
    this.connectionRequest?.abort(); this.connectionRequest = null;
    this.input?.stop(); this.stop();
    this.patch({ mapOpen: false, chatOpen: false, marketPanel: null, babylonPanel: this.snapshot.babylonPanel === 'setup' ? 'setup' : null, settingsOpen: true, settingsError: null });
  }
  closeSettings(): void { this.patch({ settingsOpen: false }); if (this.snapshot.screen === 'welcome' && this.host) this.start(this.host); else this.returnFromOverlay(); }
  applySettings(mode: ClientMode, serverUrl: string, mapId: string, chunkRadius: number, debug: boolean): boolean {
    try {
      const config = parseConfig({ session: mode === 'local' ? 'local' : 'online', serverUrl, mapId, chunkRadius, debug }, window.location.origin);
      if ((mode === 'local' || mode === 'mock') && !['demo', 'science', 'market'].includes(mapId)) throw new Error('Для локальной прогулки доступны market, demo и science.');
      if (mode === 'mock' && mapId === 'market') throw new Error('Рынок пока доступен в локальной прогулке. Тестовая сеть использует demo или science.');
      this.cancelLogin(); this.stopBabylon();
      if (config.serverUrl !== this.config.serverUrl || mode !== 'online') { this.serverSession = null; this.requiresAvatar = false; this.patch({ authName: '', avatarRequired: false }); }
      this.entryPending = mode === 'online' && config.mapId === 'market';
      this.patch({ entryStage: this.serverSession && this.entryPending ? 'profile' : null, entryReveal: false });
      this.mock = mode === 'mock'; this.config = config;
      try { rememberConnection(config.serverUrl, window.localStorage); } catch { /* Storage is optional; never persist authentication. */ }
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
  loginPassword(name: string, password: string): Promise<void> { return this.authenticate(name, password, 'login'); }
  register(name: string, password: string): Promise<void> { return this.authenticate(name, password, 'register'); }
  private async authenticate(rawName: string, password: string, mode: 'login' | 'register'): Promise<void> {
    if (!this.snapshot.authRequired || this.snapshot.authPending || this.snapshot.phase === 'disposed') return;
    let name: string;
    try { name = guestName(rawName); } catch (error) { this.patch({ authError: (error as Error).message }); return; }
    const request = new AbortController(); this.authRequest = request;
    this.patch({ authPending: true, authError: null, authName: name });
    this.authTimer = window.setTimeout(() => { if (this.authRequest === request) { this.cancelLogin(); this.patch({ authError: mode === 'register' ? 'Сервер не ответил за 10 секунд. Аккаунт мог быть создан. Перейдите во «Вход» и попробуйте войти с тем же паролем.' : 'Сервер не ответил за 10 секунд. Повторите попытку.' }); } }, 10000);
    try {
      const result = await requestPasswordSession(this.config.serverUrl, mode, name, password, request.signal);
      if (this.authRequest === request) this.provideServerSession(result.session, result.requiresAvatar);
    } catch (error) {
      if (this.authRequest === request) this.patch({ authError: error instanceof Error ? error.message : 'Не удалось войти.' });
    } finally { if (this.authRequest === request) this.cancelLogin(); }
  }
  private cancelLogin(): void {
    this.connectionRequest?.abort(); this.connectionRequest = null;
    const request = this.authRequest; this.authRequest = null;
    if (this.authTimer !== null) window.clearTimeout(this.authTimer);
    this.authTimer = null; request?.abort();
    if (this.snapshot.authPending) this.patch({ authPending: false });
  }

  /** Integration boundary: only the local server's login flow supplies this context. */
  provideServerSession(raw: unknown, requiresAvatar = false): void {
    const session = parseServerSession(raw, browserClock.now());
    this.cancelLogin();
    this.stopBabylon();
    this.serverSession = session; this.requiresAvatar = requiresAvatar; this.entryPending = this.config.mapId === 'market'; this.mock = false; this.config = Object.freeze({ ...this.config, session: 'online' });
    this.patch({ authRequired: false, authPending: false, authError: null, mode: 'online', networkError: null, networkStatus: 'unauthorized' });
    this.patch({ avatarRequired: requiresAvatar, entryStage: this.config.mapId === 'market' ? (this.pendingConnect ? 'connect' : 'profile') : null });
    this.pendingConnect = false;
    if (this.host) this.restart(this.host);
  }
  logout(): void {
    const previous = this.serverSession;
    this.cancelLogin(); this.stopBabylon(); this.serverSession = null; this.requiresAvatar = false;
    if (previous) void revokeSession(this.config.serverUrl, previous.token).catch(() => { if (!this.serverSession && this.snapshot.phase !== 'disposed') this.patch({ authError: 'Вы вышли на этом устройстве. Сервер не подтвердил отзыв сессии; проверьте подключение.' }); });
    this.patch({ entryStage: null, entryReveal: false, avatarRequired: false, authRequired: this.snapshot.mode === 'online', authError: null, authName: '', networkError: null, networkStatus: 'unauthorized' });
    if (this.mock) { this.mock = false; this.config = Object.freeze({ ...this.config, session: 'local' }); this.patch({ mode: 'local' }); }
    if (this.host) this.restart(this.host);
  }
  reconnect(): void { if (this.session instanceof OnlineSession) { this.patch({ networkError: null }); this.session.reconnect(); } }
  simulateNetworkLoss(): void { if (this.network instanceof MockNetworkAdapter) this.network.drop(); }
  openChat(): void {
    if (this.snapshot.babylon?.state?.profile) { this.openBabylonPanel('chat'); return; }
    this.input?.stop(); this.stop();
    this.patch({ pauseOpen: false, chatOpen: true, chatError: this.session instanceof OnlineSession ? null : 'Общение игроков доступно в сетевом или тестовом режиме.' });
  }
  closeChat(): void { this.patch({ chatOpen: false }); this.returnFromOverlay(); }
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
    this.cancelLogin(); this.stopBabylon(); this.serverSession = null; this.requiresAvatar = false;
    this.detach(); this.releaseResources();
    this.host = host;
    this.patch({ entryStage: null, entryReveal: false, authRequired: true, authPending: false, authError: message, screen: 'welcome', worldReady: false, dialog: null, chatOpen: false, chatMessages: [], dialogPending: false, dialogError: null, networkStatus: 'unauthorized', networkError: null });
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
    } else if (notice.type === 'world') {
      this.feedAudioMovement(notice.snapshot, notice.origin);
    } else if (notice.type === 'scene') {
      this.renderer?.setSceneState(notice.state);
    } else if (notice.type === 'carry') {
      const state = notice.state;
      if (state.hint !== this.snapshot.carryHint || state.pending !== this.snapshot.carryPending || state.error !== this.snapshot.carryError || state.heldItemId !== this.snapshot.heldItemId) {
        this.patch({ carryHint: state.hint, carryPending: state.pending, carryError: state.error, heldItemId: state.heldItemId });
      }
    } else if (notice.type === 'chat') {
      this.audioMessage(`chat:${notice.message.messageId}`, 'chat', this.snapshot.chatOpen ? 'live' : 'history');
      this.patch({ chatMessages: [...this.snapshot.chatMessages.slice(-49), { id: notice.message.messageId, name: notice.message.name, text: notice.message.text }] });
    } else if (notice.type === 'npc') {
      const dialog = this.snapshot.dialog;
      if (dialog?.npcId === notice.targetId && this.npcRequest === notice.requestId) {
        this.npcRequest = null;
        this.audioMessage(`npc-answer:${notice.requestId}`, `npc:${notice.targetId}`, 'live');
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
    if (this.snapshot.entryStage !== 'loading') this.renderer?.revealChunks?.();
    const worldStats = this.world?.stats;
    // Chunk fetches enqueue visuals later; an empty renderer queue alone is not readiness.
    const visualLoading = diagnostics.pending > 0 || Boolean(worldStats?.loading);
    const visualError = this.worldFailure || worldStats?.errors.length ? 'Не удалось загрузить участок мира. Повторите загрузку в меню.' : diagnostics.errors.length ? 'Не удалось загрузить часть оформления. Откройте меню, чтобы повторить загрузку.' : null;
    const modelStats = `Модели: ${diagnostics.models} · Экземпляры: ${diagnostics.instances}`;
    const position = this.current?.entities.find((entity) => entity.id === this.session?.playerId)?.transform?.position;
    const worldReady = (this.world ? Boolean(position && this.world.isPrepared(position)) : this.createMap === null) && (!(this.session instanceof OnlineSession) || this.session.state.status === 'connected');
    if (this.snapshot.entryStage === 'loading' && worldReady && !this.worldStarting && !visualLoading && !diagnostics.errors.length && !this.worldFailure && !worldStats?.errors.length) {
      this.renderer?.revealChunks?.();
      if (!this.snapshot.entryReveal) this.patch({ entryReveal: true });
    }
    if (this.snapshot.entryStage === 'loading' && worldReady && !this.worldStarting && this.snapshot.entryReveal && !visualLoading && !visualError && !(this.renderer?.getDiagnostics().appearing ?? 0)) {
      this.patch({ entryStage: null, entryReveal: false, screen: 'playing', worldReady: true, visualLoading: false });
      this.stop();
      if (this.autoCaptureEntry && !document.hidden && document.hasFocus()) this.requestPlay();
      else this.patch({ captureError: 'Мир готов. Вернитесь в окно и нажмите «Вернуть управление».' });
    }
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
      audioStats: this.audioDiagnostics(),
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
    return !this.snapshot.entryStage && this.snapshot.phase === 'running' && this.snapshot.screen === 'playing' && this.snapshot.capture === 'locked' && this.snapshot.worldReady && !this.snapshot.dialog && !this.snapshot.chatOpen && !this.snapshot.settingsOpen && !this.snapshot.marketPanel && !this.snapshot.babylonPanel && !this.snapshot.mapOpen && !this.snapshot.avatarOpen;
  }

  private readonly onSessionEvents = (events: readonly WorldEvent[]): void => {
    for (const event of events) {
      if (event.type !== 'interacted' || event.actorId !== this.session?.playerId) continue;
      if (this.session instanceof MarketSession) { this.openMarketPanel('interaction', event.targetId); continue; }
      const target = this.session?.getSnapshot().entities.find((entity) => entity.id === event.targetId);
      const dialog: DemoDialog | null = this.session instanceof OnlineSession
        ? target?.character?.kind === 'npc' ? { source: this.mock ? 'mock' : 'server', npcId: target.id, name: target.character.name, topic: target.interactable?.label ?? 'Разговор', questions: [], messages: [] } : null
        : openDemoDialog(event.targetId);
      if (dialog) {
        if (!(this.session instanceof OnlineSession)) this.audioMessage(`local-dialog:${++this.audioMessageSequence}`, `npc:${dialog.npcId}`, 'live');
        this.input?.stop(); this.patch({ dialog, capture: 'idle', captureError: null });
      }
    }
  };

  openMarketPanel(panel: MarketPanel, target: string | null = null): void {
    if (!(this.session instanceof MarketSession)) return;
    this.input?.stop(); this.stop();
    if (panel === 'interaction' && MARKET_PEOPLE.some(person => person.id === target)) {
      this.audioMessage(`market-dialog:${++this.audioMessageSequence}`, 'market-npc', 'live');
    }
    this.patch({ pauseOpen: false, marketPanel: panel, marketTarget: target, market: this.session.market, chatOpen: false, mapOpen: false, settingsOpen: false });
  }
  closeMarketPanel(): void {
    this.patch({ marketPanel: null, marketTarget: null });
    if (this.snapshot.screen === 'welcome' && this.host) this.start(this.host);
    else this.returnFromOverlay();
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
      if (this.entryPending) panel = 'setup';
      const completed = Boolean(view.state?.party?.completed && before?.party && !before.party.completed);
      if (completed) { this.input?.stop(); this.stop(); panel = 'task'; }
      if (view.state) for (const event of babylonAudioChanges(before, view.state, panel, this.snapshot.babylonTarget)) {
        this.audioMessage(event.id, event.stream, event.origin);
      }
      this.patch({ babylon: view, babylonPanel: panel, ...(completed ? { avatarOpen: false, mapOpen: false, chatOpen: false, settingsOpen: false, marketPanel: null, dialog: null } : {}) });
      if (view.state?.party && !this.entryPending && !this.session && this.host) this.start(this.host);
    }, () => this.expireServerSession('Сессия истекла. Войдите снова.'));
    this.patch({ babylonPanel: 'setup', entryStage: this.snapshot.entryStage ?? 'profile' });
    this.avatarClient ??= new AvatarClient(this.config.serverUrl, this.serverSession, avatar => this.patch({ avatar }), () => this.expireServerSession());
    void this.avatarClient.load();
    void this.babylonClient.start();
  }
  private stopBabylon(): void {
    this.equipmentClient?.dispose(); this.equipmentClient = null;
    this.patch({ equipment: null });
    this.avatarClient?.dispose(); this.avatarClient = null;
    this.patch({ avatar: null, avatarOpen: false });
    this.babylonClient?.dispose(); this.babylonClient = null;
    this.patch({ babylon: null, babylonPanel: null, babylonTarget: null, babylonWord: '' });
  }
  openBabylonPanel(panel: BabylonPanel, target: string | null = null): void {
    if (this.snapshot.babylonPanel === 'interaction' && (panel !== 'interaction' || target !== this.snapshot.babylonTarget)) this.babylonClient?.cancelNpc();
    if (!this.babylonClient) return;
    if (panel === 'inventory' && this.serverSession) {
      this.equipmentClient ??= new EquipmentClient(this.config.serverUrl, this.serverSession, equipment => this.patch({ equipment }), () => this.expireServerSession());
      void this.equipmentClient.load();
    }
    this.input?.stop(); this.stop(); this.patch({ mapOpen: false, chatOpen: false, settingsOpen: false, pauseOpen: false, babylonPanel: panel, babylonTarget: target });
  }
  private handleShortcut(code: string): boolean {
    if (this.snapshot.screen !== 'playing' || this.snapshot.entryStage || this.snapshot.authRequired || this.snapshot.avatarOpen || this.snapshot.dialog) return false;
    if (code === 'Escape' && !this.overlayOpen && !this.input?.hasCapture) { this.toggleMenu(); return true; }
    if (this.snapshot.settingsOpen) return false;
    const panel = ({ Digit1: 'chat', Digit2: 'words', Digit3: 'map' } as const)[code as 'Digit1' | 'Digit2' | 'Digit3'];
    if (panel) { this.toggleHudPanel(panel); return true; }
    // Tab belongs to native focus navigation once a modal releases the cursor.
    if (code === 'Tab' && !this.input?.hasCapture) return false;
    if (code === 'Tab' || code === 'Digit4') {
      const target = code === 'Tab' ? 'task' : 'languages';
      if (this.snapshot.babylon?.state?.profile) {
        if (this.snapshot.babylonPanel === target) void this.closeBabylonPanel(); else this.openBabylonPanel(target);
        return true;
      }
      if (target === 'task' && this.snapshot.market) {
        if (this.snapshot.marketPanel === 'task') this.closeMarketPanel(); else this.openMarketPanel('task');
        return true;
      }
    }
    return false;
  }
  toggleHudPanel(panel: HudPanel): void {
    if (this.snapshot.babylonPanel === 'interaction') this.babylonClient?.cancelNpc();
    if (this.snapshot.screen !== 'playing' || this.snapshot.avatarOpen || this.snapshot.settingsOpen || this.snapshot.dialog || this.snapshot.babylonPanel === 'intro') return;
    if (panel === 'map') {
      if (this.snapshot.mapOpen) { this.closeMap(); return; }
      this.input?.stop(); this.stop();
      this.patch({ pauseOpen: false, mapOpen: true, babylonPanel: null, babylonTarget: null, marketPanel: null, chatOpen: false });
      this.updateHud(true);
      return;
    }
    this.patch({ mapOpen: false });
    if (this.snapshot.babylon?.state?.profile) {
      if (this.snapshot.babylonPanel === panel) void this.closeBabylonPanel();
      else this.openBabylonPanel(panel);
    } else if (panel === 'chat') {
      if (this.snapshot.chatOpen) this.closeChat(); else { this.patch({ marketPanel: null }); this.openChat(); }
    } else if (this.snapshot.market) {
      this.patch({ chatOpen: false });
      if (this.snapshot.marketPanel === panel) this.closeMarketPanel(); else this.openMarketPanel(panel);
    }
  }
  equipTool(tool: ToolId | null): Promise<boolean> { return this.equipmentClient?.save(tool) ?? Promise.resolve(false); }
  closeMap(): void { this.patch({ mapOpen: false }); this.returnFromOverlay(); }
  openAvatar(): void {
    if (!this.serverSession || this.mock || this.snapshot.mode !== 'online') return;
    this.input?.stop(); this.stop();
    this.patch({ avatarOpen: true, avatarPurpose: this.requiresAvatar ? 'first' : 'settings', settingsOpen: false, mapOpen: false, babylonPanel: null, marketPanel: null, chatOpen: false, dialog: null });
    this.avatarClient ??= new AvatarClient(this.config.serverUrl, this.serverSession, avatar => this.patch({ avatar }), () => this.expireServerSession());
    void this.avatarClient.load();
  }
  closeAvatar(): void {
    if (this.entryPending) { this.patch({ avatarOpen: false, babylonPanel: 'setup', entryStage: 'profile' }); return; }
    this.avatarClient?.dispose(); this.avatarClient = null;
    this.patch({ avatarOpen: false, avatar: null, settingsOpen: true });
  }
  async saveAvatar(id: AvatarId): Promise<boolean> {
    const client = this.avatarClient;
    const saved = await client?.save(id) ?? false;
    if (client !== this.avatarClient || !this.snapshot.avatarOpen) return false;
    if (saved && this.requiresAvatar) {
      this.requiresAvatar = false; this.patch({ avatarRequired: false, avatarPurpose: 'settings' });
      if (this.entryPending) this.closeAvatar();
      else { this.patch({ avatarOpen: false }); if (this.host) this.restart(this.host); }
    } else if (saved) this.closeAvatar();
    return saved;
  }
  createAvatarPreview(host: HTMLElement, events: AvatarPreviewEvents): AvatarPreview {
    if (!this.serverSession) throw new Error('Для выбора облика требуется вход.');
    const root = new URL(`${this.config.serverUrl.replace(/\/$/, '')}/api/avatar/models/`);
    const metadata = this.activeBootstrap?.assets ?? (this.config.mapId === 'market' ? MARKET_WORLD.assets : DEMO_WORLD.assets);
    const sizes = new Map(Object.entries(metadata).filter(([path]) => path.startsWith('assets/models/avatars/')).map(([path, size]) => [new URL(path.slice('assets/models/avatars/'.length), root).href, size]));
    return new ThreeAvatarPreview(host, new AssetManager(new HttpAssetSource(root.href, this.httpAccess()), this.worldBudget, url => sizes.get(url)), events);
  }
  async closeBabylonPanel(): Promise<void> {
    if (this.snapshot.babylonPanel === 'setup') return;
    if (this.snapshot.babylonPanel === 'intro' && !this.snapshot.babylon?.state?.introSeen) {
      if (!await this.babylonAction({ type: 'intro-seen' })) return;
    }
    if (this.snapshot.babylonPanel === 'interaction') this.babylonClient?.cancelNpc();
    this.patch({ babylonPanel: null, babylonTarget: null, babylonWord: '' });
    this.returnFromOverlay();
  }
  setEntryStage(stage: 'profile' | 'mode' | 'connect'): void {
    if (!this.entryPending || this.snapshot.babylon?.busy) return;
    this.connectionRequest?.abort(); this.connectionRequest = null;
    this.babylonClient?.clearError(); this.entryAction = null;
    this.patch({ entryStage: stage });
  }
  saveEntryLanguages(native: Language, learning: Language): Promise<boolean> {
    this.entryAction = null;
    return this.babylonAction({ type: 'languages', native, learning });
  }
  async createEntryGame(size: PartySize, replacePartyId?: string): Promise<boolean> {
    if (this.requiresAvatar || !this.snapshot.babylon?.state?.profile) return false;
    this.entryAction = 'create';
    return this.finishEntry(await this.babylonAction({ type: 'create', size, ...(replacePartyId === undefined ? {} : { replacePartyId }) }));
  }
  async connectEntryGame(serverUrl: string): Promise<boolean> {
    if (serverUrl !== this.config.serverUrl) {
      if (this.connectionRequest) return false;
      const request = new AbortController(); this.connectionRequest = request;
      const timer = window.setTimeout(() => request.abort(), 5000);
      try {
        const response = await fetch(`${serverUrl}/api/health`, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: request.signal });
        if (!response.ok) throw new Error('Сервер недоступен или останавливается. Попробуйте позже.');
        const health = await response.json() as { protocol?: number; status?: string };
        if (health.protocol !== 3 || health.status !== 'ok') throw new Error('Несовместимая версия сервера. Обновите клиент и сервер.');
        request.signal.throwIfAborted();
        if (this.serverSession) await revokeSession(this.config.serverUrl, this.serverSession.token);
        request.signal.throwIfAborted();
        this.serverSession = null;
        this.connectionRequest = null;
        this.logout();
        window.location.assign(`${serverUrl}/?join=1`);
      } catch (error) {
        if (error instanceof TypeError || error instanceof SyntaxError || request.signal.aborted) throw new Error('Не удалось подключиться. Проверьте IP, порт и доступность сервера.');
        throw error;
      }
      finally { window.clearTimeout(timer); if (this.connectionRequest === request) this.connectionRequest = null; }
      return false;
    }
    if (this.requiresAvatar || !this.snapshot.babylon?.state?.profile) throw new Error('Вернитесь в профиль: подтвердите персонажа и сохраните языки.');
    this.entryAction = 'join';
    return this.finishEntry(await this.babylonAction({ type: 'join' }));
  }
  async retryEntryAction(): Promise<boolean> {
    const saved = await this.retryBabylon();
    return this.entryAction ? this.finishEntry(saved) : saved;
  }
  private finishEntry(saved: boolean): boolean {
    if (!saved || !this.serverSession || !this.entryPending || !this.snapshot.babylon?.state?.party) return false;
    this.entryPending = false; this.autoCaptureEntry = true;
    this.patch({ babylonPanel: null, entryStage: 'loading', entryReveal: false });
    if (this.host) this.start(this.host);
    return true;
  }
  cancelEntry(): void {
    if (!this.serverSession || !this.host) return;
    this.entryPending = true;
    this.patch({ entryStage: 'profile', entryReveal: false, babylonPanel: 'setup' });
    this.restart(this.host);
  }

  babylonAction(action: BabylonAction, requestId?: string): Promise<boolean> { return this.babylonClient?.send(action, requestId) ?? Promise.resolve(false); }
  retryBabylon(): Promise<boolean> { return this.babylonClient?.repeat() ?? Promise.resolve(false); }
  learnWord(word: string): void {
    const clean = word.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').slice(0, 200);
    if (!clean) return;
    this.openBabylonPanel('words'); this.patch({ babylonWord: clean });
    if (!this.snapshot.babylon?.state?.words.some(entry => entry.word.normalize('NFC').toLocaleLowerCase() === clean.normalize('NFC').toLocaleLowerCase())) void this.babylonAction({ type: 'suggest', word: clean });
  }

  private audioDiagnostics(): string {
    const stats = this.audio?.stats;
    return `Источники: ${stats?.sources ?? 0} · Буферы: ${stats?.buffers ?? 0} · Загрузки: ${stats?.pending ?? 0} · Память: ${stats?.reservedBytes ?? 0} байт`;
  }

  private feedAudioMovement(snapshot: WorldSnapshot, origin: AudioOrigin): void {
    this.audio?.retainEntities(snapshot.entities.filter(entity => entity.character?.kind === 'player' && entity.transform && entity.motion).map(entity => entity.id));
    const previous = this.audioPrevious;
    for (const entity of snapshot.entities) {
      if (!entity.transform || !entity.motion || entity.character?.kind !== 'player') continue;
      const before = previous?.entities.find(candidate => candidate.id === entity.id)?.motion;
      this.audio?.movement({ entityId: entity.id, tick: snapshot.tick, position: entity.transform.position,
        grounded: entity.motion.grounded, sprinting: entity.motion.locomotion === 'sprint',
        jumpStarted: origin === 'live' && before?.grounded === true && entity.motion.phase === 'rising' && entity.motion.verticalVelocity > 0,
        origin });
    }
    this.audioPrevious = snapshot;
  }
  private audioMessage(id: string, stream: string, origin: AudioOrigin): void {
    this.audio?.message({ id, stream, sequence: ++this.audioMessageSequence, origin });
  }
  private baselineAudioMessages(): void {
    for (const message of this.snapshot.chatMessages) this.audioMessage(`chat:${message.id}`, 'chat', 'history');
    for (const event of babylonAudioHistory(this.snapshot.babylon?.state)) this.audioMessage(event.id, event.stream, event.origin);
  }

  private updateHud(force = false): void {
    if (!this.current || this.snapshot.screen !== 'playing') return;
    const transform = this.current.entities.find((entity) => entity.id === this.session?.playerId)?.transform;
    const player = transform?.position;
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
    if (this.snapshot.mapOpen) {
      const mapPlayer = { x: player.x, z: player.z, yaw: transform!.rotationY, authoritative: this.session instanceof OnlineSession };
      const old = this.snapshot.mapPlayer;
      if (!old || old.x !== mapPlayer.x || old.z !== mapPlayer.z || old.yaw !== mapPlayer.yaw) Object.assign(changes, { mapPlayer });
      const members = this.snapshot.babylon?.state?.party?.members ?? [];
      const peers: MapPeer[] = [...(this.snapshot.babylon?.state?.partyPositions ?? [])];
      if (this.session instanceof OnlineSession) for (const member of members) {
        if (member.id === this.session.playerId) continue;
        const transform = this.current.entities.find(entity => entity.id === member.id)?.transform;
        if (transform) {
          const peer = { id: member.id, name: member.name, x: transform.position.x, z: transform.position.z };
          const index = peers.findIndex(item => item.id === member.id);
          if (index === -1) peers.push(peer); else peers[index] = peer;
        }
      }
      if (JSON.stringify(peers) !== JSON.stringify(this.snapshot.mapPeers)) Object.assign(changes, { mapPeers: peers });
    }
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

  private readonly cancelEntryCapture = (): void => { if (this.snapshot.entryStage === 'loading') this.autoCaptureEntry = false; };
  private readonly onEntryKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') this.cancelEntryCapture(); };

  private readonly onVisibilityChange = (): void => {
    this.frameMetrics.reset();
    if (document.hidden) { this.input?.reset(); this.cancelEntryCapture(); }
    this.loop?.setSuspended(document.hidden);
  };

  private detach(): void {
    this.loop?.stop();
    this.observer?.disconnect();
    this.observer = null;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('blur', this.cancelEntryCapture);
    document.removeEventListener('keydown', this.onEntryKey);
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
    this.patch({ carryHint: null, carryPending: false, carryError: null, heldItemId: null });
    this.host = null;
  }

  private releaseScene(): void {
    this.audio?.dispose(); this.audio = null; this.audioPrevious = null;
    if (this.snapshot.debug) this.patch({ audioStats: this.audioDiagnostics() });
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
