import type { Entity, Vector3, WorldSnapshot } from '../world/types.ts';
import type { ClientMessage, ServerMessage, ServerSession, WorldDescriptor, ErrorCode } from './types.ts';
import { ERROR_CODES, LIMITS } from './types.ts';

export class ProtocolError extends Error {
  readonly code: ErrorCode;
  constructor(message: string, code: ErrorCode = 'INVALID') { super(message); this.name = 'ProtocolError'; this.code = code; }
}
function invalid(): never { throw new ProtocolError('Некорректное сообщение игрового протокола.'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some((key) => !(key in value)) || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) invalid();
}
function string(value: unknown, max: number): string { if (typeof value !== 'string' || !value.trim() || value.length > max) return invalid(); return value; }
function id(value: unknown): string { const result = string(value, 80); if (!/^[A-Za-z0-9_-]+$/.test(result)) return invalid(); return result; }
function number(value: unknown, min: number, max: number): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return invalid(); return value; }
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number { const result = number(value, min, max); if (!Number.isSafeInteger(result)) return invalid(); return result; }
function array<T>(value: unknown, max: number, read: (item: unknown) => T): T[] { if (!Array.isArray(value) || value.length > max) return invalid(); return value.map(read); }
function unique(values: readonly string[]): void { if (new Set(values).size !== values.length) invalid(); }
function vector(value: unknown): Vector3 { const v = object(value); keys(v, ['x', 'y', 'z']); return { x: number(v.x, -1e6, 1e6), y: number(v.y, -1e6, 1e6), z: number(v.z, -1e6, 1e6) }; }
function direction(value: unknown) { const d = object(value); keys(d, ['x', 'z']); const x = number(d.x, -1, 1); const z = number(d.z, -1, 1); if (Math.hypot(x, z) > 1 + 1e-12) invalid(); return { x, z }; }
function entity(value: unknown): Entity {
  const e = object(value); keys(e, ['id'], ['transform', 'movement', 'renderable', 'interactable', 'character', 'animationState', 'motion']);
  const result: { -readonly [K in keyof Entity]: Entity[K] } = { id: id(e.id) };
  if (e.transform !== undefined) { const t = object(e.transform); keys(t, ['position', 'rotationY']); result.transform = { position: vector(t.position), rotationY: number(t.rotationY, -1e6, 1e6) }; }
  if (e.movement !== undefined) { const m = object(e.movement); keys(m, ['direction', 'speed']); result.movement = { direction: direction(m.direction), speed: number(m.speed, 0, 20) }; }
  if (e.renderable !== undefined) { const r = object(e.renderable); keys(r, ['assetId']); result.renderable = { assetId: id(r.assetId) }; }
  if (e.interactable !== undefined) { const i = object(e.interactable); keys(i, ['radius', 'label']); result.interactable = { radius: number(i.radius, 0, 20), label: string(i.label, 80) }; }
  if (e.character !== undefined) { const c = object(e.character); keys(c, ['kind', 'name']); if (c.kind !== 'player' && c.kind !== 'npc') invalid(); result.character = { kind: c.kind, name: string(c.name, 80) }; }
  if (e.animationState !== undefined) { const a = object(e.animationState); keys(a, ['name']); result.animationState = { name: id(a.name) }; }
  if (e.motion !== undefined) {
    const m = object(e.motion); keys(m, ['grounded', 'phase', 'verticalVelocity', 'locomotion', 'stamina', 'sprintBlocked', 'jumpAck']);
    if (typeof m.grounded !== 'boolean' || typeof m.sprintBlocked !== 'boolean' || !['grounded', 'rising', 'falling'].includes(m.phase as string) || !['idle', 'walk', 'sprint'].includes(m.locomotion as string)) invalid();
    const verticalVelocity = number(m.verticalVelocity, -100, 100);
    if (m.grounded !== (m.phase === 'grounded') || (m.grounded && verticalVelocity !== 0) || (m.phase === 'rising' && verticalVelocity <= 0) || (m.phase === 'falling' && verticalVelocity > 0)) invalid();
    result.motion = { grounded: m.grounded, phase: m.phase as 'grounded' | 'rising' | 'falling', verticalVelocity, locomotion: m.locomotion as 'idle' | 'walk' | 'sprint', stamina: number(m.stamina, 0, 100), sprintBlocked: m.sprintBlocked, jumpAck: integer(m.jumpAck) };
  }
  if (result.character?.kind === 'player' && !result.motion) invalid();
  return result;
}
function entities(value: unknown): Entity[] { const result = array(value, LIMITS.entities, entity); unique(result.map((item) => item.id)); return result; }
function snapshot(value: unknown): WorldSnapshot { const s = object(value); keys(s, ['tick', 'entities']); return { tick: integer(s.tick), entities: entities(s.entities) }; }
function path(value: unknown): string {
  const result = string(value, 256);
  if (!/^[A-Za-z0-9_./-]+$/.test(result) || result.startsWith('/') || result.split('/').includes('..')) invalid();
  return result;
}
export function parseWorldDescriptor(value: unknown): WorldDescriptor {
  const w = object(value); keys(w, ['manifestUrl', 'worldBytes', 'manifestBytes', 'assets']);
  const worldBytes = integer(w.worldBytes, 1, 1e12); const manifestBytes = integer(w.manifestBytes, 1, Math.floor(worldBytes / 10));
  const raw = object(w.assets); if (Object.keys(raw).length > 128) invalid();
  const assets: Record<string, { bytes: number; memory: number }> = Object.create(null) as Record<string, { bytes: number; memory: number }>;
  for (const [url, size] of Object.entries(raw)) { path(url); const s = object(size); keys(s, ['bytes', 'memory']); const bytes = integer(s.bytes, 1, Math.floor(worldBytes / 10)); assets[url] = { bytes, memory: integer(s.memory, bytes, 32 * 1024 * 1024) }; }
  return { manifestUrl: path(w.manifestUrl), worldBytes, manifestBytes, assets };
}
export function parseServerSession(value: unknown, now: number): ServerSession {
  const s = object(value); keys(s, ['token', 'expiresAt']); const token = string(s.token, 512);
  if (token.length < 16 || /[\s\x00-\x1f\x7f]/.test(token)) invalid();
  return { token, expiresAt: integer(s.expiresAt, Math.floor(now) + 1) };
}
/** UTF-8 size of a string, without TextEncoder so the module stays free of DOM/Node globals. */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const char of text) { const point = char.codePointAt(0)!; bytes += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4; }
  return bytes;
}
function packet(raw: unknown): Record<string, unknown> {
  let encoded: string;
  try { encoded = typeof raw === 'string' ? raw : JSON.stringify(raw); } catch { return invalid(); }
  if (typeof encoded !== 'string' || encoded.length > LIMITS.packetBytes) invalid();
  if (utf8Bytes(encoded) > LIMITS.packetBytes) invalid();
  let value: unknown;
  try { value = JSON.parse(encoded); } catch { return invalid(); }
  const p = object(value);
  if (p.v !== 3) throw new ProtocolError('Несовместимая версия игрового протокола.', 'VERSION');
  string(p.type, 32);
  return p;
}
/** Best-effort requestId of a rejected packet, so the error can still be correlated. */
export function peekRequestId(raw: unknown): string | null {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).requestId : undefined;
  return typeof value === 'string' && value.length <= 80 && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}
