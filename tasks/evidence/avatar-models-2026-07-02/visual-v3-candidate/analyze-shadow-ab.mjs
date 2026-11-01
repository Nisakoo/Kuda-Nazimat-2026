// CPU-only pixel and shadow-frustum inspection for the captured A/B images.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { pair } from '../../ui-independent-review/pair-png.mjs';
const here=dirname(fileURLToPath(import.meta.url)), require=createRequire(resolve(here,'../../../../client/package.json'));
const {Box3,CylinderGeometry,DirectionalLight,Group,Mesh,MeshBasicMaterial,Vector3}=require('three');
const {GLTFLoader}=await import(require.resolve('three/addons/loaders/GLTFLoader.js'));
function paeth(a,b,c){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
async function decode(path){const b=await readFile(path),w=b.readUInt32BE(16),h=b.readUInt32BE(20),n=b[25]===2?3:b[25]===6?4:0;if(b[24]!==8||b[28]!==0||!n)throw Error('Unsupported PNG');let pos=8,parts=[];while(pos<b.length){const len=b.readUInt32BE(pos),type=b.toString('ascii',pos+4,pos+8);if(type==='IDAT')parts.push(b.subarray(pos+8,pos+8+len));pos+=len+12;}const raw=inflateSync(Buffer.concat(parts)),row=w*n,pixels=Buffer.alloc(row*h);let off=0;for(let y=0;y<h;y++){const f=raw[off++];for(let x=0;x<row;x++){const a=x>=n?pixels[y*row+x-n]:0,up=y?pixels[(y-1)*row+x]:0,ul=y&&x>=n?pixels[(y-1)*row+x-n]:0;pixels[y*row+x]=(raw[off++]+(f===0?0:f===1?a:f===2?up:f===3?Math.floor((a+up)/2):paeth(a,up,ul)))&255;}}return{w,h,n,pixels};}
const folder=join(here,'shadow-ab'),a=await decode(join(folder,'baseline-cloth.png')),b=await decode(join(folder,'candidate-cloth.png'));if(a.w!==b.w||a.h!==b.h)throw Error('Dimensions differ');
let changed=0,over2=0,max=0,sum=0,box={minX:a.w,minY:a.h,maxX:-1,maxY:-1};
for(let y=0;y<a.h;y++)for(let x=0;x<a.w;x++){let d=0;for(let c=0;c<3;c++)d=Math.max(d,Math.abs(a.pixels[(y*a.w+x)*a.n+c]-b.pixels[(y*b.w+x)*b.n+c]));if(d){changed++;sum+=d;if(d>2)over2++;max=Math.max(max,d);box.minX=Math.min(box.minX,x);box.minY=Math.min(box.minY,y);box.maxX=Math.max(box.maxX,x);box.maxY=Math.max(box.maxY,y);}}
await pair(join(folder,'baseline-cloth.png'),join(folder,'candidate-cloth.png'),join(folder,'cloth-ab-pair.png'),a.h);
const bytes=await readFile(join(here,'lukas.glb')),gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''),model=gltf.scene,root=new Group();const bounds=new Box3().setFromObject(model),height=bounds.getSize(new Vector3()).y;model.scale.multiplyScalar(1.85/height);model.position.y=-bounds.min.y*1.85/height;root.add(model);root.updateMatrixWorld(true);
const pedestal=new Mesh(new CylinderGeometry(.72,.76,.12,6),new MeshBasicMaterial());pedestal.position.y=-.065;pedestal.updateMatrixWorld(true);
const sunlight=new DirectionalLight();sunlight.position.set(-3,6,5);sunlight.updateMatrixWorld(true);sunlight.target.updateMatrixWorld(true);const camera=sunlight.shadow.camera;camera.left=-2;camera.right=2;camera.top=3;camera.bottom=-1;camera.near=.5;camera.far=15;camera.updateProjectionMatrix();sunlight.shadow.updateMatrices(sunlight);
const vector=new Vector3(),byKind={casters:{count:0,outside:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},pedestalReceiver:{count:0,outside:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}};
function project(mesh,stats){const positions=mesh.geometry.attributes.position;for(let i=0;i<positions.count;i++){vector.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld).project(camera);const v=vector.toArray();stats.count++;if(v.some(n=>n < -1 || n > 1))stats.outside++;for(let k=0;k<3;k++){stats.min[k]=Math.min(stats.min[k],v[k]);stats.max[k]=Math.max(stats.max[k],v[k]);}}}
model.traverse(o=>{if(o.isMesh)project(o,byKind.casters)});project(pedestal,byKind.pedestalReceiver);
const result={crop:{width:a.w,height:a.h,pixels:a.w*a.h,changedPixels:changed,changedMoreThan2:over2,maxChannelDifference:max,meanMaxChannelDifferenceOverAllPixels:sum/(a.w*a.h),changedBoundingBox:box},frustum:{near:.5,far:15,left:-2,right:2,top:3,bottom:-1,byKind},notes:['Pixel differences do not by themselves establish the cause of the reported deployed-chooser cloth dots.','Frustum samples static mesh vertices and does not prove all animated poses or account for normal-bias offsets.']};
await writeFile(join(here,'shadow-ab-analysis.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
