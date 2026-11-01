import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { MARKET_MODEL_IDS } from './generate-market-models.mjs';
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
const chunks=base.chunks.map(entry=>({...entry}));
const authoredCeilings=[];
// All catalogue entries refer to independent shared models, not a whole-location substitute.
for(const name of MARKET_MODEL_IDS){
 const path=`assets/models/market/${name}.glb`,bytes=await readFile(new URL(path,publicRoot));
 assets[path]={bytes:bytes.length,memory:['market','pasture','main-building'].includes(name)?(name==='market'?8:6)*1024*1024:Math.max(128*1024,bytes.length*6)};
 models[name]=`market/${name}.glb`;
}
for(const [name,id] of [['market','0_0'],['pasture','0_-1'],['main-building','-1_0']]){
 const path=`assets/models/market/${name}.glb`;const bytes=await readFile(new URL(path,publicRoot));
 assets[path]={bytes:bytes.length,memory:name==='market'?8*1024*1024:6*1024*1024};models[name]=`market/${name}.glb`;
 const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 const rectangles=gltf.nodes.find(node=>node.extras?.collisions)?.extras.collisions;if(!rectangles)throw new Error('Missing authored collision data');
 const collision=Buffer.alloc(base.collisionResolution**2);const res=base.collisionResolution;
 for(const [minX,minZ,maxX,maxZ] of rectangles){const left=Math.max(0,Math.floor((minX+16)*res/32)),right=Math.min(res-1,Math.floor((maxX+16)*res/32));const top=Math.max(0,Math.floor((minZ+16)*res/32)),bottom=Math.min(res-1,Math.floor((maxZ+16)*res/32));for(let z=top;z<=bottom;z++)collision.fill(1,z*res+left,z*res+right+1);}
 const entry=chunks.find(c=>c.id===id);
 const ceilings=compactVolumes(ceilingVolumesFromGlb(gltf).filter(v=>v.bottomY<=3.1 || name==='main-building' && v.minX<=10.25 && v.maxX>=7.75 && v.minZ<=7.25 && v.maxZ>=-5.65));
 if(ceilings.length>128)throw new Error(`Too many ceilings in ${name}: ${ceilings.length}`);
 entry.ceilingVolumes=[];
 authoredCeilings.push(...placeVolumes(ceilings,entry.x*32,entry.z*32));
 const json=JSON.stringify({id,objects:[{id:name,assetId:name,transform:{position:{x:entry.x*32,y:0,z:entry.z*32},rotationY:0},animation:'idle'}]});
 entry.url=`maps/market/${name}.json`;entry.bytes=Buffer.byteLength(json);entry.assets=[name,'cat','bird','pickup-apple',...(name==='market'?['pushable-pot']:[])];entry.region=name==='market'?'Рынок Вавилона':name==='pasture'?'Пастбище у рынка':'Двор Вавилонской башни';
 entry.collisionUrl=`maps/market/collision-${createHash('sha256').update(collision).digest('hex')}.bin`;entry.collisionBytes=collision.length;
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
