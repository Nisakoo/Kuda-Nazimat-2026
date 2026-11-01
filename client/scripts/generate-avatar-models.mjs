/**
 * TASK-043: original, reproducible avatar sculpture. No imported art or textures.
 * Metres, +Y up, +Z face forward, origin on the ground between the feet.
 * Public builder: createAvatarModel(id) -> { root, animations }. It is browser-safe.
 * CLI: node scripts/generate-avatar-models.mjs [--portraits]
 * Export uses the market generator's matte vertex-colour batching convention.
 * Portraits are optional offline Chromium renders of the exported GLBs, not drawings.
 */
import {
  AnimationClip, Box3, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute,
  Group, Mesh, MeshStandardMaterial, Quaternion, QuaternionKeyframeTrack,
  SphereGeometry, Vector3, VectorKeyframeTrack,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export const AVATAR_IDS = Object.freeze(['lukas', 'nic', 'dan', 'ksu']);
export const AVATAR_PROFILE = Object.freeze({ height: 1.8, width: .96, depth: .56, forward: '+Z', up: '+Y', units: 'metres', walkCycleMetres: 1.2 });
const APPEARANCES = {
  lukas: { tunic: '#367e87', belt: '#bd852e', hair: '#b88036', lock: '#cf994b', glasses: '#292c29', frame: .0085, style: 'swept' },
  nic: { tunic: '#75764b', belt: '#b9603c', hair: '#80532d', lock: '#986736', glasses: '#aaa99b', frame: .0036, style: 'short' },
  dan: { tunic: '#b75233', belt: '#3e7f80', hair: '#3e2b20', lock: '#533b2a', glasses: '#c4c0aa', frame: .0036, style: 'tousled' },
  ksu: { tunic: '#829cbf', belt: '#bb8538', hair: '#39281f', lock: '#4d352a', style: 'long' },
};
const SKIN = '#f1b077', SKIN_SHADE = '#e3a06c', CREAM = '#f5dfb4', PANTS = '#ead4ab', BOOT = '#71472e', SOLE = '#503723', INK = '#2f251d';
const MAT = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });

