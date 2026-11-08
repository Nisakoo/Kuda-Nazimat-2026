/**
 * Original, reproducible avatar sculpture. No imported art or textures.
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
export const AVATAR_PROPORTIONS = Object.freeze({
  lukas: { height: 2.15, width: 1.04, depth: .56 },
  nic: { height: 1.8, width: .82, depth: .56 },
  dan: { height: 2, width: .82, depth: .56 },
  ksu: { height: 1.8, width: .82, depth: .56 },
});
const APPEARANCES = {
  lukas: { tunic: '#367e87', belt: '#bd852e', hair: '#bc873d', lock: '#c39148', glasses: '#292c29', frame: .0085, style: 'swept' },
  nic: { tunic: '#75764b', belt: '#b9603c', hair: '#805936', lock: '#89613b', glasses: '#aaa99b', frame: .0036, style: 'short' },
  dan: { tunic: '#b75233', belt: '#3e7f80', hair: '#403027', lock: '#48352a', glasses: '#c4c0aa', frame: .0036, style: 'tousled' },
  ksu: { tunic: '#829cbf', belt: '#bb8538', hair: '#3b2b23', lock: '#443128', style: 'long' },
};
const SKIN = '#f7bc93', SKIN_SHADE = '#eba47d', BLUSH = '#f29482', CREAM = '#f5dfb4', PANTS = '#ead4ab', BOOT = '#71472e', SOLE = '#503723', INK = '#33241b';
const MAT = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
/** Head surface in head-local metres: a soft ellipsoid with a tapered chin and a gently flattened face. */
const HEAD = { rx: .243, ry: .285, rz: .235, cy: .005 };
const headTaper = v => v < 0 ? 1 - .22 * v * v : 1;
const faceFlat = c => c < .7 ? c : c - (c - .7) ** 2 / .6;
function headZ(x, y) {
  const v = (y - HEAD.cy) / HEAD.ry, taper = headTaper(v), u = x / (HEAD.rx * taper);
  return HEAD.rz * taper * faceFlat(Math.sqrt(Math.max(0, 1 - u * u - v * v)));
}

