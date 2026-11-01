import type { Vector3 } from '../world/types.ts';
import type { BirdState, PerchedBird } from './types.ts';

export function restingBird(bird: PerchedBird): BirdState { return { id: bird.id, startedMs: null, landingMs: null, yaw: bird.rotationY }; }
/** Authority chooses only transitions; peers sample the same bounded flight without frame messages. */
export function updateBird(bird: PerchedBird, state: BirdState, players: readonly Vector3[], time: number): BirdState {
  const near = players.find(p => Math.hypot(p.x-bird.position.x,p.z-bird.position.z) < (state.startedMs === null ? 3.2 : 4.5) && Math.abs(p.y-bird.position.y)<3);
  if (state.startedMs === null) return near ? { ...state, startedMs: time, landingMs: null, yaw: Math.atan2(bird.position.x-near.x,bird.position.z-near.z) + bird.rotationY*.18 } : state;
  if (state.landingMs !== null) {
    if(near)return {id:state.id,startedMs:time,landingMs:null,yaw:state.yaw,resumedFrom:birdPose(bird,state,time).position};
    return time-state.landingMs >= 2000 ? restingBird(bird) : state;
  }
  return !near && time-state.startedMs > 5000 ? { ...state, landingMs: time } : state;
}
export function birdPose(bird: PerchedBird, state: BirdState, time: number): { position: Vector3; yaw: number; flying: boolean } {
  if (state.startedMs === null) return { position: { ...bird.position, y: bird.position.y+.13 }, yaw: bird.rotationY, flying: false };
  const age=Math.max(0,(state.landingMs ?? time)-state.startedMs), rise=Math.min(1,age/1100), angle=state.yaw+Math.max(0,age-1100)*.0014;
  const land=state.landingMs===null?0:Math.min(1,Math.max(0,time-state.landingMs)/2000), ease=land*land*(3-2*land);
  const radius=1.15*rise*(1-ease), height=(2.6*rise+Math.sin(age*.005)*.12*rise)*(1-ease);
  const position={x:bird.position.x+Math.sin(angle)*radius,y:bird.position.y+.13+height,z:bird.position.z+Math.cos(angle)*radius};
  if(state.resumedFrom&&age<1100){const t=rise*rise*(3-2*rise);position.x=state.resumedFrom.x*(1-t)+position.x*t;position.y=state.resumedFrom.y*(1-t)+position.y*t;position.z=state.resumedFrom.z*(1-t)+position.z*t;}
  return { position,yaw:land>0?Math.atan2(-Math.sin(angle),-Math.cos(angle)):angle+Math.PI/2,flying:land<1 };
}