function group(parent, name, x = 0, y = 0, z = 0) {
  const result = new Group(); result.name = name; result.position.set(x, y, z); parent.add(result); return result;
}
function mesh(parent, geometry, tint, name = '', smooth = false) {
  // Face colours provide controlled facets without random geometry or normal noise.
  if (smooth) geometry.computeVertexNormals();
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv'); if (!smooth) g.computeVertexNormals();
  const base = new Color(tint), colors = [];
  for (let i = 0; i < g.attributes.position.count; i += 3) {
    const shade = 1 + ((((i / 3) * 17 + 11) % 13) - 6) * .006;
    for (let j = 0; j < 3; j++) colors.push(base.r * shade, base.g * shade, base.b * shade);
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const result = new Mesh(g, MAT); result.name = name; parent.add(result); return result;
}
function orb(parent, tint, x, y, z, rx, ry, rz, segments = 12, rows = 6) {
  const g = new SphereGeometry(1, segments, rows); g.scale(rx, ry, rz); g.translate(x, y, z); return mesh(parent, g, tint);
}
/** Closed elliptical loft. Ring entries: [y, halfWidth, halfDepth, xOffset?, zOffset?]. */
function loft(parent, tint, rings, segments = 12, flatFace = false, smooth = false) {
  const vertices = [], indices = [];
  for (const [y, rx, rz, x = 0, z = 0] of rings) {
    for (let i = 0; i < segments; i++) {
      const angle = i * Math.PI * 2 / segments;
      vertices.push(x + Math.sin(angle) * rx, y, z + (flatFace ? Math.min(.91, Math.cos(angle)) : Math.cos(angle)) * rz);
    }
  }
  for (let row = 0; row < rings.length - 1; row++) for (let i = 0; i < segments; i++) {
    const a = row * segments + i, b = row * segments + (i + 1) % segments, c = b + segments, d = a + segments;
    if ((row + i) % 2) indices.push(a, b, d, b, c, d); else indices.push(a, b, c, a, c, d);
  }
  // The cross section winds clockwise when viewed from above.
  for (const [row, top] of [[0, false], [rings.length - 1, true]]) {
    const [y, , , x = 0, z = 0] = rings[row], middle = vertices.length / 3; vertices.push(x, y, z);
    for (let i = 0; i < segments; i++) {
      const a = row * segments + i, b = row * segments + (i + 1) % segments;
      if (top) indices.push(middle, a, b); else indices.push(middle, b, a);
    }
  }
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(vertices, 3)); g.setIndex(indices); return mesh(parent, g, tint, '', smooth);
}
function polygon(parent, tint, points, faces) {
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(points.flat(), 3)); g.setIndex(faces); return mesh(parent, g, tint);
}
function frontSurface(parent, tint, points, faces) {
  const indices=[...faces];
  for(let i=0;i<indices.length;i+=3){
    const a=points[indices[i]],b=points[indices[i+1]],c=points[indices[i+2]];
    if((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])<0)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
  }
  return polygon(parent,tint,points,indices);
}
function rod(parent, tint, a, b, radius, sides = 6) {
  const av = new Vector3(...a), bv = new Vector3(...b), delta = bv.clone().sub(av);
  const g = new CylinderGeometry(radius, radius, delta.length(), sides);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize()));
  g.translate(...av.add(bv).multiplyScalar(.5).toArray()); return mesh(parent, g, tint);
}
function stroke(parent, tint, points, radius) {
  for (let i = 1; i < points.length; i++) rod(parent, tint, points[i - 1], points[i], radius);
  for (const p of points.slice(1, -1)) orb(parent, tint, ...p, radius, radius, radius, 6, 3);
}
/** A sculpted, closed tapered lock, not a cone pasted on a generic sphere. */
function lock(parent, tint, points, widths, depths) {
  if (parent.name === 'hair') {
    // Add gently bowed intermediate sections while retaining the original ends.
    const curve = [], wide = [], deep = [];
    for (let i=0;i<points.length-1;i++) {
      curve.push(points[i]); wide.push(widths[i]); deep.push(depths[i]);
      const a=points[i], b=points[i+1];
      curve.push([(a[0]+b[0])*.5, (a[1]+b[1])*.5, (a[2]+b[2])*.5+.006]);
      wide.push((widths[i]+widths[i+1])*.5); deep.push((depths[i]+depths[i+1])*.5);
    }
    curve.push(points.at(-1)); wide.push(widths.at(-1)); deep.push(depths.at(-1));
    points=curve; widths=wide; depths=deep;
  }
  const p = [], idx = [], sides = 6;
  for (let j = 0; j < points.length; j++) {
    const previous = points[Math.max(0, j - 1)], next = points[Math.min(points.length - 1, j + 1)];
    const tangent = new Vector3(next[0] - previous[0], next[1] - previous[1], 0).normalize();
    const normal = new Vector3(-tangent.y, tangent.x, 0);
    for (let k = 0; k < sides; k++) {
      const a = k * Math.PI * 2 / sides;
      p.push(points[j][0] + normal.x * widths[j] * Math.cos(a), points[j][1] + normal.y * widths[j] * Math.cos(a), points[j][2] + depths[j] * Math.sin(a));
    }
  }
  for (let j = 0; j < points.length - 1; j++) for (let k = 0; k < sides; k++) {
    const a = j * sides + k, b = j * sides + (k + 1) % sides;
    idx.push(a, b, b + sides, a, b + sides, a + sides);
  }
  for (let k = 1; k < sides - 1; k++) idx.push(0, k, k + 1);
  const end = (points.length - 1) * sides;
  for (let k = 1; k < sides - 1; k++) idx.push(end, end + k + 1, end + k);
  // Winding follows the section basis; invert it for outward normals.
  for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
  return polygon(parent, tint, Array.from({ length: p.length / 3 }, (_, i) => p.slice(i * 3, i * 3 + 3)), idx);
}
function hair(parent, look) {
  const long = look.style === 'long', points = [], faces = [], n = 20, rows = 5;
  // The hairline follows the forehead, temples and nape, not a horizontal helmet edge.
  for (let row = 0; row <= rows; row++) for (let i = 0; i < n; i++) {
    const a = i * Math.PI * 2 / n, front = Math.cos(a), t = row / rows;
    const bottom = front > 0 ? -.035 + .23 * front ** 2 : long ? -.36 : -.19;
    const y = bottom + (.34 - bottom) * t;
    const envelope=[[-.40,.284,.253],[-.19,.267,.238],[-.04,.291,.263],[.10,.290,.263],[.22,.259,.234],[.30,.181,.165],[.35,.075,.066]];
    let j=1;while(j<envelope.length-1&&y>envelope[j][0])j++;
    const low=envelope[j-1],high=envelope[j],blend=Math.max(0,Math.min(1,(y-low[0])/(high[0]-low[0])));
    const rx=low[1]+(high[1]-low[1])*blend,rz=low[2]+(high[2]-low[2])*blend;
    points.push([Math.sin(a) * rx, y, Math.cos(a) * rz - .012]);
  }
  for (let row = 0; row < rows; row++) for (let i = 0; i < n; i++) {
    const a = row * n + i, b = row * n + (i + 1) % n;
    faces.push(a, b, b + n, a, b + n, a + n);
  }
  points.push([0, .355, -.012]);
  for (let i = 0; i < n; i++) faces.push(rows * n + i, rows * n + (i + 1) % n, points.length - 1);
  polygon(parent, look.hair, points, faces);
  if (long) {
    // Full rear curtain plus individually tapered shoulder-length locks.
    for (let i = 0; i < 7; i++) {
      const a = .98 + i * (Math.PI * 2 - 1.96) / 6, x = Math.sin(a), z = Math.cos(a);
      const drift = [-.042,.028,-.016,.038,-.026,.045,-.034][i], length = [.02,.075,.035,.095,.015,.065,.04][i];
      lock(parent, i % 3 ? look.hair : look.lock,
        [[x * .22, .19, z * .215 - .015], [x * .285 + drift * .4, -.055, z * .25 - .015], [x * .32 + drift, -.27 + length * .2, z * .245], [x * .31 + drift * 1.4, -.45 + length, z * .23]],
        [.075, .10, .075, .009], [.04, .042, .032, .006]);
    }
    for (const side of [-1, 1]) {
      lock(parent, look.lock, [[side * .015, .30, .09], [side * .15, .24, .22], [side * .23, .045, .235], [side * .28, -.10, .17]], [.05, .068, .054, .001], [.04, .038, .026, .001]);
      lock(parent, look.hair, [[side * .22, .09, .16], [side * .26, -.10, .185], [side * .23, -.28, .19], [side * .17, -.37, .17]], [.05, .043, .035, .001], [.035, .03, .026, .001]);
    }
  } else {
    // Distinct front silhouette and parting for each of the three short hairstyles.
    const ends = look.style === 'swept'
      ? [[-.29,.10,.13],[-.30,.23,.10],[-.18,.32,.10],[-.10,.39,.02],[.07,.38,.02],[.24,.29,.12],[.31,.17,.12],[.27,.01,.15],[-.23,-.045,.15]]
      : look.style === 'short'
        ? [[-.27,.06,.15],[-.24,.18,.19],[-.18,.10,.235],[-.10,.13,.245],[-.025,.16,.25],[.065,.12,.245],[.15,.17,.23],[.255,.07,.16],[.23,-.035,.13]]
        : [[-.30,.11,.14],[-.26,.23,.12],[-.17,.29,.15],[-.07,.34,.11],[.10,.36,.04],[.245,.29,.08],[.29,.17,.12],[.20,.10,.23],[-.22,.015,.20]];
    for (let i = 0; i < ends.length; i++) {
      const originalEnd = ends[i], end = [Math.max(-.275, Math.min(.275, originalEnd[0])), originalEnd[1], originalEnd[2]], startX = look.style === 'short' ? .015 : .055;
      const start = [startX + (i - 4) * .015, .255, .11];
      const mid = [(start[0] + end[0]) * .58, Math.max(.22, (start[1] + end[1]) * .6), .20];
      const inner = look.style === 'short' ? i >= 2 && i <= 6 : i === 1 || i === 7 || i === 8;
      lock(parent, i % 3 ? look.lock : look.hair, [start, mid, end], inner ? [.039, .056, .0015] : [.045, .069, .0015], inner ? [.03, .039, .0015] : [.035, .047, .0015]);
    }
    // Layered rear locks break up the scalp and make the hairstyle readable from the game camera.
    for(let row=0;row<2;row++)for(let i=-2;i<=2;i++){
      const x=i*.081,sweep=look.style==='short'?.018:look.style==='swept'?.047:-.025;
      lock(parent,(i+row)%3?look.hair:look.lock,
        [[x*.65,.265-row*.115,-.15-row*.075],[x+sweep,.17-row*.13,-.235],[x+sweep*.8,.035-row*.13,-.275],[x-sweep*.3,-.075-row*.12,-.241]],
        [.038,.051,.043,.001],[.027,.036,.029,.001]);
    }
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
      lock(parent, i % 2 ? look.lock : look.hair,
        [[side * .20, .19 - i * .075, -.04], [side * .28, .09 - i * .065, -.045], [side * (.26 - i * .012), -.055 - i * .055, -.02]],
        [.055, .05, .001], [.052, .04, .001]);
    }
  }
}
function face(parent, look) {
  const ksu = look.style === 'long';
  for (const side of [-1, 1]) {
    orb(parent, SKIN, side * .263, -.045, -.005, .057, .083, .045, 10, 5);
    orb(parent, SKIN_SHADE, side * .291, -.046, .027, .022, .044, .009, 8, 4);
    orb(parent, INK, side * .101 + (ksu ? .005 : 0), .014, ksu ? .222 : .213, ksu ? .028 : .027, .046, .010);
    stroke(parent, look.hair, [[side * .065, .105, .212], [side * .108, .119, .212], [side * .151, .105, .202]], ksu ? .006 : .009);
    if (ksu) stroke(parent, INK, [[side * .065,.055,.223],[side * .083,.073,.222],[side * .113,.075,.220],[side * .14,.056,.216]], .0045);
  }
  polygon(parent, SKIN_SHADE, [[-.025,-.063,.211],[.025,-.063,.211],[0,.005,.214],[0,-.045,.266],[0,-.079,.23]], [0,3,2,2,3,1,0,4,3,3,4,1]);
  const smile = Array.from({ length: 9 }, (_, i) => { const x = -.068 + i * .017; return [x, -.139 + .023 * (x / .068) ** 2, .198 - .005 * (x / .068) ** 2]; });
  stroke(parent, '#9b512f', smile, .0032);
  if (!look.glasses) return;
  for (const side of [-1, 1]) {
    const cx = side * .104, cy = .018, w = .087, h = .061;
    const contour = look.style === 'short'
      ? [[-.065,-h],[.055,-h],[w,-.034],[w,.036],[.054,h],[-.055,h],[-w,.035],[-w,-.03]]
      : [[-.062,-h],[.063,-h],[w,-.041],[w,.047],[.070,h],[-.072,h],[-w,.044],[-w,-.043]];
    const path = contour.map(([x,y]) => [cx + x, cy + y, .237 - Math.abs(cx+x) * .035]); path.push(path[0]);
    stroke(parent, look.glasses, path, look.frame);
    stroke(parent, look.glasses, [[side * .185,.047,.229],[side * .258,.037,.11],[side * .26,.005,.04]], look.frame * .7);
  }
  stroke(parent, look.glasses, [[-.019,.042,.239],[0,.051,.245],[.019,.042,.239]], look.frame * .8);
}
function tunic(parent, look) {
  // Continuous closed torso and skirt: internal leg overlaps remain hidden.
  loft(parent, look.tunic, [[-.42,.305,.290],[-.23,.265,.220],[0,.205,.137],[.18,.23,.145],[.31,.242,.13],[.35,.165,.092]], 16);
  loft(parent, look.belt, [[-.027,.222,.157],[.028,.219,.153]], 16);
  // Collar sits above the shirt. The skin inset makes the pale V read as a cut neckline.
  frontSurface(parent, CREAM,
    [[-.12,.342,.079],[-.072,.352,.105],[-.035,.315,.151],[0,.29,.152],[.035,.315,.151],[.072,.352,.105],[.12,.342,.079],[.099,.319,.139],[.045,.292,.151],[.012,.25,.154],[-.012,.25,.154],[-.045,.292,.151],[-.099,.319,.139]],
    [0,1,12,1,2,12,2,11,12,2,3,11,3,10,11,3,9,10,3,8,9,3,4,8,4,7,8,4,5,7,5,6,7]);
  frontSurface(parent, SKIN, [[-.058,.349,.107],[.058,.349,.107],[.026,.312,.154],[0,.282,.155],[-.026,.312,.154]], [0,4,1,1,4,2,4,3,2]);
  // Folded hanging strap, with thickness and a darker side edge.
  const x = .153;
  loft(parent, look.belt, [[-.253,.034,.011,x+.018,.202],[-.08,.032,.012,x,.14],[.026,.027,.012,x-.012,.122]], 4);
  if (look.style === 'long') {
    lock(parent, look.belt, [[.12,.022,.167],[.17,.015,.199],[.21,-.034,.204]], [.018,.038,.018], [.012,.018,.01]);
    lock(parent, look.belt, [[.12,.023,.175],[.087,-.012,.201],[.069,-.055,.202]], [.018,.034,.016], [.012,.018,.01]);
    orb(parent, '#a87530', .125, .014, .193, .024, .023, .018, 8, 4);
    loft(parent, look.belt, [[-.307,.032,.011,.21,.225],[-.12,.026,.013,.161,.203],[.022,.018,.011,.131,.173]], 4);
  }
}
function batch(parent) {
  for (const child of [...parent.children]) if (child.isGroup) batch(child);
  const pieces = [];
  for (const child of [...parent.children]) if (child.isMesh) {
    child.updateMatrix(); const g = child.geometry.clone(); g.applyMatrix4(child.matrix); pieces.push(g); parent.remove(child); child.geometry.dispose();
  }
  if (!pieces.length) return;
  const joined = mergeGeometries(pieces), geometry = mergeVertices(joined);
  const surface = new Mesh(geometry, MAT); surface.name = parent.name + '-surface'; parent.add(surface);
  joined.dispose(); for (const g of pieces) g.dispose();
}
function qTrack(name, times, rotations) {
  const q = new Quaternion();
  return new QuaternionKeyframeTrack(name + '.quaternion', times, rotations.flatMap(([x=0,y=0,z=0]) => {
    // Euler XYZ, expressed directly to keep the builder's imports small.
    const a=Math.cos(x/2),b=Math.sin(x/2),c=Math.cos(y/2),d=Math.sin(y/2),e=Math.cos(z/2),f=Math.sin(z/2);
    q.set(b*c*e+a*d*f,a*d*e-b*c*f,a*c*f+b*d*e,a*c*e-b*d*f); return q.toArray();
  }));
}
function animations() {
  const idleSamples=Array.from({length:33},(_,i)=>i/32),idleTimes=idleSamples.map(t=>t*4);
  // Dense keys keep the analytic contact trajectory accurate between GLTF samples.
  const times=Array.from({length:257},(_,i)=>i/256),walkTimes=times.map(t=>t*.9);
  const idleWave=idleSamples.map(t=>Math.sin(t*Math.PI*2)),wave=times.map(t=>Math.sin(t*Math.PI*2));
  const idle=[qTrack('head',idleTimes,idleWave.map(s=>[0,s*.018,0])),
    new VectorKeyframeTrack('torso.scale',idleTimes,idleWave.flatMap(s=>[1+s*.002,1+s*.003,1+s*.002]))];
  const contact=times.map(t=>{
    const z=.3-1.2*(t%.5),down=Math.sqrt(.6199**2-z*z);
    return {down,offset:.16+down-.78};
  });
  // A slight counter-lean and restrained sway keep the fixed tunic clear of the knees.
  const walk=[qTrack('torso',walkTimes,wave.map(s=>[-.025,s*.018,s*.005])),qTrack('head',walkTimes,wave.map(s=>[.025,-s*.015,-s*.003])),
    new VectorKeyframeTrack('torso.position',walkTimes,contact.flatMap(p=>[0,.95+p.offset,0]))];
  for(const side of [-1,1]){
    const suffix=side<0?'left':'right';
    idle.push(qTrack('shoulder-'+suffix,idleTimes,idleWave.map(s=>[-.055+s*.012,0,side*(.19+s*.009)])));
    idle.push(qTrack('elbow-'+suffix,idleTimes,idleWave.map(s=>[-.07+s*.01,0,0])));
    walk.push(qTrack('shoulder-'+suffix,walkTimes,wave.map(s=>[s*side*.32,0,side*.19])));
    walk.push(qTrack('elbow-'+suffix,walkTimes,wave.map(s=>[-.13-Math.max(0,-s*side)*.16,0,0])));
    walk.push(new VectorKeyframeTrack('hip-'+suffix+'.position',walkTimes,contact.flatMap(p=>[side*.126,.78+p.offset,0])));
    const poses=times.map((t,i)=>{
      const phase=(t+(side<0?0:.5))%1;
      const z=phase<.5?.3-1.2*phase:-.3+1.2*(phase-.5);
      // A low, relaxed swing preserves clearance inside the unchanged knee-length tunic.
      const lift=phase<.5?0:.02*Math.sin((phase-.5)*Math.PI*2);
      const down=contact[i].down-lift,d=Math.hypot(down,z);
      const hip=Math.atan2(-z,down)-Math.acos(Math.max(-1,Math.min(1,(.32**2+d*d-.30**2)/(2*.32*d))));
      const knee=Math.PI-Math.acos(Math.max(-1,Math.min(1,(.32**2+.30**2-d*d)/(2*.32*.30))));
      return [hip,knee,-hip-knee];
    });
    for(const[j,joint]of['hip','knee','ankle'].entries())walk.push(qTrack(joint+'-'+suffix,walkTimes,poses.map(p=>[p[j],0,0])));
  }
  return [new AnimationClip('idle',4,idle),new AnimationClip('walk',.9,walk)];
}

