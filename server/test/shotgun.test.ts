import { describe, expect, it } from 'vitest';
import { ShotgunSimulation } from '../../shared/shotgun/Simulation.ts';
import { parseWorldLifeClientMessage, parseWorldLifeServerMessage } from '../../shared/world-life/validate.ts';
const origin={x:0,y:0,z:0};
const action={v:1,type:'shotgun',requestId:'shot-1',action:'fire',yaw:0,pitch:.28};
function create(blocked=false) { const s=new ShotgunSimulation('scene','test',[{x:0,y:0,z:-4},{x:2,y:0,z:-4},{x:-2,y:0,z:-4}],{height:()=>0,clear:()=>true,rayClear:(_a,b)=>!blocked||b.z>-2});s.addPlayer('p');return s; }
function advance(s:ShotgunSimulation,seconds:number) {for(let i=0;i<Math.ceil(seconds*100);i++)s.step(.01);}
describe('shotgun authority and bounded wire contract',()=>{
  it('limits rate/ammunition, blocks fire throughout reload, and refills only on completion',()=>{
    const s=create();
    expect(s.act('stranger',origin,'fire',0,.28)).toBe(false);
    for(let i=0;i<6;i++){expect(s.act('p',origin,'fire',0,.28)).toBe(true);expect(s.act('p',origin,'fire',0,.28)).toBe(false);advance(s,.7);}
    expect(s.snapshot().weapons[0]?.ammo).toBe(0);expect(s.act('p',origin,'fire',0,.28)).toBe(false);
    expect(s.act('p',origin,'reload',0,0)).toBe(true);advance(s,2.39);expect(s.act('p',origin,'fire',0,0)).toBe(false);expect(s.snapshot().weapons[0]?.ammo).toBe(0);
    advance(s,.02);expect(s.snapshot().weapons[0]).toMatchObject({ammo:6,reloadLeft:0});expect(s.act('p',origin,'fire',0,0)).toBe(true);
  });
  it('gives the nearest target an airborne impulse, settles on the ground, and blocks shots at a wall',()=>{
    const s=create(), before=s.snapshot();s.act('p',origin,'fire',0,.28);advance(s,.1);
    expect(s.snapshot().props[0]!.position.z).toBeLessThan(-4);expect(s.snapshot().props[0]!.position.y).toBeGreaterThan(0);
    expect(s.snapshot().props[1]).toEqual(before.props[1]);advance(s,8);expect(s.snapshot().props[0]!.position.y).toBe(0);
    const blocked=create(true);blocked.act('p',origin,'fire',0,.28);advance(blocked,1);expect(blocked.snapshot().props).toEqual(before.props);
    expect(before.props[0]!.position).toEqual({x:0,y:0,z:-4});
  });
  it('rejects forged origin/target, nonfinite angles, oversized state and retains at most 12 shots',()=>{
    expect(parseWorldLifeClientMessage(action)).toEqual(action);
    for(const extra of [{origin},{targetId:'target-0'},{yaw:NaN},{pitch:2}])expect(()=>parseWorldLifeClientMessage({...action,...extra})).toThrow();
    const s=create();for(let i=0;i<24;i++){if(i%6===0&&i){s.act('p',origin,'reload',0,0);advance(s,2.4);}s.act('p',origin,'fire',0,.28);advance(s,.7);}
    const state=s.snapshot();expect(state.shots).toHaveLength(12);expect(parseWorldLifeServerMessage(state)).toEqual(state);
    expect(()=>parseWorldLifeServerMessage({...state,props:Array(13).fill(state.props[0])})).toThrow();
    expect(JSON.stringify(state).length).toBeLessThan(65536);
  });
  it('reflects at world obstacles without tunnelling and keeps released players bounded',()=>{
    const s=new ShotgunSimulation('s','m',[{x:0,y:0,z:-4}],{height:()=>0,clear:(_a,b)=>b.z> -4.7,rayClear:()=>true});s.addPlayer('p');s.act('p',origin,'fire',0,.28);
    for(let i=0;i<200;i++){s.step(.02);expect(s.snapshot().props[0]!.position.z).toBeGreaterThan(-4.7);}
    s.removePlayer('p');expect(s.snapshot().weapons).toEqual([]);
  });
});
