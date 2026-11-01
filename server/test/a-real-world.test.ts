import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadWorld } from '../src/world/loader.ts';
import { CITY_LOCATIONS, CITY_RESIDENTS, CITY_BOUNDS, CITY_OUTLINE, PASTURE_GOATS, PASTURE_ORIGIN, insideCity, cityBoundaryDistance } from '../../shared/city/catalogue.ts';
import { World } from '../src/game/World.ts';

const publicDir = fileURLToPath(new URL('../../client/public/', import.meta.url));
const generated = (name: string) => fileURLToPath(new URL(`../../client/src/shared/${name}.generated.ts`, import.meta.url));
const ready = existsSync(`${publicDir}maps/market/manifest.json`) && existsSync(generated('marketWorld'));
/** Bootstraps the client generator embedded for its local session. */
const embedded = (name: string, constant: string): unknown => {
  const source = readFileSync(generated(name), 'utf8');
  return JSON.parse(source.split(`export const ${constant} = `)[1]!.split(' as const;')[0]!);
};

// Requires `npm --prefix client run world:generate`; skipped (= unverified) otherwise.
describe.runIf(ready)('real client worlds (SERVER-WORLD S1, SERVER-DEMO-005)', () => {
  it('loads market/demo/science with server NPC content and matches the client bootstrap byte for byte', async () => {
    const world = await loadWorld({
      worldDir: publicDir,
      maps: { market: 'maps/market/manifest.json', demo: 'maps/demo/manifest.json', science: 'maps/demo/science.json' },
      contentDir: fileURLToPath(new URL('../content/', import.meta.url)),
    });
    expect(world.maps.get('market')!.bootstrap).toEqual(embedded('marketWorld', 'MARKET_WORLD'));
    expect(world.maps.get('demo')!.bootstrap).toEqual(embedded('demoWorld', 'DEMO_WORLD'));
    const market = world.maps.get('market')!;
    expect(market.isWalkable(market.spawn.x, market.spawn.z)).toBe(true);
    expect(world.npcs.filter((n) => n.mapId === 'market').map((n) => n.id).sort()).toEqual(CITY_RESIDENTS.map(n=>n.id).sort());
    expect(market.manifest.chunks).toHaveLength(16);
    for(const npc of CITY_RESIDENTS) expect(market.isSafeSupport(npc.x,npc.z), `NPC support ${npc.id}`).toBe(true);
    for(const npc of world.npcs.filter(n=>n.mapId==='market')) {
      const authored=CITY_RESIDENTS.find(n=>n.id===npc.id)!;
      expect(npc.position, npc.id).toMatchObject({x:authored.x,z:authored.z});
    }
    for(const location of CITY_LOCATIONS) expect(market.footprintChunkIds(location.x,location.z), location.id).not.toBeNull();
    for(const [x,z] of [[CITY_BOUNDS.minX,0],[CITY_BOUNDS.maxX,0],[0,CITY_BOUNDS.minZ],[0,CITY_BOUNDS.maxZ]]) expect(market.isWalkable(x!,z!)).toBe(false);
  });
  it('the compact city connects all residents and safely relocates saves from removed districts', async () => {
    const loaded = await loadWorld({ worldDir: publicDir, maps: { market: 'maps/market/manifest.json', demo: 'maps/demo/manifest.json', science: 'maps/demo/science.json' }, contentDir: fileURLToPath(new URL('../content/', import.meta.url)) });
    const map = loaded.maps.get('market')!;
    const queue = [{ x: map.spawn.x, y: map.spawn.y, z: map.spawn.z }];
    const visited = new Set([`${map.spawn.x},${map.spawn.z}`]);
    for (let i = 0; i < queue.length; i++) {
      const from = queue[i]!;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const to = { x: from.x + dx, y: 0, z: from.z + dz }, key = `${to.x},${to.z}`;
        if (visited.has(key)) continue;
        if (!map.canTraverse(from, to) || ![.25, .5, .75, 1].every(t => map.isSafeSupport(from.x + dx * t, from.z + dz * t))) continue;
        visited.add(key); to.y = map.heightAt(to.x, to.z); queue.push(to);
      }
    }
    for (const npc of [...CITY_RESIDENTS,...PASTURE_GOATS]) expect(queue.some(point => Math.hypot(point.x - npc.x, point.z - npc.z) < 1.3), `reachable ${npc.id}`).toBe(true);
    const world = new World(loaded.maps, []);
    for (const position of [{ x: 64, y: 0, z: 0 }, { x: 0, y: 0, z: -96 }, { x: 42, y: 0, z: 0 }, { x: 36, y: 0, z: 10 }]) {
      world.add({ id: 'returning-player', name: 'Returning', mapId: 'market', position, rotationY: 0 });
      expect(world.locate('returning-player')!.position).toEqual(map.spawn);
    }
  });
  it('the zigzag silhouette is authoritative, and the moved pasture shares its geometry and interaction positions', async () => {
    const loaded = await loadWorld({worldDir:publicDir,maps:{market:'maps/market/manifest.json',demo:'maps/demo/manifest.json',science:'maps/demo/science.json'},contentDir:fileURLToPath(new URL('../content/',import.meta.url))});
    const map=loaded.maps.get('market')!;
    expect(new Set(CITY_OUTLINE.map(p=>p[0])).size).toBeGreaterThan(10);
    let outside=0;
    for(let z=-79;z<48;z+=1)for(let x=-79;x<48;x+=1)if(!insideCity(x,z)){
      expect(map.isWalkable(x,z),`outside ${x},${z}`).toBe(false);outside++;
    }
    expect(outside).toBeGreaterThan(2000);
    for(let i=0;i<CITY_OUTLINE.length;i++){
      const a=CITY_OUTLINE[i]!,b=CITY_OUTLINE[(i+1)%CITY_OUTLINE.length]!,x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
      expect(map.isWalkable(x,z),`boundary segment ${i}`).toBe(false);
    }
    expect(cityBoundaryDistance(PASTURE_ORIGIN.x,PASTURE_ORIGIN.z)).toBeLessThan(15);
    const pasture=map.manifest.chunks.find(chunk=>chunk.x===0&&chunk.z===-2)!;
    const chunk=JSON.parse(readFileSync(publicDir+pasture.url,'utf8')) as {objects:{assetId:string;transform:{position:{x:number;z:number}}}[]};
    expect(chunk.objects.find(object=>object.assetId==='pasture')!.transform.position).toMatchObject(PASTURE_ORIGIN);
    for(const goat of PASTURE_GOATS)expect(map.isSafeSupport(goat.x,goat.z),goat.id).toBe(true);
    for(const entry of map.manifest.chunks){
      const data=JSON.parse(readFileSync(publicDir+entry.url,'utf8')) as {objects:{assetId:string;transform:{position:{x:number;z:number}}}[]};
      for(const object of data.objects.filter(object=>object.assetId.startsWith('city-'))){
        const bytes=readFileSync(publicDir+'assets/models/'+map.manifest.models[object.assetId]);
        const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString()) as {nodes:{extras?:{collisions?:number[][][]}}[]};
        for(const polygon of gltf.nodes.find(node=>node.extras?.collisions)?.extras?.collisions??[]){
          for(let i=0;i<polygon.length;i++)for(const t of [0,.25,.5,.75]){
            const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!;
            const x=object.transform.position.x+a[0]!+(b[0]!-a[0]!)*t,z=object.transform.position.z+a[1]!+(b[1]!-a[1]!)*t;
            expect(insideCity(x,z),object.assetId).toBe(true);
            expect(cityBoundaryDistance(x,z),`wall clearance ${object.assetId}`).toBeGreaterThan(1.15);
          }
        }
      }
    }
  });
  it('MOVE: prepared ceilings in all three real maps stop an otherwise reachable jump', async () => {
    const loaded = await loadWorld({ worldDir: publicDir, maps: { market: 'maps/market/manifest.json', demo: 'maps/demo/manifest.json', science: 'maps/demo/science.json' }, contentDir: fileURLToPath(new URL('../content/', import.meta.url)) });
    for (const map of loaded.maps.values()) {
      expect(map.manifest.chunks.every(chunk => (chunk.ceilingVolumes?.length ?? 0) <= 128)).toBe(true);
      const world = new World(loaded.maps, []);
      let tested = false;
      search: for (const chunk of map.manifest.chunks) for (const volume of chunk.ceilingVolumes ?? []) {
        for (let x = volume.minX; x <= volume.maxX; x += .25) for (let z = volume.minZ; z <= volume.maxZ; z += .25) {
          const y = map.heightAt(x, z);
          if (!map.isWalkable(x, z) || volume.bottomY < y + 1.85 || volume.bottomY >= y + 2.9) continue;
          if (map.ceilingsFor({ x, y, z }, { x, y, z }).some(v => x + .25 >= v.minX && x - .25 < v.maxX && z + .25 >= v.minZ && z - .25 < v.maxZ && y < v.topY && y + 1.8 > v.bottomY)) continue;
          world.add({ id: 'p', name: 'P', mapId: map.id, position: { x, y, z }, rotationY: 0 });
          expect(world.locate('p')!.position).toEqual({ x, y, z });
          let apex = y;
          world.setIntent('p', 1, { x: 0, z: 0 }, [chunk.id], 0, false, 1);
          for (let i = 1; i <= 30; i++) { world.step(.05, i * 50); apex = Math.max(apex, world.locate('p')!.position.y); }
          expect(apex, map.id).toBeGreaterThan(y);
          expect(apex + 1.8, map.id).toBeLessThanOrEqual(volume.bottomY + 1e-8);
          expect(world.aoi('p')[0]!.motion!.grounded, map.id).toBe(true);
          tested = true; break search;
        }
      }
      expect(tested, `reachable low ceiling: ${map.id}`).toBe(true);
    }
  });
  it('every city window fits the 128 MiB payload guard with four avatars and bounded audio', () => {
    const manifestBytes=readFileSync(`${publicDir}maps/market/manifest.json`);
    const manifest=JSON.parse(manifestBytes.toString()) as {chunks:{x:number;z:number;url:string;bytes:number;collisionUrl:string;collisionBytes:number;assets:string[]}[];models:Record<string,string>;assets:Record<string,{bytes:number;memory:number}>};
    const audio=JSON.parse(readFileSync(`${publicDir}assets/audio/manifest.json`,'utf8')) as {files:{frames:number;bytes:number}[]};
    const audioMemory=audio.files.reduce((sum,a)=>sum+a.frames*4,0)+8*(Math.max(...audio.files.map(a=>a.frames))*4+512)+audio.files.map(a=>a.bytes*2).sort((a,b)=>b-a).slice(0,2).reduce((a,b)=>a+b,0);
    for(const [path,size] of Object.entries(manifest.assets).filter(([path])=>path.includes('/city/'))){
      const bytes=readFileSync(publicDir+path),gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString()) as {buffers:{byteLength:number}[];images?:unknown[]};
      expect(gltf.images??[]).toHaveLength(0);
      // Encoded source + two copies of geometry (CPU/GPU), plus scene bookkeeping.
      expect(size.memory,path).toBeGreaterThanOrEqual(bytes.length+2*gltf.buffers.reduce((sum,b)=>sum+b.byteLength,0)+16384);
    }
    for(const centre of manifest.chunks){
      const window=manifest.chunks.filter(c=>Math.abs(c.x-centre.x)<=2&&Math.abs(c.z-centre.z)<=2);
      const ids=new Set([...window.flatMap(c=>c.assets),...Object.keys(manifest.models).filter(id=>id.startsWith('avatar-'))]);
      const resources=new Map<string,number>([["manifest",Math.max(131072,manifestBytes.length*16)]]);
      for(const chunk of window){resources.set(chunk.url,Math.max(131072,chunk.bytes*16));resources.set(chunk.collisionUrl,Math.max(131072,chunk.collisionBytes*3));}
      for(const id of ids){const path='assets/models/'+manifest.models[id];resources.set(path,manifest.assets[path]!.memory);}
      expect([...resources.values()].reduce((sum,memory)=>sum+memory,0)+audioMemory,`${centre.x},${centre.z}`).toBeLessThan(128*1024*1024);
    }
  });

});
