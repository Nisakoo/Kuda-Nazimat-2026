import { birdPose } from '../../../../shared/world-life/birds.ts';
import { Group } from 'three';
import type { Object3D, Scene } from 'three';
import type { SceneStateMessage, CatDefinition, PackAnimalDefinition } from '../../../../shared/world-life/types.ts';
import { packAnimalPosition, catPosition, routePosition, schedulePhase } from '../../../../shared/world-life/phase.ts';
import type { Vector3 } from '../../../../shared/world/types.ts';
import type { GltfLibrary, ModelInstance } from './GltfLibrary';
import type { EntityVisuals } from './EntityVisuals';
import { VisualWind } from './VisualWind';
import { poseMillDrive } from './MillDrive';

interface LifeVisual { readonly assetId: string; readonly group: Group; readonly abort: AbortController; model: ModelInstance | null; failed: boolean; positioned: boolean; wind: VisualWind | null }
/** Market shares the existing grid. This is a visibility lookup, not a second chunk loader. */
export function lifeChunk(position: Vector3): string { return `${Math.floor((position.x+16)/32)}_${Math.floor((position.z+16)/32)}`; }

/** Small map-local authoritative scene; every model uses the existing asset leases and clone queue. */
export class WorldLifeVisuals {
  private state: SceneStateMessage | null = null;
  private atElapsed = 0;
  private readonly visuals = new Map<string, LifeVisual>();
  constructor(private readonly scene: Scene, private readonly library: GltfLibrary, private readonly characters: EntityVisuals,
    private readonly report: (id: string, error: string | null) => void = () => {}) {}
  get ids(): readonly string[] { return [...this.visuals.keys()]; }
  setState(state: SceneStateMessage | null, elapsed: number): void {
    if (state === this.state || state && this.state && state.sceneId === this.state.sceneId && state.revision < this.state.revision) return;
    const transitions = !!state && !!this.state && state.sceneId === this.state.sceneId && state.revision >= this.state.revision;
    if (!transitions) this.clear();
    this.characters.setHands(new Map(state?.apples.flatMap(apple => apple.state === 'held' ? [[apple.holderId,apple.id] as const] : []) ?? []), transitions);
    this.state = state; this.atElapsed = elapsed;
  }
  sceneTime(elapsed: number): number { return this.state ? Math.max(0,this.state.serverTimeMs-this.state.epochMs+(elapsed-this.atElapsed)*1000) : elapsed*1000; }
  animate(elapsed: number, delta: number, chunks: readonly string[]): void {
    const state = this.state;
    if (!state) return;
    const time = this.sceneTime(elapsed); const loaded = new Set(chunks); const live = new Set<string>();
    const templates = new Map(state.definition.templates.map(template => [template.id,template]));
    const cats = new Map(state.definition.cats.map(cat => [cat.instanceId,cat]));
    const animals=new Map((state.definition.packAnimals??[]).map(animal=>[animal.instanceId,animal]));
    const pots = new Map(state.pots.map(pot => [pot.id,pot])); const apples = new Map(state.apples.map(apple => [apple.id,apple]));
    for (const instance of state.definition.instances) {
      const template = templates.get(instance.templateId); if (!template) continue;
      const cat = cats.get(instance.id); const animal=animals.get(instance.id); const apple = apples.get(instance.id);
      // Missing dynamic state must never respawn a saved item from the initial placement.
      if (template.behavior === 'pickup' && !apple || template.behavior === 'pushable' && !pots.has(instance.id)) continue;
      const position = animal ? packAnimalPosition(animal,time) : cat ? catPosition(cat,time) : apple?.state === 'world' ? apple.position : pots.get(instance.id)?.position ?? instance.position;
      const hand = apple?.state === 'held' ? this.characters.handAnchor(apple.holderId) : undefined;
      if (apple?.state === 'held' ? !hand : !loaded.has(lifeChunk(position))) continue;
      live.add(instance.id);
      const visual = this.ensure(instance.id,template.assetId); if (!visual) continue;
      const parent: Object3D = hand ?? this.scene;
      if (visual.group.parent !== parent) { parent.add(visual.group); visual.positioned = false; }
      if (hand) {
        visual.group.position.set(0,-.14,.025); visual.group.rotation.set(0,0,0); visual.group.scale.setScalar(1.15);
      } else {
        const p=visual.group.position;
        const blend=template.behavior==='pushable'&&visual.positioned&&Math.hypot(position.x-p.x,position.y-p.y,position.z-p.z)<1?1-Math.exp(-Math.max(0,delta)*18):1;
        p.set(p.x+(position.x-p.x)*blend,p.y+(position.y-p.y)*blend,p.z+(position.z-p.z)*blend);
        visual.group.rotation.set(0,instance.rotationY,0); visual.group.scale.setScalar(1);
      }
      visual.positioned = true;
      if (animal && visual.model) this.posePackAnimal(visual,animal,time,instance.rotationY);
      else if (cat && visual.model) this.poseCat(visual,cat,time,instance.rotationY);
      else visual.model?.animate(template.animation,delta);
      visual.wind?.animate(time,state.definition.wind);
    }
    for(const bird of state.definition.perches??[]){
      const status=state.birds?.find(b=>b.id===bird.id);if(!status)continue;
      const pose=birdPose(bird,status,time);if(!loaded.has(lifeChunk(pose.position)))continue;
      live.add(bird.id);const visual=this.ensure(bird.id,state.definition.flock.assetId);if(!visual)continue;
      visual.group.position.set(pose.position.x,pose.position.y,pose.position.z);visual.group.rotation.y=pose.yaw;
      const flap=pose.flying?Math.sin(time*.022+bird.rotationY)*.8:1.15;
      const left=visual.model?.root.getObjectByName('bird-wing-left'),right=visual.model?.root.getObjectByName('bird-wing-right');
      if(left){left.rotation.z=pose.flying?-flap:.12;left.rotation.y=pose.flying?0:-1.05;}if(right){right.rotation.z=pose.flying?flap:-.12;right.rotation.y=pose.flying?0:1.05;}
      visual.group.rotation.x=pose.flying?-.10:Math.sin(time*.003+bird.rotationY)*.035;
    }
    const flock = state.definition.flock; const flight = schedulePhase(time,flock.schedule);
    if (flight.active) {
      const centre = routePosition(flock.route,flight.phase);
      // The flock only exists while its world trajectory passes a loaded chunk.
      if (loaded.has(lifeChunk(centre))) for (let index=0;index<flock.count;index++) {
        const id=`flock:${index}`; live.add(id); const visual=this.ensure(id,flock.assetId); if (!visual) continue;
        const row=Math.ceil(index/2),side=index%2 ? -1 : 1;
        visual.group.position.set(centre.x+side*row*.72,centre.y+Math.sin(index*1.7)*.18,centre.z-row*.55);
        const ahead=routePosition(flock.route,Math.min(1,flight.phase+.002));
        visual.group.rotation.y=Math.atan2(ahead.x-centre.x,ahead.z-centre.z);
        const flap=Math.sin(time*.009+index*.8)*.62;
        const left=visual.model?.root.getObjectByName('bird-wing-left'); const right=visual.model?.root.getObjectByName('bird-wing-right');
        if(left)left.rotation.z=flap; if(right)right.rotation.z=-flap;
      }
    }
    for (const id of this.visuals.keys()) if (!live.has(id)) this.remove(id);
  }
  private posePackAnimal(visual:LifeVisual, animal:PackAnimalDefinition, time:number, yaw:number):void {
    const root=visual.model!.root,phase=time/animal.cycleMs*Math.PI*2;
    const head=root.getObjectByName('pack-head'),neck=root.getObjectByName('pack-neck'),tail=root.getObjectByName('pack-tail');
    if(animal.behavior==='walk'){
      const p=packAnimalPosition(animal,time),ahead=packAnimalPosition(animal,time+70);
      visual.group.rotation.y=Math.atan2(ahead.x-p.x,ahead.z-p.z);
      visual.group.position.y+=Math.abs(Math.sin(time*.006))*.025;
      for(const side of [-1,1])for(const end of [-1,1]){const leg=root.getObjectByName(`pack-leg-${side}-${end}`);if(leg)leg.rotation.x=Math.sin(time*.006+(side===end?0:Math.PI))*.32;}
      if(head)head.rotation.x=Math.sin(time*.003)*.04;
      poseMillDrive(root,visual.group.position,visual.group.rotation.y,animal.route);
    }else{
      visual.group.rotation.y=yaw;
      const feeding=.5+.5*Math.sin(phase);
      if(neck)neck.rotation.x=1.06+feeding*.09;
      if(head)head.rotation.x=.22+Math.sin(time*.008)*.035;
    }
    if(tail)tail.rotation.z=Math.sin(time*.0018+animal.route[0]!.x)*.12;
  }
  private poseCat(visual: LifeVisual, cat: CatDefinition, time: number, yaw: number): void {
    const root=visual.model!.root; const body=root.getObjectByName('cat-body'); const head=root.getObjectByName('cat-head'); const tail=root.getObjectByName('cat-tail');
    const seconds=time/1000; const asleep=cat.behavior==='sleep'; const wash=cat.behavior==='wash';
    const walking=cat.behavior==='walk' && time%cat.cycleMs>cat.pauseMs;
    for(const side of ['left','right']){const eye=root.getObjectByName(`cat-eye-${side}`);if(eye)eye.scale.y=asleep?.12:1;}
    if(body){body.position.y=asleep?.19:.34;body.scale.set(1,asleep?.70+Math.sin(seconds*1.7)*.025:1,asleep?1.04:1);body.rotation.z=asleep?-.20:0;}
    if(head){head.position.set(0,asleep?.02:.16,asleep?.30:.38);head.rotation.set(asleep?-.35:wash?Math.sin(seconds*3)*.16+.2:0,asleep?-.55:wash?-.25:0,0);}
    if(tail){tail.position.y=asleep?.17:.35;tail.rotation.y=asleep?1.5:Math.sin(seconds*1.3)*.18;tail.rotation.x=asleep?.3:wash?-.35:0;}
    for(const side of [-1,1])for(const end of [-1,1]){
      const leg=root.getObjectByName(`cat-leg-${side}-${end}`);if(!leg)continue;
      leg.position.y=asleep?.18:.30;leg.rotation.x=walking?Math.sin(seconds*6+(side===end?0:Math.PI))*.38:asleep?-.95:0;
      leg.rotation.z=wash&&side===1&&end===1?-.35:0;
      if(wash&&side===1&&end===1)leg.rotation.x=-2.2+Math.sin(seconds*3)*.18;
    }
    if(walking){const ahead=catPosition(cat,time+30);const here=catPosition(cat,time);visual.group.rotation.y=Math.atan2(ahead.x-here.x,ahead.z-here.z);}
    else if(cat.behavior!=='walk')visual.group.rotation.y=yaw;
  }
  private ensure(id: string, assetId: string): LifeVisual | null {
    let visual=this.visuals.get(id);if(visual&&visual.assetId!==assetId){this.remove(id);visual=undefined;}
    if(visual)return visual;
    if(!this.library.has(assetId)){this.report(id,`Unknown world-life model: ${assetId}`);return null;}
    visual={assetId,group:new Group(),abort:new AbortController(),model:null,failed:false,positioned:false,wind:null};visual.group.name=`life:${id}`;
    this.visuals.set(id,visual);this.scene.add(visual.group);const target=visual;
    void this.library.instantiate(assetId,target.abort.signal).then(model=>{
      if(target.abort.signal.aborted||this.visuals.get(id)!==target){model.dispose();return;}
      target.model=model;target.group.add(model.root);
      let flexible=false;model.root.traverse(node=>{if(/^wind-(leaf|grass|cloth|sign)-/.test(node.name))flexible=true;});
      if(flexible)target.wind=new VisualWind(model.root);
      this.report(id,null);
    },(error: unknown)=>{if(!target.abort.signal.aborted){target.failed=true;this.report(id,error instanceof Error?error.message:'World-life model load failed');}});
    return visual;
  }
  retryFailed(): void { for(const [id,visual] of this.visuals)if(visual.failed)this.remove(id); }
  private remove(id: string): void {const visual=this.visuals.get(id);if(!visual)return;visual.abort.abort();visual.wind?.dispose();visual.model?.dispose();visual.group.removeFromParent();this.visuals.delete(id);this.report(id,null);}
  private clear(): void { for(const id of this.visuals.keys())this.remove(id); }
  dispose(): void {this.clear();this.state=null;this.characters.setHands(new Map(),false);}
}
