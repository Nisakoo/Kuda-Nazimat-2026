import { BoxGeometry, CircleGeometry, CylinderGeometry, Group, Matrix3, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Raycaster, SphereGeometry, Vector3 } from 'three';
import type { PerspectiveCamera, Scene } from 'three';
import { SHOTGUN, pelletDirection } from '../../../../shared/shotgun/types.ts';
import type { Shot, ShotgunState } from '../../../../shared/shotgun/types.ts';
import type { EntityVisuals } from './EntityVisuals';
import { CameraRaycast } from './CameraRaycast';

/** Owns bounded procedural resources; never changes authoritative scene objects. */
export class ShotgunVisuals {
  private state: ShotgunState | null = null;
  private playerId = '';
  private lastShot = 0;
  private readonly props = new Map<string, Group>();
  private readonly guns = new Map<string, Group>();
  private readonly shotAt = new Map<string, number>();
  private readonly marks: { mesh: Mesh; age: number }[] = [];
  private pending: Shot[] = [];
  private historical = false;
  private time = 0;
  private readonly geometries = [new BoxGeometry(1,1,1), new CylinderGeometry(1,1,1,12), new SphereGeometry(1,12,8), new CircleGeometry(.037,8)];
  private readonly wood = new MeshStandardMaterial({color:'#75452d',roughness:.8});
  private readonly metal = new MeshStandardMaterial({color:'#303c43',metalness:.65,roughness:.32});
  private readonly clay = new MeshStandardMaterial({color:'#c7774d',roughness:.9});
  private readonly skin = new MeshStandardMaterial({color:'#c4906d',roughness:.9});
  private readonly dark = new MeshBasicMaterial({color:'#241b19',polygonOffset:true,polygonOffsetFactor:-3,depthWrite:false});
  private readonly flashMaterial = new MeshBasicMaterial({color:'#ffdc8a',depthTest:false});
  private readonly viewGun: Group;
  private readonly ray = new Raycaster();
  private readonly raycast = new CameraRaycast();
  constructor(private readonly scene: Scene, private readonly camera: PerspectiveCamera, private readonly characters: EntityVisuals) {
    this.viewGun=this.makeGun(); this.viewGun.name='first-person-shotgun'; this.viewGun.visible=false;
    this.viewGun.traverse(node=>{if(node instanceof Mesh){const material=node.material as MeshStandardMaterial;const copy=material.clone();copy.depthTest=false;node.material=copy;node.renderOrder=1000;}});
    camera.add(this.viewGun); scene.add(camera);
  }
  private mesh(parent: Group, geometry: number, material: MeshStandardMaterial | MeshBasicMaterial, x:number,y:number,z:number,sx:number,sy:number,sz:number): Mesh {
    const mesh=new Mesh(this.geometries[geometry]!,material); mesh.position.set(x,y,z); mesh.scale.set(sx,sy,sz); mesh.castShadow=true; mesh.receiveShadow=true; parent.add(mesh); return mesh;
  }
  private makeGun(): Group {
    const gun=new Group(); gun.userData.cameraIgnore=true;
    this.mesh(gun,0,this.wood,0,-.02,.18,.11,.14,.38); // stock
    this.mesh(gun,0,this.metal,0,0,-.08,.13,.14,.28); // receiver
    const barrel=this.mesh(gun,1,this.metal,0,.035,-.49,.032,.68,.032);barrel.rotation.x=Math.PI/2;
    const magazine=this.mesh(gun,1,this.metal,0,-.045,-.42,.028,.48,.028);magazine.rotation.x=Math.PI/2;
    const pump=this.mesh(gun,0,this.wood,0,-.055,-.38,.095,.095,.22);pump.name='pump';
    this.mesh(gun,0,this.metal,0,.09,-.77,.014,.035,.025);
    this.mesh(gun,0,this.skin,.035,-.13,.05,.09,.16,.11);
    const hand=this.mesh(gun,0,this.skin,-.015,-.13,-.38,.12,.09,.15);hand.name='loading-hand';
    const shell=this.mesh(gun,1,this.clay,-.015,-.19,-.2,.025,.09,.025);shell.name='shell';shell.visible=false;
    const flash=this.mesh(gun,2,this.flashMaterial,0,.035,-.87,.12,.12,.23);flash.name='flash';flash.visible=false;
    return gun;
  }
  setState(state: ShotgunState, playerId: string): void {
    if(this.state?.sceneId===state.sceneId && state.revision<this.state.revision) return;
    if(this.state?.sceneId!==state.sceneId) { this.clearWorld(); this.lastShot=0; this.historical=true; }
    this.state=state;this.playerId=playerId;
    this.pending.push(...state.shots.filter(s=>s.id>this.lastShot));this.pending=this.pending.slice(-SHOTGUN.maxShots);
    this.lastShot=Math.max(this.lastShot,...state.shots.map(s=>s.id));
    if(!this.pending.length)this.historical=false;
    for(const prop of state.props) if(!this.props.has(prop.id)) {
      const group=new Group();group.name=`shotgun:${prop.id}`;
      if(prop.kind==='crate') {
        this.mesh(group,0,this.wood,0,.38,0,.72,.76,.72);
        for(const y of [.12,.63]) this.mesh(group,0,this.metal,0,y,0,.75,.07,.75);
      } else if(prop.kind==='barrel') {
        this.mesh(group,1,this.wood,0,.4,0,.35,.8,.35);
        for(const y of [.12,.68])this.mesh(group,1,this.metal,0,y,0,.36,.07,.36);
      } else {
        this.mesh(group,2,this.clay,0,.32,0,.34,.32,.34);
        this.mesh(group,1,this.clay,0,.65,0,.15,.25,.15);
        this.mesh(group,1,this.dark,0,.78,0,.12,.006,.12);
      }
      group.position.set(prop.position.x,prop.position.y,prop.position.z);
      this.props.set(prop.id,group);this.scene.add(group);
    }
  }
  aim(eye: Vector3): {yaw:number;pitch:number} {
    const direction=this.camera.getWorldDirection(new Vector3());
    this.ray.set(this.camera.position,direction);this.ray.near=.05;this.ray.far=60;
    const hits: import('three').Intersection[]=[];
    for(const root of this.scene.children) if(root.visible&&(root.name.startsWith('chunk:')||root.name.startsWith('shotgun:')||root.name==='babylon-courtyard')) {this.raycast.prepare(root);this.raycast.intersect(root,this.ray,hits);}
    const target=hits.sort((a,b)=>a.distance-b.distance)[0]?.point ?? this.camera.position.clone().addScaledVector(direction,60);
    const aim=target.clone().sub(eye).normalize();
    return {yaw:Math.atan2(-aim.x,-aim.z),pitch:Math.max(-1.45,Math.min(1.45,Math.asin(-aim.y)))};
  }
  animate(dt: number, firstPerson: boolean): void {
    this.time+=Math.min(dt,.1);
    for(const prop of this.state?.props ?? []) {
      const group=this.props.get(prop.id)!;
      group.position.lerp(new Vector3(prop.position.x,prop.position.y,prop.position.z),1-Math.exp(-dt*25));
      group.rotation.y=prop.rotation;
      group.visible=group.position.distanceTo(this.camera.position)<65;
    }
    for(const [id,gun] of this.guns) if(!this.state?.weapons.some(w=>w.playerId===id)) {gun.removeFromParent();this.guns.delete(id);this.shotAt.delete(id);}
    this.viewGun.visible=firstPerson && !!this.state;
    for(const weapon of this.state?.weapons ?? []) {
      const local=weapon.playerId===this.playerId;
      let gun=this.guns.get(weapon.playerId);
      if(!gun){gun=this.makeGun();this.guns.set(weapon.playerId,gun);}
      const hand=this.characters.handAnchor(weapon.playerId);
      if(hand && gun.parent!==hand)hand.add(gun);
      gun.visible=!!hand && !(local&&firstPerson);
      gun.position.set(0,-.08,0);gun.rotation.set(-.2,Math.PI,0);gun.scale.setScalar(.8);
      const age=this.time-(this.shotAt.get(weapon.playerId) ?? -100);
      const recoil=Math.max(0,1-age/.24);
      const reload=weapon.reloadLeft>0 ? Math.sin((1-weapon.reloadLeft/SHOTGUN.reload)*Math.PI) : 0;
      for(const model of local&&firstPerson?[this.viewGun]:[gun]) {
        if(model===this.viewGun){model.position.set(.27,-.28-reload*.16,-.52+recoil*.13);model.rotation.set(recoil*.13+reload*.35,0,-reload*.5);}
        else model.rotation.z=reload*.55+recoil*.12;
        const flash=model.getObjectByName('flash')!;flash.visible=age>=0&&age<.065;
        model.getObjectByName('pump')!.position.z=-.38+(age>.12&&age<.5?Math.sin((age-.12)/.38*Math.PI)*.1:0);
        model.getObjectByName('loading-hand')!.position.set(-.015-reload*.08,-.13-reload*.12,-.38+reload*.23);
        const shell=model.getObjectByName('shell')!;shell.visible=weapon.reloadLeft>.3&&weapon.reloadLeft<2; shell.position.y=-.19-Math.abs(Math.sin(weapon.reloadLeft*8))*.07;
      }
    }
    for(let i=this.marks.length-1;i>=0;i--) {const mark=this.marks[i]!; mark.age+=dt; if(mark.age>30 || !mark.mesh.parent?.parent){mark.mesh.removeFromParent();this.marks.splice(i,1);}}
  }
  flushShots(): void {
    if(!this.pending.length)return;
    // Only loaded world geometry and the shared physical props receive marks.
    const roots=this.scene.children.filter(o=>o.visible && (o.name.startsWith('chunk:') || o.name.startsWith('shotgun:') || o.name==='babylon-courtyard'));
    for(const root of roots)this.raycast.prepare(root);
    for(const shot of this.pending) {
      if(!this.historical)this.shotAt.set(shot.playerId,this.time);
      for(let i=0;i<SHOTGUN.pellets;i++) {
        const d=pelletDirection(shot.yaw,shot.pitch,i);
        this.ray.set(new Vector3(shot.origin.x,shot.origin.y,shot.origin.z),new Vector3(d.x,d.y,d.z));this.ray.near=.05;this.ray.far=SHOTGUN.range;
        const hits: import('three').Intersection[]=[];
        for(const root of roots)this.raycast.intersect(root,this.ray,hits);
        const hit=hits.sort((a,b)=>a.distance-b.distance)[0];if(!hit?.face)continue;
        const mark=new Mesh(this.geometries[3],this.dark);mark.userData.cameraIgnore=true;mark.name='pellet-mark';
        const normal=hit.face.normal.clone().applyNormalMatrix(new Matrix3().getNormalMatrix(hit.object.matrixWorld));
        const worldRotation=new Quaternion().setFromUnitVectors(new Vector3(0,0,1),normal);
        const worldMatrix=new Matrix4().compose(hit.point.clone().addScaledVector(normal,.008),worldRotation,new Vector3(1,1,1));
        mark.matrix.copy(hit.object.matrixWorld).invert().multiply(worldMatrix);
        mark.matrix.decompose(mark.position,mark.quaternion,mark.scale);mark.matrixAutoUpdate=false;
        hit.object.add(mark);mark.updateMatrixWorld(true);this.marks.push({mesh:mark,age:0});
        if(this.marks.length>96)this.marks.shift()!.mesh.removeFromParent();
      }
    }
    this.pending=[];this.historical=false;
  }
  private clearWorld(): void {
    for(const group of this.props.values())group.removeFromParent();this.props.clear();
    for(const gun of this.guns.values())gun.removeFromParent();this.guns.clear();
    for(const mark of this.marks)mark.mesh.removeFromParent();this.marks.length=0;this.pending=[];this.shotAt.clear();
  }
  dispose(): void {this.clearWorld();this.viewGun.removeFromParent();this.viewGun.traverse(node=>{if(node instanceof Mesh)(node.material as MeshStandardMaterial).dispose();});for(const g of this.geometries)g.dispose();for(const m of [this.wood,this.metal,this.clay,this.skin,this.dark,this.flashMaterial])m.dispose();}
}