function group(parent, name, x = 0, y = 0, z = 0) {
  const result = new Group(); result.name = name; result.position.set(x, y, z); parent.add(result); return result;
}
function mesh(parent, geometry, tint, name = '', smooth = false) {
  // Faceted parts get controlled face-colour variation; smooth skin keeps one even tone.
  if (smooth) {
    geometry.deleteAttribute('uv'); geometry.deleteAttribute('normal');
    geometry = mergeVertices(geometry); geometry.computeVertexNormals();
  }
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv'); if (!smooth) g.computeVertexNormals();
  const base = new Color(tint), colors = [];
  for (let i = 0; i < g.attributes.position.count; i += 3) {
    const shade = smooth ? 1 : 1 + ((((i / 3) * 17 + 11) % 13) - 6) * .006;
    for (let j = 0; j < 3; j++) colors.push(base.r * shade, base.g * shade, base.b * shade);
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const result = new Mesh(g, MAT); result.name = name; parent.add(result); return result;
}
function orb(parent, tint, x, y, z, rx, ry, rz, segments = 12, rows = 6, smooth = false) {
  const g = new SphereGeometry(1, segments, rows); g.scale(rx, ry, rz); g.translate(x, y, z); return mesh(parent, g, tint, '', smooth);
}
function headShell(parent) {
  const g = new SphereGeometry(1, 24, 14), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i), taper = headTaper(uy);
    p.setXYZ(i, ux * HEAD.rx * taper, HEAD.cy + uy * HEAD.ry, HEAD.rz * taper * (uz > 0 ? faceFlat(uz) : uz));
  }
  return mesh(parent, g, SKIN, '', true);
}
/** A flattened clump lying on the scalp: wide across the surface, thin along its outward normal. */
function tuft(parent, tint, points, widths, thickness, center = [0, .03, -.02]) {
  const sides = 6, p = [], idx = [], c = new Vector3(...center);
  const T = new Vector3(), N = new Vector3(), B = new Vector3(), P = new Vector3();
  for (let j = 0; j < points.length; j++) {
    const previous = points[Math.max(0, j - 1)], next = points[Math.min(points.length - 1, j + 1)];
    T.set(next[0] - previous[0], next[1] - previous[1], next[2] - previous[2]).normalize();
    P.set(...points[j]); N.copy(P).sub(c); N.addScaledVector(T, -N.dot(T)).normalize(); B.crossVectors(T, N);
    for (let k = 0; k < sides; k++) {
      const a = k * Math.PI * 2 / sides, w = widths[j] * Math.cos(a), t = thickness[j] * Math.sin(a);
      p.push([P.x + B.x * w + N.x * t, P.y + B.y * w + N.y * t, P.z + B.z * w + N.z * t]);
    }
  }
  for (let j = 0; j < points.length - 1; j++) for (let k = 0; k < sides; k++) {
    const a = j * sides + k, b = j * sides + (k + 1) % sides; idx.push(a, b, b + sides, a, b + sides, a + sides);
  }
  for (let k = 1; k < sides - 1; k++) idx.push(0, k + 1, k);
  const end = (points.length - 1) * sides;
  for (let k = 1; k < sides - 1; k++) idx.push(end, end + k, end + k + 1);
  // Orient every triangle away from its section centre, independent of path direction.
  const A = new Vector3(), Bv = new Vector3(), C = new Vector3(), M = new Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    A.set(...p[idx[i]]); Bv.set(...p[idx[i + 1]]); C.set(...p[idx[i + 2]]);
    M.set(0, 0, 0); for (let v = 0; v < 3; v++) M.add(new Vector3(...points[Math.floor(idx[i + v] / sides)])); M.multiplyScalar(1 / 3);
    const normal = Bv.clone().sub(A).cross(C.clone().sub(A)), centroid = A.add(Bv).add(C).multiplyScalar(1 / 3);
    if (normal.dot(centroid.sub(M)) < 0) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  }
  const result = polygon(parent, tint, p, idx); smoothNormals(result.geometry); result.userData.smooth = true; return result;
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
/** Shared-vertex normals for a non-indexed surface, keeping its vertex order and colours. */
function smoothNormals(g) {
  const shape = new BufferGeometry(); shape.setAttribute('position', g.attributes.position.clone());
  const merged = mergeVertices(shape); merged.computeVertexNormals();
  g.setAttribute('normal', merged.toNonIndexed().attributes.normal);
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
  const long = look.style === 'long', short = look.style === 'short';
  const points = [], faces = [], sectors = 32, rows = 9;
  // One connected scalp mass. The flow is sculpted into the surface rather
  // than stacked strips crossing the scalp and casting checkerboard shadows.
  for (let row=0; row<=rows; row++) for (let i=0; i<sectors; i++) {
    const angle=i*Math.PI*2/sectors, front=Math.cos(angle), t=row/rows;
    const hairline=front>0 ? -.065+.255*front**2 : -.205;
    const y=hairline+(.337-hairline)*t;
    const latitude=(y-.025)/.335;
    const radius=Math.sqrt(Math.max(.025,1-latitude*latitude));
    const flow=.023*Math.sin(angle*9+t*4.2)*(1-t)+.012*Math.sin(angle*5-t*3)*Math.sin(t*Math.PI);
    const x=Math.sin(angle)*(.294*radius+flow);
    const z=Math.cos(angle)*(.272*radius+flow)-.018;
    points.push([x,y,z]);
  }
  for(let row=0;row<rows;row++)for(let i=0;i<sectors;i++){
    const a=row*sectors+i,b=row*sectors+(i+1)%sectors;
    faces.push(a,b,b+sectors,a,b+sectors,a+sectors);
  }
  points.push([0,.351,-.018]);
  for(let i=0;i<sectors;i++)faces.push(rows*sectors+i,rows*sectors+(i+1)%sectors,points.length-1);
  // Fold the perimeter into the head, closing the silhouette at the nape.
  const inner=points.length;
  for(let i=0;i<sectors;i++){const p=points[i];points.push([p[0]*.88,p[1]+.025,p[2]*.88]);}
  for(let i=0;i<sectors;i++){const next=(i+1)%sectors;faces.push(i,inner+i,inner+next,i,inner+next,next);}
  polygon(parent,look.hair,points,faces);
  if(long){
    // Continuous shoulder-length curtain, with staggered rounded tips and
    // shallow flowing ridges; no disconnected triangular side/back blades.
    const p=[],f=[],n=28,levels=7;
    for(let row=0;row<=levels;row++)for(let i=0;i<=n;i++){
      const a=.91+i*(Math.PI*2-1.82)/n,t=row/levels;
      const tip=-.405+.028*Math.cos(a*5)+.012*Math.sin(a*9);
      const y=.19+(tip-.19)*t;
      const volume=.255+.055*Math.sin(t*Math.PI*.82);
      const ridge=.018*Math.cos(a*8+t*1.5)*Math.sin(t*Math.PI*.9);
      p.push([Math.sin(a)*(volume+ridge),y,Math.cos(a)*(volume*.90+ridge)-.01]);
    }
    for(let j=0;j<levels;j++)for(let i=0;i<n;i++){const a=j*(n+1)+i,b=a+1;f.push(a,b,b+n+1,a,b+n+1,a+n+1);}
    // Back faces use a real inner shell and closed edges, not DoubleSide.
    const offset=p.length;for(const v of [...p])p.push([v[0]*.90,v[1]+.008,v[2]*.90]);
    const outer=[...f];for(let i=0;i<outer.length;i+=3)f.push(outer[i]+offset,outer[i+2]+offset,outer[i+1]+offset);
    for(let j=0;j<levels;j++)for(const i of [0,n]){const a=j*(n+1)+i,b=a+n+1;if(i===0)f.push(a,b,b+offset,a,b+offset,a+offset);else f.push(b,a,a+offset,b,a+offset,b+offset);}
    for(let i=0;i<n;i++){const a=levels*(n+1)+i,b=a+1;f.push(a+offset,b+offset,b,a+offset,b,a);}
    for(let i=0;i<f.length;i+=3)[f[i+1],f[i+2]]=[f[i+2],f[i+1]];
    polygon(parent,look.hair,p,f);
    // Strands fan from the centre parting over the crown into the curtain.
    for(const side of [-1,1])for(let i=0;i<5;i++){
      const theta=side*(.62+i*.58);
      crownTuft(parent,[look.lock,look.hair,shine(look)][i%3],theta,.08,1.62,.012,.9);
    }
    for(const side of [-1,1]){
      lock(parent,look.lock,[[side*.018,.315,.10],[side*.13,.25,.20],[side*.222,.08,.165],[side*.25,-.17,.13]], [.04,.064,.05,.006],[.026,.03,.025,.008]);
      lock(parent,look.hair,[[side*.235,.10,.17],[side*.277,-.08,.187],[side*.26,-.27,.18],[side*.225,-.37,.14]],[.045,.052,.043,.013],[.026,.028,.023,.009]);
    }
  }else{
    const ends=short
      ? [[-.262,.05,.17],[-.20,.12,.239],[-.12,.14,.25],[-.025,.13,.258],[.08,.17,.25],[.18,.12,.23],[.255,.04,.17]]
      : look.style==='swept'
        ? [[-.269,.07,.17],[-.235,.18,.215],[-.15,.285,.20],[-.03,.38,.12],[.10,.355,.08],[.23,.22,.19],[.264,.04,.17]]
        : [[-.27,.08,.16],[-.22,.21,.20],[-.12,.31,.17],[.025,.35,.13],[.15,.31,.12],[.24,.18,.21],[.26,.035,.15]];
    ends.forEach((end,i)=>{
      const start=[-.08+i*.026,.24,.11];
      const middle=[start[0]*.22+end[0]*.64,Math.max(.21,end[1]*.85),.239];
      lock(parent,i%3===0?look.hair:look.lock,[start,middle,end],[.051,.068,.006],[.035,.042,.006]);
    });
    // Chunky clumps around the crown give the volume and pointed silhouette.
    const config=short?{count:13,lift:.016,width:.9,jitter:0}:look.style==='swept'?{count:15,lift:.03,width:1.05,jitter:.05}:{count:15,lift:.026,width:1,jitter:.22};
    for(let i=0;i<config.count;i++){
      const theta=.75+i*(Math.PI*2-1.5)/(config.count-1),wobble=Math.sin(i*2.4+1)*config.jitter;
      const end=1.25+.85*(1-Math.cos(theta))/2;
      crownTuft(parent,[look.hair,look.lock,shine(look)][i%3],theta+wobble*.4,.14,end+wobble*.3,config.lift*(1+Math.abs(wobble)),config.width,wobble);
    }
    // Shallow swept nape tufts are rooted outside the scalp surface.
    for(const side of [-1,1]){
      lock(parent,look.hair,[[side*.23,.12,-.04],[side*.284,-.04,-.045],[side*.23,-.195,-.065]],[.043,.047,.008],[.045,.033,.008]);
    }
  }
  // Keep the existing real envelope and normalization: lower-body geometry,
  // animation contact and all four gameplay sizes remain byte-identical.
  parent.updateMatrixWorld(true);
  let minZ=Infinity,maxY=-Infinity;
  parent.traverse(n=>{if(n.isMesh){const p=n.geometry.attributes.position;for(let i=0;i<p.count;i++){minZ=Math.min(minZ,p.getZ(i));maxY=Math.max(maxY,p.getY(i));}}});
  const top=look.style==='swept'?.52:look.style==='tousled'?.47:look.style==='long'?.40:.41;
  const back=long?-.30137306451797485:-.3001147508621216;
  parent.traverse(n=>{if(n.isMesh){const p=n.geometry.attributes.position;for(let i=0;i<p.count;i++){p.setY(i,-.20+(p.getY(i)+.20)*(top+.20)/(maxY+.20));if(p.getZ(i)<0)p.setZ(i,p.getZ(i)*back/minZ);}if(n.userData.smooth)smoothNormals(n.geometry);else n.geometry.computeVertexNormals();}});
}
const shine = look => '#' + new Color(look.lock).multiplyScalar(1.16).getHexString();
/** One clump following the scalp from polar angle phiA to phiB at azimuth theta (0 = forward). */
function crownTuft(parent, tint, theta, phiA, phiB, lift, width = 1, curl = 0) {
  const steps = [0, .3, .6, .85, 1], raise = [0, .45, .85, 1, 1.7];
  const points = steps.map((s, i) => {
    const phi = phiA + (phiB - phiA) * s, a = theta + curl * s * s, out = 1 + lift * raise[i] / .29;
    return [Math.sin(a) * Math.sin(phi) * .294 * out, .025 + Math.cos(phi) * .335 * out, Math.cos(a) * Math.sin(phi) * .272 * out - .018];
  });
  return tuft(parent, tint, points, [.05, .074, .07, .048, .005].map(w => w * width), [.02, .03, .029, .021, .004], [0, .025, -.018]);
}
function face(parent, look) {
  const ksu = look.style === 'long';
  // The face group is narrowed by .94, so surface lookups use head-space x.
  const on = (x, y, offset) => headZ(x * .94, y) + offset;
  for (const side of [-1, 1]) {
    orb(parent, SKIN, side * .263, -.045, -.005, .055, .08, .045, 10, 6, true);
    orb(parent, SKIN_SHADE, side * .289, -.046, .025, .02, .042, .009, 8, 5, true);
    const ex = side * .098 + (ksu ? .004 : 0), ey = .006, ez = on(ex, ey, .002);
    orb(parent, INK, ex, ey, ez, ksu ? .036 : .035, .054, .012, 12, 6, true);
    orb(parent, '#ffffff', ex + side * .011, ey + .022, ez + .009, .012, .014, .005, 8, 5, true);
    orb(parent, '#ffffff', ex - side * .009, ey - .021, ez + .009, .006, .006, .004, 6, 4, true);
    const bx = side * .155, by = -.072;
    orb(parent, BLUSH, bx, by, on(bx, by, -.008), .044, .026, .016, 12, 6, true);
    const brow = [[.062, .098], [.100, .112], [.142, .1]].map(([x, y]) => [side * x, y, on(side * x, y, .004)]);
    stroke(parent, look.hair, brow, ksu ? .0055 : .0075);
    if (ksu) stroke(parent, INK, [[.062,.048],[.08,.064],[.11,.066],[.138,.048]].map(([x, y]) => [side * x, y, on(side * x, y, .006)]), .0045);
  }
  // A small soft button nose, not a pointed wedge.
  orb(parent, SKIN_SHADE, 0, -.052, on(0, -.052, .003), .018, .013, .011, 10, 6, true);
  const smile = Array.from({ length: 9 }, (_, i) => { const x = -.052 + i * .013, y = -.128 + .018 * (x / .052) ** 2; return [x, y, on(x, y, .002)]; });
  stroke(parent, '#a8553a', smile, .0034);
  if (!look.glasses) return;
  const lens = .03;
  for (const side of [-1, 1]) {
    const cx = side * .1, cy = .01, w = .084, h = .058, depth = on(cx, cy, lens);
    const contour = look.style === 'short'
      ? [[-.062,-h],[.052,-h],[w,-.032],[w,.034],[.051,h],[-.052,h],[-w,.033],[-w,-.028]]
      : [[-.059,-h],[.06,-h],[w,-.039],[w,.045],[.067,h],[-.069,h],[-w,.042],[-w,-.041]];
    const path = contour.map(([x,y]) => [cx + x, cy + y, depth - Math.abs(x) * .12]); path.push(path[0]);
    stroke(parent, look.glasses, path, look.frame);
    const edge = cx + side * w;
    stroke(parent, look.glasses, [[edge, cy + .03, depth - w * .12], [side * .262, cy + .02, .11], [side * .265, -.01, .03]], look.frame * .7);
  }
  const bridge = on(0, .04, lens + .006);
  stroke(parent, look.glasses, [[-.019, .036, bridge - .004], [0, .044, bridge], [.019, .036, bridge - .004]], look.frame * .8);
}
function tunic(parent, look) {
  const slim=look.style!=='swept',waist=slim?.177:.205;
  // Continuous closed torso and skirt: internal leg overlaps remain hidden.
  loft(parent, look.tunic, [[-.42,.305,.290],[-.23,.265,.220],[0,waist,.137],[.18,slim?.222:.23,.145],[.31,.242,.13],[.35,.165,.092]], 16);
  loft(parent, look.belt, [[-.027,waist+.017,.157],[.028,waist+.014,.153]], 16);
  // Collar sits above the shirt. The skin inset makes the pale V read as a cut neckline.
  frontSurface(parent, CREAM,
    [[-.12,.342,.079],[-.072,.352,.105],[-.035,.315,.151],[0,.255,.152],[.035,.315,.151],[.072,.352,.105],[.12,.342,.079],[.099,.319,.139],[.045,.292,.151],[.012,.19,.154],[-.012,.19,.154],[-.045,.292,.151],[-.099,.319,.139]],
    [0,1,12,1,2,12,2,11,12,2,3,11,3,10,11,3,9,10,3,8,9,3,4,8,4,7,8,4,5,7,5,6,7]);
  frontSurface(parent, SKIN, [[-.058,.349,.107],[.058,.349,.107],[.026,.312,.154],[0,.225,.155],[-.026,.312,.154]], [0,4,1,1,4,2,4,3,2]);
  // Folded hanging strap, with thickness and a darker side edge.
  const x = slim ? .128 : .153;
  loft(parent, look.belt, [[-.253,.034,.011,x+.018,.202],[-.08,.032,.012,x,.14],[.026,.027,.012,x-.012,.122]], 4);
  if (look.style === 'long') {
    lock(parent, look.belt, [[.12,.022,.167],[.17,.015,.199],[.21,-.034,.204]], [.018,.038,.018], [.012,.018,.01]);
    lock(parent, look.belt, [[.12,.023,.175],[.087,-.012,.201],[.069,-.055,.202]], [.018,.034,.016], [.012,.018,.01]);
    orb(parent, '#a87530', .125, .014, .193, .024, .023, .018, 8, 4);
    loft(parent, look.belt, [[-.307,.032,.011,.21,.225],[-.12,.026,.013,.161,.203],[.022,.018,.011,.131,.173]], 4);
  }
}
/** Blender part surfaces (client/scripts/avatar-parts/<id>.json), read only under Node; null keeps the fallback. */
function loadAvatarParts(id) {
  const fs = globalThis.process?.getBuiltinModule?.('node:fs');
  if (!fs) return null;
  // AVATAR_PARTS_DIR lets a candidate sculpture be reviewed without touching the committed parts.
  const dir = globalThis.process.env.AVATAR_PARTS_DIR;
  const file = dir ? dir.replace(/\/?$/, '/') + id + '.json' : new URL('./avatar-parts/' + id + '.json', import.meta.url);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function sculpted(parent, surfaces = []) {
  for (const surface of surfaces) {
    const indexed = new BufferGeometry(), tint = new Color(surface.color), count = surface.position.length / 3;
    indexed.setAttribute('position', new Float32BufferAttribute(surface.position, 3));
    indexed.setAttribute('normal', new Float32BufferAttribute(surface.normal, 3));
    indexed.setAttribute('color', new Float32BufferAttribute(Array.from({ length: count * 3 }, (_, i) => [tint.r, tint.g, tint.b][i % 3]), 3));
    indexed.setIndex(surface.index);
    parent.add(new Mesh(indexed.toNonIndexed(), MAT)); indexed.dispose();
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
  const rest=idleTimes.map(()=>[0,0,0]);
  const idle=[qTrack('head',idleTimes,idleWave.map(s=>[0,s*.018,0])),qTrack('skirt-front',idleTimes,rest),qTrack('skirt-back',idleTimes,rest),
    new VectorKeyframeTrack('torso.scale',idleTimes,idleWave.flatMap(s=>[1+s*.002,1+s*.003,1+s*.002]))];
  const contact=times.map(t=>{
    const z=.3-1.2*(t%.5),down=Math.sqrt(.6199**2-z*z);
    return {down,offset:.16+down-.78};
  });
  // A slight counter-lean and restrained sway keep the fixed tunic clear of the knees.
  const walk=[qTrack('torso',walkTimes,wave.map(s=>[-.025,s*.018,s*.005])),qTrack('head',walkTimes,wave.map(s=>[.025,-s*.015,-s*.003])),
    new VectorKeyframeTrack('torso.position',walkTimes,contact.flatMap(p=>[0,.95+p.offset,0]))];
  const thighs=[];
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
    thighs.push(poses.map(p=>p[0]));
  }
  // Negative hip rotation swings a thigh forward: the front panel follows the leading thigh, the
  // back panel the trailing one, nearly as far, so the hem keeps covering the trousers.
  const PANEL_FOLLOW=.9;
  walk.push(qTrack('skirt-front',walkTimes,times.map((_,i)=>[Math.min(0,thighs[0][i],thighs[1][i])*PANEL_FOLLOW,0,0])));
  walk.push(qTrack('skirt-back',walkTimes,times.map((_,i)=>[Math.max(0,thighs[0][i],thighs[1][i])*PANEL_FOLLOW,0,0])));
  const jump = idle.filter(track => !/^(shoulder|elbow)-/.test(track.name)).map(track => track.clone());
  for (const side of [-1, 1]) {
    const suffix = side < 0 ? 'left' : 'right';
    jump.push(qTrack('shoulder-' + suffix, idleTimes, idleWave.map(s => [-2.85 + s * .025, 0, side * .5])));
    jump.push(qTrack('elbow-' + suffix, idleTimes, idleWave.map(s => [-.2 + s * .015, 0, 0])));
  }
  return [new AnimationClip('idle',4,idle),new AnimationClip('walk',.9,walk),new AnimationClip('jump',4,jump)];
}

export function createAvatarModel(id) {
  if (!AVATAR_IDS.includes(id)) throw new RangeError('Unknown avatar: '+id);
  const look=APPEARANCES[id], root=new Group(); root.name='avatar';
  root.userData={avatarId:id,origin:'ground between feet',units:'metres',forward:'+Z',author:'Original TASK-043 procedural sculpture; no third-party art',walkCycleMetres:1.2};
  // Blender-authored surfaces (TASK-125) replace the procedural fallback per joint.
  const doc=loadAvatarParts(id), parts=doc?.parts, nodes=doc?.nodes??{}, at=(name,fallback)=>nodes[name]??fallback;
  const sculpt=(target,name,fallback)=>parts?sculpted(target,parts[name]):fallback();
  const torso=group(root,'torso',0,.95,0); sculpt(torso,'torso',()=>tunic(torso,look));
  // The hem's front and back panels (split at the side slits) pivot at hip height so the walk can
  // swing them with the thighs and the tunic stays over the trousers. Empty for the fallback.
  for(const name of ['skirt-front','skirt-back']){const panel=group(torso,name,...at(name,[0,-.17,0])); if(parts?.[name])sculpted(panel,parts[name]);}
  const neck=group(torso,'neck',...at('neck',[0,.365,0])); sculpt(neck,'neck',()=>loft(neck,SKIN,[[-.015,.076,.07],[.105,.073,.071]],12));
  // The fallback head grows in width and height only, keeping the shared depth envelope.
  const head=group(torso,'head',...at('head',[0,parts?.63:.73,0])); if(!parts)head.scale.set(1.08,1.2,1);
  sculpt(head,'head',()=>headShell(head));
  const facial=group(head,'face'); sculpt(facial,'face',()=>{facial.scale.x=.94; face(facial,look);});
  const coiffure=group(head,'hair'); sculpt(coiffure,'hair',()=>{root.updateMatrixWorld(true); hair(coiffure,look);});
  for (const side of [-1,1]) {
    const suffix=side<0?'left':'right';
    const shoulder=group(torso,'shoulder-'+suffix,...at('shoulder-'+suffix,[side*.235,.305,0])); shoulder.rotation.z=side*.19; shoulder.rotation.x=-.055;
    sculpt(shoulder,'shoulder-'+suffix,()=>{
      loft(shoulder,look.tunic,[[-.155,.087,.092],[-.13,.088,.094],[-.035,.090,.094],[.015,.076,.078],[.045,.030,.035]],12);
      loft(shoulder,look.style==='long'?CREAM:new Color(look.tunic).multiplyScalar(.97),[[-.161,.090,.095],[-.125,.089,.096]],10);
    });
    const elbow=group(shoulder,'elbow-'+suffix,...at('elbow-'+suffix,[0,-.215,0])); elbow.rotation.x=-.07;
    sculpt(elbow,'elbow-'+suffix,()=>loft(elbow,SKIN,[[-.188,.050,.052],[-.13,.054,.055],[-.045,.064,.061],[.015,.064,.061],[.11,.06,.058]],10));
    const wrist=group(elbow,'wrist-'+suffix,...at('wrist-'+suffix,[0,-.195,0]));
    sculpt(wrist,'wrist-'+suffix,()=>{
      // Narrow the palm and raise its bottom, so the fingers extend below it.
      orb(wrist,SKIN,side*.016412675,-.0335,.008,.047,.0715,.042,10,5);
      const thumb=orb(wrist,SKIN,-side*.040,-.026,.038,.018,.038,.022,8,4); thumb.geometry.rotateZ(-side*.24);
      for(let finger=0;finger<4;finger++)orb(wrist,SKIN,side*(-.027+finger*.018),finger===1||finger===2?-.09799999:-.094,.014,.011,.030,.012,8,4);
    });
    const hip=group(root,'hip-'+suffix,side*.126,.78,0);
    sculpt(hip,'hip-'+suffix,()=>loft(hip,PANTS,[[-.32,.100,.087],[-.25,.100,.085],[-.09,.088,.085],[.01,.075,.08]],10));
    const knee=group(hip,'knee-'+suffix,0,-.32,0);
    sculpt(knee,'knee-'+suffix,()=>{
      orb(knee,PANTS,0,-.002,0,.095,.06,.095,10,5);
      loft(knee,PANTS,[[-.19,.074,.077],[-.16,.106,.112],[-.05,.117,.11],[.025,.09,.09]],10);
      loft(knee,CREAM,[[-.20,.076,.08],[-.175,.082,.085]],10);
      loft(knee,SKIN,[[-.295,.051,.056],[-.195,.058,.061]],10);
    });
    const ankle=group(knee,'ankle-'+suffix,0,-.30,0);
    sculpt(ankle,'ankle-'+suffix,()=>{
      loft(ankle,BOOT,[[-.13,.09,.145,0,.046],[-.09,.086,.145,0,.049],[-.045,.071,.12,0,.03],[.018,.065,.072,0,-.005]],10);
      loft(ankle,SOLE,[[-.16,.091,.15,0,.048],[-.132,.094,.153,0,.048]],10);
      loft(ankle,'#63412d',[[-.029,.071,.078],[.027,.074,.077]],10);
    });
  }
  batch(root); root.updateMatrixWorld(true);
  // Authored visual proportions; no invisible bounding mesh or collision change.
  const bounds=new Box3().setFromObject(root), size=bounds.getSize(new Vector3());
  const proportion=AVATAR_PROPORTIONS[id];
  // Generated sculptures keep their own shape: one uniform scale from the authored height.
  if(doc?.uniformScale){const s=proportion.height/size.y; root.scale.set(s,s,s);}
  else root.scale.set(proportion.width/size.x,proportion.height/size.y,proportion.depth/size.z);
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
    reports.push({id,proportions:AVATAR_PROPORTIONS[id],path:'/assets/models/avatars/'+id+'.glb',bytes:bytes.length,triangles,drawCalls,bounds:{min:b.min.toArray(),max:b.max.toArray()},clips:animations.map(c=>({name:c.name,duration:c.duration})),portrait:'/assets/models/avatars/'+id+'-portrait.png'});
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
window.renderAvatar=async id=>{if(model)s.remove(model);model=(await new GLTFLoader().loadAsync('/avatars/'+id+'.glb')).scene;model.rotation.y=-.12;s.add(model);const height=new T.Box3().setFromObject(model).max.y/1.8;c.position.set(.22,1.50*height,2.18);c.lookAt(0,1.39*height,0);r.render(s,c);return true};window.ready=true;
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
    browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||undefined,headless:true,args:['--enable-unsafe-swiftshader']});
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
