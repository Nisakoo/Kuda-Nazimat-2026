import { Group } from 'three';
import type { Mesh, Scene } from 'three';
import type { Entity, EntityId, Transform, WorldSnapshot } from '../../core/types';
import { DEMO_NPCS } from '../../shared/demo';
import type { SceneAssets } from './SceneAssets';

interface Visual {
  readonly group: Group;
  readonly limbs: readonly Mesh[];
  readonly token: string;
  previous: Transform;
  current: Transform;
  walking: boolean;
}

export class EntityVisuals {
  private readonly visuals = new Map<EntityId, Visual>();
  constructor(private readonly scene: Scene, private readonly assets: SceneAssets) {}

  sync(previous: WorldSnapshot, current: WorldSnapshot, playerId: EntityId | null): void {
    const old = new Map(previous.entities.map((entity) => [entity.id, entity]));
    const live = new Set<EntityId>();
    for (const entity of current.entities) {
      if (!entity.transform || !entity.renderable) continue;
      live.add(entity.id);
      const token = `${entity.renderable.assetId}:${entity.character?.name ?? ''}:${entity.id === playerId}`;
      let visual = this.visuals.get(entity.id);
      if (visual && visual.token !== token) { this.remove(entity.id); visual = undefined; }
      if (!visual) {
        visual = this.create(entity, token, entity.id === playerId);
        this.visuals.set(entity.id, visual);
        this.scene.add(visual.group);
      }
      visual.previous = old.get(entity.id)?.transform ?? entity.transform;
      visual.current = entity.transform;
      visual.walking = entity.animationState?.name === 'walk';
    }
    for (const id of this.visuals.keys()) if (!live.has(id)) this.remove(id);
  }

  animate(alpha: number, elapsed: number): void {
    for (const visual of this.visuals.values()) {
      const from = visual.previous.position;
      const to = visual.current.position;
      visual.group.position.set(from.x + (to.x - from.x) * alpha, from.y + (to.y - from.y) * alpha, from.z + (to.z - from.z) * alpha);
      const delta = visual.current.rotationY - visual.previous.rotationY;
      visual.group.rotation.y = visual.previous.rotationY + Math.atan2(Math.sin(delta), Math.cos(delta)) * alpha;
      visual.limbs.forEach((limb, index) => { limb.rotation.x = visual.walking ? Math.sin(elapsed * 11 + (index % 2) * Math.PI) * 0.45 : 0; });
    }
  }

  position(id: EntityId | null) { return id ? this.visuals.get(id)?.group.position : undefined; }
  dispose(): void { for (const id of this.visuals.keys()) this.remove(id); }

  private remove(id: EntityId): void {
    const visual = this.visuals.get(id);
    if (visual) this.assets.release(visual.group);
    this.visuals.delete(id);
  }

  private create(entity: Entity, token: string, player: boolean): Visual {
    const transform = entity.transform!;
    const group = new Group();
    group.name = `entity:${entity.id}`;
    const npc = DEMO_NPCS.find((item) => item.id === entity.id);
    const color = npc?.color ?? '#318e81';
    const body = this.assets.mesh('capsule', color);
    body.position.y = 0.95;
    group.add(body);
    const head = this.assets.mesh('sphere', '#eec8a2');
    head.scale.setScalar(0.27);
    head.position.y = 1.73;
    group.add(head);
    const hair = this.assets.mesh('sphere', player ? '#34434b' : '#695343');
    hair.scale.set(0.28, 0.17, 0.28);
    hair.position.set(0, 1.91, -0.015);
    group.add(hair);
    const limbs: Mesh[] = [];
    for (const side of [-1, 1]) {
      const leg = this.assets.mesh('box', '#344b5d');
      leg.scale.set(0.21, 0.52, 0.24);
      leg.position.set(side * 0.16, 0.31, 0);
      group.add(leg);
      limbs.push(leg);
    }
    for (const side of [-1, 1]) {
      const arm = this.assets.mesh('box', color);
      arm.scale.set(0.17, 0.61, 0.23);
      arm.position.set(side * 0.39, 1.02, 0);
      group.add(arm);
      limbs.push(arm);
    }
    const front = this.assets.mesh('box', '#fcf7e9');
    front.scale.set(0.18, 0.18, 0.08);
    front.position.set(0, 1.2, 0.29);
    group.add(front);
    const ring = this.assets.mesh('cylinder', player ? '#8cddc2' : '#e5cf9d');
    ring.scale.set(0.52, 0.035, 0.52);
    ring.position.y = 0.015;
    group.add(ring);
    const label = this.assets.label(player ? 'Вы' : `${npc?.name ?? entity.character?.name} · ${npc?.topic ?? 'Гость'}`);
    if (player) label.scale.set(1, 0.4, 1);
    label.position.y = 2.45;
    group.add(label);
    group.position.set(transform.position.x, transform.position.y, transform.position.z);
    return { group, limbs, token, previous: transform, current: transform, walking: false };
  }
}