export function parseClientMessage(raw: unknown): ClientMessage {
  const p = packet(raw); const requestId = id(p.requestId); const base = ['v', 'type', 'requestId']; const request = { v: 3 as const, requestId };
  switch (p.type) {
    case 'join': keys(p, [...base, 'mapId']); return { ...request, type: 'join', mapId: id(p.mapId) };
    case 'input': { keys(p, [...base, 'sequence', 'direction', 'preparedChunks', 'sprint', 'jumpId']); const preparedChunks = array(p.preparedChunks, 25, id); unique(preparedChunks); if (typeof p.sprint !== 'boolean') invalid(); return { ...request, type: 'input', sprint: p.sprint, jumpId: integer(p.jumpId), sequence: integer(p.sequence, 1), direction: direction(p.direction), preparedChunks }; }
    case 'interact': keys(p, [...base, 'targetId']); return { ...request, type: 'interact', targetId: id(p.targetId) };
    case 'npc-question': keys(p, [...base, 'targetId', 'text']); return { ...request, type: 'npc-question', targetId: id(p.targetId), text: string(p.text, LIMITS.question) };
    case 'chat-send': keys(p, [...base, 'text']); return { ...request, type: 'chat-send', text: string(p.text, LIMITS.chat) };
    case 'resync': keys(p, [...base, 'revision']); return { ...request, type: 'resync', revision: integer(p.revision) };
    default: return invalid();
  }
}
export function parseServerMessage(raw: unknown): ServerMessage {
  const p = packet(raw); const base = ['v', 'type']; const request = [...base, 'requestId'];
  switch (p.type) {
    case 'joined': { keys(p, [...request, 'playerId', 'revision', 'snapshot', 'world']); const playerId = id(p.playerId); const state = snapshot(p.snapshot); if (!state.entities.some((e) => e.id === playerId && e.character?.kind === 'player' && e.transform)) invalid(); return { v: 3, type: 'joined', requestId: id(p.requestId), playerId, revision: integer(p.revision), snapshot: state, world: parseWorldDescriptor(p.world) }; }
    case 'snapshot': keys(p, [...base, 'revision', 'snapshot']); return { v: 3, type: 'snapshot', revision: integer(p.revision), snapshot: snapshot(p.snapshot) };
    case 'delta': { keys(p, [...base, 'revision', 'baseRevision', 'tick', 'upsert', 'remove']); const upsert = entities(p.upsert); const remove = array(p.remove, 128, id); unique(remove); if (upsert.some((e) => remove.includes(e.id))) invalid(); return { v: 3, type: 'delta', revision: integer(p.revision, 1), baseRevision: integer(p.baseRevision), tick: integer(p.tick), upsert, remove }; }
    case 'interacted': keys(p, [...request, 'targetId']); return { v: 3, type: 'interacted', requestId: id(p.requestId), targetId: id(p.targetId) };
    case 'npc-answer': keys(p, [...request, 'targetId', 'text']); return { v: 3, type: 'npc-answer', requestId: id(p.requestId), targetId: id(p.targetId), text: string(p.text, LIMITS.answer) };
    case 'chat': keys(p, [...request, 'messageId', 'playerId', 'name', 'text']); return { v: 3, type: 'chat', requestId: id(p.requestId), messageId: id(p.messageId), playerId: id(p.playerId), name: string(p.name, 80), text: string(p.text, LIMITS.chat) };
    case 'error': { keys(p, [...request, 'code', 'message']); const codes: readonly unknown[] = ERROR_CODES; if (!codes.includes(p.code)) invalid(); return { v: 3, type: 'error', requestId: id(p.requestId), code: p.code as ErrorCode, message: string(p.message, 500) }; }
    default: return invalid();
  }
}
