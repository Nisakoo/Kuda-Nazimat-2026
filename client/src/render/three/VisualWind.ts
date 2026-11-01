import { BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { WorldLifeDefinition } from '../../../../shared/world-life/types.ts';
import { schedulePhase } from '../../../../shared/world-life/phase.ts';
import { WindInstances } from './WindInstances';
interface FlexiblePart { readonly node: Object3D; readonly x: number; readonly z: number; readonly phase: number; readonly kind: string }
/** Named flexible pivots only. Masonry, collision geometry, characters and dynamic props never move. */
export class VisualWind {
  private lastTime: number | null = null;
  private readonly parts: FlexiblePart[]=[];
  private readonly traces: Line[]=[];
  private readonly geometry: BufferGeometry;
  private readonly material: LineBasicMaterial;
  private readonly instances: WindInstances;
  constructor(root: Object3D, private readonly traceEnabled = false) {
    root.traverse(node=>{
      const match=/^wind-(leaf|grass|cloth|sign)-/.exec(node.name);if(!match)return;
      const world=new Vector3();node.getWorldPosition(world);
      this.parts.push({node,x:node.rotation.x,z:node.rotation.z,kind:match[1]!,phase:world.x*.41+world.z*.27+this.parts.length*.73});
    });
    this.instances = new WindInstances(root);
    this.geometry=new BufferGeometry();this.geometry.setAttribute('position',new Float32BufferAttribute([-1,0,0,-.5,.06,.05,0,.09,.10,.5,.06,.13,1,0,.15],3));
    this.material=new LineBasicMaterial({color:'#eee0c3',transparent:true,opacity:0,depthWrite:false});
    for(let i=0;i<2;i++){const trace=new Line(this.geometry,this.material);trace.name=`wind-trace-${i}`;trace.visible=false;root.add(trace);this.traces.push(trace);}
  }
  animate(timeMs: number, wind?: WorldLifeDefinition['wind'], intervalMs = 0): void {
    if (this.lastTime !== null && timeMs >= this.lastTime && timeMs - this.lastTime < intervalMs) return;
    this.lastTime = timeMs;
    const gust=schedulePhase(timeMs,wind?.schedule??{periodMs:67000,durationMs:3000,offsetMs:19000});
    const envelope=gust.active?Math.sin(Math.PI*gust.phase):0;
    const strength=Math.min(.8,Math.max(0,wind?.strength??.24))+Math.min(1,Math.max(0,wind?.gustStrength??.42))*envelope;
    for(const part of this.parts){
      const amplitude=part.kind==='grass'?.13:part.kind==='cloth'?.045:part.kind==='sign'?.025:.065;
      const sway=Math.sin(timeMs*.0017+part.phase)*amplitude*strength;
      part.node.rotation.x=part.x+sway;part.node.rotation.z=part.z+sway*.55;
    }
    this.instances.update();
    // World-space traces are rare and weak. Only one of three gusts shows them.
    const traceGust=Math.floor(timeMs/(wind?.schedule.periodMs??67000))%3===1;
    this.material.opacity=.14*envelope;
    this.traces.forEach((trace,index)=>{trace.visible=this.traceEnabled&&traceGust&&gust.active&&this.parts.length>0;
      trace.position.set(-4+gust.phase*8+index*2,.6+index*.45,5+index*2);trace.rotation.y=-.3;});
  }
  dispose(): void {this.instances.dispose();for(const trace of this.traces)trace.removeFromParent();this.geometry.dispose();this.material.dispose();this.parts.length=0;}
}