export function createAvatarModel(id) {
  if (!AVATAR_IDS.includes(id)) throw new RangeError('Unknown avatar: '+id);
  const look=APPEARANCES[id], root=new Group(); root.name='avatar';
  root.userData={avatarId:id,origin:'ground between feet',units:'metres',forward:'+Z',author:'Original TASK-043 procedural sculpture; no third-party art',walkCycleMetres:1.2};
  const torso=group(root,'torso',0,.95,0); tunic(torso,look);
  const neck=group(torso,'neck',0,.365,0); loft(neck,SKIN,[[-.015,.076,.07],[.105,.073,.071]],12);
  const head=group(torso,'head',0,.67,0); head.scale.x=.84;
  loft(head,SKIN,[[-.279,.045,.085],[-.25,.125,.155],[-.17,.181,.203],[-.10,.215,.223],[-.04,.237,.233],[.10,.240,.232],[.17,.226,.217],[.22,.210,.198],[.28,.12,.12],[.29,.045,.045]],24,true,true);
  const facial=group(head,'face'); facial.scale.x=.94; face(facial,look);
  const coiffure=group(head,'hair'); root.updateMatrixWorld(true); hair(coiffure,look);
  for (const side of [-1,1]) {
    const suffix=side<0?'left':'right';
    const shoulder=group(torso,'shoulder-'+suffix,side*.235,.305,0); shoulder.rotation.z=side*.19; shoulder.rotation.x=-.055;
    loft(shoulder,look.tunic,[[-.155,.087,.092],[-.13,.088,.094],[-.035,.087,.095],[.035,.068,.078],[.065,.025,.03]],10);
    loft(shoulder,look.style==='long'?CREAM:new Color(look.tunic).multiplyScalar(.97),[[-.161,.090,.095],[-.125,.089,.096]],10);
    const elbow=group(shoulder,'elbow-'+suffix,0,-.215,0); elbow.rotation.x=-.07;
    loft(elbow,SKIN,[[-.188,.050,.052],[-.13,.054,.055],[-.045,.064,.061],[.015,.064,.061],[.11,.06,.058]],10);
    const wrist=group(elbow,'wrist-'+suffix,0,-.195,0);
    // Narrow the palm and raise its bottom, so the fingers extend below it.
    // Its top and outside edge still contribute to the shared real bounds.
    orb(wrist,SKIN,side*.016412675,-.0335,.008,.047,.0715,.042,10,5);
    const thumb=orb(wrist,SKIN,-side*.040,-.026,.038,.018,.038,.022,8,4); thumb.geometry.rotateZ(-side*.24);
    for(let finger=0;finger<4;finger++)orb(wrist,SKIN,side*(-.027+finger*.018),finger===1||finger===2?-.09799999:-.094,.014,.011,.030,.012,8,4);
    const hip=group(root,'hip-'+suffix,side*.126,.78,0);
    loft(hip,PANTS,[[-.32,.100,.087],[-.25,.100,.085],[-.09,.088,.085],[.01,.075,.08]],10);
    const knee=group(hip,'knee-'+suffix,0,-.32,0);
    orb(knee,PANTS,0,-.002,0,.095,.06,.095,10,5);
    loft(knee,PANTS,[[-.19,.074,.077],[-.16,.106,.112],[-.05,.117,.11],[.025,.09,.09]],10);
    loft(knee,CREAM,[[-.20,.076,.08],[-.175,.082,.085]],10);
    loft(knee,SKIN,[[-.295,.051,.056],[-.195,.058,.061]],10);
    const ankle=group(knee,'ankle-'+suffix,0,-.30,0);
    loft(ankle,BOOT,[[-.13,.09,.145,0,.046],[-.09,.086,.145,0,.049],[-.045,.071,.12,0,.03],[.018,.065,.072,0,-.005]],10);
    loft(ankle,SOLE,[[-.16,.091,.15,0,.048],[-.132,.094,.153,0,.048]],10);
    loft(ankle,'#63412d',[[-.029,.071,.078],[.027,.074,.077]],10);
  }
  batch(root); root.updateMatrixWorld(true);
  // Real surface bounds are identical. No invisible bounding mesh or collision change.
  const bounds=new Box3().setFromObject(root), size=bounds.getSize(new Vector3());
  root.scale.set(AVATAR_PROFILE.width/size.x,AVATAR_PROFILE.height/size.y,AVATAR_PROFILE.depth/size.z);
  root.updateMatrixWorld(true);
  return {root,animations:animations()};
}

