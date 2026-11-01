import { readFileSync } from 'node:fs';
import { Box3, Raycaster, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { parseWorldLifeDefinition } from '../../../../shared/world-life/validate.ts';

const modelUrl=(name:string)=>new URL(`../../../public/assets/models/market/${name}.glb`,import.meta.url);
function json(name:string){const bytes=readFileSync(modelUrl(name));return JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString()) as {nodes:{name?:string;extras?:{collisions?:number[][]}}[]};}
async function scene(name:string){const bytes=Uint8Array.from(readFileSync(modelUrl(name))).buffer;const gltf=await new GLTFLoader().parseAsync(bytes,'');gltf.scene.updateMatrixWorld(true);return gltf.scene;}
async function bounds(name:string){return new Box3().setFromObject(await scene(name));}

describe('generated market assets',()=>{
  it('keeps the movable pot footprint inside the shared 0.3 m authority radius',async()=>{
    const box=await bounds('pushable-pot');expect(Math.max(Math.abs(box.min.x),Math.abs(box.max.x),Math.abs(box.min.z),Math.abs(box.max.z))).toBeLessThanOrEqual(.3);
    expect(box.max.y).toBeGreaterThan(.5);
  });
  it('removes all 4 dynamic vessel positions from the baked collision rectangles and keeps the main route open',()=>{
    const collisions=json('market').nodes.find(node=>node.name==='market')!.extras!.collisions!;
    for(const [x,z] of [[5.2,4.6],[5.9,5.3],[6.6,4.6],[-3.7,7],[0,8],[0,4],[0,0]]){
      expect(collisions.some(([minX,minZ,maxX,maxZ])=>x!>=minX!&&x!<=maxX!&&z!>=minZ!&&z!<=maxZ!)).toBe(false);
    }
  });
  it('blocks ground vessels and cart shafts but leaves rounded corners and shaft gap open',()=>{
    const collisions=json('market').nodes.find(node=>node.name==='market')!.extras!.collisions!;
    const blocked=(x:number,z:number)=>collisions.some(([x0,z0,x1,z1])=>x>=x0!&&x<=x1!&&z>=z0!&&z<=z1!);
    for(const [x,z] of [[-6.8,3.6],[-3.15,3.5],[-6.7,4.9],[4.25,-6.2],[5.35,-6.2]])expect(blocked(x!,z!)).toBe(true);
    expect(blocked(-6.7+.6,4.9+.6)).toBe(false);
    expect(blocked(4.8,-6.2)).toBe(false);
  });
  it('does not leave baked visual vessels at any of the 4 movable positions',async()=>{
    const market=await scene('market');
    for(const [x,z] of [[5.2,4.6],[5.9,5.3],[6.6,4.6],[-3.7,7]]){
      const hits=new Raycaster(new Vector3(x,1.8,z),new Vector3(0,-1,0)).intersectObject(market,true);
      expect(hits.length).toBeGreaterThan(0);expect(hits[0]!.point.y).toBeLessThan(.1);
    }
  });
  it('exports cat joints, bird wings, and flexible foliage/cloth/grass separately from baked masonry',()=>{
    const cat=json('cat').nodes.map(node=>node.name);expect(cat).toContain('cat-head');expect(cat.filter(name=>name&&/^cat-leg-(-?1)-(-?1)$/.test(name))).toHaveLength(4);
    expect(json('bird').nodes.map(node=>node.name)).toEqual(expect.arrayContaining(['bird-wing-left','bird-wing-right']));
    for(const [name,kind] of [['market','cloth'],['market','sign'],['main-building','leaf'],['pasture','grass']])expect(json(name!).nodes.some(node=>node.name?.startsWith(`wind-${kind}-`))).toBe(true);
  });
  it('includes the canonical valid scene, 4 pots and 5 persistent apple IDs in the generated manifest',()=>{
    const manifest=JSON.parse(readFileSync(new URL('../../../public/maps/market/manifest.json',import.meta.url),'utf8')) as {worldLife:unknown;models:Record<string,string>};
    const life=parseWorldLifeDefinition(manifest.worldLife,manifest.models,'market');
    expect(life.cats).toHaveLength(3);expect(life.flock.count).toBe(5);
    const behavior=(id:string)=>life.templates.find(template=>template.id===id)!.behavior;
    expect(life.instances.filter(instance=>behavior(instance.templateId)==='pushable')).toHaveLength(8);
    expect(life.instances.filter(instance=>behavior(instance.templateId)==='pickup')).toHaveLength(17);
  });
  it('makes the full SCENE/BUILDING catalogue available through independent manifest models and declared budgets',()=>{
    const manifest=JSON.parse(readFileSync(new URL('../../../public/maps/market/manifest.json',import.meta.url),'utf8')) as {models:Record<string,string>;assets:Record<string,{bytes:number;memory:number}>};
    for(const id of ['house','wall','textile-sign','courtyard-arch','exterior-stair','fence','paving','table','shelf','crate','basket','fruit','dates','fabric-roll','canopy','cart','bowl','jar','bench','scroll-table','courtyard-vessel','courtyard-planter','courtyard-lantern','palm','vines','grass','merchant','shepherd','goat','cat','bird','pushable-pot','pickup-apple']){
      expect(manifest.models[id]).toBe(`market/${id}.glb`);const bytes=readFileSync(modelUrl(id));expect(manifest.assets[`assets/models/market/${id}.glb`]!.bytes).toBe(bytes.length);
      expect(manifest.assets[`assets/models/market/${id}.glb`]!.memory).toBeGreaterThanOrEqual(bytes.length);
      expect(json(id).nodes.some(node=>node.name?.endsWith('-surface'))).toBe(true);
    }
  });
});
