import { afterEach, describe, expect, it } from 'vitest';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { AnimationMixer, Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AVATAR_IDS, AVATAR_PROFILE, createAvatarModel, generateAvatarModels } from './generate-avatar-models.mjs';

const temporary=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
// Candidate validation is opt-in; production checks continue to read the shipped GLBs.
const candidateDir=process.env.AVATAR_MODEL_TEST_DIR;
const file=id=>candidateDir ? pathToFileURL(join(candidateDir,id+'.glb')) : new URL('../public/assets/models/avatars/'+id+'.glb',import.meta.url);
const hierarchy=root=>{const result=[];root.traverse(n=>{if(n.isGroup)result.push([n.name,n.parent?.isGroup?n.parent.name:null]);});return result;};
const bounds=root=>{root.updateMatrixWorld(true);return new Box3().setFromObject(root);};
const parse=async id=>{const bytes=await readFile(file(id));return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');};
const glbDocument=bytes=>JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8'));

describe('TASK-043 original local avatar models',()=>{
  it('exports exactly four closed IDs, never accepts a path or unknown name',()=>{
    expect(AVATAR_IDS).toEqual(['lukas','nic','dan','ksu']);
    for(const id of ['other','../lukas','lukas.glb','https://invalid/avatar.glb',''])expect(()=>createAvatarModel(id)).toThrow(RangeError);
  });

  it('has one common hierarchy, forward axis, real surface dimensions and foot origin',()=>{
    const reference=hierarchy(createAvatarModel('lukas').root);
    for(const id of AVATAR_IDS){
      const {root}=createAvatarModel(id),b=bounds(root),size=b.getSize(new Vector3());
      expect(hierarchy(root)).toEqual(reference);
      expect(root.name).toBe('avatar');expect(root.userData.forward).toBe('+Z');
      expect(size.x).toBeCloseTo(AVATAR_PROFILE.width,6);expect(size.y).toBeCloseTo(1.8,6);expect(size.z).toBeCloseTo(.56,6);
      expect(b.min.y).toBeCloseTo(0,6);expect(root.position.toArray()).toEqual([0,0,0]);
      for(const side of ['left','right']){
        expect(root.getObjectByName('elbow-'+side).parent.name).toBe('shoulder-'+side);
        expect(root.getObjectByName('wrist-'+side).parent.name).toBe('elbow-'+side);
        expect(root.getObjectByName('knee-'+side).parent.name).toBe('hip-'+side);
        expect(root.getObjectByName('ankle-'+side).parent.name).toBe('knee-'+side);
      }
      expect(root.getObjectByName('hair').parent.name).toBe('head');
      expect(root.getObjectByName('face').parent.name).toBe('head');
    }
  });

  it('has distinct sculpted hair, frames and Ksu clothing, not only different colours',()=>{
    const models=new Map(AVATAR_IDS.map(id=>[id,createAvatarModel(id).root]));
    const signature=(id,name)=>Array.from(models.get(id).getObjectByName(name+'-surface').geometry.attributes.position.array);
    expect(signature('lukas','hair')).not.toEqual(signature('nic','hair'));
    expect(signature('nic','hair')).not.toEqual(signature('dan','hair'));
    expect(signature('dan','hair')).not.toEqual(signature('ksu','hair'));
    expect(signature('lukas','face')).not.toEqual(signature('nic','face'));
    expect(signature('nic','face')).not.toEqual(signature('dan','face'));
    expect(signature('ksu','torso')).not.toEqual(signature('lukas','torso'));
  });

  it('ships valid GLB 2.0 with embedded geometry, no runtime URLs, and the two clips',async()=>{
    for(const id of AVATAR_IDS){
      const bytes=await readFile(file(id)),json=glbDocument(bytes);
      expect(bytes.toString('utf8',0,4)).toBe('glTF');expect(bytes.readUInt32LE(4)).toBe(2);expect(bytes.readUInt32LE(8)).toBe(bytes.length);
      expect(json.buffers).toHaveLength(1);expect(json.buffers[0].uri).toBeUndefined();
      expect(json.images??[]).toHaveLength(0);expect(json.textures??[]).toHaveLength(0);
      expect(json.animations.map(a=>a.name)).toEqual(['idle','walk']);
      const loaded=await parse(id);expect(loaded.animations.map(c=>c.name)).toEqual(['idle','walk']);
      const b=bounds(loaded.scene),s=b.getSize(new Vector3());expect(b.min.y).toBeCloseTo(0,6);expect(s.y).toBeCloseTo(1.8,6);
      const png=await readFile(new URL('../public/assets/models/avatars/'+id+'-portrait.png',import.meta.url));
      expect(png.subarray(1,4).toString()).toBe('PNG');expect(png.readUInt32BE(16)).toBe(512);expect(png.readUInt32BE(20)).toBe(512);
    }
  });

  it('matches the independently approved V4 GLB, full geometry and exact neutral transforms',async()=>{
    // geometry-neutral-before.json remains unchanged as the historical pre-correction fixture.
    const baseline=JSON.parse(await readFile(new URL('../../tasks/evidence/avatar-models-2026-07-02/geometry-neutral-approved-v4.json',import.meta.url),'utf8'));
    for(const id of AVATAR_IDS){
      const bytes=await readFile(file(id));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(baseline[id].candidateGlbSha256);
      const loaded=await parse(id),hash=createHash('sha256'),nodes=[];
      loaded.scene.traverse(node=>{
        nodes.push({name:node.name,type:node.type,position:node.position.toArray(),quaternion:node.quaternion.toArray(),scale:node.scale.toArray()});
        if(!node.isMesh)return;hash.update(node.name);
        for(const key of Object.keys(node.geometry.attributes).sort()){
          const array=node.geometry.attributes[key].array;hash.update(key);hash.update(Buffer.from(array.buffer,array.byteOffset,array.byteLength));
        }
        if(node.geometry.index){const array=node.geometry.index.array;hash.update(Buffer.from(array.buffer,array.byteOffset,array.byteLength));}
      });
      expect(hash.digest('hex')).toBe(baseline[id].geometrySha256);
      expect(nodes).toEqual(baseline[id].neutralNodes);
    }
  });

  it('preserves the original lower-body geometry, node transforms and avatar normalization exactly',async()=>{
    const baseline=JSON.parse(await readFile(new URL('../../tasks/evidence/avatar-models-2026-07-02/visual-v2-candidate/lowerbody-baseline.json',import.meta.url),'utf8'));
    for(const id of AVATAR_IDS){
      const loaded=await parse(id),nodes=[];
      loaded.scene.traverse(node=>{
        if(!/^(hip|knee|ankle)-(left|right)(-surface)?$/.test(node.name))return;
        const item={name:node.name,position:node.position.toArray(),quaternion:node.quaternion.toArray(),scale:node.scale.toArray()};
        if(node.isMesh){const hash=createHash('sha256');for(const key of Object.keys(node.geometry.attributes).sort()){
          const array=node.geometry.attributes[key].array;hash.update(key);hash.update(Buffer.from(array.buffer,array.byteOffset,array.byteLength));
        }if(node.geometry.index){const array=node.geometry.index.array;hash.update(Buffer.from(array.buffer,array.byteOffset,array.byteLength));}item.geometrySha256=hash.digest('hex');}
        nodes.push(item);
      });
      expect(loaded.scene.getObjectByName('avatar').scale.toArray()).toEqual(baseline[id].avatarScale);
      expect(nodes).toEqual(baseline[id].nodes);
    }
  });

  it('keeps geometry finite, bounded and matte, with one shared material and at most 20 calls',async()=>{
    for(const id of AVATAR_IDS){
      const loaded=await parse(id),materials=new Set();let triangles=0,drawCalls=0;
      loaded.scene.traverse(node=>{if(!node.isMesh)return;
        drawCalls++;materials.add(node.material);const {position,normal,color}=node.geometry.attributes;
        expect(position.count).toBeGreaterThan(0);expect(normal.count).toBe(position.count);expect(color.count).toBe(position.count);
        for(const array of [position.array,normal.array,color.array])expect(Array.from(array).every(Number.isFinite)).toBe(true);
        triangles+=(node.geometry.index?.count??position.count)/3;
        expect(node.material.map).toBeNull();expect(node.material.roughness).toBe(1);expect(node.material.metalness).toBe(0);
      });
      expect(materials.size).toBe(1);expect(triangles).toBeGreaterThan(5000);expect(triangles).toBeLessThan(8000);expect(drawCalls).toBeLessThanOrEqual(20);
    }
  });

  it('uses identical looped clips without root motion or unnormalised rotations',()=>{
    const clipData=clip=>({name:clip.name,duration:clip.duration,tracks:clip.tracks.map(track=>({name:track.name,times:Array.from(track.times),values:Array.from(track.values)}))});
    const reference=createAvatarModel('lukas').animations.map(clipData);
    for(const id of AVATAR_IDS){
      const {root,animations}=createAvatarModel(id);expect(animations.map(clipData)).toEqual(reference);
      for(const clip of animations)for(const track of clip.tracks){
        expect(track.name.startsWith('avatar.')).toBe(false);
        if(track.name.endsWith('.position'))expect(['torso.position','hip-left.position','hip-right.position']).toContain(track.name);
        expect(root.getObjectByName(track.name.split('.')[0])).toBeDefined();
        expect(track.times[0]).toBe(0);expect(track.times.at(-1)).toBeCloseTo(clip.duration,5);
        const stride=track.getValueSize();
        for(let j=0;j<stride;j++)expect(track.values[j]).toBeCloseTo(track.values[track.values.length-stride+j],6);
        if(stride===4)for(let i=0;i<track.values.length;i+=4)expect(Math.hypot(...track.values.slice(i,i+4))).toBeCloseTo(1,6);
      }
    }
  });

  it('uses dense common Y-offset keys, a 1.2 m cycle and no animated root/scaling',()=>{
    const {root,animations}=createAvatarModel('lukas'),walk=animations.find(c=>c.name==='walk');
    expect(root.userData.walkCycleMetres).toBe(1.2);
    const torso=walk.tracks.find(t=>t.name==='torso.position'),left=walk.tracks.find(t=>t.name==='hip-left.position'),right=walk.tracks.find(t=>t.name==='hip-right.position');
    for(const track of walk.tracks){expect(track.times.length).toBe(257);expect(track.name.endsWith('.scale')).toBe(false);expect(track.name.startsWith('avatar.')).toBe(false);}
    for(let i=0;i<257;i++){
      const phase=i/256,z=.3-1.2*(phase%.5),offset=.16+Math.sqrt(.6199**2-z*z)-.78;
      expect(torso.values[i*3+1]).toBeCloseTo(.95+offset,6);
      expect(left.values[i*3+1]).toBeCloseTo(.78+offset,6);expect(right.values[i*3+1]).toBeCloseTo(.78+offset,6);
      expect(offset).toBeGreaterThan(-.078);expect(offset).toBeLessThanOrEqual(0);
      expect(torso.values[i*3]).toBe(0);expect(torso.values[i*3+2]).toBe(0);
      expect(left.values[i*3]).toBeCloseTo(-.126,6);expect(right.values[i*3]).toBeCloseTo(.126,6);
      expect(left.values[i*3+2]).toBe(0);expect(right.values[i*3+2]).toBe(0);
    }
  });

  it('holds actual exported stance soles and contact Z within 0.1 mm between dense keys',async()=>{
    const point=new Vector3();
    for(const id of AVATAR_IDS){
      const loaded=await parse(id),root=loaded.scene,avatar=root.getObjectByName('avatar'),mixer=new AnimationMixer(root);
      mixer.clipAction(loaded.animations.find(c=>c.name==='walk')).play();
      for(let sample=0;sample<2048;sample++){
        const t=(sample+.5)/2048;mixer.setTime(t*.9);root.updateMatrixWorld(true);
        for(const side of ['left','right']){
          const phase=(t+(side==='left'?0:.5))%1,ankle=root.getObjectByName('ankle-'+side);
          const foot=new Box3().setFromObject(ankle);expect(foot.min.y).toBeGreaterThan(-.0001);
          if(phase>=.5)continue;
          expect(Math.abs(foot.min.y)).toBeLessThan(.0001);
          ankle.getWorldPosition(point);expect(Math.abs(point.z-(.3-1.2*phase)*avatar.scale.z)).toBeLessThan(.0001);
        }
        expect(avatar.position.toArray()).toEqual([0,0,0]);
      }
      mixer.stopAllAction();mixer.uncacheRoot(root);
    }
  },30000);

  it('keeps the shared trouser surfaces inside the closed tunic throughout the gait',()=>{
    const {root,animations}=createAvatarModel('lukas'),mixer=new AnimationMixer(root);
    mixer.clipAction(animations.find(c=>c.name==='walk')).play();
    const torso=root.getObjectByName('torso'),point=new Vector3();
    for(let sample=0;sample<512;sample++){
      mixer.setTime(sample/512*.9);root.updateMatrixWorld(true);
      const inverse=torso.matrixWorld.clone().invert();
      for(const name of ['hip-left','hip-right','knee-left','knee-right']){
        const surface=root.getObjectByName(name+'-surface'),positions=surface.geometry.attributes.position;
        const matrix=surface.matrixWorld.clone().premultiply(inverse);
        for(let vertex=0;vertex<positions.count;vertex++){
          point.fromBufferAttribute(positions,vertex).applyMatrix4(matrix);
          if(point.y<=-.419||point.y>=0)continue;
          const lower=point.y<-.23,t=lower?(point.y+.42)/.19:(point.y+.23)/.23;
          const rx=lower?.305+(.265-.305)*t:.265+(.205-.265)*t;
          const rz=lower?.290+(.220-.290)*t:.220+(.137-.220)*t;
          const angle=(Math.atan2(point.x/rx,point.z/rz)+Math.PI*2)%(Math.PI*2),step=Math.PI/8;
          const radialLimit=Math.cos(step/2)/Math.cos(angle-(Math.floor(angle/step)+.5)*step);
          expect(Math.hypot(point.x/rx,point.z/rz)).toBeLessThanOrEqual(radialLimit+.001);
        }
      }
    }
    mixer.stopAllAction();mixer.uncacheRoot(root);
  },30000);

  it('rebuilds the checked-in GLBs byte for byte',async()=>{
    const path=await mkdtemp(join(tmpdir(),'avatar-model-test-'));temporary.push(path);
    const output=pathToFileURL(path+'/'),reports=await generateAvatarModels(output);
    for(const report of reports){
      expect((await readFile(new URL(report.id+'.glb',output))).equals(await readFile(file(report.id)))).toBe(true);
      expect(report.bytes).toBeLessThan(900000);
    }
  },30000);
});
