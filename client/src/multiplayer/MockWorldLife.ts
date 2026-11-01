import type { Entity, Vector3 } from '../core/types';
import type { AppleState, HandResultMessage, SceneStateMessage, WorldLifeClientMessage, WorldLifeDefinition } from '../../../shared/world-life/types.ts';
import { WORLD_LIFE_LIMITS } from '../../../shared/world-life/types.ts';
import type { MockNetworkAdapter } from './MockNetworkAdapter';

/** Explicit synthetic backend for the test network. No persistence or real map collision proof. */
export class MockWorldLife {
  private readonly receipts = new Map<string, { fingerprint: string; result: HandResultMessage }>();
  private scene: SceneStateMessage;
  constructor(mapId: string, epochMs: number, spawn: Vector3) {
    const at = (x: number, z: number): Vector3 => ({ x: spawn.x + x, y: spawn.y, z: spawn.z + z });
    const apples = Array.from({ length: 5 }, (_, i): AppleState => ({ id: `mock-apple-${i}`, mapId, state: 'world', position: at(i ? i + 1 : 0, -1) }));
    const pots = Array.from({ length: 4 }, (_, i) => ({ id: `mock-pot-${i}`, position: at(-7 + i * 4, 5) }));
    const behaviors = ['sleep', 'walk', 'wash'] as const;
    const cats = behaviors.map((behavior, i) => ({ instanceId: `mock-cat-${i}`, behavior, route: behavior === 'walk' ? [at(-8, -5), at(-8, -8)] : [at(8, i * 4 - 4)], cycleMs: 8000, pauseMs: 1000 }));
    const definition: WorldLifeDefinition = {
      v: 1, mapId, seed: 42,
      templates: [
        { id: 'apple', assetId: 'life-apple', behavior: 'pickup', animation: 'idle' },
        { id: 'pot', assetId: 'life-pot', behavior: 'pushable', animation: 'idle' },
        { id: 'cat', assetId: 'life-cat', behavior: 'animated', animation: 'idle' },
      ],
      instances: [
        ...apples.map(apple => ({ id: apple.id, templateId: 'apple', position: apple.state === 'world' ? apple.position : spawn, rotationY: 0 })),
        ...pots.map(pot => ({ id: pot.id, templateId: 'pot', position: pot.position, rotationY: 0, zone: { minX: pot.position.x - 2, maxX: pot.position.x + 2, minZ: pot.position.z - 2, maxZ: pot.position.z + 2 } })),
        ...cats.map(cat => ({ id: cat.instanceId, templateId: 'cat', position: cat.route[0]!, rotationY: 0 })),
      ], cats,
      flock: { assetId: 'life-bird', count: 5, route: [{ x: -10, y: 14, z: spawn.z - 8 }, { x: 10, y: 14, z: spawn.z - 8 }], schedule: { periodMs: 120000, durationMs: 10000, offsetMs: 0 } },
      wind: { strength: .1, gustStrength: .3, schedule: { periodMs: 60000, durationMs: 3000, offsetMs: 0 } },
    };
    this.scene = { v: 1, type: 'scene-state', sceneId: `mock-scene-${epochMs}`, revision: 0, serverTimeMs: epochMs, epochMs, definition, pots, apples };
  }
  snapshot(now: number): SceneStateMessage { return { ...this.scene, serverTimeMs: now }; }
  receive(message: WorldLifeClientMessage, transport: MockNetworkAdapter, actor: Entity | undefined, now: number): void {
    if (message.type === 'scene-sync') { transport.receiveWorldLife(this.snapshot(now)); return; }
    const fingerprint = JSON.stringify(message);
    const receipt = this.receipts.get(message.requestId);
    if (receipt) {
      transport.receiveWorldLife(receipt.fingerprint === fingerprint ? receipt.result : { v: 1, type: 'hand-result', requestId: message.requestId, ok: false, code: 'CONFLICT', message: 'Тест: идентификатор уже использован для другого действия.' });
      transport.receiveWorldLife(this.snapshot(now)); return;
    }
    const base = { v: 1 as const, type: 'hand-result' as const, requestId: message.requestId };
    const fail = (code: 'NOT_READY' | 'HANDS_FULL' | 'HANDS_EMPTY' | 'TOO_FAR' | 'BLOCKED', text: string): HandResultMessage => ({ ...base, ok: false, code, message: `Тест: ${text}` });
    const position = actor?.transform?.position;
    const held = this.scene.apples.find(apple => apple.state === 'held' && apple.holderId === actor?.id);
    let result: HandResultMessage;
    if (!position || !actor) result = fail('NOT_READY', 'игрок ещё не вошёл.');
    else if (message.action === 'pickup') {
      const nearest = this.scene.apples.flatMap(apple => apple.state === 'world' ? [{ apple, distance: Math.hypot(position.x - apple.position.x, position.y - apple.position.y, position.z - apple.position.z) }] : []).filter(candidate => candidate.distance <= WORLD_LIFE_LIMITS.pickupDistance).sort((a, b) => a.distance - b.distance || a.apple.id.localeCompare(b.apple.id))[0]?.apple;
      if (held) result = fail('HANDS_FULL', 'руки заняты.');
      else if (!nearest || nearest.id !== message.targetId) result = fail('TOO_FAR', 'яблоко недоступно.');
      else result = { ...base, ok: true, action: 'pickup', apple: { id: nearest.id, mapId: nearest.mapId, state: 'held', holderId: actor.id } };
    } else if (!held) result = fail('HANDS_EMPTY', 'руки свободны.');
    else {
      const rotation = actor.transform!.rotationY;
      const destination = { x: position.x + Math.sin(rotation) * .9, y: position.y, z: position.z + Math.cos(rotation) * .9 };
      const occupied = actor.motion?.grounded === false || this.scene.apples.some(apple => apple.state === 'world' && Math.hypot(apple.position.x - destination.x, apple.position.z - destination.z) < .3) || this.scene.pots.some(pot => Math.hypot(pot.position.x - destination.x, pot.position.z - destination.z) < .45);
      result = occupied ? fail('BLOCKED', 'нет свободной поверхности перед игроком.') : { ...base, ok: true, action: 'place', apple: { id: held.id, mapId: held.mapId, state: 'world', position: destination } };
    }
    if (result.ok) this.scene = { ...this.scene, revision: this.scene.revision + 1, apples: this.scene.apples.map(apple => apple.id === result.apple.id ? result.apple : apple) };
    this.receipts.set(message.requestId, { fingerprint, result });
    if (this.receipts.size > 128) this.receipts.delete(this.receipts.keys().next().value!);
    transport.receiveWorldLife(result); transport.receiveWorldLife(this.snapshot(now));
  }
}
