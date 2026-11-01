import { describe, expect, it } from 'vitest';
import { createCharacter } from './CharacterRig';
import { SceneAssets } from './SceneAssets';

const movement={sprint:1,air:0,falling:0,takeoff:0,landing:0};
describe('pickup, carry and place poses',()=>{
  it.each([30,60])('keeps the hand joint, root and MOVE leg gait coherent at %i FPS',fps=>{
    const assets=new SceneAssets(),free=createCharacter(assets,'#318e81',true,0),held=createCharacter(assets,'#318e81',true,0);
    expect(held.hand.name).toBe('hand-right');expect(held.hand.parent!.name).toBe('elbow');
    for(let frame=0;frame<fps;frame++){
      const time=frame/fps,phase=time*8;
      free.pose(phase,1,time,.1,movement);
      held.pose(phase,1,time,.1,movement,{carrying:true,action:null,progress:1});
      for(const name of ['hip-left','hip-right','knee','ankle'])expect(held.root.getObjectByName(name)!.rotation.toArray()).toEqual(free.root.getObjectByName(name)!.rotation.toArray());
      expect(held.root.position.toArray()).toEqual([0,0,0]);
      expect(held.root.getObjectByName('shoulder-right')!.rotation.x).toBeLessThan(-.2);
    }
    assets.release(free.root);assets.release(held.root);assets.dispose();
  });
  it('blends the confirmed reach action and returns smoothly to the free pose after place',()=>{
    const assets=new SceneAssets(),rig=createCharacter(assets,'#318e81',true,0);
    rig.pose(0,0,0,0,movement);const torso=rig.root.getObjectByName('torso')!,shoulder=rig.root.getObjectByName('shoulder-right')!;
    const idleY=torso.position.y,idleArm=shoulder.rotation.x;
    rig.pose(0,0,0,0,movement,{carrying:true,action:'pickup',progress:.5});expect(torso.position.y).toBeLessThan(idleY-.1);expect(torso.rotation.x).toBeGreaterThan(.4);
    rig.pose(0,0,0,0,movement,{carrying:false,action:'place',progress:1});expect(shoulder.rotation.x).toBeCloseTo(idleArm,8);expect(torso.position.y).toBeCloseTo(idleY,8);
    assets.release(rig.root);assets.dispose();
  });
});
