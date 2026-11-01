import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { rasterizePolygons } from './collision-raster.mjs';
import ts from 'typescript';
import { MARKET_MODEL_IDS } from './generate-market-models.mjs';
import { CITY_MODEL_IDS, CITY_LOCATIONS, CITY_RESIDENTS, insideCity, cityBoundaryDistance } from './generate-city-models.mjs';
import { ceilingVolumesFromGlb, compactVolumes, distributeVolumes, placeVolumes } from './ceiling-volumes.mjs';
// Compile only this pure authored data module offline. This also keeps generation compatible with Node 22.12.
const sceneSource=await readFile(new URL('../../shared/world-life/market.ts',import.meta.url),'utf8');
const sceneModule=ts.transpileModule(sceneSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const { MARKET_WORLD_LIFE }=await import(`data:text/javascript;base64,${Buffer.from(sceneModule).toString('base64')}`);
const publicRoot=new URL('../public/',import.meta.url);
const base=JSON.parse(await readFile(new URL('maps/demo/manifest.json',publicRoot),'utf8'));
const root=new URL('maps/market/',publicRoot);await mkdir(root,{recursive:true});
async function writeChanged(path,data){const bytes=Buffer.from(data);const old=await readFile(path).catch(()=>null);if(!old?.equals(bytes))await writeFile(path,bytes);}
const assets={...base.assets}; delete assets['assets/models/demo/courtyard.glb'];
const models={...base.models};delete models.courtyard;
const chunks=base.chunks.filter(entry=>entry.x>=-2&&entry.x<=1&&entry.z>=-2&&entry.z<=1).map(entry=>({...entry,assets:[...entry.assets]}));
const authoredCeilings=[];
// All catalogue entries refer to independent shared models, not a whole-location substitute.
for(const name of MARKET_MODEL_IDS){
 const path=`assets/models/market/${name}.glb`,bytes=await readFile(new URL(path,publicRoot));
 assets[path]={bytes:bytes.length,memory:['market','pasture','main-building'].includes(name)?(name==='market'?8:6)*1024*1024:Math.max(128*1024,bytes.length*6)};
 models[name]=`market/${name}.glb`;
}
for(const [name,id] of [['market','0_0'],['pasture','0_-2'],['main-building','-1_0']]){
 const path=`assets/models/market/${name}.glb`;const bytes=await readFile(new URL(path,publicRoot));
 assets[path]={bytes:bytes.length,memory:name==='market'?8*1024*1024:6*1024*1024};models[name]=`market/${name}.glb`;
 const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 const rectangles=gltf.nodes.find(node=>node.extras?.collisions)?.extras.collisions;if(!rectangles)throw new Error('Missing authored collision data');
 const collision=Buffer.from(rasterizePolygons(rectangles.map(([x0,z0,x1,z1])=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]]),base.collisionResolution));
 const entry=chunks.find(c=>c.id===id);
 const ceilings=compactVolumes(ceilingVolumesFromGlb(gltf).filter(v=>v.bottomY<=3.1 || name==='main-building' && v.minX<=10.25 && v.maxX>=7.75 && v.minZ<=7.25 && v.maxZ>=-5.65));
 if(ceilings.length>128)throw new Error(`Too many ceilings in ${name}: ${ceilings.length}`);
 entry.ceilingVolumes=[];
 authoredCeilings.push(...placeVolumes(ceilings,entry.x*32,entry.z*32));
 const json=JSON.stringify({id,objects:[{id:name,assetId:name,transform:{position:{x:entry.x*32,y:0,z:entry.z*32},rotationY:0},animation:'idle'}]});
 entry.url=`maps/market/${name}.json`;entry.bytes=Buffer.byteLength(json);entry.assets=[name,'cat','bird','pickup-apple',...(name==='market'?['pushable-pot']:[])];entry.region=name==='market'?'Рынок Вавилона':name==='pasture'?'Пастбище у северной стены':'Двор Вавилонской башни';
 entry.collisionUrl=`maps/market/collision-${createHash('sha256').update(collision).digest('hex')}.bin`;entry.collisionBytes=collision.length;
 await writeChanged(new URL(entry.url,publicRoot),json);await writeChanged(new URL(entry.collisionUrl,publicRoot),collision);
}
for (const id of CITY_MODEL_IDS) {
 const path=`assets/models/city/${id}.glb`, bytes=await readFile(new URL(path,publicRoot));
 // Indexed, untextured city meshes: encoded GLB + CPU/GPU geometry and node overhead.
 assets[path]={bytes:bytes.length,memory:Math.max(128*1024,bytes.length*4+32768)};models[id]=`city/${id}.glb`;
}
const cityAreas = [...CITY_LOCATIONS.filter(l=>!['market','pasture','tower'].includes(l.id)),
 ...chunks.filter(c=>!CITY_LOCATIONS.some(l=>l.x===c.x*32&&l.z===c.z*32)).map(c=>({id:`lane-${Math.abs(c.x*7+c.z*3)%4}`,x:c.x*32,z:c.z*32,name:{ru:'Переулки Вавилона'}}))];
