import { describe, expect, it, vi } from 'vitest';
import { Group, Scene, Sprite, Vector3 } from 'three';
import type { SceneStateMessage } from '../../../../shared/world-life/types.ts';
import type { Entity, WorldSnapshot } from '../../core/types';
import type { GltfLibrary, ModelInstance } from './GltfLibrary';
import { WorldLifeVisuals, lifeChunk } from './WorldLifeVisuals';
import { EntityVisuals } from './EntityVisuals';
import { SceneAssets } from './SceneAssets';

function state(time = 0): SceneStateMessage {
  return { v:1,type:'scene-state',sceneId:'test',revision:0,serverTimeMs:1000+time,epochMs:1000,
    definition:{v:1,mapId:'market',seed:7,templates:[
      {id:'cat',assetId:'cat',behavior:'animated',animation:'idle'},
      {id:'pot',assetId:'pushable-pot',behavior:'pushable',animation:'idle'},
      {id:'apple',assetId:'pickup-apple',behavior:'pickup',animation:'idle'},
      {id:'bench',assetId:'bench',behavior:'static',animation:'idle'}],
    instances:[{id:'cat-1',templateId:'cat',position:{x:0,y:0,z:0},rotationY:.4},
      {id:'pot-1',templateId:'pot',position:{x:5,y:0,z:5},rotationY:0},
      {id:'apple-1',templateId:'apple',position:{x:-5,y:0,z:7},rotationY:0},
      {id:'bench-1',templateId:'bench',position:{x:32,y:0,z:0},rotationY:.5},
      {id:'bench-2',templateId:'bench',position:{x:34,y:0,z:1},rotationY:1}],
    cats:[{instanceId:'cat-1',behavior:'walk',route:[{x:0,y:0,z:0},{x:4,y:0,z:0},{x:4,y:0,z:4}],cycleMs:12000,pauseMs:2000}],
    flock:{assetId:'bird',count:5,route:[{x:-8,y:12,z:4},{x:8,y:13,z:4}],schedule:{periodMs:120000,durationMs:10000,offsetMs:30000}},
    wind:{strength:.25,gustStrength:.4,schedule:{periodMs:60000,durationMs:3000,offsetMs:10000}}},
    pots:[{id:'pot-1',position:{x:5,y:0,z:5}}],apples:[{id:'apple-1',mapId:'market',state:'world',position:{x:-5,y:0,z:7}}]};
}
function model(): ModelInstance {
  const root=new Group();
  for(const name of ['cat-body','cat-head','cat-tail','cat-eye-left','cat-eye-right','bird-wing-left','bird-wing-right',...[-1,1].flatMap(a=>[-1,1].map(b=>`cat-leg-${a}-${b}`))]){const node=new Group();node.name=name;root.add(node);}
  return {root,animate:vi.fn(),dispose:vi.fn(()=>root.removeFromParent())};
}
function setup() {
  const scene=new Scene(),assets=new SceneAssets();vi.spyOn(assets,'label').mockImplementation(()=>new Sprite());
  const characters=new EntityVisuals(scene,assets);const models:ModelInstance[]=[];
  const library={has:()=>true,instantiate:vi.fn(async()=>{const instance=model();models.push(instance);return instance;})} as unknown as GltfLibrary;
  const life=new WorldLifeVisuals(scene,library,characters);
  return {scene,assets,characters,models,library,life,dispose:()=>{life.dispose();characters.dispose();assets.dispose();}};
}
const settle=async()=>{await Promise.resolve();await Promise.resolve();};

