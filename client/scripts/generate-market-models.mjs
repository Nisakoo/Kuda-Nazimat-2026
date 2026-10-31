/** Original low-poly assets; generated offline with Three.js, no downloaded content. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Group, Mesh, MeshStandardMaterial, BoxGeometry, CylinderGeometry, IcosahedronGeometry, LatheGeometry, BufferAttribute, Vector2, Color, AnimationClip, QuaternionKeyframeTrack } from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
// GLTFExporter uses FileReader for binary Blob conversion, also in Node.
globalThis.FileReader ??= class { readAsArrayBuffer(blob) { blob.arrayBuffer().then(value => { this.result = value; this.onloadend?.(); }); } };
const rootUrl = new URL('../public/assets/models/market/', import.meta.url);
await mkdir(rootUrl, { recursive: true });
const C = { sand:'#d7b989', cream:'#ecd3a7', light:'#f3dfb9', clay:'#b96c49', teal:'#478e88', dark:'#65503c', wood:'#8b603f', leaf:'#718253', olive:'#9a9d62', ochre:'#d6a64e', red:'#b54e3e', gold:'#e7bc57' };
let root, collisions, clips;
function rotationTrack(name,times,angles) { return new QuaternionKeyframeTrack(name+'.quaternion',times,angles.flatMap(a=>[Math.sin(a/2),0,0,Math.cos(a/2)])); }
function begin(name) { root = new Group(); root.name = name; collisions=[]; clips=[]; }
function part(geometry, color, x,y,z, sx=1,sy=1,sz=1, parent=root) {
  const mesh=new Mesh(geometry,new MeshStandardMaterial({color,roughness:1})); mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);parent.add(mesh);return mesh;
}
function box(color,x,y,z,sx,sy,sz,parent=root) { return part(new BoxGeometry(1,1,1),color,x,y,z,sx,sy,sz,parent); }
function ball(color,x,y,z,sx,sy,sz,parent=root) { return part(new IcosahedronGeometry(1,0),color,x,y,z,sx,sy,sz,parent); }
function cyl(color,x,y,z,r,h,top=r,parent=root) { return part(new CylinderGeometry(top,r,h,8),color,x,y,z,1,1,1,parent); }
function obstacle(x,z,w,d) {collisions.push([x-w/2,z-d/2,x+w/2,z+d/2]);}
function triangle(color,x,y,z,size,parent=root) {const mesh=part(new CylinderGeometry(size,size,0.025,3),color,x,y,z,1,1,1,parent);mesh.rotation.x=Math.PI/2;return mesh;}
function band(x,y,z,w,parent=root) {box(C.teal,x,y,z,w,.14,.06,parent);for(let i=-w/2+.25;i<w/2;i+=.55)triangle(C.ochre,x+i,y+.2,z+.04,.15,parent);}
function pot(x,y,z,s=1,color=C.clay,kind='jar',parent=root) {
  const profile=kind==='bowl'?[[.12,0],[.28,.08],[.5,.32],[.49,.39],[.42,.37],[.2,.12]]:kind==='tall'?[[.23,0],[.34,.12],[.37,.55],[.22,.87],[.2,1.05],[.26,1.08],[.25,1.16],[.17,1.14],[.16,1]]:[[.24,0],[.43,.15],[.48,.5],[.32,.75],[.19,.86],[.19,.98],[.25,1],[.25,1.08],[.15,1.07],[.15,.9]];
  cyl('#875f41',x,y+.006,z,s*.48,.012,s*.48,parent);
  part(new LatheGeometry(profile.map(p=>new Vector2(...p)),10),color,x,y,z,s,s,s,parent);
  if(kind!=='bowl') {cyl(C.teal,x,y+s*.55,z,s*.44,s*.1,s*.4,parent); for(const side of [-1,1])ball(color,x+side*.34*s,y+.72*s,z,.12*s,.21*s,.08*s,parent);}
}
function basket(x,y,z,s=1,filled=false,parent=root) {cyl(C.wood,x,y+.24*s,z,.28*s,.48*s,.4*s,parent);for(let i=0;i<4;i++)cyl(C.ochre,x,y+(.08+i*.12)*s,z,(.3+i*.025)*s,.03*s,(.3+i*.025)*s,parent);if(filled)for(let i=0;i<5;i++)ball(C.gold,x+Math.sin(i*2)*.18*s,y+.5*s,z+Math.cos(i*2)*.18*s,.14*s,.14*s,.14*s,parent);}
function palm(x,z,h=5) {obstacle(x,z,.6,.6);for(let i=0;i<7;i++){const trunk=cyl(i%2?C.wood:'#a17b50',x+Math.sin(i*.3)*.15,(i+.5)*h/7,z,.19,h/7,.23);trunk.rotation.z=.04;}
for(let i=0;i<7;i++){const angle=i*Math.PI*2/7;const leaf=ball(i%2?C.leaf:C.olive,x+Math.sin(angle)*1.15,h,z+Math.cos(angle)*1.15,.42,.13,1.8);leaf.rotation.y=angle;leaf.rotation.x=.2;}ball(C.wood,x,h-.15,z,.35,.3,.35);}
function plant(x,z,s=1){box(C.sand,x,.25,z,s,.5,s);obstacle(x,z,s,s);for(let i=0;i<5;i++)ball(i%2?C.leaf:C.olive,x+Math.sin(i*3)*s*.2,.6+s*.25,z+Math.cos(i*3)*s*.2,s*.3,s*.45,s*.3);}
function house(x,z,w=5,h=3,d=4){
  obstacle(x,z,w,d);box(C.sand,x,h/2,z,w,h,d);
  // Large protruding masonry courses, with a shadowed entrance on the street facade.
  for(let row=0;row<Math.ceil(h/.65);row++)for(let col=0;col<Math.ceil(w/1.1);col++)box((row+col)%3?C.cream:C.sand,x-w/2+.54+col*1.08, row*.65+.31,z+d/2+.025,1.03,.6,.12);
  box(C.dark,x,.95,z+d/2+.12,1.15,1.9,.04);cyl(C.dark,x,1.9,z+d/2+.13,.57,.05,.57).rotation.x=Math.PI/2;
  for(const side of [-1,1])box(C.light,x+side*.72,.95,z+d/2+.2,.25,1.9,.3);
  box(C.cream,x,2.15,z+d/2+.2,1.7,.3,.35);
  box(C.cream,x,h+.12,z,w+.3,.25,d+.3);band(x,h-.25,z+d/2+.12,w);
  for(const side of [-1,1]) {box(C.sand,x+side*(w/2-.1),h+.4,z,.28,.5,d);box(C.cream,x+side*(w/2-.1),h+.7,z,.36,.13,d+.15);}
  for(let i=0;i<5;i++)ball(i%2?C.leaf:C.olive,x+w/2-.25,h-i*.38,z+d/2+.18,.3,.3,.15);
}
function table(x,z,w=3){box(C.wood,x,1,z,w,.18,1.5);for(const a of [-1,1])for(const b of [-1,1])box(C.dark,x+a*(w/2-.2),.48,z+b*.5,.18,.96,.18);obstacle(x,z,w,1.5);}
function canopy(x,z,color){for(const a of [-1,1])for(const b of [-1,1]){box(C.wood,x+a*1.9,1.65,z+b*1.25,.14,3.3,.14);obstacle(x+a*1.9,z+b*1.25,.2,.2);}for(const a of [-1,1])box(C.dark,x,3.25,z+a*1.25,4.1,.15,.16);
for(let i=0;i<6;i++){const panel=box(i%2?color:C.cream,x-1.65+i*.66,3.1-Math.sin((i+.5)/6*Math.PI)*.35,z,.68,.06,2.7);panel.rotation.z=(i-2.5)*.045;triangle(color,x-1.65+i*.66,2.85,z+1.36,.26);}
basket(x-1.5,2,z,.5);basket(x+1.5,2.1,z,.45);}
function merchant(name,x,z,color=C.cream,action='idle'){
  const g=new Group();g.name=name;g.position.set(x,0,z);root.add(g);
  cyl(color,0,.65,0,.4,1.25,.24,g);band(0,.35,.32,.6,g);
  ball('#c69770',0,1.55,0,.3,.33,.28,g);ball(C.cream,0,1.83,0,.36,.18,.32,g);box(C.cream,0,1.55,-.21,.54,.6,.12,g);
  for(const side of [-1,1]){ball(C.dark,side*.11,1.57,.25,.035,.04,.025,g);box(C.dark,side*.16,.07,.04,.2,.14,.35,g);}
  const shawl=box(color===C.clay?C.cream:C.teal,-.18,1,.14,.24,.8,.35,g);shawl.rotation.z=-.15;
  const hand=new Group();hand.name=name+'-hands';hand.position.set(0,1.05,.3);g.add(hand);
  for(const side of [-1,1]){const arm=box(color,side*.35,0,0,.17,.55,.2,hand);arm.rotation.x=-.6;ball('#c69770',side*.34,-.15,.2,.1,.1,.1,hand);}
  if(action==='pot')pot(0,-.3,.3,.43,C.clay,'jar',hand);
  clips.push(new AnimationClip('idle',4,[rotationTrack(hand.name,[0,1,2,3,4],action==='fruit'?[0,-.3,0,-.15,0]:action==='pot'?[0,-.35,-.35,0,0]:[0,.07,0,-.07,0])]));
}
function goat(name,x,z,color,kind){const g=new Group();g.name=name;g.position.set(x,0,z);if(kind==='kid')g.scale.setScalar(.65);root.add(g);
ball(color,0,.8,0,.4,.4,.65,g);for(const a of [-1,1])for(const b of [-1,1]){box(color,a*.23,.35,b*.4,.13,.7,.14,g);box(C.dark,a*.23,.07,b*.4,.15,.14,.18,g);}
const head=new Group();head.name=name+'-head';head.position.set(0,1.1,.55);g.add(head);ball(color,0,.1,0,.24,.3,.28,head);ball(color,0,-.05,.22,.2,.16,.23,head);
for(const side of [-1,1]){ball(color,side*.32,.17,0,.23,.08,.13,head);ball(C.dark,side*.15,.16,.21,.035,.04,.04,head);
if(kind!=='kid'){for(let i=0;i<(kind==='horns'?5:2);i++){const horn=cyl(C.dark,side*(.13+i*.035),.39+i*.12,-i*i*.025,.045,.18,.025,head);horn.rotation.x=-i*.28;}}}
if(kind==='bell'){box(C.teal,0,-.17,.02,.4,.12,.3,head);cyl(C.gold,0,-.32,.22,.1,.16,.05,head);}
if(kind==='spots')for(const a of [-1,1])for(let i=0;i<3;i++)ball(C.cream,a*.36,.82+(i%2)*.1,-.35+i*.3,.04,.14,.13,g);
const tail=ball(color,0,1,-.65,.09,.2,.1,g);tail.rotation.x=-.8;
clips.push(new AnimationClip('idle',5,[rotationTrack(head.name,[0,1,2,3,5],[0,.15,.4,.15,0])]));}
function paving(){box('#c4a276',0,-.12,0,32,.2,32);for(let row=0;row<14;row++)for(let col=0;col<7;col++){const x=-5.5+col*1.85+(row%2)*.25,z=13.5-row*2.1;const m=box([C.sand,C.cream,C.light][(row+col)%3],x,-.005+(row%3)*.01,z,1.72,.09,1.95);m.rotation.y=((row*7+col)%5-2)*.025;}}
function horizon(){
  for(let i=0;i<6;i++) { const peak=ball(i%2?'#c5a38d':'#b99a88',-35+i*14,1,-48-(i%2)*6,13,9+(i%3)*3,9);peak.rotation.y=i*.7; }
  for(let i=0;i<5;i++) { const cloud=ball(i%2?'#f6ddbe':'#ead0b4',-28+i*14,13+(i%2)*3,-35-(i%3)*8,7,.7,2);cloud.rotation.y=.3; }
}
function market(){begin('market');horizon();paving();house(-10,-5,6,3.5,6);house(9,-7,6,3.7,5);house(-6,-12,5,2.7,4);house(6,-14,5,3,4);
// Stepped landmark stays left of the street axis.
for(let i=0;i<4;i++){box(i%2?C.sand:C.cream,-12,1+i*1.45,-12,7-i*1.2,2,7-i*1.2);box(C.teal,-12,2+i*1.45,-12,7.1-i*1.2,.15,7.1-i*1.2);for(const dx of [-1.3,1.3])box(C.teal,-12+dx,1.4+i*1.45,-8.45-i*.6,.25,1.5,.08);}obstacle(-12,-12,7,7);
// Wide passable visual steps; no obstacle rises into the walking capsule.
for(let i=0;i<5;i++)box(i%2?C.light:C.cream,0,.02+i*.018,-10-i*.7,4.8,.13,.68);
for(const side of [-1,1]){box(C.sand,side*2.8,.45,-11.5,.5,.9,4.5);obstacle(side*2.8,-11.5,.5,4.5);plant(side*3.5,-13,1.1);}
table(-4.8,2,3.2);canopy(-4.8,2,C.ochre);box(C.teal,-4.8,.65,2.79,3.2,.7,.07);band(-4.8,.65,2.84,3);
for(let tray=0;tray<3;tray++){box(C.dark,-5.8+tray,1.15,2,.9,.12,1.15);for(let i=0;i<10;i++){const color=[C.gold,C.red,C.wood][tray];ball(color,-6.05+tray+(i%3)*.24,1.27+Math.floor(i/6)*.18,1.65+Math.floor(i/3)%2*.32,.15,tray===2?.09:.16,tray===2?.25:.15);}}
basket(-6.8,0,3.6,1,true);basket(-3.15,0,3.5,.75,true);pot(-6.7,0,4.9,1.3);merchant('fruit-seller',-4.5,.5,C.cream,'fruit');
table(-4.8,-4.6,3);for(let i=0;i<4;i++){const color=[C.clay,C.ochre,C.teal,C.cream][i];const roll=cyl(color,-5.8+i*.65,1.3,-4.6,.24,1.15);roll.rotation.x=Math.PI/2;box(color,-5.8+i*.65,1.16,-3.9,.55,.12,.5);}
box(C.clay,-4.8,2,-5.65,2.8,2.4,.1);for(let i=0;i<4;i++){band(-4.8,1.2+i*.45,-5.57,2.6);}merchant('fabric-seller',-3,-5.2,C.clay);
table(4.9,1,3.2);canopy(4.9,1,C.teal);for(let i=0;i<5;i++)pot(3.7+i*.57,1.1,1,i%2?.55:.45,i%2?C.cream:C.clay,i%3?'jar':'bowl');
for(let shelf=0;shelf<2;shelf++){box(C.wood,6.7,.85+shelf*.9,-.2,.65,.13,3.5);for(let i=0;i<4;i++)pot(6.7,.93+shelf*.9,-1.3+i*.75,.5,C.clay,i%2?'tall':'jar');}obstacle(6.7,-.2,.7,3.5);
for(let i=0;i<3;i++)pot(5.2+i*.7,0,4.6+(i%2)*.7,1.1+i*.2,C.clay,i%2?'tall':'jar');obstacle(6,5,2.8,1.8);
merchant('potter',4.6,-.5,C.cream,'pot');merchant('visitor',3,2.8,C.clay);
// Cart, with visible spokes, parked clear of the stair approach.
box(C.wood,4.8,.65,-8.8,1.8,.2,2.5);for(const side of [-1,1]){box(C.wood,4.8+side*.88,1,-8.8,.12,.7,2.5);const wheel=cyl(C.dark,4.8+side*1.05,.55,-8.5,.58,.14);wheel.rotation.z=Math.PI/2;for(let i=0;i<6;i++){const spoke=box(C.ochre,4.8+side*1.14,.55,-8.5,.07,.95,.08);spoke.rotation.x=i*Math.PI/3;}box(C.wood,4.8+side*.55,.7,-6.9,.12,.12,1.7);}obstacle(4.8,-8.7,2.4,2.8);pot(4.5,.8,-8.6,.8);basket(5.2,.8,-9,.8,true);
box(C.sand,3.1,.35,-7,.75,.7,.75);box(C.cream,3.1,1,-7,.65,.65,.65);const glow=box('#f4b54c',3.1,1,-6.66,.28,.28,.03);glow.rotation.z=Math.PI/4;box(C.sand,3.1,1.4,-7,.95,.17,.95);obstacle(3.1,-7,.9,.9);
palm(-8,7,5.5);palm(7,-10,6.5);plant(-7,-1);plant(8,3);pot(-3.7,0,7,1.4);obstacle(-3.7,7,1.4,1.4);
}
function pasture(){begin('pasture');horizon();box('#b2aa73',0,-.12,0,32,.2,32);box(C.cream,0,-.005,10,4,.08,12);
for(const side of [-1,1]){house(side*6,12,5,2.8,4);plant(side*3.2,9);}
// Fence has a broad south gate on the continuation of the market street.
for(const z of [-10,6])for(let x=-10;x<=10;x+=2){if(z===6&&Math.abs(x)<3)continue;box(C.wood,x,.6,z,.16,1.2,.16);obstacle(x,z,.2,.2);if(x<10 && !(z===6&&x>=-4&&x<2)){for(const y of [.4,.85])box(C.wood,x+1,y,z,2,.12,.12);obstacle(x+1,z,2,.2);}}
for(const side of [-1,1])for(let z=-10;z<6;z+=2){box(C.wood,side*10,.6,z,.16,1.2,.16);for(const y of [.4,.85])box(C.wood,side*10,y,z+1,.12,.12,2);obstacle(side*10,z+1,.2,2);}
for(let i=0;i<35;i++){const x=Math.sin(i*19)*13,z=Math.cos(i*7)*12;if(Math.abs(x)<2&&z>5)continue;for(let j=0;j<2;j++){const grass=triangle(i%2?C.leaf:C.olive,x+j*.13,.13,z,.22);grass.rotation.y=i;}}
merchant('shepherd',-3,6,C.ochre);box(C.wood,-3.6,.85,6,.08,1.7,.08);
goat('white-goat',-5,1,'#e8e0c9','bell');goat('black-goat',4,0,'#4d4943','horns');goat('spotted-goat',-4,-5,'#b76b3f','spots');goat('kid-goat',4,-5,'#b9bab1','kid');
box(C.wood,0,.25,-8,2.5,.5,.8);box('#759e9a',0,.5,-8,2.2,.03,.6);obstacle(0,-8,2.5,.8);palm(-13,-9,4.5);palm(13,3,5);
}
// Merge static geometry with vertex colors, retaining named animated subgroups.
function batch(group){for(const child of [...group.children])if(child.isGroup)batch(child);
const geometries=[];for(const child of [...group.children]){if(!child.isMesh)continue;child.updateMatrix();const g=child.geometry.index?child.geometry.toNonIndexed():child.geometry.clone();g.applyMatrix4(child.matrix);g.deleteAttribute('uv');const count=g.attributes.position.count;const color=child.material.color;const colors=new Uint8Array(count*3);for(let i=0;i<count;i++)colors.set([Math.round(color.r*255),Math.round(color.g*255),Math.round(color.b*255)],i*3);g.setAttribute('color',new BufferAttribute(colors,3,true));geometries.push(g);group.remove(child);child.geometry.dispose();child.material.dispose();}
if(geometries.length){const joined=mergeGeometries(geometries);const merged=mergeVertices(joined);joined.dispose();const mesh=new Mesh(merged,new MeshStandardMaterial({vertexColors:true,roughness:1}));mesh.name=group.name+'-surface';group.add(mesh);for(const g of geometries)g.dispose();}}
for(const [name,make] of [['market',market],['pasture',pasture]]){make();root.userData.collisions=collisions;batch(root);const tracks=clips.flatMap(clip=>clip.tracks);const data=await new GLTFExporter().parseAsync(root,{binary:true,animations:[new AnimationClip('idle',5,tracks)]});const bytes=Buffer.from(data);const target=new URL(name+'.glb',rootUrl);const previous=await readFile(target).catch(()=>null);if(!previous?.equals(bytes))await writeFile(target,bytes);console.log(`${name}: ${bytes.length} bytes; ${collisions.length} collision rectangles`);}
