import { Group } from 'three';
import type { Scene } from 'three';
import type { Entity, EntityId, Transform, WorldSnapshot } from '../../core/types';
import { DEMO_NPCS } from '../../shared/demo';
import type { SceneAssets } from './SceneAssets';
import type { GltfLibrary, ModelInstance } from './GltfLibrary';
import { createCharacter } from './CharacterRig';
import type { CharacterRig } from './CharacterRig';
import { CHARACTER_MOTION, approach, damp, turnTowards } from './CharacterMotion';
import type { MotionStatus } from '../../../../shared/world/types.ts';

interface Visual {
  readonly group: Group;
  readonly token: string;
  previous: Transform;
  current: Transform;
  animation: string;
  speedLimit: number;
  phase: number;
  weight: number;
  speed: number;
  elapsed: number;
  snap: boolean;
  readonly controller: AbortController;
  model: ModelInstance | null;
  rig: CharacterRig | null;
  failed: boolean;
  motion: MotionStatus | undefined;
  observedTick: number;
  sprintWeight: number;
  airWeight: number;
  fallWeight: number;
  takeoff: number;
  landing: number;
  handAction: 'pickup' | 'place' | null;
  handTime: number;
}

export class EntityVisuals {
  private readonly visuals = new Map<EntityId, Visual>();
  private held = new Map<string, string>();