export async function generateAvatarModels(output = new URL('../public/assets/models/avatars/',import.meta.url)) {
  const {mkdir,readFile,writeFile}=await import('node:fs/promises');
  globalThis.FileReader ??= class {readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});}};
  await mkdir(output,{recursive:true}); const reports=[];
  for(const id of AVATAR_IDS){
    const {root,animations}=createAvatarModel(id);
    const bytes=Buffer.from(await new GLTFExporter().parseAsync(root,{binary:true,animations}));
    const path=new URL(id+'.glb',output),old=await readFile(path).catch(()=>null);
    if(!old?.equals(bytes))await writeFile(path,bytes);
    let triangles=0,drawCalls=0;root.traverse(node=>{if(node.isMesh){triangles+=(node.geometry.index?.count??node.geometry.attributes.position.count)/3;drawCalls++;}});
    const b=new Box3().setFromObject(root);
    reports.push({id,path:'/assets/models/avatars/'+id+'.glb',bytes:bytes.length,triangles,drawCalls,bounds:{min:b.min.toArray(),max:b.max.toArray()},clips:animations.map(c=>({name:c.name,duration:c.duration})),portrait:'/assets/models/avatars/'+id+'-portrait.png'});
  }
  await writeFile(new URL('models.json',output),JSON.stringify({generator:'client/scripts/generate-avatar-models.mjs',profile:AVATAR_PROFILE,models:reports},null,2)+'\n');
  return reports;
}

