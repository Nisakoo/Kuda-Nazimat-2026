import { packAnimalPosition } from '../../../shared/world-life/phase.ts';
import { restingBird, updateBird } from '../../../shared/world-life/birds.ts';
import type { BirdState } from '../../../shared/world-life/types.ts';
import type { Vector3 } from '../../../shared/world/types.ts';
import { WORLD_LIFE_LIMITS as L } from '../../../shared/world-life/types.ts';
import type { AppleState, HandRequest, HandResultMessage, ObjectInstance, SceneStateMessage, WorldLifeDefinition } from '../../../shared/world-life/types.ts';
import { handFailure, parseWorldLifeServerMessage } from '../../../shared/world-life/validate.ts';
import { isBodyClear } from '../../../shared/movement/simulation.ts';
import type { GameMap } from '../world/GameMap.ts';
import type { PlacedPlayer } from './ports.ts';

function distance(a: Vector3, b: Vector3): number { return Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z); }
function overlapsPath(p: Vector3, a: Vector3, b: Vector3, half: number): boolean {
  // Swept square footprints, consistent with MAP's square player probes. Corners cannot tunnel.
  let lo = 0, hi = 1; const extent = half - 1e-6;
  for (const axis of ['x','z'] as const) {
    const delta = b[axis]-a[axis]; const start = a[axis]-p[axis];
    if (Math.abs(delta) < 1e-10) { if (Math.abs(start) >= extent) return false; continue; }
    const t1 = (-extent-start)/delta, t2 = (extent-start)/delta;
    lo = Math.max(lo,Math.min(t1,t2)); hi = Math.min(hi,Math.max(t1,t2));
    if (lo > hi) return false;
  }
  return true;
}

/** Pure bounded scene state. No SQL, IO, clock, transport or independent simulation loop. */
export class WorldLife {
  private apples: readonly AppleState[] = [];
  private revision = 0;
  private readonly birds = new Map<string, readonly BirdState[]>();
  private readonly definitions = new Map<string, WorldLifeDefinition>();
  private readonly pots = new Map<string, { id: string; position: Vector3 }[]>();
  private readonly maps: ReadonlyMap<string, GameMap>;
  readonly epochMs: number;
  readonly sceneId: string;

