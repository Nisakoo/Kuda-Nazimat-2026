import type { Vector3 } from '../world/types.ts';
import { SHOTGUN, pelletDirection } from './types.ts';
import type { Shot, ShotgunProp, ShotgunState, WeaponState } from './types.ts';
interface Body { id: string; kind: ShotgunProp['kind']; position: Vector3; velocity: { x:number; y:number; z:number }; rotation: number }
interface Weapon { ammo: number; reloadLeft: number; cooldown: number; shotId: number }
export interface ShotgunTerrain { height(x: number, z: number): number; clear(from: Vector3, to: Vector3): boolean; rayClear(from: Vector3, to: Vector3): boolean }
const freeTerrain: ShotgunTerrain = { height: () => 0, clear: () => true, rayClear: () => true };
/** Headless authority shared by the server and offline walk. No timers or transport. */
export class ShotgunSimulation {
  private readonly bodies: Body[];
  private readonly weapons = new Map<string, Weapon>();
  private shots: Shot[] = [];
  private revision = 0;
  private shotId = 0;
  private time = 0;
  private readonly shotTimes = new Map<number,number>();
  readonly sceneId: string;
  readonly mapId: string;
  private readonly terrain: ShotgunTerrain;
  constructor(sceneId: string, mapId: string, positions: readonly Vector3[], terrain: ShotgunTerrain = freeTerrain) {
    this.sceneId=sceneId;this.mapId=mapId;this.terrain=terrain;
    this.bodies = positions.slice(0, SHOTGUN.maxProps).map((p, i) => ({ id: `target-${i}`, kind: (['crate','barrel','jar'] as const)[i % 3]!, position: {...p}, velocity: { x:0,y:0,z:0 }, rotation:0 }));
  }
  addPlayer(id: string): void { if (!this.weapons.has(id) && this.weapons.size < 4) this.weapons.set(id, { ammo:6, reloadLeft:0, cooldown:0, shotId:0 }); }
  removePlayer(id: string): void { this.weapons.delete(id); }
  act(playerId: string, position: Vector3, action: 'fire'|'reload', yaw: number, pitch: number): boolean {
    const weapon = this.weapons.get(playerId);
    if (!weapon || !Number.isFinite(yaw) || !Number.isFinite(pitch) || Math.abs(pitch) > 1.5) return false;
    if (action === 'reload') {
      if (weapon.reloadLeft || weapon.ammo === SHOTGUN.capacity) return false;
      weapon.reloadLeft = SHOTGUN.reload; this.revision++; return true;
    }
    if (weapon.reloadLeft || weapon.cooldown > 1e-6 || !weapon.ammo) return false;
    weapon.ammo--; weapon.cooldown = SHOTGUN.cooldown; weapon.shotId = ++this.shotId;
    const origin = { ...position, y: position.y + SHOTGUN.eyeHeight };
    const shot: Shot = { id:this.shotId, playerId, origin, yaw, pitch };
    this.shotTimes.set(shot.id,this.time);
    this.shots.push(shot); this.shots = this.shots.slice(-SHOTGUN.maxShots);
    for(const id of this.shotTimes.keys())if(!this.shots.some(s=>s.id===id))this.shotTimes.delete(id);
    for (let i=0;i<SHOTGUN.pellets;i++) {
      const direction = pelletDirection(yaw,pitch,i);
      let previous = origin;
      for (let t=.08;t<=SHOTGUN.range;t+=.08) {
        const point = { x:origin.x+direction.x*t, y:origin.y+direction.y*t, z:origin.z+direction.z*t };
        if (point.y < this.terrain.height(point.x,point.z) || !this.terrain.rayClear(previous,point)) break;
        const body = this.bodies.find(b => Math.abs(point.x-b.position.x)<.38 && Math.abs(point.z-b.position.z)<.38 && point.y>=b.position.y && point.y<=b.position.y+.8);
        if (body) { body.velocity.x += direction.x*.8; body.velocity.z += direction.z*.8; body.velocity.y = Math.min(5,body.velocity.y+.7); break; }
        previous = point;
      }
    }
    this.revision++; return true;
  }
  step(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    const dt = Math.min(delta,.1);
    this.time+=dt;
    this.shots=this.shots.filter(shot=>this.time-this.shotTimes.get(shot.id)!<=30);
    for(const id of this.shotTimes.keys())if(!this.shots.some(s=>s.id===id))this.shotTimes.delete(id);
    for (const weapon of this.weapons.values()) {
      weapon.cooldown = Math.max(0,weapon.cooldown-dt);
      if (weapon.reloadLeft > 0) { weapon.reloadLeft = Math.max(0,weapon.reloadLeft-dt); if (weapon.reloadLeft < 1e-6) { weapon.reloadLeft=0; weapon.ammo=6; } }
    }
    // Small substeps keep high impulses from tunnelling through map collision cells.
    const steps = Math.ceil(dt/.016), h=dt/steps;
    for(let n=0;n<steps;n++) for (const body of this.bodies) {
      const p=body.position, v=body.velocity;
      if (Math.hypot(v.x,v.y,v.z)<.01 && p.y<=this.terrain.height(p.x,p.z)+.001) continue;
      v.y-=9.8*h;
      const next={x:p.x+v.x*h,y:p.y+v.y*h,z:p.z+v.z*h};
      if (!this.terrain.clear(p,next) || this.bodies.some(other=>other!==body && Math.abs(other.position.x-next.x)<.76 && Math.abs(other.position.z-next.z)<.76 && Math.abs(other.position.y-next.y)<.8)) { v.x*=-.3; v.z*=-.3; next.x=p.x; next.z=p.z; }
      const floor=this.terrain.height(next.x,next.z);
      if (next.y<floor) { next.y=floor; v.y=Math.abs(v.y)>.8?-v.y*.28:0; const drag=Math.exp(-h*6); v.x*=drag; v.z*=drag; }
      body.rotation = (body.rotation+Math.hypot(v.x,v.z)*h*1.4) % (Math.PI*2);
      body.position=next;
    }
    this.revision++;
  }
  snapshot(): ShotgunState {
    const weapons: WeaponState[]=[...this.weapons].map(([playerId,w])=>({ playerId,ammo:w.ammo,reloadLeft:w.reloadLeft,shotId:w.shotId }));
    return {v:1,type:'shotgun-state',sceneId:this.sceneId,mapId:this.mapId,revision:this.revision,props:this.bodies.map(b=>({id:b.id,kind:b.kind,position:{...b.position},rotation:b.rotation})),weapons,shots:this.shots.map(s=>({...s,origin:{...s.origin}}))};
  }
}
