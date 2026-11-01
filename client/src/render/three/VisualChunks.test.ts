import { Group, Scene } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { GltfLibrary, ModelInstance } from './GltfLibrary';
import { VisualChunks } from './VisualChunks';
import type { VisualChunk } from '../RenderAdapter';

const chunk:VisualChunk={id:'0_0',objects:[{id:'bench-a',assetId:'bench',transform:{position:{x:1,y:0,z:2},rotationY:.5}},{id:'bench-b',assetId:'bench',transform:{position:{x:3,y:0,z:2},rotationY:1}}]};
const instance=():ModelInstance=>{const root=new Group();return {root,animate:vi.fn(),dispose:vi.fn(()=>root.removeFromParent())};};
describe('streamed visual chunk readiness',()=>{
  it('does not expose a chunk to ground world-life until all its models are ready',async()=>{
    const scene=new Scene();const pending:((value:ModelInstance)=>void)[]=[];
    const library={instantiate:vi.fn(()=>new Promise<ModelInstance>(resolve=>pending.push(resolve)))} as unknown as GltfLibrary;
    const chunks=new VisualChunks(scene,library);const loading=chunks.load(chunk);
    expect(chunks.readyIds).toEqual([]);const a=instance(),b=instance();pending[0]!(a);await Promise.resolve();expect(chunks.readyIds).toEqual([]);
    pending[1]!(b);await loading;expect(chunks.readyIds).toEqual(['0_0']);
    const first=scene.getObjectByName('bench-a')!,second=scene.getObjectByName('bench-b')!;expect(first.position.toArray()).toEqual([1,0,2]);expect(second.rotation.y).toBe(1);
    chunks.unload('0_0');expect(chunks.readyIds).toEqual([]);expect(a.dispose).toHaveBeenCalledOnce();expect(b.dispose).toHaveBeenCalledOnce();expect(scene.children).toHaveLength(0);chunks.dispose();
  });
  it('does not restore a chunk after its pending models complete following unload',async()=>{
    const scene=new Scene();let resolve!:(value:ModelInstance)=>void;
    const library={instantiate:()=>new Promise<ModelInstance>(done=>{resolve=done;})} as unknown as GltfLibrary;
    const chunks=new VisualChunks(scene,library);const loading=chunks.load({...chunk,objects:[chunk.objects[0]!]});const rejected=expect(loading).rejects.toMatchObject({name:'AbortError'});
    chunks.unload('0_0');const late=instance();resolve(late);await rejected;expect(late.dispose).toHaveBeenCalledOnce();expect(chunks.readyIds).toEqual([]);expect(scene.children).toHaveLength(0);chunks.dispose();
  });
  it('rejects duplicate placement IDs without replacing the existing ready chunk',async()=>{
    const scene=new Scene();const library={instantiate:async()=>instance()} as unknown as GltfLibrary;const chunks=new VisualChunks(scene,library);
    await chunks.load(chunk);await expect(chunks.load({...chunk,objects:[chunk.objects[0]!,chunk.objects[0]!]})).rejects.toThrow('Duplicate visual object');
    expect(chunks.readyIds).toEqual(['0_0']);chunks.dispose();
  });
});
