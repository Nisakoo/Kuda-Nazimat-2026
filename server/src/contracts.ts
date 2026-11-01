/** Shared application boundaries for world/network, platform/data and BABEL.
 * Types only; implementations are composed in app/application.ts.
 */
import type { Server as HttpServer } from 'node:http';
import type { Vector3 } from '../../shared/world/types.ts';
import type { Logger } from './common/logger.ts';
import type { Metrics } from './common/metrics.ts';
import type { Clock, Scheduler } from './common/time.ts';

export interface PlayerIdentity { readonly accountId: string; readonly playerId: string; readonly displayName: string }

// ── Implemented by part B, consumed by part A ──────────────────────────────

/** AUTH-003: token check for the Socket.IO handshake. */
/** sessionId is the public session id for logs (AUTH-002), never the token. */
export type SessionCheck = { readonly ok: true; readonly identity: PlayerIdentity; readonly expiresAt: number; readonly sessionId?: string } | { readonly ok: false };
export interface SessionVerifier { verify(token: string): Promise<SessionCheck> }

/** STORE-001/003: saved player position. */
export interface SavedPosition { readonly mapId: string; readonly position: Vector3; readonly rotationY: number }
export interface PlayerStore {
  load(playerId: string): SavedPosition | null;
  save(players: readonly (SavedPosition & { readonly id: string })[]): void;
}

/** NPC-001–004: part A checks target/distance and delivers; part B queues, calls NpcResponder, stores history. */
export interface NpcProfile { readonly id: string; readonly name: string; readonly topic: string; readonly persona: string; readonly greeting: string }
export interface NpcQuestion {
  readonly connectionId: string;
  readonly requestId: string;
  readonly player: PlayerIdentity;
  readonly npc: NpcProfile;
  readonly question: string;
}
/** player-busy → RATE_LIMIT; server-busy/timeout/unavailable → UNAVAILABLE; cancelled → send nothing. */
export type NpcAnswer =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: 'player-busy' | 'server-busy' | 'timeout' | 'unavailable' | 'cancelled' };
export interface NpcQuestions {
  /** With onPartial the answer is streamed (PROTO-007): whole text so far, display-only, with the longer stream deadline. */
  ask(question: NpcQuestion, onPartial?: (text: string) => void): Promise<NpcAnswer>;
  /** npc-cancel: aborts one question of this connection; unknown or finished questions are ignored. */
  cancel(connectionId: string, requestId: string): void;
  /** Disconnect, takeover, session expiry. */
  cancelConnection(connectionId: string): void;
}

// ── Implemented by part A, consumed by part B ──────────────────────────────

/** SERVER-WORLD-005/006: resolved file for GET /world/<path>; ok:false → 404. */
export interface WorldFile { readonly absolutePath: string; readonly bytes: number; readonly contentType: string }
export type WorldFileAccess = { readonly ok: true; readonly file: WorldFile } | { readonly ok: false };

/** OFFLINE-010: who holds a seat, for the operator screen; no tokens, texts or positions. */
export interface PlayerPresence {
  readonly name: string; readonly mapId: string | null; readonly connected: boolean; readonly releaseInMs: number | null;
  /** OBS-010: median Engine.IO heartbeat RTT of the last minute, reconnects in 10 min, seconds since the seat was taken. */
  readonly rttMs: number | null; readonly reconnects: number; readonly seatedSeconds: number;
}

export interface MapSummary { readonly mapId: string; readonly worldBytes: number; readonly chunks: number }

/** Subset of server config (SERVER-004) the game needs; paths already absolute. */
export interface GameConfig {
  readonly worldDir: string;
  readonly maps: Readonly<Record<string, string>>;
  readonly contentDir: string;
  readonly maxPlayers: number;
  readonly tickHz: number;
  readonly broadcastHz: number;
  readonly aoiRadius: number;
  readonly staticChunkRadius: number;
  readonly disconnectGraceMs: number;
  readonly saveIntervalMs: number;
  readonly corsOrigins: readonly string[];
}
export interface GameDeps {
  readonly babylon?: { enrolled(playerId: string): boolean; spawn(playerId: string): { mapId: string; position: Vector3; force: boolean } | null; entered(playerId: string): void };
  readonly sessions: SessionVerifier;
  readonly players: PlayerStore;
  readonly npc: NpcQuestions;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
  readonly metrics?: Metrics;
  /** Engine.IO heartbeat interval, also the RTT sampling period (OBS-010). */
  readonly pingIntervalMs?: number;
  /** OBS-005: validate every outgoing packet (development). */
  readonly validateOutgoing?: boolean;
}
export interface GameRuntime {
  canAct?(accountId: string, sessionKey: string): boolean;
  location?(accountId: string): { mapId: string; position: Vector3 } | null;
  readonly maps: readonly MapSummary[];
  /** Access check by the account's authoritative position; B verifies the Bearer token first. */
  worldFile(path: string, accountId: string): WorldFileAccess;
  /** Mounts Socket.IO namespace /game on B's HTTP server and starts the tick loop. */
  attach(server: HttpServer): void;
  activePlayers(): number;
  presence(): readonly PlayerPresence[];
  /** AUTH-012: closes every game connection of these sessions (token hashes) with the given message. */
  closeSessions(tokenHashes: readonly string[], message: string): void;
  /** Seats, connections and queue counters for incident dumps (OBS-004); no names or texts. */
  state(): Record<string, unknown>;
  /** Last minute p95 of the step and broadcast interval (OBS-010); null before the first minute. */
  stats(): { readonly tickP95Ms: number; readonly broadcastP95Ms: number; readonly players: number } | null;
  /** SERVER-005: closes connections and saves positions. */
  stop(reason: string): Promise<void>;
}
/** Exported by part A from src/game/index.ts; loads and validates the world (fails fast). */
export type CreateGame = (config: GameConfig, deps: GameDeps) => Promise<GameRuntime>;
