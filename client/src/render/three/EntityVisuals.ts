import { Group } from 'three';
import type { Mesh, Scene } from 'three';
import type { Entity, EntityId, Transform, WorldSnapshot } from '../../core/types';
import { DEMO_NPCS } from '../../shared/demo';
import type { SceneAssets } from './SceneAssets';
import type { GltfLibrary, ModelInstance } from './GltfLibrary';

interface Visual {
  readonly group: Group;
  readonly limbs: readonly Mesh[];
  readonly token: string;
  previous: Transform;
  current: Transform;
  walking: boolean;
  animation: string;
  readonly controller: AbortController;
  model: ModelInstance | null;
  failed: boolean;
}

export class EntityVisuals {
  private readonly visuals = new Map<EntityId, Visual>();
  constructor(private readonly scene: Scene, private readonly assets: SceneAssets, private readonly library?: GltfLibrary, private readonly report: (id: string, error: string | null) => void = () => {}) {}
  get ids(): readonly string[] { return [...this.visuals.keys()]; }

  sync(previous: WorldSnapshot, current: WorldSnapshot, playerId: EntityId | null): void {
    const old = new Map(previous.entities.map((entity) => [entity.id, entity]));
    const live = new Set<EntityId>();
    for (const entity of current.entities) {
      if (!entity.transform || !entity.renderable) continue;
      live.add(entity.id);
      const token = `${entity.renderable.assetId}:${entity.character?.name ?? ''}:${entity.id === playerId}:${this.library?.has(entity.renderable.assetId) ?? false}`;
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
      visual.animation = entity.animationState?.name ?? 'idle';
    }
    for (const id of this.visuals.keys()) if (!live.has(id)) this.remove(id);
  }

  animate(alpha: number, elapsed: number, delta = 0): void {
    for (const visual of this.visuals.values()) {
      const from = visual.previous.position;
      const to = visual.current.position;
      visual.group.position.set(from.x + (to.x - from.x) * alpha, from.y + (to.y - from.y) * alpha, from.z + (to.z - from.z) * alpha);
      const yawDelta = visual.current.rotationY - visual.previous.rotationY;
      visual.group.rotation.y = visual.previous.rotationY + Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta)) * alpha;
      visual.limbs.forEach((limb, index) => { limb.rotation.x = visual.walking ? Math.sin(elapsed * 11 + (index % 2) * Math.PI) * 0.45 : 0; });
      visual.model?.animate(visual.animation, delta);
    }
  }

  position(id: EntityId | null) { return id ? this.visuals.get(id)?.group.position : undefined; }
  dispose(): void { for (const id of this.visuals.keys()) this.remove(id); }

  private remove(id: EntityId): void {
    const visual = this.visuals.get(id);
    if (visual) { visual.controller.abort(); visual.model?.dispose(); this.assets.release(visual.group); this.report(id, null); }
    this.visuals.delete(id);
  }

  private create(entity: Entity, token: string, player: boolean): Visual {
    const transform = entity.transform!;
    const group = new Group();
    group.name = `entity:${entity.id}`;
    if (this.library?.has(entity.renderable!.assetId)) {
      const visual: Visual = { group, limbs: [], token, previous: transform, current: transform, walking: false, animation: entity.animationState?.name ?? 'idle', controller: new AbortController(), model: null, failed: false };
      group.position.set(transform.position.x, transform.position.y, transform.position.z);
      this.loadModel(entity.id, entity.renderable!.assetId, visual);
      return visual;
    }
    const npc = DEMO_NPCS.find((item) => item.id === entity.id);
    const color = npc?.color ?? '#318e81';
    const body = this.assets.mesh('capsule', color);
    body.scale.set(1.1, 0.75, 1);
    body.position.y = 0.8;
    group.add(body);
    const head = this.assets.mesh('sphere', '#eec8a2');
    head.scale.set(0.4, 0.42, 0.38);
    head.position.y = 1.55;
    group.add(head);
    const hair = this.assets.mesh('sphere', player ? '#34434b' : '#695343');
    hair.scale.set(0.41, 0.22, 0.39);
    hair.position.set(0, 1.82, -0.035);
    group.add(hair);
    const band = this.assets.mesh('cylinder', '#e7c789');
    band.scale.set(0.405, 0.07, 0.385);
    band.position.y = 1.78;
    group.add(band);
    for (const side of [-1, 1]) {
      const eye = this.assets.mesh('sphere', '#3b302b');
      eye.scale.set(0.045, 0.06, 0.025);
      eye.position.set(side * 0.14, 1.57, 0.35);
      group.add(eye);
      const cheek = this.assets.mesh('sphere', '#dfac8e');
      cheek.scale.set(0.08, 0.04, 0.022);
      cheek.position.set(side * 0.23, 1.45, 0.31);
      group.add(cheek);
    }
    const limbs: Mesh[] = [];
    for (const side of [-1, 1]) {
      const leg = this.assets.mesh('capsule', '#785d46');
      leg.scale.set(0.5, 0.3, 0.6);
      leg.position.set(side * 0.16, 0.23, 0);
      group.add(leg);
      limbs.push(leg);
    }
    for (const side of [-1, 1]) {
      const arm = this.assets.mesh('capsule', color);
      arm.scale.set(0.45, 0.43, 0.5);
      arm.position.set(side * 0.39, 0.83, 0);
      group.add(arm);
      limbs.push(arm);
    }
    const front = this.assets.mesh('roundedBox', '#e8c783');
    front.scale.set(0.42, 0.13, 0.1);
    front.position.set(0, 0.85, 0.3);
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
    return { group, limbs, token, previous: transform, current: transform, walking: false, animation: 'idle', controller: new AbortController(), model: null, failed: false };
  }

  retryFailed(): void {
    for (const [id, visual] of [...this.visuals]) if (visual.failed) this.remove(id);
  }

  private loadModel(id: string, assetId: string, visual: Visual): void {
    void this.library!.instantiate(assetId, visual.controller.signal).then((model) => {
      if (visual.controller.signal.aborted || this.visuals.get(id) !== visual) { model.dispose(); return; }
      visual.model = model;
      visual.group.add(model.root);
      this.report(id, null);
    }, (error: unknown) => {
      if (visual.controller.signal.aborted) return;
      visual.failed = true;
      this.report(id, error instanceof Error ? error.message : 'Model load failed');
    });
  }
}
