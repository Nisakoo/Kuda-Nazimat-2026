import { describe, expect, it, vi } from 'vitest';
import { Group, Line } from 'three';
import { VisualWind } from './VisualWind';

function fixture(){const root=new Group();const flexible=new Group();flexible.name='wind-leaf-0';flexible.position.set(2,4,3);flexible.rotation.x=.2;root.add(flexible);
 const masonry=new Group();masonry.name='wall';root.add(masonry);return {root,flexible,masonry};}
describe('bounded visual wind',()=>{
  it('moves only named flexible pivots, remains moderate, and gives a late join the same phase',()=>{
    const a=fixture(),b=fixture();const first=new VisualWind(a.root),late=new VisualWind(b.root);
    first.animate(12345);late.animate(12345);expect(a.flexible.rotation.x).toBe(b.flexible.rotation.x);
    expect(a.flexible.rotation.x).not.toBe(.2);expect(Math.abs(a.flexible.rotation.x-.2)).toBeLessThan(.1);
    expect(a.masonry.rotation.toArray()).toEqual([0,0,0,'XYZ']);expect(a.flexible.position.toArray()).toEqual([2,4,3]);first.dispose();late.dispose();
  });
  it('allows at most 2 subtle world traces on the designated market model and frees their shared GPU resources',()=>{
    const h=fixture(),wind=new VisualWind(h.root,true);const traces=h.root.children.filter(child=>child instanceof Line) as Line[];
    expect(traces).toHaveLength(2);expect(traces[0]!.geometry).toBe(traces[1]!.geometry);
    const geometry=vi.spyOn(traces[0]!.geometry,'dispose');const material=vi.spyOn(traces[0]!.material as import('three').LineBasicMaterial,'dispose');
    wind.animate(87500);expect(traces.every(trace=>trace.visible)).toBe(true);
    expect((traces[0]!.material as import('three').LineBasicMaterial).opacity).toBeLessThanOrEqual(.14);
    wind.animate(90000);expect(traces.every(trace=>!trace.visible)).toBe(true);
    wind.dispose();expect(geometry).toHaveBeenCalledOnce();expect(material).toHaveBeenCalledOnce();expect(h.root.children).toHaveLength(2);
  });
  it('does not show traces on every streamed model or chunk',()=>{
    const h=fixture(),wind=new VisualWind(h.root);wind.animate(87500);
    expect(h.root.children.filter(child=>child instanceof Line&&child.visible)).toHaveLength(0);wind.dispose();
  });
});