describe('authoritative world-life visuals',()=>{
  it('gates instances by streamed chunks, supports reusable data placements, and releases after unload',async()=>{
    const h=setup();h.life.setState(state(),0);h.life.animate(0,.016,[]);expect(h.library.instantiate).not.toHaveBeenCalled();
    h.life.animate(0,.016,['0_0']);await settle();expect([...h.life.ids].sort()).toEqual(['apple-1','cat-1','pot-1']);
    h.life.animate(0,.016,['1_0']);await settle();expect([...h.life.ids].sort()).toEqual(['bench-1','bench-2']);
    expect(h.scene.getObjectByName('life:bench-2')!.rotation.y).toBe(1);
    expect(h.models.slice(0,3).every(item=>vi.mocked(item.dispose).mock.calls.length===1)).toBe(true);
    h.life.animate(0,.016,[]);expect(h.life.ids).toEqual([]);h.dispose();expect(h.models.every(item=>vi.mocked(item.dispose).mock.calls.length===1)).toBe(true);
  });
  it('samples the same cat route and pose for an existing client and a late join',async()=>{
    const a=setup(),b=setup();a.life.setState(state(4000),10);b.life.setState(state(6500),12.5);
    for(const h of [a,b]){h.life.animate(12.5,.016,['0_0']);await settle();h.life.animate(12.5,.016,['0_0']);}
    const first=a.scene.getObjectByName('life:cat-1')!,late=b.scene.getObjectByName('life:cat-1')!;
    expect(first.position.toArray()).toEqual(late.position.toArray());
    expect(first.getObjectByName('cat-leg-1-1')!.rotation.x).toBe(late.getObjectByName('cat-leg-1-1')!.rotation.x);
    a.dispose();b.dispose();
  });
  it('shows exactly 5 shared birds only during the scheduled flight and releases them afterwards',async()=>{
    const h=setup();h.life.setState(state(35000),0);h.life.animate(0,.016,['0_0']);await settle();h.life.animate(0,.016,['0_0']);
    expect(h.life.ids.filter(id=>id.startsWith('flock:'))).toHaveLength(5);
    expect(h.scene.getObjectByName('life:flock:0')!.position.y).toBeCloseTo(12.5);
    h.life.animate(6,.016,['0_0']);expect(h.life.ids.filter(id=>id.startsWith('flock:'))).toHaveLength(0);h.dispose();
  });
  it.each(['sleep','wash'] as const)('makes the %s cat pose recognizable without changing its route position',async behavior=>{
    const h=setup(),initial=state();h.life.setState({...initial,definition:{...initial.definition,cats:[{...initial.definition.cats[0]!,behavior}]}},0);
    h.life.animate(0,.016,['0_0']);await settle();h.life.animate(.4,.016,['0_0']);
    const cat=h.scene.getObjectByName('life:cat-1')!;expect(cat.position.toArray()).toEqual([0,0,0]);
    if(behavior==='sleep'){expect(cat.getObjectByName('cat-eye-left')!.scale.y).toBeLessThan(.2);expect(cat.getObjectByName('cat-body')!.scale.y).toBeLessThan(.8);}
    else expect(cat.getObjectByName('cat-leg-1-1')!.rotation.x).toBeLessThan(-2);
    h.dispose();
  });
  it.each(['local','remote'])('attaches the confirmed apple to the %s hand and keeps it through ground chunk unload and MOVE',async holder=>{
    const h=setup();const character=(y:number):Entity=>({id:holder,renderable:{assetId:'player'},character:{kind:'player',name:holder},transform:{position:{x:0,y,z:0},rotationY:0}});
    const snapshot=(y:number):WorldSnapshot=>({tick:y?1:0,entities:[character(y)]});
    let current=snapshot(0);h.characters.sync(current,current,holder==='local'?holder:null);
    const initial=state();h.life.setState(initial,0);h.life.animate(0,.016,['0_0']);await settle();
    h.life.setState({...initial,revision:1,apples:[{id:'apple-1',mapId:'market',state:'held',holderId:holder}]},0);
    h.characters.animate(1,.2,.1);h.life.animate(.2,.016,[]);await settle();
    const apple=h.scene.getObjectByName('life:apple-1')!,anchor=h.characters.handAnchor(holder)!;
    expect(apple.parent).toBe(anchor);expect(h.life.ids).toEqual(['apple-1']);
    h.scene.updateMatrixWorld(true);const before=apple.getWorldPosition(new Vector3());
    current=snapshot(1);h.characters.sync(current,current,holder);h.characters.animate(1,.3,.016);h.life.animate(.3,.016,[]);h.scene.updateMatrixWorld(true);
    expect(apple.getWorldPosition(new Vector3()).y).toBeGreaterThan(before.y+.7);
    h.life.setState({...initial,revision:2},.3);h.life.animate(.3,.016,['0_0']);await settle();
    expect(apple.parent).toBe(h.scene);expect(apple.position.toArray()).toEqual([-5,0,7]);
    expect(h.scene.getObjectByName(`entity:${holder}`)!.position.y).toBe(1);h.dispose();
  });
  it('ignores older revisions, does not respawn absent saved apples, and clears on session reset',async()=>{
    const h=setup(),initial=state();h.life.setState({...initial,revision:2,apples:[]},0);h.life.setState({...initial,revision:1},0);
    h.life.animate(0,.016,['0_0']);await settle();expect(h.life.ids).not.toContain('apple-1');
    h.life.setState(null,0);expect(h.life.ids).toHaveLength(0);expect(h.models.every(item=>vi.mocked(item.dispose).mock.calls.length===1)).toBe(true);h.dispose();
  });
  it('disposes a late model result after the chunk has unloaded',async()=>{
    const h=setup();let resolve!:(value:ModelInstance)=>void;
    vi.mocked(h.library.instantiate).mockImplementation(()=>new Promise(done=>{resolve=done;}));
    const initial=state();h.life.setState({...initial,definition:{...initial.definition,instances:[initial.definition.instances[0]!]}},0);
    h.life.animate(0,.016,['0_0']);h.life.animate(.1,.016,[]);const late=model();resolve(late);await settle();
    expect(late.dispose).toHaveBeenCalledOnce();expect(h.life.ids).toHaveLength(0);h.dispose();
  });
  it('uses the existing centred market grid at negative and positive boundaries',()=>{
    expect(lifeChunk({x:-16,y:0,z:-16})).toBe('0_0');expect(lifeChunk({x:16,y:0,z:-16.01})).toBe('1_-1');
  });
});
