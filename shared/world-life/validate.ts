import type { Vector3 } from '../world/types.ts';
import { WORLD_LIFE_LIMITS as L } from './types.ts';
import type { AppleState, CatDefinition, HandErrorCode, HandResultMessage, ObjectInstance, SceneSchedule, WorldLifeClientMessage, WorldLifeDefinition, WorldLifeServerMessage } from './types.ts';

export class WorldLifeError extends Error {
  readonly code: 'INVALID' | 'VERSION';
  constructor(code: 'INVALID' | 'VERSION' = 'INVALID') { super(`World life: ${code}`); this.code = code; }
}
const fail = (): never => { throw new WorldLifeError(); };
function obj(v: unknown): Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail(); }
function keys(o: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some(k => !(k in o)) || Object.keys(o).some(k => !required.includes(k) && !optional.includes(k))) fail();
}
function num(v: unknown, min = -100000, max = 100000): number { return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail(); }
function integer(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number { const n = num(v, min, max); return Number.isSafeInteger(n) ? n : fail(); }
function id(v: unknown): string { return typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(v) ? v : fail(); }
function text(v: unknown): string { return typeof v === 'string' && v.length > 0 && v.length <= 240 ? v : fail(); }
function choice<T extends string>(v: unknown, choices: readonly T[]): T { return choices.includes(v as T) ? v as T : fail(); }
function arr<T>(v: unknown, max: number, parse: (v: unknown) => T, min = 0): T[] { return Array.isArray(v) && v.length >= min && v.length <= max ? v.map(parse) : fail(); }
function unique<T>(items: readonly T[], key: (v: T) => string): void { if (new Set(items.map(key)).size !== items.length) fail(); }
function vector(v: unknown): Vector3 { const o = obj(v); keys(o, ['x','y','z']); return { x: num(o.x), y: num(o.y), z: num(o.z) }; }
function packet(v: unknown): Record<string, unknown> {
  let json: string | undefined;
  try { json = JSON.stringify(v); } catch { fail(); }
  // ASCII <=1 byte; non-ASCII <=3 bytes per UTF-16 code unit. Exact UTF-8 count without DOM/Node.
  if (!json || json.length > L.packetBytes) throw new WorldLifeError();
  let bytes = 0;
  for (let i = 0; i < json.length; i++) { const c = json.charCodeAt(i); bytes += c < 128 ? 1 : c < 2048 ? 2 : c >= 0xd800 && c <= 0xdbff && i + 1 < json.length ? (i++, 4) : 3; }
  if (bytes > L.packetBytes) fail();
  const o = obj(v); if (o.v !== 1) throw new WorldLifeError('VERSION'); return o;
}
function schedule(v: unknown, periodMin: number, periodMax: number, durationMin: number, durationMax: number): SceneSchedule {
  const o = obj(v); keys(o, ['periodMs','durationMs','offsetMs']);
  const periodMs = integer(o.periodMs, periodMin, periodMax);
  return { periodMs, durationMs: integer(o.durationMs, durationMin, durationMax), offsetMs: integer(o.offsetMs, 0, periodMs - 1) };
}
function instance(v: unknown): ObjectInstance {
  const o = obj(v); keys(o, ['id','templateId','position','rotationY'], ['zone']);
  let zone: ObjectInstance['zone'];
  if (o.zone !== undefined) { const z = obj(o.zone); keys(z, ['minX','maxX','minZ','maxZ']); zone = { minX: num(z.minX), maxX: num(z.maxX), minZ: num(z.minZ), maxZ: num(z.maxZ) }; if (zone.minX >= zone.maxX || zone.minZ >= zone.maxZ) fail(); }
  return { id: id(o.id), templateId: id(o.templateId), position: vector(o.position), rotationY: num(o.rotationY), ...(zone && { zone }) };
}
function cat(v: unknown): CatDefinition {
  const o = obj(v); keys(o, ['instanceId','behavior','route','cycleMs','pauseMs']);
  const behavior = choice(o.behavior, ['sleep','walk','wash']);
  const route = arr(o.route, L.routePoints, vector, behavior === 'walk' ? 2 : 1);
  if (behavior !== 'walk' && route.length !== 1) fail();
  const cycleMs = integer(o.cycleMs, 1000, 120000); const pauseMs = integer(o.pauseMs, 0, cycleMs - 1);
  return { instanceId: id(o.instanceId), behavior, route, cycleMs, pauseMs };
}
export function parseWorldLifeDefinition(raw: unknown, models?: Readonly<Record<string, string>>, mapId?: string): WorldLifeDefinition {
  const o = packet(raw); keys(o, ['v','mapId','seed','templates','instances','cats','flock','wind']);
  const templates = arr(o.templates, L.templates, v => { const t = obj(v); keys(t, ['id','assetId','behavior','animation']); return { id: id(t.id), assetId: id(t.assetId), behavior: choice(t.behavior, ['static','animated','pushable','pickup']), animation: id(t.animation) }; }, 1);
  const instances = arr(o.instances, L.instances, instance, 12);
  unique(templates, t => t.id); unique(instances, i => i.id);
  for (const i of instances) {
    const template = templates.find(t => t.id === i.templateId); if (!template || (template.behavior === 'pushable') !== !!i.zone) fail();
    if (i.zone && (i.position.x - L.potRadius < i.zone.minX || i.position.x + L.potRadius > i.zone.maxX || i.position.z - L.potRadius < i.zone.minZ || i.position.z + L.potRadius > i.zone.maxZ)) fail();
  }
  for (const [behavior, count] of [['pushable',L.pots],['pickup',L.apples]] as const) if (instances.filter(i => templates.find(t => t.id === i.templateId)?.behavior === behavior).length !== count) fail();
  const cats = arr(o.cats, L.cats, cat, L.cats); unique(cats, c => c.instanceId); unique(cats, c => c.behavior);
  for (const c of cats) { const i = instances.find(i => i.id === c.instanceId); if (!i || templates.find(t => t.id === i.templateId)?.behavior !== 'animated' || JSON.stringify(i.position) !== JSON.stringify(c.route[0])) fail(); }
  const f = obj(o.flock); keys(f, ['assetId','count','route','schedule']);
  const flock = { assetId: id(f.assetId), count: integer(f.count, 4, 6), route: arr(f.route, L.routePoints, vector, 2), schedule: schedule(f.schedule, 90000, 150000, 8000, 12000) };
  if (flock.route.some(p => p.y < 10 || p.y > 16)) fail();
  const w = obj(o.wind); keys(w, ['strength','gustStrength','schedule']);
  const wind = { strength: num(w.strength, 0, 1), gustStrength: num(w.gustStrength, 0, 1), schedule: schedule(w.schedule, 45000, 90000, 2000, 4000) };
  if (models && [...templates.map(t => t.assetId), flock.assetId].some(a => !Object.hasOwn(models, a))) fail();
  const parsedMap = id(o.mapId); if (mapId && parsedMap !== mapId) fail();
  return { v: 1, mapId: parsedMap, seed: integer(o.seed, 0, 0xffffffff), templates, instances, cats, flock, wind };
}
export function parseWorldLifeClientMessage(raw: unknown): WorldLifeClientMessage {
  const o = packet(raw); const requestId = id(o.requestId);
  if (o.type === 'scene-sync') { keys(o, ['v','type','requestId']); return { v: 1, type: 'scene-sync', requestId }; }
  if (o.type !== 'hand') fail();
  if (o.action === 'pickup') { keys(o, ['v','type','requestId','action','targetId']); return { v: 1, type: 'hand', requestId, action: 'pickup', targetId: id(o.targetId) }; }
  keys(o, ['v','type','requestId','action']); if (o.action !== 'place') fail();
  return { v: 1, type: 'hand', requestId, action: 'place' };
}
export function parseAppleState(raw: unknown): AppleState {
  const o = obj(raw); const base = { id: id(o.id), mapId: id(o.mapId) };
  if (o.state === 'world') { keys(o, ['id','mapId','state','position']); return { ...base, state: 'world', position: vector(o.position) }; }
  keys(o, ['id','mapId','state','holderId']); if (o.state !== 'held') fail(); return { ...base, state: 'held', holderId: id(o.holderId) };
}
const CODES: readonly HandErrorCode[] = ['INVALID','VERSION','UNAUTHORIZED','NOT_READY','FORBIDDEN','NOT_FOUND','TOO_FAR','BLOCKED','HANDS_FULL','HANDS_EMPTY','CONFLICT','RATE_LIMIT','UNAVAILABLE'];
export function parseWorldLifeServerMessage(raw: unknown): WorldLifeServerMessage {
  const o = packet(raw);
  if (o.type === 'hand-result') {
    const requestId = id(o.requestId);
    if (o.ok === true) {
      keys(o, ['v','type','requestId','ok','action','apple']);
      const action = choice(o.action, ['pickup','place']); const apple = parseAppleState(o.apple);
      if ((action === 'pickup') !== (apple.state === 'held')) fail();
      return { v: 1, type: 'hand-result', requestId, ok: true, action, apple };
    }
    keys(o, ['v','type','requestId','ok','code','message']); if (o.ok !== false) fail();
    return { v: 1, type: 'hand-result', requestId, ok: false, code: choice(o.code, CODES), message: text(o.message) };
  }
  keys(o, ['v','type','sceneId','revision','serverTimeMs','epochMs','definition','pots','apples']); if (o.type !== 'scene-state') fail();
  const definition = parseWorldLifeDefinition(o.definition);
  const pots = arr(o.pots, L.pots, v => { const p = obj(v); keys(p, ['id','position']); return { id: id(p.id), position: vector(p.position) }; }, L.pots);
  const apples = arr(o.apples, L.apples, parseAppleState, L.apples);
  unique(pots, p => p.id); unique(apples, a => a.id); unique(apples.filter(a => a.state === 'held'), a => a.state === 'held' ? a.holderId : '');
  for (const [items, behavior] of [[pots,'pushable'],[apples,'pickup']] as const) for (const item of items) {
    const i = definition.instances.find(i => i.id === item.id); if (!i || definition.templates.find(t => t.id === i.templateId)?.behavior !== behavior) fail();
  }
  for (const p of pots) {
    const zone = definition.instances.find(i => i.id === p.id)!.zone!;
    if (p.position.x-L.potRadius < zone.minX || p.position.x+L.potRadius > zone.maxX || p.position.z-L.potRadius < zone.minZ || p.position.z+L.potRadius > zone.maxZ) fail();
  }
  if (apples.some(a => a.mapId !== definition.mapId)) fail();
  return { v: 1, type: 'scene-state', sceneId: id(o.sceneId), revision: integer(o.revision), serverTimeMs: integer(o.serverTimeMs), epochMs: integer(o.epochMs), definition, pots, apples };
}
export function handFailure(requestId: string, code: HandErrorCode, message: string): HandResultMessage { return { v: 1, type: 'hand-result', requestId, ok: false, code, message }; }
