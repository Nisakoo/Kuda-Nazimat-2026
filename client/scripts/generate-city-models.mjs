import { buildCityBoat } from './city-boat.mjs';
import { roundFootprint, cityOverheadVolumes } from './city-collisions.mjs';
import { buildPackAnimal } from './city-pack-animals.mjs';
import { decorateEast } from './city-details-east.mjs';
import { decorateCrafts } from './city-details-crafts.mjs';
import { decorateCivic } from './city-details-civic.mjs';
/** Original city assets. One batched mesh per district; no runtime network dependencies. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import ts from 'typescript';
import { Group, Mesh, MeshStandardMaterial, BoxGeometry, CylinderGeometry, IcosahedronGeometry, Color, BufferAttribute, BufferGeometry, Float32BufferAttribute, CatmullRomCurve3, Vector3, Shape, ShapeGeometry } from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
const source = await readFile(new URL('../../shared/city/catalogue.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
export const { CITY_BASE_LOCATIONS: CITY_LOCATIONS, CITY_AUTHORED_RESIDENTS: PLACEMENT_RESIDENTS, CITY_RESIDENTS, CITY_BOUNDS, CITY_LAYOUT, CITY_OUTLINE, CITY_RIVER_BANK, cityLocal, cityStreets, insideCity, cityBoundaryDistance } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
globalThis.FileReader ??= class { readAsArrayBuffer(blob) { blob.arrayBuffer().then(value => { this.result = value; this.onloadend?.(); }); } };
const directory = new URL('../public/assets/models/city/', import.meta.url);
await mkdir(directory, { recursive: true });
export const CITY_MODEL_IDS = [];
const cityMapFeatures = [];
let pieces = [], obstacles = [], districtSeed = 0, batches = [], trackingDepth = 0;
const sand = '#d6bb92', cream = '#f1dec0', teal = '#478f8c', wood = '#916a48', leaf = '#729163';
function mesh(geometry, color, x, y, z, sx = 1, sy = 1, sz = 1) {
  geometry.scale(sx, sy, sz); geometry.translate(x, y, z);
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  g.deleteAttribute('uv');
  const c = new Color(color), count = g.getAttribute('position').count, colors = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([Math.round(c.r*255), Math.round(c.g*255), Math.round(c.b*255)], i * 3);
  g.setAttribute('color', new BufferAttribute(colors, 3, true)); pieces.push(g); return g;
}
function box(color, x, y, z, w, h, d) { const g=mesh(new BoxGeometry(w, h, d), color, x, y, z);g.userData.citySolid=Math.min(w,d)>=.049&&Math.max(w,d)>=.5; }
function ball(color, x, y, z, w, h, d) { mesh(new IcosahedronGeometry(1, 1), color, x, y, z, w, h, d); }
function cylinder(color, x, y, z, r, h, top = r) { return mesh(new CylinderGeometry(top, r, h, 12), color, x, y, z); }
function block(x, z, w, d) { obstacles.push([[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]]); }
function roundBlock(x,z,rx,rz=rx) { obstacles.push(roundFootprint(x,z,rx,rz)); }
function house(x, z, color = sand, w = 7, d = 6, h = 4) {
  const first=pieces.length, firstObstacle=obstacles.length;
  const style=((x>0?1:0)+(z>0?2:0)+districtSeed)%4;
  if(w<=8&&h<=4)h+=style*.25;
  if(color===sand)color=['#d6bb92','#cfad8e','#d5c5a3','#c5b697','#d2b8a7'][districtSeed%5];
  box(color, x, h/2, z, w, h, d); box(cream, x, h+.12, z, w+.3, .24, d+.3);
  box(wood, x, 1, z+d/2+.03, 1.2, 2, .1); box(teal, x, 2.8, z+d/2+.08, w, .18, .1);
  for (let dx = -w/2+.6; dx < w/2; dx += 1.3) box(cream, x+dx, h+.5, z+d/2-.2, .65, .7, .55);
  for(const side of [-1,1]) {
    const wx=x+side*w*.3;
    box(wood,wx,2.3,z+d/2+.08,1.1,1.2,.15);box(cream,wx,3,z+d/2+.12,1.5,.18,.25);
    for(let i=-1;i<=1;i++)box(teal,wx+i*.3,2.3,z+d/2+.19,.12,1.1,.08);
    box(cream,x+side*.75,1,z+d/2+.12,.25,2.1,.3);
  }
  box(cream,x,2.1,z+d/2+.15,1.8,.25,.35);
  for(let row=0;row<Math.floor(h/.65);row++)for(let col=0;col<Math.floor(w/1.3);col++){
    const bx=x-w/2+.65+col*1.3;if(Math.abs(bx-x)<1&&row<4)continue;
    box((row+col)%3?'#ddc59f':'#c5ab85',bx,.32+row*.65,z+d/2+.02,1.23,.6,.04);
  }
  for(let i=0;i<4;i++)box(wood,x-w/2+.7+i*(w-1.4)/3,h-.3,z+d/2+.24,.12,.15,.55);
  cylinder('#ba8b62',x+w*.25,h+.45,z,.5,.6,.3);ball(leaf,x-w*.3,h+.6,z+d*.2,.7,.65,.6);
  const accent=['#577e91','#b67b63','#899b72','#ad9562'][style];
  // Side windows, sun shades, pottery vents and door ironwork distinguish each facade.
  for(const side of [-1,1]){
    box(wood,x+side*(w/2+.035),2.2,z, .09,1.25,1.5);
    for(let i=0;i<4;i++)box(cream,x+side*(w/2+.1),2.2,z-.52+i*.35,.08,1.25,.08);
    box(accent,x+side*(w/2+.35),2.95,z,.8,.12,1.9);
    for(let i=0;i<3;i++)box(wood,x+side*.43,.45+i*.5,z+d/2+.1,.09,.09,.05);
    box('#bca16b',x+side*.35,1.05,z+d/2+.12,.1,.18,.05);
  }
  for(let i=0;i<Math.floor(w/.6);i++){
    const px=x-w/2+.3+i*.6;
    box(accent,px,h-.8,z+d/2+.06,.4,.3,.07);
    if(i%2===style%2)bead('#dfc486',px,h-.8,z+d/2+.11,.1,.1,.035);
  }
  box('#bba27d',x,.05,z+d/2+.5,1.9,.1,.85);
  box(accent,x-w*.2,h+.26,z-.4,2,.04,1.4);
  for(let i=0;i<5;i++)box(cream,x-w*.2-.8+i*.4,h+.29,z-.4,.12,.02,1.3);
  for(let i=0;i<3;i++){cylinder('#a97a57',x+w*.3,h+.55+i*.08,z-d*.28,.22,.2);}
  box(wood,x+w/2-.2,h+.2,z-d/2+.6,.22,.22,1.5);
  block(x, z, w, d);
  if(w<=8&&h<6)transformPatch(first,firstObstacle,(px,pz)=>{
    const angle=(style-1.5)*.10,c=Math.cos(angle),s=Math.sin(angle);
    return {x:x+(px-x)*c-(pz-z)*s,z:z+(px-x)*s+(pz-z)*c};
  });
}
function palm(x, z, h=5) { cylinder(wood,x,h/2,z,.22,h); roundBlock(x,z,.22); for(let i=0;i<6;i++) { const a=i*Math.PI/3; ball(i%2?leaf:'#9aaa72',x+Math.sin(a)*1.1,h,z+Math.cos(a)*1.1,1.2,.22,1.2); } }
function pot(x,z,color='#bd7e5d') { cylinder(color,x,.45,z,.5,.9,.27); cylinder(teal,x,.5,z,.51,.12,.51);roundBlock(x,z,.51); }
function bench(x,z) { box(wood,x,.5,z,2.8,.2,.65);box(wood,x,.8,z-.3,2.8,.65,.12);for(const a of [-1,1])box(wood,x+a,.2,z,.2,.5,.5);block(x,z,2.8,.7); }
function ground() { box('#d4bf9a',0,-.12,0,32,.2,32); }
function canopy(x,z,color=teal,halfWidth=3,halfDepth=2) { for(const dx of [-halfWidth,halfWidth])for(const dz of [-halfDepth,halfDepth]) { box(wood,x+dx,1.7,z+dz,.16,3.4,.16);block(x+dx,z+dz,.16,.16); } if(halfWidth===3&&halfDepth===2){for(let i=0;i<8;i++)box(i%2?color:cream,x-2.7+i*.77,3.4,z,.8,.08,4.4);}else{const strip=(halfWidth*2+.4)/8;for(let i=0;i<8;i++)box(i%2?color:cream,x-halfWidth-.2+strip*(i+.5),3.4,z,strip+.025,.08,halfDepth*2+.4);} }
function animal(x,z,kind) {
 const camel=kind==='camel',dog=kind==='dog',cat=kind==='cat';const color=camel?'#c8a271':dog?'#a47c50':cat?'#c89d75':'#9a927f';
 const scale=camel?1.3:cat?.4:dog?.55:.8;
 ball(color,x,scale*1.1,z,scale*.6,scale*.5,scale*1.1);
 for(const dx of [-.4,.4])for(const dz of [-.7,.7])cylinder(color,x+dx*scale,.5*scale,z+dz*scale,.12*scale,scale);
 ball(color,x,scale*(camel?2.1:1.6),z+scale,scale*.35,scale*.5,scale*.4);
 for(const dx of [-.25,.25])ball(color,x+dx*scale,scale*(camel?2.6:2.1),z+scale,scale*.12,scale*.25,scale*.12);
 if(camel)ball(color,x,scale*1.7,z-.1,scale*.45,scale*.6,scale*.5);
}
function tablet(x,y,z,s=1) {
 box('#bc9470',x,y,z,.7*s,.09*s,.52*s);
 for(let row=0;row<3;row++)for(let col=0;col<4;col++){box('#806548',x+(-.24+col*.15)*s,y+.05*s,z+(-.17+row*.15)*s,.07*s,.015*s,.025*s);box('#806548',x+(-.24+col*.15)*s,y+.055*s,z+(-.15+row*.15)*s,.025*s,.015*s,.07*s);}
}
function basket(x,z,fruit=false,s=1) {
 cylinder('#a78654',x,.35*s,z,.4*s,.7*s,.5*s);
 for(let i=0;i<5;i++)cylinder(i%2?'#d3b47c':'#8c7048',x,(.08+i*.13)*s,z,(.42+i*.015)*s,.035*s);
 if(fruit)for(let i=0;i<7;i++)ball(i%2?'#b86f45':'#d9ae53',x+Math.sin(i*2)*.3*s,.75*s,z+Math.cos(i*2)*.3*s,.15*s,.13*s,.15*s);
 if(.7*s>.35)roundBlock(x,z,.5*s);
}
function lamp(x,z) { cylinder(sand,x,.2,z,.4,.4);cylinder(wood,x,1.35,z,.1,2.5);box(teal,x,2.4,z,.5,.7,.5);box('#f1c46e',x,2.4,z+.26,.25,.4,.03);box(cream,x,2.85,z,.7,.15,.7);roundBlock(x,z,.4); }
function rug(x,z,color=teal,w=3,d=2) {box(color,x,.04,z,w,.04,d);for(const side of [-1,1]){box('#ddbd76',x+side*(w/2-.15),.065,z,.12,.02,d-.15);box('#ddbd76',x,.065,z+side*(d/2-.15),w-.15,.02,.12);}for(let i=-1;i<=1;i++)ball('#e4c47e',x+i*w/4,.07,z,.12,.025,.2);}
function jar(x,z,s=1,color='#b87c57') {cylinder(color,x,.4*s,z,.5*s,.8*s,.3*s);cylinder(color,x,.95*s,z,.2*s,.3*s,.24*s);cylinder(teal,x,.47*s,z,.49*s,.1*s);cylinder('#755b40',x,1.11*s,z,.17*s,.02*s);if(1.12*s>.35)roundBlock(x,z,.5*s);}
function tray(x,z,kind='bread') {box(wood,x,.75,z,2.8,.15,1.2);for(const dx of [-1,1])box(wood,x+dx,.35,z,.13,.7,.9);block(x,z,2.8,1.2);for(let i=0;i<5;i++){const dx=x-1+i*.5;if(kind==='tablet')tablet(dx,.87,z,.6);else if(kind==='spice'){cylinder('#98664b',dx,.88,z,.23,.15);ball(['#b56f41','#c9a64d','#8b934d','#a16b67','#7c5544'][i],dx,1,z,.2,.15,.2);}else {ball('#d3a369',dx,.9,z,.21,.08,.4);for(let j=0;j<3;j++)box('#9f7547',dx,.975,z-.18+j*.18,.28,.01,.025);}}}
function rope(x,z) {for(let i=0;i<9;i++){const a=i*Math.PI*2/9;ball('#c5a474',x+Math.sin(a)*.5,.1,z+Math.cos(a)*.5,.2,.08,.2);}}
function sign(x,z,color=teal) {box(wood,x,1.6,z,.12,3.2,.12);box(color,x+.6,2.7,z,1.2,.8,.12);for(let i=0;i<3;i++){box('#ecd9b4',x+.25+i*.3,2.7,z+.07,.08,.4,.02);}block(x,z,.12,.12);}
function flowers(x,z) {cylinder('#b68159',x,.35,z,.42,.7,.5);for(let i=0;i<6;i++){const a=i*2.4;box(leaf,x+Math.sin(a)*.25,.9,z+Math.cos(a)*.25,.03,1,.03);ball(i%2?'#d89d8f':'#e2c274',x+Math.sin(a)*.25,1.25,z+Math.cos(a)*.25,.14,.12,.14);}roundBlock(x,z,.5);}
function awningLine(x,z) {for(const dx of [-3,3]){box(wood,x+dx,2,z,.12,4,.12);block(x+dx,z,.12,.12);}box(wood,x,3.8,z,6,.06,.06);for(let i=0;i<5;i++)box(i%2?'#d8bd90':teal,x-2+i,2.9,z, .8,1.6,.05);}
function dryingFrame(x,z,color) {
 const shadow='#'+new Color(color).multiplyScalar(.82).getHexString();
 // Keep the cloth, ground supports and ties in one fitted composition.
 for(const side of [-1,1]){
  box(wood,x+side*2.3,2.15,z,.18,4.3,.2);block(x+side*2.3,z,.18,.2);
  box('#6b5039',x+side*2.3,.1,z,.44,.2,.6);
  beam(wood,x+side*2.02,3.87,z,.14,.85,.14,-side*.72);
 }
 box(wood,x,4.18,z,4.9,.18,.24);
 box(color,x,2.8,z,4,2.5,.08);
 for(let i=0;i<7;i++){
  const px=x-1.8+i*.6;
  box('#c9ae7c',px,4.12,z,.065,.22,.14);
  // Narrow ridges on both faces suggest soft hanging folds at any viewing angle.
  for(const side of [-1,1])box(i%2?shadow:color,px,2.78,z+side*.055,.12,2.43,.04);
 }
 for(const side of [-1,1])box(shadow,x+side*1.94,2.8,z,.055,2.5,.095);
 box(shadow,x,1.59,z,4,.075,.095);
}
function streetDetails(seed) {
 // Small repairs, inset mosaics and kerb stones break up the ground without blocking the road.
 for(let i=0;i<36;i++){const x=((i*13+seed*7)%29)-14,z=((i*7+seed*11)%29)-14;if(Math.abs(x)<3||Math.abs(z)<3)continue;box(i%3?cream:'#bda481',x,.015,z,.35+(i%3)*.12,.035,.25);}

 for(const [x,z] of [[-13,2],[13,-2]]) {lamp(x,z);flowers(x+(x<0?1:-1),z+1);}
}
function detailDistrict(id) {
 const seed=CITY_LOCATIONS.findIndex(l=>l.id===id)+1;streetDetails(seed);
 if(id==='gate'){
  for(const x of [-8,8])for(let row=0;row<5;row++){box('#3e6b88',x,1+row*1.6,6.43,6,.07,.02);for(let j=-2;j<=2;j++)box('#6c9bad',x+j,1.6+row*1.6,6.45,.04,1.1,.02);}
  for(const x of [-8,8]){box('#e3bb67',x,5,6.5,2,.7,.15);for(const dx of [-.65,.65])box('#e3bb67',x+dx,4.55,6.5,.18,.6,.15);ball('#e3bb67',x+.9,5.3,6.5,.4,.4,.15);}
  tray(-8,-3,'tablet');jar(10,-4,1.2);rug(0,-5,'#b17f62',5,3);sign(6,-6);basket(-11,-5);rope(11,-6);
 }else if(id==='guest'){
  rug(-8,4,'#a16c78',5,3);rug(8,4,'#aa8b58',5,3);basket(-11,1,true);jar(10,7);jar(12,7,.7);rope(10,-5);awningLine(0,11);
 }else if(id==='fountain'){
  for(let i=0;i<16;i++){const a=i*Math.PI/8;box(i%2?teal:cream,Math.sin(a)*4,.045,-5+Math.cos(a)*4,.4,.06,.4);}
  jar(-5,2,1.1);jar(-6,2,.75);flowers(8,3);flowers(-8,3);sign(8,-3);tablet(9,.67,5);rug(0,9,'#b58c66',4,2);
 }else if(id==='garden'){
  basket(-8,10,true);basket(-10,10);jar(5,8,1.2);box('#6fa4a0',0,.03,-10,1,.05,10);box(wood,7,1,8,.08,2,.08);box('#8e8d79',7,.1,8,.7,.12,.35);
  for(let i=0;i<4;i++){const x=-10+i*2;box(wood,x,.7,-12,.08,1.4,.08);box(cream,x,.9,-12,.55,.35,.08);}sign(-6,5);rope(12,8);
 }else if(id==='mill'){
  for(let i=0;i<6;i++){const a=i*Math.PI/3;box('#807969',Math.sin(a)*1.5,1.22,-7+Math.cos(a)*1.5,.15,.03,.6);}
  basket(7,5,true);basket(9,5);tray(-9,4,'tablet');rope(6,8);box(wood,9,1.5,7,3,.1,.1);cylinder(wood,9,.8,7,.1,1.6);roundBlock(9,7,.1);for(const x of [8,10])cylinder('#b99c68',x,1,7,.4,.1);sign(-8,-3);
 }else if(id==='bakery'){
  for(let i=0;i<5;i++){box('#966244',-2+i,.5,-5.1,.7,.1,.15);ball('#e5ab59',-.5+i*.25,.3,-5.05,.12,.2,.08);}
  tray(-9,6);basket(-10,8,true);basket(-12,8);jar(6,-5,.8);box(wood,5,1,-6,.08,2,.08);box(wood,5,.2,-6,.65,.5,.12);block(5,-6,.65,.12);sign(-5,8);rope(10,6);
 }else if(id==='dye'){
  rug(8,8,'#987491',5,3);for(let i=0;i<3;i++)jar(-10+i,7,.7,['#ab6656','#cba953','#4e9193'][i]);
  box(wood,8,1.2,7,3,.1,.1);for(const x of [6.5,9.5])box(wood,x,1.3,7,.15,2.6,.15);for(let i=0;i<12;i++)box(i%2?cream:teal,6.6+i*.24,1.3,7,.07,2.5,.05);block(8,7,3,.3);basket(-8,9);sign(-6,5);
 }else if(id==='school'){
  for(let i=0;i<4;i++){rug(-9+i*6,6,'#bca477',2,1.4);tablet(-9+i*6,.14,6);for(let j=0;j<5;j++)ball('#9c8162',-9+i*6+j*.15,.13,6.5,.06,.06,.06);}
  for(let shelf=0;shelf<3;shelf++){box(wood,-9,.6+shelf*.65,-5,4,.15,1);for(let i=0;i<5;i++)tablet(-10.5+i*.7,.72+shelf*.65,-5,.7);}block(-9,-5,4,1);jar(7,-5);sign(-6,4);
 }else if(id==='homes'){
  rug(-6,7,'#b97564',2,3);flowers(6,7);flowers(12,5);jar(-6,-6);basket(-8,5);basket(10,4,true);rope(-6,10);sign(5,-5);
 }else if(id==='dock'){
  for(let i=0;i<7;i++){box('#ae9a72',-5+i*.5,.27,4, .03,.03,3);box('#ae9a72',-5,.27,2.5+i*.5,3,.03,.03);}rope(-6,6);rope(-3,6);basket(1,10);basket(3,10,true);jar(8,6);sign(5,6);
  for(let i=0;i<4;i++)ball('#839e9c',1+i*.3,.8,10,.12,.08,.3);
 }else if(id==='gardens'){
  for(let i=0;i<6;i++){flowers(-11+i*4,10);box(teal,-11+i*4,.1,12,3,.1,.45);}rug(0,8,'#8e9c70',4,3);jar(-7,6);rope(12,-2);sign(-8,5);
 }else if(id==='palace'){
  rug(0,5,'#a36967',4,9);for(const x of [-10,10]){jar(x,-1,1.5,'#d9b578');flowers(x,3);}
  for(let x=-8;x<=8;x+=2)for(let row=0;row<2;row++)ball(row?teal:'#dbb665',x,3+row*1.5,-3.4,.3,.3,.08);
  tray(-8,7,'tablet');sign(8,7);tablet(-8,.9,7,1.5);
 }
}

// Small authored scenes fill vacant pockets; roads and interaction space stay clear.
function bead(color,x,y,z,rx,ry,rz) { mesh(new IcosahedronGeometry(1,0),color,x,y,z,rx,ry,rz); }
function beam(color,x,y,z,w,h,d,angle=0) { const g=new BoxGeometry(w,h,d);g.rotateZ(angle);const solid=mesh(g,color,x,y,z);solid.userData.citySolid=Math.min(w,d)>=.049&&Math.max(w,d)>=.5; }
function mosaic(x,z,theme=0) {
 const colors=[cream,teal,'#bc805f','#d5b266'];
 box('#a88c68',x,.025,z,2.6,.045,2.6);
 for(let row=0;row<6;row++)for(let col=0;col<6;col++)box(colors[(row+col+theme)%4],x-1.05+col*.42,.055,z-1.05+row*.42,.36,.03,.36);
}
function rack(x,z,fish=false) {
 for(const dx of [-1,1]){box(wood,x+dx,1,z,.12,2,.12);box(wood,x+dx,.12,z,.5,.24,.65);}
 box(wood,x,1.95,z,2.4,.12,.12);
 for(let i=0;i<5;i++){const px=x-.85+i*.42;box('#bca77e',px,1.62,z,.025,.6,.025);
  if(fish){bead('#88a6a0',px,1.15,z,.14,.36,.09);bead('#718f8d',px,.82,z,.22,.13,.06);bead('#253e40',px,1.35,z+.08,.028,.028,.015);}
  else{bead(i%2?'#78905b':'#ab8269',px,1.2,z,.22,.34,.16);box('#c6b17c',px,1.46,z,.24,.06,.28);}
 }block(x-1,z,.5,.65);block(x+1,z,.5,.65);block(x,z,2,.25);
}
function workshop(x,z,kind) {
 box(wood,x,.85,z,2.4,.16,1.3);for(const dx of [-.9,.9])box(wood,x+dx,.4,z,.14,.8,1.05);block(x,z,2.4,1.3);
 if(kind==='scribe'){
  for(const [dx,dz] of [[-.6,-.3],[.25,.2],[.65,-.2]])tablet(x+dx,.98,z+dz,.75);
  cylinder('#534e40',x-.8,1.05,z+.35,.16,.3);beam(wood,x+.3,1.01,z+.4,1.2,.04,.07,.12);
  for(let i=0;i<4;i++)box('#cab28a',x-.4+i*.18,1,z-.4,.08,.05,.8);
 }else if(kind==='baker'){
  for(let i=0;i<5;i++){bead('#d6b07a',x-.8+i*.4,.99,z,.17,.08,.33);box('#9e7652',x-.8+i*.4,1.065,z,.2,.012,.03);}
  cylinder('#b7825c',x+.65,1.03,z-.35,.28,.24,.3);box('#e5d4af',x+.65,1.16,z-.35,.4,.02,.3);
  beam(wood,x-.4,1,z+.45,1.5,.1,.1);cylinder(wood,x-.8,1.1,z-.4,.12,.25);
 }else if(kind==='dye'){
  for(let i=0;i<4;i++){cylinder('#aa7859',x-.75+i*.5,1.02,z,.18,.22);cylinder(['#bd6657','#b8a355','#509092','#8f6583'][i],x-.75+i*.5,1.14,z,.15,.015);}
  box(cream,x,.96,z+.4,1.6,.02,.28);for(let i=0;i<9;i++)box(teal,x-.7+i*.18,.98,z+.4,.07,.02,.26);
 }else{
  for(let i=0;i<3;i++)beam(i%2?'#d0ae78':'#aa8457',x,1+i*.09,z-.3,1.9,.08,.22,.035*i);
  box('#b0b6a4',x+.3,1,z+.3,.7,.06,.3);box(wood,x-.3,1,z+.3,.6,.1,.12);
  box(wood,x-.75,1,z+.35,.1,.1,.7);box('#859587',x-.75,1.1,z+.08,.45,.2,.17);
 }
}
function amphoraStand(x,z) {
 box(wood,x,.24,z,2.5,.15,1.4);for(const dx of [-.9,.9])box(wood,x+dx,.1,z,.15,.2,1.4);
 for(let i=0;i<3;i++){
  const px=x-.8+i*.8,color=['#bb805b','#d0ab78','#8aab9d'][i];cylinder(color,px,.7,z,.3,.9,.18);cylinder(color,px,1.23,z,.13,.2);
  for(const side of [-1,1]){box(color,px+side*.25,1.05,z,.08,.3,.09);box(color,px+side*.17,1.2,z,.2,.08,.09);}
  cylinder('#644d3e',px,1.34,z,.105,.015);for(let stripe=0;stripe<2;stripe++)cylinder(cream,px,.65+stripe*.2,z,.31,.045);
 }for(const dx of [-.8,0,.8])roundBlock(x+dx,z,.32);
}
function offerings(x,z) {
 box(sand,x,.25,z,2.4,.5,1.6);box(cream,x,.55,z,2.6,.12,1.8);
 for(const dx of [-.8,.8]){cylinder('#bfa064',x+dx,.8,z,.16,.5);bead('#deb875',x+dx,1.14,z,.09,.18,.09);}
 tablet(x,.67,z,1);box(teal,x,.27,z+.81,1.1,.25,.04);for(let i=0;i<3;i++)box('#d8ba72',x-.3+i*.3,.28,z+.85,.1,.18,.02);block(x,z,2.6,1.8);
}
function produce(x,z,seed) {
 box(wood,x,.18,z,2.5,.3,1.5);for(const dx of [-1,1])box(wood,x+dx,.38,z,.12,.4,1.5);
 for(let i=0;i<12;i++){const px=x-.8+(i%4)*.53,pz=z-.4+Math.floor(i/4)*.4;bead(['#b78145','#8e9b5e','#c6a953'][seed%3],px,.45,pz,.2,.16,.17);box(leaf,px,.64,pz,.035,.18,.035);}block(x,z,2.5,1.5);
}
function plantedScreen(x,z) {
 for(const dx of [-1,1])box(wood,x+dx,1,z,.1,2,.1);
 for(let i=0;i<5;i++){box(wood,x,.35+i*.35,z,2.3,.06,.06);beam(wood,x-.8+i*.4,1,z,.04,1.9,.04,.3);}
 for(let i=0;i<12;i++)bead(i%2?leaf:'#92a271',x-.9+(i%4)*.6,.5+Math.floor(i/4)*.55,z+.1,.3,.22,.08);
 box(sand,x,.22,z,2.5,.4,.65);block(x,z,2.5,.7);
}
function marketGame(x,z) {
 box('#a78b63',x,.22,z,2.2,.44,1.6);box('#dbc799',x,.46,z,2.3,.08,1.7);
 for(let row=0;row<3;row++)for(let col=0;col<5;col++){box((row+col)%2?teal:cream,x-.8+col*.4,.51,z-.5+row*.5,.35,.02,.45);if((row+col)%3===0)cylinder('#925b43',x-.8+col*.4,.57,z-.5+row*.5,.08,.1);}
 for(const dz of [-1.3,1.3]){cylinder(wood,x,.2,z+dz,.45,.4);roundBlock(x,z+dz,.45);}block(x,z,2.3,1.7);
}
function districtStories(location) {
 const bank=['gardens','palace'].includes(location.id);
 const people=PLACEMENT_RESIDENTS.filter(n=>Math.abs(n.x-location.x)<16&&Math.abs(n.z-location.z)<16).map(n=>({x:bank?(n.x-location.x-4)/.6875:n.x-location.x,z:n.z-location.z}));
 const kinds={gate:['offerings','amphora','game'],guest:['game','amphora','produce'],fountain:['mosaic','screen','amphora'],garden:['produce','screen','rack'],mill:['tools','produce','amphora'],bakery:['baker','produce','amphora'],dye:['dye','rack','mosaic'],school:['scribe','game','offerings'],homes:['game','screen','amphora'],dock:['fish','tools','amphora'],gardens:['screen','mosaic','offerings'],palace:['offerings','mosaic','scribe']}[location.id];
 const sites=[[-5,11],[5,11],[-12,-4],[12,5],[-5,-12],[5,-12],[-11,11],[11,11],[-6,6],[6,6],[-12,-12],[12,-12],[-5,-5],[5,-5]];
 let added=0;
 for(const [x,z] of sites){
  if(added>=5)break;
  if(people.some(p=>Math.abs(p.x-x)<3&&Math.abs(p.z-z)<3))continue;
  if(pieces.some(g=>{g.computeBoundingBox();const b=g.boundingBox;return b.max.y>.18&&b.min.y<1.9&&b.max.x>x-1.6&&b.min.x<x+1.6&&b.max.z>z-1.7&&b.min.z<z+1.7;}))continue;
  const kind=kinds[added%kinds.length];
  if(['scribe','baker','dye','tools'].includes(kind))workshop(x,z,kind);
  if(kind==='amphora')amphoraStand(x,z);
  if(kind==='offerings')offerings(x,z);
  if(kind==='produce')produce(x,z,added);
  if(kind==='screen')plantedScreen(x,z);
  if(kind==='game')marketGame(x,z);
  if(kind==='mosaic')mosaic(x,z,added);
  if(kind==='fish'||kind==='rack')rack(x,z,kind==='fish');
  added++;
 }
 console.log(`City detail scenes ${location.id}: ${added}`);
}
function compactBank() {
 // Ground remains full size; authored props occupy the dry bank, streets are drawn afterwards.
 for(const part of pieces.slice(1)){part.scale(.6875,1,1);part.translate(4,0,0);}
 obstacles=obstacles.map(polygon=>polygon.map(([x,z])=>[x*.6875+4,z]));
}

async function save(id) {
 const place=CITY_LOCATIONS.find(p=>'city-'+p.id===id);
 if(place)for(const polygon of obstacles){
   const area=Math.abs(polygon.reduce((sum,a,i)=>{const b=polygon[(i+1)%polygon.length];return sum+a[0]*b[1]-b[0]*a[1];},0))/2;
   cityMapFeatures.push({district:place.id,kind:area>18?'building':area>2?'structure':'detail',points:polygon.map(([x,z])=>[Math.round((place.x+x)*100)/100,Math.round((place.z+z)*100)/100])});
 }

 const root=new Group();root.name=id;root.userData={collisions:obstacles,ceilingVolumes:cityOverheadVolumes(pieces,obstacles)};
 const combined=mergeGeometries(pieces,false),geometry=mergeVertices(combined);combined.dispose();for(const p of pieces)p.dispose();
 const material=new MeshStandardMaterial({vertexColors:true,roughness:1});root.add(new Mesh(geometry,material));
 const result=Buffer.from(await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:true}));
 const path=new URL(id+'.glb',directory);const old=await readFile(path).catch(()=>null);if(!old?.equals(result))await writeFile(path,result);
 geometry.dispose();material.dispose();CITY_MODEL_IDS.push(id);pieces=[];obstacles=[];batches=[];
}
// Keep complete authored objects together when fitting them to an irregular edge.
function tracked(build) {
 return (...args)=>{
  const outer=trackingDepth++===0,first=pieces.length,firstObstacle=obstacles.length;
  try{return build(...args);}finally{
   trackingDepth--;
   if(outer)batches.push({kind:build.name,first,end:pieces.length,firstObstacle,lastObstacle:obstacles.length,required:build.name==='house'&&(args[5]??4)>=6});
  }
 };
}
function fitDistrict(location) {
 const removedPieces=new Set(),removedObstacles=new Set();let shifted=0,removed=0;
 const bounds=points=>({minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minZ:Math.min(...points.map(p=>p[1])),maxZ:Math.max(...points.map(p=>p[1]))});
 const overlaps=(a,b,gap=.12)=>a.minX<b.maxX+gap&&a.maxX>b.minX-gap&&a.minZ<b.maxZ+gap&&a.maxZ>b.minZ-gap;
 const people=CITY_RESIDENTS.filter(n=>Math.abs(n.x-location.x)<20&&Math.abs(n.z-location.z)<20).map(n=>({minX:n.x-location.x-.9,maxX:n.x-location.x+.9,minZ:n.z-location.z-.9,maxZ:n.z-location.z+.9}));
 // Keep fitted furniture out of the two feeding camels' body/hoof space.
 // World coordinates match their stationary instances; the feeder is authored after fitting.
 const animals=location.id==='guest'?[20.5,23].map(x=>({minX:x-location.x-.8,maxX:x-location.x+.8,minZ:25.1-location.z,maxZ:27.45-location.z})):[];
 const fits=points=>points.every(([x,z])=>Math.abs(x)<15.8&&Math.abs(z)<15.8&&insideCity(x+location.x,z+location.z)&&cityBoundaryDistance(x+location.x,z+location.z)>1.45);
 const offsets=[];for(let x=-7;x<=7;x+=.5)for(let z=-7;z<=7;z+=.5)offsets.push([x,z]);offsets.sort((a,b)=>Math.hypot(...a)-Math.hypot(...b));
 for(const batch of batches){
  const points=[];
  for(const geometry of pieces.slice(batch.first,batch.end)){geometry.computeBoundingBox();const b=geometry.boundingBox;points.push([b.min.x,b.min.z],[b.max.x,b.min.z],[b.max.x,b.max.z],[b.min.x,b.max.z]);}
  const extent=bounds(points),corners=[[extent.minX,extent.minZ],[extent.maxX,extent.minZ],[extent.maxX,extent.maxZ],[extent.minX,extent.maxZ]];
  if(fits(corners))continue;
  const own=obstacles.slice(batch.firstObstacle,batch.lastObstacle).map(bounds);
  const others=obstacles.flatMap((polygon,i)=>i>=batch.firstObstacle&&i<batch.lastObstacle||removedObstacles.has(i)?[]:[bounds(polygon)]);
  const offset=offsets.find(([dx,dz])=>{
   if(!fits(corners.map(([x,z])=>[x+dx,z+dz])))return false;
   const shapes=own.length?own:[extent];
   return shapes.every(box=>{
    const moved={minX:box.minX+dx,maxX:box.maxX+dx,minZ:box.minZ+dz,maxZ:box.maxZ+dz};
    return !people.some(person=>overlaps(moved,person,0))&&!animals.some(animal=>overlaps(moved,animal,0))&&!others.some(other=>!overlaps(box,other,0)&&overlaps(moved,other));
   });
  });
  if(offset){
   const [dx,dz]=offset;for(const geometry of pieces.slice(batch.first,batch.end))geometry.translate(dx,0,dz);
   for(let i=batch.firstObstacle;i<batch.lastObstacle;i++)obstacles[i]=obstacles[i].map(([x,z])=>[x+dx,z+dz]);shifted++;
  }else{
   if(batch.required)throw new Error(`Important landmark does not fit ${location.id}: ${batch.kind}`);
   for(let i=batch.first;i<batch.end;i++)removedPieces.add(i);
   for(let i=batch.firstObstacle;i<batch.lastObstacle;i++)removedObstacles.add(i);
   console.log(`Removed edge object ${location.id}: ${batch.kind}`);removed++;
  }
 }
 // Flat paving fragments must not decorate the water or the outside of the wall.
 for(let i=1;i<pieces.length;i++){
  const g=pieces[i];g.computeBoundingBox();const b=g.boundingBox;
  if(b.max.y<.16&&[[b.min.x,b.min.z],[b.max.x,b.max.z]].some(([x,z])=>!insideCity(x+location.x,z+location.z)))removedPieces.add(i);
 }
 pieces=pieces.filter((g,i)=>{if(!removedPieces.has(i))return true;g.dispose();return false;});
 obstacles=obstacles.filter((_,i)=>!removedObstacles.has(i));
 console.log(`Edge fitting ${location.id}: ${shifted} moved, ${removed} removed`);
}

house=tracked(house);
palm=tracked(palm);
pot=tracked(pot);
bench=tracked(bench);
canopy=tracked(canopy);
animal=tracked(animal);
tablet=tracked(tablet);
basket=tracked(basket);
lamp=tracked(lamp);
rug=tracked(rug);
jar=tracked(jar);
tray=tracked(tray);
rope=tracked(rope);
sign=tracked(sign);
flowers=tracked(flowers);
awningLine=tracked(awningLine);
dryingFrame=tracked(dryingFrame);
mosaic=tracked(mosaic);
rack=tracked(rack);
workshop=tracked(workshop);
amphoraStand=tracked(amphoraStand);
offerings=tracked(offerings);
produce=tracked(produce);
plantedScreen=tracked(plantedScreen);
marketGame=tracked(marketGame);
for(const location of CITY_LOCATIONS.filter(l=>!['market','pasture','tower'].includes(l.id))) {
 districtSeed=CITY_LOCATIONS.indexOf(location);
 ground(['gardens','palace'].includes(location.id));
 if(location.id==='gate') {
  for(const side of [-1,1]) { house(side*8,10,'#497f9c',7,7,10);for(let i=0;i<3;i++){ball('#e6bb65',side*8,2+i*2.1,6.4,1.3,.5,.12);box('#e6bb65',side*8,1.5+i*2.1,6.4,1.4,.5,.1);} }
  box('#39738e',0,8,10,10,2,5);box(wood,0,3,13,10,6,.4);block(0,13,10,.5);
  for(let x=-4;x<=4;x++)box('#594938',x,3,12.7,.15,6,.15);
  bench(-9,-7);pot(8,-7);
 } else if(location.id==='fountain') {
  cylinder(sand,0,.55,-5,3.5,1.1);cylinder('#69b2b3',0,1.12,-5,3.05,.06);cylinder(cream,0,2,-5,.5,2.3);cylinder(teal,0,3.2,-5,1.3,.3);
  roundBlock(0,-5,3.5);bench(-9,5);bench(9,5);palm(-10,-10);palm(10,-10);pot(-5,0);pot(5,0);
 } else if(location.id==='garden') {
  for(const x of [-10,-6,6,10])for(const z of [-10,-6,-2]) {box(wood,x,.2,z,2.5,.4,2.5);box('#8e7652',x,.3,z,2.2,.1,2.2);for(const dx of [-.6,.6])ball(leaf,x+dx,.65,z,.35,.6,.35);block(x,z,2.5,2.5);}
  house(10,10,sand,6,5,3);box(wood,-9,1.6,8,.15,3.2,.15);box(wood,-9,2.2,8,2,.12,.15);ball(cream,-9,2.8,8,.35,.4,.35);block(-9,8,.15,.15);
 } else if(location.id==='mill') {
  canopy(0,-7,teal,5.4,4.4);cylinder('#aaa08c',0,.6,-7,2.5,1.2);cylinder(wood,0,1.5,-7,.2,2);roundBlock(0,-7,2.5); // The rotating drive is owned by the mule's streamed model.
  for(let i=0;i<5;i++){ball('#c3b78f',-10+i*1.2,.6,10,.5,.65,.5);roundBlock(-10+i*1.2,10,.5);}house(10,-10);
 } else if(location.id==='bakery') {
  ball('#bc8561',0,1.1,-8,3,2.4,3);box('#604c3b',0,.7,-5.1,1.4,1.4,.1);roundBlock(0,-8,3);canopy(-9,-5);
  for(let i=0;i<5;i++){box(wood,-10+i*.7,1,-5,.65,.2,1.2);ball('#dba966',-10+i*.7,1.2,-5,.3,.09,.5);}house(11,-10);animal(5,-4,'cat');
 } else if(location.id==='dye') {
  for(const [x,c] of [[-9,'#ad6654'],[0,'#579593'],[9,'#8a7298']]) {cylinder(wood,x,.65,-7,1.8,1.3);cylinder(c,x,1.3,-7,1.65,.08);roundBlock(x,-7,1.8);dryingFrame(x,-12,c);}canopy(8,8,'#ac7495');
 } else if(location.id==='school') {
  house(-10,-10);house(10,-10);canopy(0,-6);box(wood,0,1.1,-6,5,.2,2);block(0,-6,5,2);
  for(let i=0;i<6;i++){box('#ba8a62',-2+i*.8,1.25,-6,.55,.1,.8);box('#725b45',-2+i*.8,1.31,-6,.3,.02,.05);}box(wood,9,1.5,5,3,3,.2);block(9,5,3,.3);
 } else if(location.id==='homes') {
  for(const [x,z,w,d] of [[-10,-9,7,5],[8,-7,6,7],[-7,10,8,5]])house(x,z,x<0?'#d9bda1':'#c7af8e',w,d);
  for(let i=0;i<5;i++)box(i%2?cream:teal,-3+i*1.5,3,-10,1,1.5,.08);pot(5,4);pot(-6,-4);
 } else if(location.id==='guest') {
  for(const x of [-10,10])house(x,-10);canopy(-8,4);canopy(8,4,'#b98b61');
  tracked(function caravanTable(){box(wood,0,1,-8,5,.2,2);block(0,-8,5,2);for(let i=0;i<4;i++)pot(-1.5+i,-8);tablet(-1,1.15,-8);})();
 } else if(location.id==='dock') {
  box('#679d9d',-10,-.15,0,12,.18,32);box(wood,-6,.08,4,13,.3,5);
  const boatFirst=pieces.length;buildCityBoat({mesh,box,bead,cylinder},-10,-7); // Water already blocks entry; never fit this boat onto land.
  for(const part of pieces.slice(boatFirst))part.userData.citySolid=false;
  for(let i=0;i<4;i++){box(wood,7+(i%2)*2,.5,-6+Math.floor(i/2)*2,1.6,1,1.6);block(7+(i%2)*2,-6+Math.floor(i/2)*2,1.6,1.6);}canopy(8,10);
 } else if(location.id==='gardens') {
  for(let i=0;i<3;i++){const w=18-i*5,d=12-i*3;box(sand,0,.75+i*1.5,-6,w,1.5,d);box(leaf,0,1.55+i*1.5,-6,w,.15,d);for(const x of [-w/2+1,w/2-1]){ball(leaf,x,2.4+i*1.5,-6,1.5,1.7,1.5);for(let z=-10;z<-2;z+=2)ball('#d6a184',x,1.8+i*1.5,z,.25,.25,.25);}}
  block(0,-6,18,12);cylinder(wood,12,2,-5,2,.3).userData.citySolid=true;cylinder(wood,12,.925,-5,.16,1.85);roundBlock(12,-5,.16);bench(-10,8);bench(10,10);
 } else if(location.id==='palace') {
  house(0,-8,'#d8c6a5',20,9,7);for(const x of [-8,-4,4,8]){cylinder(cream,x,2.5,0,.4,5);roundBlock(x,0,.7);}box('#c89a57',0,5.3,0,20,.6,2);box('#b97866',0,.03,5,5,.06,12);palm(-12,9);palm(12,9);
 }
 detailDistrict(location.id);
 districtStories(location);
 enrichLandmark(location.id);
 const detailApi={box,ball,bead,cylinder,beam,block,tracked,tablet,basket,jar,rug,rope,flowers,pot,wood,cream,teal,sand,leaf};
 decorateEast(location.id,detailApi);decorateCrafts(location.id,detailApi);decorateCivic(location.id,detailApi);
 if(['gardens','palace'].includes(location.id))compactBank();
 transformPatch(1,0,(x,z)=>cityLocal(location.id,x,z));
 fitDistrict(location);
 if(location.id==='guest'){
   // World-aligned feeder matches the two synchronized camels, after district fitting.
   const x=21.75-location.x,z=28.15-location.z;
   box(wood,x,.5,z,4.4,.65,.8);box('#5f4b36',x,.85,z,4.1,.06,.6);
   for(const side of [-1,1]){box('#b18a58',x,.85,z+side*.43,4.5,.18,.1);for(const dx of [-1.7,1.7])box(wood,x+dx,.25,z+side*.3,.16,.5,.16);}
   for(let i=0;i<30;i++)beam(i%2?'#ccb86c':'#e0ce88',x-2+i*.135,.91+(i%3)*.04,z+Math.sin(i)*.2,.46,.045,.035,(i%5-2)*.2);
   block(x,z,4.5,.9);
 }
 streets(location.id);
 await save('city-'+location.id);
}
for(const npc of CITY_RESIDENTS.filter(n=>!n.legacy)) {
 const s=npc.child ? .72 : 1, skin='#c99870';
 mesh(new CylinderGeometry(.24,.36,.95,12),npc.color,0,.7*s,0,s,s,s);
 for(const x of [-.15,.15]){cylinder('#a57552',x*s,.2*s,0,.1*s,.4*s);ball('#644e3a',x*s,.08*s,.12*s,.13*s,.1*s,.22*s);}
 ball(skin,0,1.45*s,0,.23*s,.29*s,.23*s);for(const x of [-.32,.32])ball(skin,x*s,.82*s,0,.1*s,.38*s,.1*s);
 for(const x of [-.08,.08])ball('#473b32',x*s,1.48*s,.22*s,.025*s,.025*s,.015*s);
 const hatColor=npc.hat==='helmet'?'#ae9973':npc.hat==='straw'?'#dcc080':npc.hat==='crown'?'#dbb251':npc.hat==='flowers'?leaf:cream;
 cylinder(hatColor,0,1.7*s,0,.27*s,.15*s);if(npc.hat==='turban')ball(hatColor,0,1.78*s,0,.3*s,.18*s,.3*s);
 if(npc.hat==='straw')cylinder(hatColor,0,1.7*s,0,.44*s,.05*s);
 if(['wrap','band'].includes(npc.hat))box(hatColor,0,1.48*s,-.2*s,.45*s,.55*s,.12*s);
 if(npc.id==='belu') {cylinder(wood,.42,.9,0,.035,1.8);ball('#b7af98',.42,1.9,0,.06,.22,.06);}
 if(npc.id==='apil'||npc.id==='herodotus')ball('#695341',0,1.18, .17,.19,.23,.12);
 await save('resident-'+npc.id);
}

for(let variant=0;variant<4;variant++) {
 ground(true);streetDetails(20+variant);canopy(-9,-8,[teal,'#b87e62','#b8a06b','#8b8296'][variant]);
 bench(8,8);flowers(10,6);basket(-10,-7,true);jar(-7,-6,.8);rug(-9,-8,[teal,'#ba886c','#9ba177','#a78a98'][variant],5,3);
 if(variant===0){tray(8,-8,'spice');sign(5,-6);}
 if(variant===1){tray(8,-8,'tablet');tablet(8,.9,-8);}
 if(variant===2){awningLine(8,-8);rope(8,-5);basket(10,-4);}
 if(variant===3){palm(8,-8);bench(8,-4);animal(-10,6,'dog');}
 workshop(8,0,'tools');plantedScreen(-8,6);marketGame(0,10);compactBank();fitDistrict({id:'lane-'+variant,x:-64,z:0});streets('lane-'+variant);
 await save('city-lane-'+variant);
}

// Transform geometry and its collision polygons together, including rotated houses.
function transformPatch(first,firstObstacle,transform) {
 for(const geometry of pieces.slice(first)){
  const position=geometry.getAttribute('position');
  for(let i=0;i<position.count;i++){const p=transform(position.getX(i),position.getZ(i));position.setXYZ(i,p.x,position.getY(i),p.z);}
  geometry.computeVertexNormals();geometry.computeBoundingBox();
 }
 for(let i=firstObstacle;i<obstacles.length;i++)obstacles[i]=obstacles[i].map(([x,z])=>{const p=transform(x,z);return [p.x,p.z];});
}
function ribbon(points,width,color,y=.035,origin=null) {
 const curve=new CatmullRomCurve3(points.map(p=>new Vector3(p.x,y,p.z)),false,'centripetal'),vertices=[];
 const steps=Math.max(16,Math.ceil(curve.getLength()*2));
 for(let i=0;i<steps;i++){
  const corners=[];
  for(const t of [i/steps,(i+1)/steps]){
   const p=curve.getPoint(t),v=curve.getTangent(t),w=width*(1+.09*Math.sin(t*Math.PI));
   corners.push([p.x-v.z*w/2,y,p.z+v.x*w/2],[p.x+v.z*w/2,y,p.z-v.x*w/2]);
  }
  for(const indices of [[0,2,1],[1,2,3]]){
   if(origin && indices.some(index=>!insideCity(corners[index][0]+origin.x,corners[index][2]+origin.z)))continue;
   for(const index of indices)vertices.push(...corners[index]);
  }
 }
 const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();mesh(geometry,color,0,0,0);
 return curve;
}
function streets(id) {
 const bank=['gardens','palace','dock'].includes(id)||id.startsWith('lane-');
 const origin=CITY_LOCATIONS.find(place=>place.id===id)??{x:-64,z:0};
 for(const points of cityStreets(id)){
  const width=bank?2.2:3.2,curve=ribbon(points,width,'#e8d2ab',.035,origin);
  for(let i=1;i<18;i++){
   const t=i/18,p=curve.getPoint(t),v=curve.getTangent(t);
   // Uneven edging follows the curve rather than revealing chunk axes.
   for(const side of [-1,1]){const x=p.x-side*v.z*(width/2+.2),z=p.z+side*v.x*(width/2+.2);if(!insideCity(x+origin.x,z+origin.z)||cityBoundaryDistance(x+origin.x,z+origin.z)<1.2)continue;box(i%3?'#bda17b':'#d7bb8e',x,.045,z,.24,.09,.5);}
  }
 }
}
function enrichLandmark(id) {
 if(id==='fountain'){
  for(let i=0;i<18;i++){const a=i*Math.PI/9;box(i%2?teal:cream,Math.sin(a)*3.2,1.16,-5+Math.cos(a)*3.2,.4,.16,.4);}
  for(const side of [-1,1]){cylinder(cream,side*.65,2,-5,.14,.65);ribbon([{x:side*.65,z:-5},{x:side*1.5,z:-5},{x:side*2.3,z:-5}],.1,'#9cc7bd',1.5);}
  for(let i=0;i<9;i++)bead('#c9dacf',Math.sin(i*2)*2.4,1.17,-5+Math.cos(i*2)*2.4,.14,.015,.25);
 }else if(id==='mill'){
  for(let i=0;i<12;i++){const a=i*Math.PI/6;box('#877c66',Math.sin(a)*2.3,1.23,-7+Math.cos(a)*2.3,.25,.12,.5);}
  cylinder('#c8b995',0,1.23,-7,.6,.12);box(wood,0,2.5,-7,.4,1,.4);
  for(let i=0;i<4;i++){basket(-10+i*1.4,7,false,.85);rope(-10+i*1.4,6);}
 }else if(id==='bakery'){
  for(let i=0;i<9;i++){const a=i*Math.PI/8;box(i%2?'#d4ac7b':'#a77351',Math.cos(a)*1.1,.7+Math.sin(a)*1.2,-5.05,.35,.4,.22);}
  cylinder('#b87d54',0,3.8,-8,.42,1.5,.32);cylinder('#e2c69b',0,4.55,-8,.48,.16);
  box(wood,3,1.5,-5,.13,3,.13);box(wood,3,2.9,-5,.65,.08,.85);
  for(let i=0;i<7;i++)bead('#947452',-2+i*.6,.12,-4.5,.18,.1,.12);
 }else if(id==='dock'){
  for(let i=0;i<10;i++)box(i%2?'#ad895e':'#846243',-6,.25,1.9+i*.46,12.6,.035,.06);
  for(const z of [2,6])for(const x of [-11,-7,-3]){cylinder(wood,x,.65,z,.15,1.3);rope(x+.3,z);}

 }else if(id==='gardens'){
  for(let i=0;i<3;i++){
   box('#639d96',-6+i*3,1.6+i*1.5,-6,1.2,.08,6-i);box(cream,-6.8+i*3,1.7+i*1.5,-6,.2,.2,6-i);
   for(let j=0;j<8;j++)box(j%2?'#7aa59b':'#8bb4aa',-6+i*3,1.4+i*1.5-j*.15,-2.4,.8,.16,.06);
  }
  for(let i=0;i<5;i++){box(cream,-10+i*.45,.08+i*.14,1.5,1.7,.15+i*.28,.4);}
 }else if(id==='palace'){
  for(const x of [-8,-4,4,8]){cylinder('#c6b187',x,.3,0,.7,.6);cylinder('#c6b187',x,4.9,0,.7,.35);for(let i=0;i<7;i++)cylinder(teal,x,1+i*.5,0,.41,.08);}
  for(let i=0;i<11;i++){box(teal,-9+i*1.8,5.3,1.02,1.2,.35,.06);bead('#d9b56c',-9+i*1.8,5.3,1.1,.2,.14,.05);}
 }else if(id==='homes'||id==='guest'){
  for(let i=0;i<4;i++){box(wood,-4+i*.45,1,8,.08,2,.08);box(wood,-3.3,.6+i*.42,8,1.5,.08,.1);}
  rug(5,5,'#936d75',3,2);amphoraStand(7,9);
 }
}

function clipPolygon(polygon,minX,minZ,maxX,maxZ) {
 let points=polygon.map(p=>[...p]);
 for(const [axis,bound,sign] of [[0,minX,1],[0,maxX,-1],[1,minZ,1],[1,maxZ,-1]]){
  const out=[];
  for(let i=0;i<points.length;i++){
   const a=points[i],b=points[(i+1)%points.length],ia=(a[axis]-bound)*sign>=0,ib=(b[axis]-bound)*sign>=0;
   if(ia)out.push(a);
   if(ia!==ib){const t=(bound-a[axis])/(b[axis]-a[axis]);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
  }points=out;
 }
 return points;
}
function surface(polygon,color,cx,cz,y) {
 if(polygon.length<3)return;
 const shape=new Shape();polygon.forEach(([x,z],i)=>i?shape.lineTo(x-cx,-z+cz):shape.moveTo(x-cx,-z+cz));shape.closePath();
 const geometry=new ShapeGeometry(shape);geometry.rotateX(-Math.PI/2);mesh(geometry,color,0,y,0);
}
function edgePiece(a,b,color,height,width,cx,cz) {
 const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),geometry=new BoxGeometry(length,height,width);
 geometry.rotateY(-Math.atan2(dz,dx));mesh(geometry,color,(a[0]+b[0])/2-cx,height/2,(a[1]+b[1])/2-cz);
}
function segmentInCell(a,b,minX,minZ,maxX,maxZ) {
 let lo=0,hi=1;const dx=b[0]-a[0],dz=b[1]-a[1];
 for(const [p,q] of [[-dx,a[0]-minX],[dx,maxX-a[0]],[-dz,a[1]-minZ],[dz,maxZ-a[1]]]){
  if(p===0){if(q<0)return null;continue;}const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
 }return lo>=hi?null:[[a[0]+lo*dx,a[1]+lo*dz],[a[0]+hi*dx,a[1]+hi*dz]];
}
// Per-chunk boundary meshes follow one shared outline. No square perimeter walls remain.
for(let cz=-64;cz<=32;cz+=32)for(let cx=-64;cx<=32;cx+=32){
 const minX=cx-16,minZ=cz-16,maxX=cx+16,maxZ=cz+16;
 const edges=CITY_OUTLINE.flatMap((a,i)=>{const b=CITY_OUTLINE[(i+1)%CITY_OUTLINE.length],cut=segmentInCell(a,b,minX,minZ,maxX,maxZ);return cut?[{a:cut[0],b:cut[1],index:i}]:[];});
 if(!edges.length)continue;
 surface([[minX,minZ],[maxX,minZ],[maxX,maxZ],[minX,maxZ]],'#c5b18c',cx,cz,-.01);
 const river=[[-90,-90],[-69,-90],...CITY_RIVER_BANK,[-80,58],[-90,58]];
 surface(clipPolygon(river,minX,minZ,maxX,maxZ),'#679e9d',cx,cz,.005);
 surface(clipPolygon(CITY_OUTLINE,minX,minZ,maxX,maxZ),'#d4bf9a',cx,cz,.012);
 for(const edge of edges){
  const {a,b,index}=edge,river=index>=21,dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),nx=-dz/length,nz=dx/length;
  if(river){
   edgePiece(a,b,'#b3b597',.28,1.1,cx,cz);
   for(let d=1;d<length;d+=2.3){const x=a[0]+dx*d/length,z=a[1]+dz*d/length;
    bead('#9b9f82',x-cx,.18,z-cz,.45,.22,.35);
    for(let j=0;j<3;j++){box('#7d8b58',x-cx-nx*.6+j*.14,.55,z-cz-nz*.6,.035,1.1,.035);bead('#9e835a',x-cx-nx*.6+j*.14,1.08,z-cz-nz*.6,.06,.18,.06);}
   }
  }else{
   const h=4.6+(index%3)*.55;
   edgePiece(a,b,index%2?'#c5aa81':'#d0b48a',h,1.4,cx,cz);
   edgePiece(a,b,'#ac8e65',.6,2,cx,cz);
   for(let d=.8;d<length;d+=1.8){const x=a[0]+dx*d/length,z=a[1]+dz*d/length;box(cream,x-cx,h+.28,z-cz,.75,.65,.8);}
   for(let d=2;d<length;d+=5){const x=a[0]+dx*d/length,z=a[1]+dz*d/length;box('#b69b73',x-cx,h*.35,z-cz,.9,h*.7,1.9);box(teal,x-cx+nx*.76,h*.6,z-cz+nz*.76,.35,.65,.1);}
   for(let row=1;row<4;row++){
    const offset=row*.9;const aa=[a[0]+nx*.73,a[1]+nz*.73],bb=[b[0]+nx*.73,b[1]+nz*.73];
    const first=pieces.length;edgePiece(aa,bb,'#ae9069',.035,.035,cx,cz);pieces[first].translate(0,offset,0);
   }
  }
 }
 // Bastions at selected bends, constrained to the solid wall footprint.
 for(const index of [1,3,6,8,10,12,14,19]){
  const [x,z]=CITY_OUTLINE[index];if(x<minX||x>=maxX||z<minZ||z>=maxZ)continue;
  cylinder('#c4a679',x-cx,3.2,z-cz,1.05,6.4);cylinder(cream,x-cx,6.45,z-cz,1.2,.28);
  for(let i=0;i<8;i++){const angle=i*Math.PI/4;box(cream,x-cx+Math.cos(angle),6.85,z-cz+Math.sin(angle),.4,.65,.4);}
 }
 await save(`city-boundary-${cx/32}_${cz/32}`);
}

await writeFile(new URL("../src/shared/cityMap.generated.ts",import.meta.url), "// Generated from the final authored collision footprints.\nexport const CITY_MAP_FEATURES: readonly {district: string; kind: string; points: readonly (readonly number[])[]}[] = "+JSON.stringify(cityMapFeatures)+";\n");

for(const kind of ['camel','mule']){
 const root=buildPackAnimal(kind);const result=Buffer.from(await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:true}));
 const path=new URL(`city-${kind}.glb`,directory);const old=await readFile(path).catch(()=>null);if(!old?.equals(result))await writeFile(path,result);
 const geometries=new Set(),materials=new Set();root.traverse(node=>{if(node.isMesh){geometries.add(node.geometry);materials.add(node.material);}});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();CITY_MODEL_IDS.push(`city-${kind}`);
}