  /** Only confirmed changes trigger reach actions. Initial/reconnected state starts in the carry pose. */
  setHands(held: ReadonlyMap<string, string>, transitions: boolean): void {
    for (const [id, visual] of this.visuals) {
      if (transitions && this.held.get(id) !== held.get(id)) {
        visual.handAction = held.has(id) ? 'pickup' : 'place'; visual.handTime = 0;
      } else if (!transitions) { visual.handAction = null; visual.handTime = .65; }
    }
    this.held = new Map(held);
  }
  handAnchor(id: string): Group | undefined { return this.visuals.get(id)?.rig?.hand; }
  constructor(private readonly scene: Scene, private readonly assets: SceneAssets, private readonly library?: GltfLibrary, private readonly report: (id: string, error: string | null) => void = () => {}, private readonly marketStyle = false) {}
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
      const a = visual.current.position; const b = entity.transform.position;
      if (Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)>CHARACTER_MOTION.discontinuity || current.tick<previous.tick) visual.snap = true;
      if (visual.observedTick !== current.tick) {
        if (previous === current) visual.snap = true;
        if (!visual.snap && visual.motion && entity.motion) {
          if (visual.motion.grounded && !entity.motion.grounded && entity.motion.phase === 'rising') { visual.takeoff = .1; visual.landing = 0; }
          if (!visual.motion.grounded && entity.motion.grounded) visual.landing = .14;
        }
        visual.observedTick = current.tick;
      }
      visual.motion = entity.motion;
      visual.previous = old.get(entity.id)?.transform ?? entity.transform;
      visual.current = entity.transform;
      visual.animation = entity.animationState?.name ?? 'idle';
      visual.speedLimit = entity.motion?.locomotion === 'sprint' ? 5 : entity.movement?.speed ?? 3;
    }
    for (const id of this.visuals.keys()) if (!live.has(id)) this.remove(id);
  }

  animate(alpha: number, _elapsed: number, delta = 0): void {
    const dt = Math.min(CHARACTER_MOTION.maxDelta, Math.max(0,delta));
    for (const [id, visual] of this.visuals) {
      const from = visual.previous.position; const to = visual.current.position;
      const oldX = visual.group.position.x; const oldZ = visual.group.position.z;
      const discontinuousPair = Math.hypot(to.x-from.x,to.y-from.y,to.z-from.z)>CHARACTER_MOTION.discontinuity;
      const t = visual.snap || discontinuousPair ? 1 : Math.max(0,Math.min(1,alpha));
      visual.group.position.set(from.x+(to.x-from.x)*t,from.y+(to.y-from.y)*t,from.z+(to.z-from.z)*t);
      const distance = Math.hypot(visual.group.position.x-oldX,visual.group.position.z-oldZ);
      const reset = visual.snap || delta>CHARACTER_MOTION.maxDelta || distance>CHARACTER_MOTION.discontinuity;
      if (reset) {
        visual.group.rotation.y = visual.current.rotationY;
        visual.phase = 0; visual.speed = 0; visual.weight = 0;
        visual.landing = 0; visual.takeoff = 0;
        visual.airWeight = visual.motion && !visual.motion.grounded ? 1 : 0;
        visual.fallWeight = visual.motion?.phase === 'falling' ? 1 : 0;
        visual.sprintWeight = 0;
      }
      const speed = !reset && dt>0 ? Math.min(distance/dt,visual.speedLimit*1.5) : 0;
      visual.speed = damp(visual.speed,speed,CHARACTER_MOTION.blendRate,dt);
      visual.weight = damp(visual.weight,speed>CHARACTER_MOTION.movingThreshold?1:0,CHARACTER_MOTION.blendRate,dt);
      if (visual.weight<.005) { visual.weight=0; visual.speed=0; }
      // Advance by distance, not elapsed wall time: no walking into a wall or after reconnect.
      visual.sprintWeight = approach(visual.sprintWeight, visual.motion?.locomotion === 'sprint' && speed > CHARACTER_MOTION.movingThreshold ? 1 : 0, dt, .14);
      visual.airWeight = approach(visual.airWeight, visual.motion && !visual.motion.grounded ? 1 : 0, dt, .1);
      visual.fallWeight = approach(visual.fallWeight, visual.motion?.phase === 'falling' ? 1 : 0, dt, .1);
      if (!reset && (!visual.motion || visual.motion.grounded)) visual.phase = (visual.phase+distance/(CHARACTER_MOTION.stride+.6*visual.sprintWeight)*Math.PI*2)%(Math.PI*2);
      visual.takeoff = Math.max(0, visual.takeoff-dt); visual.landing = Math.max(0, visual.landing-dt);
      const oldYaw = visual.group.rotation.y;
      visual.group.rotation.y = turnTowards(oldYaw,visual.current.rotationY,dt);
      const turn = dt>0 ? (visual.group.rotation.y-oldYaw)/dt : 0;
      visual.elapsed += dt;
      visual.rig?.pose(visual.phase,visual.weight,visual.elapsed,turn, { sprint: visual.sprintWeight, air: visual.airWeight, falling: visual.fallWeight,
        takeoff: Math.sin(Math.PI*visual.takeoff/.1), landing: Math.sin(Math.PI*visual.landing/.14) },
        { carrying: this.held.has(id), action: visual.handAction, progress: visual.handTime/.65 });
      visual.handTime = Math.min(.65,visual.handTime+dt);
      if (visual.handTime >= .65) visual.handAction = null;
      const name = visual.weight>.1 ? 'walk' : visual.animation==='walk' ? 'idle' : visual.animation;
      visual.model?.animate(name,dt,name==='walk' ? Math.max(.2,visual.speed/3) : 1);
      visual.snap = false;
    }
  }

  position(id: EntityId | null) { return id ? this.visuals.get(id)?.group.position : undefined; }
  dispose(): void { for (const id of this.visuals.keys()) this.remove(id); this.held.clear(); }

  private remove(id: EntityId): void {
    const visual = this.visuals.get(id);
    if (visual) { visual.controller.abort(); visual.model?.dispose(); this.assets.release(visual.group); this.report(id, null); }
    this.visuals.delete(id);
  }

  private create(entity: Entity, token: string, player: boolean): Visual {
    const transform = entity.transform!;
    const group = new Group(); group.name = `entity:${entity.id}`;
    group.position.set(transform.position.x,transform.position.y,transform.position.z);
    group.rotation.y = transform.rotationY;
    const visual: Visual = { group, token, previous:transform, current:transform, animation:entity.animationState?.name??'idle', speedLimit:entity.movement?.speed??3, phase:0, weight:0, speed:0, elapsed:0, snap:true, controller:new AbortController(), model:null, rig:null, failed:false,
      motion: entity.motion, observedTick: -1, sprintWeight: 0, airWeight: 0, fallWeight: 0, takeoff: 0, landing: 0, handAction: null, handTime: .65 };
    if (this.library?.has(entity.renderable!.assetId)) this.loadModel(entity.id,entity.renderable!.assetId,visual,entity,player);
    else this.addCharacter(visual,entity,player);
    return visual;
  }

  private addCharacter(visual: Visual, entity: Entity, player: boolean): void {
    const npc = DEMO_NPCS.find(item=>item.id===entity.id);
    const seed = [...entity.id].reduce((n,c)=>(n*31+c.charCodeAt(0))%997,0)/997*Math.PI*2;
    visual.rig = createCharacter(this.assets,npc?.color??'#318e81',this.marketStyle,seed);
    // Player crown (including breathing) stays within the agreed 1.8 m collider.
    if (entity.character?.kind === 'player') visual.rig.root.scale.set(1, .83, 1);
    visual.group.add(visual.rig.root);
    visual.rig.pose(0,0,0,0);
    const label = this.assets.label(player?'Вы':`${npc?.name??entity.character?.name??'Гость'}${npc?.topic?` · ${npc.topic}`:''}`);
    if (player) label.scale.set(1,.4,1);
    label.position.y=2.45; visual.group.add(label);
  }

  retryFailed(): void { for (const [id,visual] of [...this.visuals]) if (visual.failed) this.remove(id); }

  private loadModel(id: string, assetId: string, visual: Visual, entity: Entity, player: boolean): void {
    void this.library!.instantiate(assetId,visual.controller.signal).then(model=>{
      if (visual.controller.signal.aborted || this.visuals.get(id)!==visual) { model.dispose(); return; }
      visual.model=model; visual.group.add(model.root); this.report(id,null);
    },(error:unknown)=>{
      if (visual.controller.signal.aborted) return;
      visual.failed=true; this.addCharacter(visual,entity,player);
      this.report(id,error instanceof Error?error.message:'Model load failed');
    });
  }
}
