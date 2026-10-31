/**
 * Frozen boundary between the two parallel parts of the server.
 *   Part A (world/network): shared/, src/world/, src/game/, src/realtime/, content/.
 *   Part B (platform/data): src/app/, src/http/, src/auth/, src/persistence/, src/npc/, src/cli/, src/common/.
 * Change this file only by agreement of both parts. Types only — no logic.
 */
import type { Server as HttpServer } from 'node:http';
import type { Vector3 } from '../../shared/world/types.ts';
import type { Logger } from './common/logger.ts';
import type { Clock, Scheduler } from './common/time.ts';

export interface PlayerIdentity { readonly accountId: string; readonly playerId: string; readonly displayName: string }

// ── Implemented by part B, consumed by part A ──────────────────────────────

/** AUTH-003: token check for the Socket.IO handshake. */
export type SessionCheck = { readonly ok: true; readonly identity: PlayerIdentity; readonly expiresAt: number } | { readonly ok: false };
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
  ask(question: NpcQuestion): Promise<NpcAnswer>;
  /** Disconnect, takeover, session expiry. */
  cancelConnection(connectionId: string): void;
}

// ── Implemented by part A, consumed by part B ──────────────────────────────

/** SERVER-WORLD-005/006: resolved file for GET /world/<path>; ok:false → 404. */
export interface WorldFile { readonly absolutePath: string; readonly bytes: number; readonly contentType: string }
export type WorldFileAccess = { readonly ok: true; readonly file: WorldFile } | { readonly ok: false };

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
  readonly sessions: SessionVerifier;
  readonly players: PlayerStore;
  readonly npc: NpcQuestions;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
}
export interface GameRuntime {
  readonly maps: readonly MapSummary[];
  /** Access check by the account's authoritative position; B verifies the Bearer token first. */
  worldFile(path: string, accountId: string): WorldFileAccess;
  /** Mounts Socket.IO namespace /game on B's HTTP server and starts the tick loop. */
  attach(server: HttpServer): void;
  activePlayers(): number;
  /** SERVER-005: closes connections and saves positions. */
  stop(reason: string): Promise<void>;
}
/** Exported by part A from src/game/index.ts; loads and validates the world (fails fast). */
export type CreateGame = (config: GameConfig, deps: GameDeps) => Promise<GameRuntime>;
