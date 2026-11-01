// CPU-only scan of the approved public GLBs. Does not create a renderer or modify assets.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';
const here = dirname(fileURLToPath(import.meta.url));
const client = resolve(here, '../../../../client');
const require = createRequire(join(client, 'package.json'));
const { Vector3, Raycaster } = require('three');
const { GLTFLoader } = await import(require.resolve('three/addons/loaders/GLTFLoader.js'));
const approval = JSON.parse(await readFile(resolve(here, '../../ui-independent-review/avatar-v4-approval-receipt.json'), 'utf8'));
assert.equal(approval.decision, 'approved-for-controlled-publication-and-strict-geometry-golden');

// Project two coplanar triangles onto the dominant plane, clip one against the
// other, and return their intersection area in those local projected units.
function overlapArea(t1, t2, n) {
  const axis = Math.abs(n.x) > Math.abs(n.y) ? (Math.abs(n.x) > Math.abs(n.z) ? 0 : 2) : (Math.abs(n.y) > Math.abs(n.z) ? 1 : 2);
  const project = v => axis === 0 ? [v.y, v.z] : axis === 1 ? [v.x, v.z] : [v.x, v.y];
  let polygon = t1.map(project); const clip = t2.map(project);
  const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const sign = Math.sign(cross(...clip));
  for (let i=0; i<3; i++) {
    const a=clip[i], b=clip[(i+1)%3], input=polygon; polygon=[];
    if (!input.length) break;
    for (let j=0; j<input.length; j++) {
      const s=input[j], e=input[(j+1)%input.length], ds=sign*cross(a,b,s), de=sign*cross(a,b,e);
      if ((ds>=0)!==(de>=0)) { const u=ds/(ds-de); polygon.push([s[0]+u*(e[0]-s[0]), s[1]+u*(e[1]-s[1])]); }
      if (de>=0) polygon.push(e);
    }
  }
  let area=0;
  for (let i=0; i<polygon.length; i++) { const a=polygon[i], b=polygon[(i+1)%polygon.length]; area+=a[0]*b[1]-a[1]*b[0]; }
  return Math.abs(area)/2;
}
function meshScan(mesh) {
  const geo=mesh.geometry, pos=geo.attributes.position, idx=geo.index, count=(idx?.count??pos.count)/3, triangles=[], seen=new Map();
  let duplicates=0, degenerate=0, coplanar=0;
  for (let i=0; i<count; i++) {
    const verts=[0,1,2].map(j=>new Vector3().fromBufferAttribute(pos,idx?idx.getX(i*3+j):i*3+j));
    const normal=verts[1].clone().sub(verts[0]).cross(verts[2].clone().sub(verts[0])), len=normal.length();
    const key=verts.map(v=>v.toArray().join(',')).sort().join('|');
    if (seen.has(key)) duplicates++; else seen.set(key,i);
    if (len<1e-10) degenerate++;
    triangles.push({verts,normal:normal.normalize(),len});
  }
  for (let i=0; i<triangles.length; i++) for (let j=i+1; j<triangles.length; j++) {
    const a=triangles[i], b=triangles[j];
    if (a.len<1e-10||b.len<1e-10||Math.abs(a.normal.dot(b.normal))<1-1e-10||Math.abs(b.verts[0].clone().sub(a.verts[0]).dot(a.normal))>1e-7) continue;
    if (overlapArea(a.verts,b.verts,a.normal)>1e-10) coplanar++;
  }
  return { triangles:count, exactDuplicateTriangles:duplicates, degenerateTriangles:degenerate, coplanarPositiveAreaPairs:coplanar };
}
function rayScan(torso, grid) {
  const ray=new Raycaster(), direction=new Vector3(0,0,-1), point=new Vector3(), near=[]; let hits=0;
  for(let yi=0;yi<grid.n;yi++) for(let xi=0;xi<grid.n;xi++) {
    const x=grid.x0+(xi+.37)*grid.width/grid.n, y=grid.y0+(yi+.41)*grid.height/grid.n;
    ray.set(point.set(x,y,2),direction); const intersections=ray.intersectObject(torso,false);
    if(intersections.length) hits++;
    for(let i=1;i<intersections.length;i++) {
      const gap=intersections[i].distance-intersections[i-1].distance;
      if(gap<.001) near.push({x,y,gapMetres:gap,faces:[intersections[i-1].faceIndex,intersections[i].faceIndex]});
    }
  }
  return {grid, samples:grid.n**2, hitSamples:hits, nearPairsBelow1mm:near};
}
function beltIntersection(torso) {
  const ray=new Raycaster(), direction=new Vector3(0,0,-1), x=.1437130434782609;
  function sample(y) {
    ray.set(new Vector3(x,y,2),direction); const hits=ray.intersectObject(torso,false);
    const belt=hits.find(h=>h.faceIndex===195), strap=hits.find(h=>h.faceIndex===285);
    assert(belt&&strap); return belt.distance-strap.distance;
  }
  let lo=.8353695652173914, hi=.8505869565217392, delta=sample(lo);
  assert(delta*sample(hi)<0);
  for(let i=0;i<30;i++) { const mid=(lo+hi)/2, v=sample(mid); if(Math.sign(v)===Math.sign(delta)){lo=mid;delta=v;}else hi=mid; }
  const y=(lo+hi)/2;
  return {x,y,faces:[195,285],signedDepthDifferenceMetres:sample(y),interpretation:'Belt and hanging-strap faces cross along this static front ray.'};
}
const report={description:'Read-only CPU scan of approved V4 GLBs; no GPU or renderer.',coplanarCriteria:'Parallel normal dot magnitude >= 1-1e-10, plane separation <= 1e-7 local units, projected overlap area > 1e-10 local square units.',limits:['Static neutral pose only.','Raycaster uses the material front side and samples parallel front rays only.','Mesh triangle pairs are compared within each named surface, not across different meshes.','The sampled intersection does not establish the cause of dots elsewhere on cloth.'],models:{}};
for(const id of ['lukas','nic','dan','ksu']) {
  const bytes=await readFile(join(client,'public/assets/models/avatars',id+'.glb'));
  const sha256=createHash('sha256').update(bytes).digest('hex'), approved=approval.records.find(r=>r.id===id);
  assert.equal(sha256,approved.sha256); assert.equal(bytes.length,approved.bytes);
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''); gltf.scene.updateMatrixWorld(true);
  const torso=gltf.scene.getObjectByName('torso-surface'), meshes={};
  for(const name of ['torso-surface','shoulder-left-surface','shoulder-right-surface']) meshes[name]=meshScan(gltf.scene.getObjectByName(name));
  const m=torso.material;
  report.models[id]={sha256,bytes:bytes.length,meshes,wideGrid:rayScan(torso,{n:51,x0:-.32,width:.64,y0:.45,height:.75}),beltGrid:rayScan(torso,{n:23,x0:-.21,width:.42,y0:.54,height:.35}),material:{type:m.type,opacity:m.opacity,transparent:m.transparent,map:!!m.map,roughness:m.roughness,metalness:m.metalness,side:m.side},...(id==='lukas'?{beltIntersection:beltIntersection(torso)}:{})};
}
await writeFile(join(here,'cloth-mesh-v4-scan.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