  constructor(maps: ReadonlyMap<string, GameMap>, epochMs: number, sceneId: string) {
    this.maps = maps; this.epochMs = epochMs; this.sceneId = sceneId;
    const globalIds = new Set<string>();
    for (const map of maps.values()) {
      const d = map.manifest.worldLife; if (!d) continue;
      this.definitions.set(map.id, d);
      this.birds.set(map.id,(d.perches??[]).map(restingBird));
      for (const i of d.instances) { if (globalIds.has(i.id)) throw new Error(`Duplicate scene instance ${i.id}`); globalIds.add(i.id); }
      const pots = this.instances(d, 'pushable').map(i => ({ id: i.id, position: { ...i.position } }));
      this.pots.set(map.id, pots);
      if (!this.clearPots(map.id,map.spawn,map.spawn)) throw new Error('Pot overlaps fallback spawn');
      for (const i of [...this.instances(d, 'pushable'), ...this.instances(d, 'pickup')]) {
        if (!this.support(map, i.position) || (this.behavior(d,i) === 'pushable' && !this.potPath(map,i.position,i.position,new Set(map.manifest.chunks.map(c => c.id))))) throw new Error(`Unsafe scene instance ${i.id} at ${JSON.stringify(i.position)}`);
      }
      const movable = [...this.instances(d, 'pushable'), ...this.instances(d, 'pickup')];
      for (let i = 0; i < movable.length; i++) for (const b of movable.slice(i+1)) {
        const a = movable[i]!; const radius = (this.behavior(d,a) === 'pushable' ? L.potRadius : L.appleRadius) + (this.behavior(d,b) === 'pushable' ? L.potRadius : L.appleRadius);
        if (overlapsPath(a.position,b.position,b.position,radius)) throw new Error('Overlapping scene objects');
      }
      for (const cat of d.cats) for (let i = 0; i < cat.route.length; i++) {
        const a = cat.route[i]!; const b = cat.route[(i+1)%cat.route.length]!;
        if (!this.clearStatic(map,a,b)) throw new Error(`Blocked cat route ${cat.instanceId}`);
      }
      for(const animal of d.packAnimals??[]){
        for(let i=0;i<64;i++){
          const a=packAnimalPosition(animal,i*animal.cycleMs/64),b=packAnimalPosition(animal,(i+1)*animal.cycleMs/64);
          if(!this.clearStatic(map,a,b))throw new Error(`Blocked animal route ${animal.instanceId}`);
        }
      }
      for(const bird of d.perches??[])if(!this.support(map,bird.position))throw new Error(`Unsafe bird perch ${bird.id}`);
      // Check the complete route, not just endpoints. Bitmap has no height: ceiling metadata supplies roofs.
      for (let i = 0; i < d.flock.route.length-1; i++) {
        const a = d.flock.route[i]!; const b = d.flock.route[i+1]!;
        const steps = Math.max(1, Math.ceil(distance(a,b)/0.25));
        for (let n = 0; n <= steps; n++) {
          const t = n/steps; const p = { x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, z:a.z+(b.z-a.z)*t };
          const tops = map.ceilingsFor(p,p).filter(v => p.x >= v.minX && p.x <= v.maxX && p.z >= v.minZ && p.z <= v.maxZ).map(v => v.topY);
          if (!map.footprintChunkIds(p.x,p.z) || p.y < Math.max(map.heightAt(p.x,p.z), ...tops)+3) throw new Error('Unsafe flock route');
        }
      }
    }
  }
  catalogue(): readonly WorldLifeDefinition[] { return [...this.definitions.values()]; }
  has(mapId: string): boolean { return this.definitions.has(mapId); }
  private behavior(d: WorldLifeDefinition, i: ObjectInstance) { return d.templates.find(t => t.id === i.templateId)!.behavior; }
  private instances(d: WorldLifeDefinition, behavior: 'pickup' | 'pushable'): ObjectInstance[] { return d.instances.filter(i => this.behavior(d,i) === behavior); }
  private support(map: GameMap, p: Vector3): boolean {
    return Math.abs(map.heightAt(p.x,p.z)-p.y) < 0.05 && map.isSafeSupport(p.x,p.z);
  }
  private clearStatic(map: GameMap, from: Vector3, to: Vector3, prepared?: ReadonlySet<string>): boolean {
    if (!map.canTraverse(from,to,prepared)) return false;
    const steps = Math.max(1, Math.ceil(distance(from,to)/0.1));
    let previousY = map.heightAt(from.x,from.z);
    for (let n = 0; n <= steps; n++) {
      const t = n/steps; const x = from.x+(to.x-from.x)*t; const z = from.z+(to.z-from.z)*t;
      const p = { x, y: map.heightAt(x,z), z };
      if (!map.isSafeSupport(x,z) || Math.abs(p.y-previousY) > 0.35 || !isBodyClear(p,map.ceilingsFor(p,p))) return false;
      previousY = p.y;
    }
    return true;
  }
  /** Reconcile old ground positions against changed authored geometry; never change held ownership. */
  restoreApples(apples: readonly AppleState[]): readonly AppleState[] {
    const placed: AppleState[]=[];
    const offsets:{x:number;z:number}[]=[];for(let x=-8;x<=8;x+=.5)for(let z=-8;z<=8;z+=.5)offsets.push({x,z});offsets.sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z));
    for(const item of apples){
      if(item.state==='held'){placed.push(item);continue;}
      const map=this.maps.get(item.mapId),definition=this.definitions.get(item.mapId),home=definition?.instances.find(i=>i.id===item.id);
      if(!map||!home)throw new Error('Unknown saved scene item');
      const free=(p:Vector3)=>this.support(map,p)&&this.clearStatic(map,p,p)&&this.clearPots(item.mapId,p,p)&&!placed.some(other=>other.state==='world'&&other.mapId===item.mapId&&overlapsPath(other.position,p,p,2*L.appleRadius));
      let position:Vector3|undefined=free(item.position)?item.position:undefined;
      for(const origin of [item.position,home.position,map.spawn]){
        if(position)break;
        for(const offset of offsets){const x=origin.x+offset.x,z=origin.z+offset.z,p={x,y:map.heightAt(x,z),z};if(free(p)){position=p;break;}}
      }
      if(!position)throw new Error('No safe place to restore scene item');
      placed.push({...item,position});
    }
    return placed;
  }
  setApples(apples: readonly AppleState[], changed = false): void {
    for (const d of this.definitions.values()) {
      const local = apples.filter(a => a.mapId === d.mapId);
      if (local.length !== this.instances(d,'pickup').length) throw new Error('Invalid durable apple count');
      for (const apple of local) if (apple.state === 'world') {
        if (!this.support(this.maps.get(d.mapId)!,apple.position) || this.instances(d,'pushable').some(p => overlapsPath(p.position,apple.position,apple.position,L.potRadius+L.appleRadius))) throw new Error(`Unsafe durable apple ${apple.id}`);
      }
    }
    this.apples = apples; if (changed) this.revision++;
  }
  updateBirds(players: readonly PlacedPlayer[], now: number): void {
    const time=Math.max(0,now-this.epochMs);
    for(const [mapId,definition] of this.definitions){
      const positions=players.filter(p=>p.mapId===mapId).map(p=>p.position), previous=this.birds.get(mapId)!;
      const next=(definition.perches??[]).map((bird,index)=>updateBird(bird,previous[index]!,positions,time));
      if(next.some((bird,index)=>bird!==previous[index])){this.birds.set(mapId,next);this.revision++;}
    }
  }
  snapshot(mapId: string, now: number): SceneStateMessage | null {
    const definition = this.definitions.get(mapId); if (!definition) return null;
    const packet: SceneStateMessage = { v:1, type:'scene-state', sceneId:this.sceneId, revision:this.revision, serverTimeMs:now, epochMs:this.epochMs, definition, birds:this.birds.get(mapId) ?? [], pots:this.pots.get(mapId)!.map(p => ({ ...p,position:{...p.position} })), apples:this.apples.filter(a => a.mapId === mapId) };
    return packet;
  }
  validateSnapshots(now: number): void {
    for (const mapId of this.definitions.keys()) parseWorldLifeServerMessage(this.snapshot(mapId,now));
  }
  currentRevision(): number { return this.revision; }
  clearPots(mapId: string, from: Vector3, to: Vector3): boolean {
    return (this.pots.get(mapId) ?? []).every(p => !overlapsPath(p.position,from,to,L.potRadius+0.25));
  }
  /** Atomic RAM plan: no pot changes until every proposed footprint/path is valid. */
  tryPush(player: PlacedPlayer, to: Vector3, players: readonly PlacedPlayer[], prepared: ReadonlySet<string>, grounded: boolean): boolean {
    const pots = this.pots.get(player.mapId); if (!pots?.length) return true;
    const from = player.position; const dx=to.x-from.x; const dz=to.z-from.z;
    const touched = pots.filter(p => overlapsPath(p.position,from,to,L.potRadius+0.25));
    if (!touched.length) return true;
    if (!grounded || Math.hypot(dx,dz) < 1e-8) return false;
    const map = this.maps.get(player.mapId)!; const d = this.definitions.get(player.mapId)!;
    const updates = new Map<string,Vector3>();
    for (const pot of touched) {
      // Touch must approach the pot; moving away from an existing contact must not drag it.
      if (dx*(pot.position.x-from.x)+dz*(pot.position.z-from.z) <= 0) return false;
      const p = { x:pot.position.x+dx, y:map.heightAt(pot.position.x+dx,pot.position.z+dz), z:pot.position.z+dz };
      const zone = d.instances.find(i => i.id === pot.id)!.zone!;
      if (p.x-L.potRadius < zone.minX || p.x+L.potRadius > zone.maxX || p.z-L.potRadius < zone.minZ || p.z+L.potRadius > zone.maxZ || overlapsPath(map.spawn,pot.position,p,L.potRadius+0.25) || !this.potPath(map,pot.position,p,prepared)) return false;
      if (players.some(other => other.id !== player.id && other.mapId === player.mapId && overlapsPath(other.position,pot.position,p,L.potRadius+0.25))) return false;
      if (this.apples.some(a => a.mapId === player.mapId && a.state === 'world' && overlapsPath(a.position,pot.position,p,L.potRadius+L.appleRadius))) return false;
      updates.set(pot.id,p);
    }
    for (const pot of touched) for (const other of pots) if (pot.id !== other.id && overlapsPath(updates.get(other.id) ?? other.position,pot.position,updates.get(pot.id)!,2*L.potRadius)) return false;
    for (const pot of pots) { const p=updates.get(pot.id); if (p) pot.position=p; }
    this.revision++; return true;
  }
  private potPath(map: GameMap, a: Vector3, b: Vector3, prepared: ReadonlySet<string>): boolean {
    // The bitmap player footprint is 0.25m. Four shifted sweeps cover the 0.30m pot footprint.
    for (const dx of [-0.05,0.05]) for (const dz of [-0.05,0.05]) if (!this.clearStatic(map,{...a,x:a.x+dx,z:a.z+dz},{...b,x:b.x+dx,z:b.z+dz},prepared)) return false;
    return true;
  }
  decideHand(player: PlacedPlayer, request: HandRequest, apples: readonly AppleState[], players: readonly PlacedPlayer[], grounded: boolean): HandResultMessage {
    const fail = (code: Parameters<typeof handFailure>[1], message: string) => handFailure(request.requestId,code,message);
    const map=this.maps.get(player.mapId)!;
    if (!this.has(player.mapId)) return fail('NOT_READY','На этой карте нет переносимых предметов.');
    const held=apples.find(a => a.state === 'held' && a.holderId === player.id);
    if (request.action === 'pickup') {
      if (held) return fail('HANDS_FULL','В руках уже есть предмет.');
      const target=apples.find(a => a.id === request.targetId && a.mapId === player.mapId);
      if (!target || target.state !== 'world') return fail('NOT_FOUND','Предмет недоступен.');
      if (distance(player.position,target.position) > L.pickupDistance) return fail('TOO_FAR','Слишком далеко.');
      if (!this.clearStatic(map,player.position,target.position) || !this.clearPots(player.mapId,player.position,target.position)) return fail('BLOCKED','Между игроком и предметом есть преграда.');
      const nearest=apples.filter((a): a is Extract<AppleState,{state:'world'}> => a.state === 'world' && a.mapId === player.mapId && distance(player.position,a.position) <= L.pickupDistance && this.clearStatic(map,player.position,a.position) && this.clearPots(player.mapId,player.position,a.position)).sort((a,b) => distance(player.position,a.position)-distance(player.position,b.position) || a.id.localeCompare(b.id))[0];
      if (nearest?.id !== target.id) return fail('FORBIDDEN','Выберите ближайший доступный предмет.');
      return { v:1,type:'hand-result',requestId:request.requestId,ok:true,action:'pickup',apple:{id:target.id,mapId:target.mapId,state:'held',holderId:player.id} };
    }
    if (!held) return fail('HANDS_EMPTY','В руках нет предмета.');
    if (held.mapId !== player.mapId) return fail('FORBIDDEN','Положите предмет на его исходной карте.');
    const x=player.position.x+Math.sin(player.rotationY)*L.placeDistance; const z=player.position.z+Math.cos(player.rotationY)*L.placeDistance;
    const position={x,y:map.heightAt(x,z),z};
    if (!grounded || !this.support(map,player.position) || !this.support(map,position) || !this.clearStatic(map,player.position,position) || !this.clearPots(player.mapId,player.position,position)) return fail('BLOCKED','Нет безопасной поверхности перед игроком.');
    // A durable apple must never occupy a pot's RAM-reset position.
    const resetPots = this.instances(this.definitions.get(player.mapId)!, 'pushable');
    if (resetPots.some(p => overlapsPath(p.position,position,position,L.potRadius+L.appleRadius))) return fail('BLOCKED','Исходное место горшка должно оставаться свободным после перезапуска.');
    if (apples.some(a => a.state === 'world' && a.mapId === player.mapId && overlapsPath(a.position,position,position,2*L.appleRadius)) || players.some(p => p.id !== player.id && p.mapId === player.mapId && overlapsPath(p.position,position,position,0.25+L.appleRadius))) return fail('BLOCKED','Место занято.');
    return {v:1,type:'hand-result',requestId:request.requestId,ok:true,action:'place',apple:{id:held.id,mapId:held.mapId,state:'world',position}};
  }
}