/** Optional build-time portrait export. All module, GLB and font requests stay local. */
export async function generateAvatarPortraits(output = new URL('../public/assets/models/avatars/',import.meta.url)) {
  const {chromium}=await import('@playwright/test'),{createServer}=await import('node:http'),{readFile,writeFile}=await import('node:fs/promises');
  const {fileURLToPath}=await import('node:url'),{resolve,sep}=await import('node:path');
  const client=resolve(fileURLToPath(new URL('../',import.meta.url)));
  const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:transparent}canvas{display:block}</style><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script></head><body><script type="module">
import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const r=new T.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});r.setSize(512,512);r.setPixelRatio(1);r.outputColorSpace=T.SRGBColorSpace;r.toneMapping=T.ACESFilmicToneMapping;r.toneMappingExposure=1.05;document.body.append(r.domElement);
const s=new T.Scene(),c=new T.PerspectiveCamera(28,1,.01,20);c.position.set(.22,1.50,2.18);c.lookAt(0,1.39,0);
s.add(new T.HemisphereLight('#fff1d8','#9c9686',2));const l=new T.DirectionalLight('#fff1db',2.8);l.position.set(-3,5,5);s.add(l);const rim=new T.DirectionalLight('#dcecff',1);rim.position.set(3,2,-3);s.add(rim);let model;
window.renderAvatar=async id=>{if(model)s.remove(model);model=(await new GLTFLoader().loadAsync('/avatars/'+id+'.glb')).scene;model.rotation.y=-.12;s.add(model);r.render(s,c);return true};window.ready=true;
</script></body></html>`;
  const server=createServer(async(req,res)=>{try{
    if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
    const url=new URL(req.url,'http://localhost');
    const path=url.pathname.startsWith('/avatars/')?fileURLToPath(new URL(url.pathname.slice(9),output)):resolve(client,'.'+decodeURIComponent(url.pathname));
    const allowed=path.startsWith(client+sep)||path.startsWith(fileURLToPath(output));if(!allowed){res.writeHead(403);res.end();return;}
    res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.glb')?'model/gltf-binary':'application/octet-stream');res.end(await readFile(path));
  }catch{res.writeHead(404);res.end();}});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
  try{
    browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
    const page=await browser.newPage({viewport:{width:512,height:512},deviceScaleFactor:1});const errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>errors.push(r.url()));
    await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.ready,{},{timeout:60000}).catch(error=>{throw new Error(errors.join('\n')||error.message);});
    for(const id of AVATAR_IDS){await page.evaluate(id=>window.renderAvatar(id),id);await writeFile(new URL(id+'-portrait.png',output),await page.screenshot({omitBackground:true}));}
    if(errors.length)throw new Error(errors.join('\n'));
  }finally{await browser?.close();await new Promise(done=>server.close(done));}
}
if(typeof process!=='undefined'&&process.argv[1]&&new URL('file://'+process.argv[1]).href===import.meta.url){
  const reports=await generateAvatarModels();for(const r of reports)console.log(JSON.stringify(r));
  if(process.argv.includes('--portraits'))await generateAvatarPortraits();
}