for (const location of cityAreas) {
 const entry=chunks.find(c=>c.x===location.x/32&&c.z===location.z/32);
 const model=`city-${location.id}`,bytes=await readFile(new URL(`assets/models/city/${model}.glb`,publicRoot));
 const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 const polygons=gltf.nodes.find(n=>n.extras?.collisions)?.extras.collisions??[];
 const collision=Buffer.from(rasterizePolygons(polygons,base.collisionResolution));
 const json=JSON.stringify({id:entry.id,objects:[{id:model,assetId:model,transform:{position:{x:location.x,y:0,z:location.z},rotationY:0}}]});
 entry.url=`maps/market/${model}-${entry.id}.json`;entry.bytes=Buffer.byteLength(json);entry.region=location.name.ru;
 entry.assets=[model];
 entry.collisionUrl=`maps/market/collision-${createHash('sha256').update(collision).digest('hex')}.bin`;entry.collisionBytes=collision.length;entry.ceilingVolumes=[];
 authoredCeilings.push(...placeVolumes(compactVolumes(ceilingVolumesFromGlb(gltf).filter(v=>v.bottomY<=3.1)),location.x,location.z));
 await writeChanged(new URL(entry.url,publicRoot),json);await writeChanged(new URL(entry.collisionUrl,publicRoot),collision);
}
// Reserve residents in the actual chunk where they stand, including the old districts.
for(const resident of CITY_RESIDENTS.filter(n=>!n.legacy)){
 const entry=chunks.find(c=>c.x===Math.floor((resident.x+16)/32)&&c.z===Math.floor((resident.z+16)/32));
 if(entry)entry.assets.push(`resident-${resident.id}`);
}
for(const entry of chunks) {
 const model=`city-boundary-${entry.x}_${entry.z}`;
 const chunk=JSON.parse(await readFile(new URL(entry.url,publicRoot),'utf8'));
 const collision=Buffer.from(await readFile(new URL(entry.collisionUrl,publicRoot))),res=base.collisionResolution;
 if(models[model]){chunk.objects.push({id:model,assetId:model,transform:{position:{x:entry.x*32,y:0,z:entry.z*32},rotationY:0}});entry.assets.push(model);}
 for(let z=0;z<res;z++)for(let x=0;x<res;x++){
  const wx=entry.x*32-16+(x+.5)*32/res,wz=entry.z*32-16+(z+.5)*32/res;
  if(!insideCity(wx,wz)||cityBoundaryDistance(wx,wz)<1.15)collision[z*res+x]=1;
 }
 const json=JSON.stringify(chunk);entry.url=`maps/market/border-${entry.id}.json`;entry.bytes=Buffer.byteLength(json);
 entry.collisionUrl=`maps/market/collision-${createHash('sha256').update(collision).digest('hex')}.bin`;
 await writeChanged(new URL(entry.url,publicRoot),json);await writeChanged(new URL(entry.collisionUrl,publicRoot),collision);
}
distributeVolumes(chunks,authoredCeilings,base.chunkSize,base.origin);
// Count the actual unique files reachable from this manifest, including reused city districts.
const files=new Set(Object.keys(assets));for(const chunk of chunks){files.add(chunk.url);files.add(chunk.collisionUrl);}
let resourceBytes=0;for(const path of files)resourceBytes+=(await readFile(new URL(path,publicRoot))).length;
const heightSurfaces=[{minX:-24,maxX:-22,minZ:-5.4,maxZ:-3,startY:3,endY:3},{minX:-24,maxX:-22,minZ:-3,maxZ:7,startY:3,endY:0}];
const manifest={...base,worldLife:MARKET_WORLD_LIFE,heightSurfaces,mapId:'market',spawn:{x:0,y:0,z:8},chunks,models,assets,worldBytes:resourceBytes};
let json='';for(let pass=0;pass<10;pass++){json=JSON.stringify(manifest);const total=resourceBytes+Buffer.byteLength(json);if(total===manifest.worldBytes)break;manifest.worldBytes=total;}
json=JSON.stringify(manifest);await writeChanged(new URL('manifest.json',root),json);
const bootstrap={manifestUrl:'maps/market/manifest.json',manifestBytes:Buffer.byteLength(json),worldBytes:manifest.worldBytes,assets};
await writeChanged(new URL('../src/shared/marketWorld.generated.ts',import.meta.url),`// Generated local world metadata.\nexport const MARKET_WORLD = ${JSON.stringify(bootstrap)} as const;\n`);
console.log(`Market world ${manifest.worldBytes} bytes.`);
