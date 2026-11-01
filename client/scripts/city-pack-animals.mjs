import { Group, Mesh, MeshStandardMaterial, BoxGeometry, IcosahedronGeometry, CylinderGeometry, TorusGeometry, Color, BufferAttribute } from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/** Shared static pack-animal geometry. +Z faces forward, hooves stand on y=0. */
export function packAnimal(kind, x, z, api) {
  if (kind !== 'camel' && kind !== 'mule') throw new Error(`Unknown pack animal: ${kind}`);
  const { box, ball, bead, cylinder, block } = api;
  const ellipsoid = (color, px, y, pz, rx, ry, rz) => ball(color, x + px, y, z + pz, rx, ry, rz);
  const facet = (color, px, y, pz, rx, ry, rz) => bead(color, x + px, y, z + pz, rx, ry, rz);
  const panel = (color, px, y, pz, w, h, d) => box(color, x + px, y, z + pz, w, h, d);
  const upright = (color, px, y, pz, r, h, top = r) => cylinder(color, x + px, y, z + pz, r, h, top);
  const leather = '#71513b', binding = '#c5a572', buckle = '#c2a26a';
  // Static scene callers omit part(); the standalone builder groups the same authored geometry.
  const part = (name, pivot = [0, 0, 0], parent = null) => api.part?.(name, pivot, parent);
  part('pack-body');

  if (kind === 'camel') {
    const coat = '#c69b68', light = '#dab584', shadow = '#ac8055', hoof = '#695244';
    // Deep chest, tucked belly and a single rounded hump make a dromedary silhouette.
    ellipsoid(coat, 0, 1.22, -.18, .43, .39, .79);
    ellipsoid(light, 0, 1.13, -.04, .32, .3, .61);
    ellipsoid(coat, 0, 1.31, .41, .34, .37, .35);
    ellipsoid(shadow, 0, 1.27, -.67, .36, .34, .34);
    ellipsoid(coat, 0, 1.74, -.26, .31, .46, .42);
    ellipsoid(light, -.06, 1.94, -.31, .22, .24, .28);
    // Separate upper limbs, knees, long shins and paired toes, with staggered feet.
    for (const side of [-1, 1]) for (const front of [false, true]) {
      const px = side * .28, pz = front ? .43 : -.66;
      const offset = side === 1 ? (front ? .065 : -.055) : 0;
      part(`pack-leg-${side}-${front ? 1 : -1}`, [px, 1.05, pz]);
      ellipsoid(coat, px, .91, pz, .11, .3, .14);
      ellipsoid(shadow, px, .59, pz + .04, .09, .11, .11);
      ellipsoid(light, px, .34, pz + .035 + offset, .065, .26, .075);
      ellipsoid(shadow, px, .13, pz + .05 + offset, .085, .09, .095);
      for (const toe of [-1, 1]) ellipsoid(hoof, px + toe * .048, .065, pz + .11 + offset, .052, .065, .135);
    }
    // The neck rises in three overlapping curved sections; the jaw projects forward.
    part('pack-neck', [0, 1.4, .5]);
    ellipsoid(coat, 0, 1.47, .54, .22, .34, .24);
    ellipsoid(coat, 0, 1.76, .69, .17, .33, .19);
    ellipsoid(light, 0, 2.04, .84, .14, .28, .16);
    part('pack-head', [0, 2.17, .98], 'pack-neck');
    ellipsoid(coat, 0, 2.25, 1.04, .195, .18, .27);
    ellipsoid(light, 0, 2.18, 1.24, .16, .12, .17);
    ellipsoid(shadow, 0, 2.1, 1.19, .145, .07, .16);
    panel('#624b3a', 0, 2.125, 1.365, .19, .018, .025);
    for (const side of [-1, 1]) {
      ellipsoid(coat, side * .19, 2.43, .91, .07, .13, .075);
      facet('#ab7e60', side * .195, 2.445, .954, .035, .08, .026);
      ellipsoid(shadow, side * .18, 2.3, 1.095, .035, .055, .065);
      facet('#2f2a23', side * .205, 2.305, 1.11, .022, .029, .032);
      facet('#e7d9b8', side * .216, 2.32, 1.122, .008, .009, .009);
      facet('#74533e', side * .087, 2.215, 1.385, .027, .019, .015);
      // Short eyebrow and cheek straps keep the face readable from both sides.
      panel(shadow, side * .202, 2.355, 1.105, .025, .026, .1);
      panel(leather, side * .185, 2.24, 1.16, .028, .045, .36);
      facet(buckle, side * .205, 2.23, 1.28, .034, .035, .019);
    }
    panel(leather, 0, 2.225, 1.397, .29, .055, .023);
    // Tail follows the rump instead of reading as an extra leg.
    part('pack-tail', [0, 1.15, -.87]);
    ellipsoid(shadow, .05, 1.02, -.96, .045, .22, .055);
    ellipsoid(shadow, .1, .78, -1.035, .04, .16, .045);
    ellipsoid('#70513b', .13, .62, -1.075, .075, .13, .075);
    // A two-sided saddle cloth leaves the hump exposed, with a distinct woven border.
    part('pack-body');
    for (const side of [-1, 1]) {
      const px = side * .425;
      panel('#4f8583', px, 1.27, -.22, .045, .48, 1.23);
      panel('#c99e56', side * .455, 1.07, -.22, .018, .075, 1.24);
      panel('#d4b274', side * .455, 1.45, -.22, .018, .055, 1.24);
      for (let mark = 0; mark < 6; mark++) facet('#e7d3a3', side * .461, 1.27, -.72 + mark * .2, .018, .052, .055);
      // Compact panniers remain inside the 1.1 m authored footprint.
      ellipsoid(side < 0 ? '#b38659' : '#a5815c', side * .405, 1.31, -.35, .145, .2, .28);
      panel(leather, side * .54, 1.32, -.35, .018, .37, .055);
      panel(binding, side * .405, 1.5, -.35, .27, .035, .34);
      facet(buckle, side * .548, 1.35, -.35, .015, .04, .03);
      for (let tassel = 0; tassel < 3; tassel++) {
        const pz = -.6 + tassel * .35;
        panel(binding, side * .45, .99, pz, .035, .15, .035);
        facet(tassel % 2 ? '#b56f53' : '#4d777b', side * .45, .88, pz, .06, .09, .055);
      }
    }
    panel(leather, 0, 1.57, .25, .82, .085, .12);
    panel(leather, 0, 1.57, -.75, .71, .085, .12);
    upright(binding, -.39, 1.64, -.58, .1, .34, .105);
    panel('#ad6f55', -.39, 1.65, -.468, .15, .055, .015);
    part('pack-neck', [0, 1.4, .5]);
    for (let knot = 0; knot < 6; knot++) facet(binding, .2 + knot * .018, 2.15 - knot * .12, 1.28 - knot * .045, .021, .06, .025);
    block(x, z + .13, 1.1, 2.6);
  } else {
    const coat = '#937a64', light = '#b6a18a', dark = '#51483e', hoof = '#49463f';
    ellipsoid(coat, 0, .94, -.12, .31, .32, .62);
    ellipsoid(light, 0, .85, -.06, .25, .25, .5);
    ellipsoid(coat, 0, 1, .32, .26, .33, .28);
    ellipsoid('#88715f', 0, .98, -.55, .28, .29, .25);
    for (const side of [-1, 1]) for (const front of [false, true]) {
      const px = side * .21, pz = front ? .37 : -.56;
      const stagger = side < 0 ? .035 : -.035;
      part(`pack-leg-${side}-${front ? 1 : -1}`, [px, .79, pz]);
      ellipsoid(coat, px, .64, pz, .09, .24, .115);
      ellipsoid(dark, px, .4, pz + stagger, .065, .08, .08);
      ellipsoid(light, px, .245, pz + stagger, .05, .17, .06);
      ellipsoid(hoof, px, .065, pz + .045 + stagger, .085, .065, .115);
    }
    part('pack-neck', [0, 1.05, .35]);
    ellipsoid(coat, 0, 1.17, .42, .18, .3, .22);
    ellipsoid(coat, 0, 1.42, .58, .14, .22, .16);
    part('pack-head', [0, 1.4, .62], 'pack-neck');
    ellipsoid(coat, 0, 1.47, .74, .155, .19, .22);
    ellipsoid(light, 0, 1.32, .945, .14, .12, .13);
    ellipsoid('#c2b29a', 0, 1.27, .965, .12, .07, .105);
    panel(dark, 0, 1.272, 1.072, .16, .017, .017);
    for (const side of [-1, 1]) {
      // The long upright ears distinguish a mule from a small horse or donkey prop.
      ellipsoid(coat, side * .115, 1.72, .65, .052, .2, .075);
      ellipsoid('#c3a58f', side * .118, 1.74, .704, .027, .135, .022);
      facet(dark, side * .12, 1.895, .645, .045, .035, .055);
      ellipsoid(dark, side * .15, 1.49, .795, .028, .045, .05);
      facet('#282822', side * .174, 1.495, .81, .018, .025, .027);
      facet('#e7ddc9', side * .182, 1.506, .824, .007, .008, .008);
      facet('#615348', side * .074, 1.35, 1.056, .024, .016, .012);
      panel(leather, side * .15, 1.4, .84, .024, .045, .3);
      panel(leather, side * .16, 1.48, .7, .025, .23, .04);
      facet(buckle, side * .17, 1.41, .94, .018, .032, .026);
    }
    panel(leather, 0, 1.355, 1.069, .26, .052, .022);
    // Short standing mane and a full brush tail contrast with the camel's neck and tail.
    part('pack-neck', [0, 1.05, .35]);
    for (let tuft = 0; tuft < 6; tuft++) facet(dark, 0, 1.27 + tuft * .065, .21 + tuft * .068, .065, .11, .065);
    part('pack-tail', [0, 1.05, -.68]);
    ellipsoid(dark, 0, .92, -.76, .065, .19, .07);
    ellipsoid(dark, .035, .68, -.83, .075, .2, .065);
    ellipsoid('#3e3c36', .055, .47, -.85, .1, .15, .075);
    // A warm patterned blanket and two unequal bags make the pack readable at game distance.
    part('pack-body');
    panel('#ac6954', 0, 1.25, -.16, .55, .075, .81);
    for (const side of [-1, 1]) {
      panel('#ad6f58', side * .315, 1.07, -.16, .04, .35, .88);
      panel('#dfbf7e', side * .342, .92, -.16, .015, .055, .89);
      for (let mark = 0; mark < 4; mark++) facet('#eedcaa', side * .35, 1.065, -.48 + mark * .21, .016, .045, .05);
      ellipsoid(side < 0 ? '#baa37d' : '#a28d6c', side * .325, 1.05, -.26, .125, .21, side < 0 ? .23 : .19);
      panel(leather, side * .445, 1.06, -.26, .015, .37, .045);
      panel(binding, side * .33, 1.25, -.26, .22, .03, .28);
      facet(buckle, side * .453, 1.08, -.26, .012, .035, .026);
      panel(leather, side * .3, 1.25, .24, .075, .08, .1);
    }
    panel(leather, 0, 1.3, .18, .65, .07, .1);
    panel(leather, 0, 1.3, -.55, .61, .07, .1);
    upright('#7e9a8c', -.28, 1.38, -.48, .11, .3);
    upright(binding, -.28, 1.405, -.48, .115, .035);
    facet('#b6885b', .3, 1.3, -.18, .11, .08, .14);
    part('pack-neck', [0, 1.05, .35]);
    for (let knot = 0; knot < 5; knot++) facet(binding, -.17 - knot * .022, 1.38 - knot * .07, .96 - knot * .08, .018, .04, .025);
    block(x, z + .07, .94, 2.02);
  }
}


/** Batched movable parts; head is a child of the neck, mill drive belongs to the mule lease. */
export function buildPackAnimal(kind) {
  const root = new Group(); root.name = `city-${kind}`;
  const parts = new Map(); let active;
  const part = (name, pivot, parent) => {
    if (!parts.has(name)) parts.set(name, { pivot, parent, geometry: [], group: new Group() });
    active = parts.get(name);
  };
  function geometry(shape, color, x, y, z, sx = 1, sy = 1, sz = 1) {
    shape.scale(sx, sy, sz); shape.translate(x, y, z);
    const g = shape.index ? shape.toNonIndexed() : shape;
    if (g !== shape) shape.dispose();
    g.deleteAttribute('uv');
    const c = new Color(color), colors = new Uint8Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = Math.round(c.r * 255); colors[i + 1] = Math.round(c.g * 255); colors[i + 2] = Math.round(c.b * 255); }
    g.setAttribute('color', new BufferAttribute(colors, 3, true)); active.geometry.push(g);
  }
  packAnimal(kind, 0, 0, {
    part, block() {},
    box(color, x, y, z, w, h, d) { geometry(new BoxGeometry(w, h, d), color, x, y, z); },
    ball(color, x, y, z, rx, ry, rz) { geometry(new IcosahedronGeometry(1, 1), color, x, y, z, rx, ry, rz); },
    bead(color, x, y, z, rx, ry, rz) { geometry(new IcosahedronGeometry(1, 0), color, x, y, z, rx, ry, rz); },
    cylinder(color, x, y, z, r, h, top = r) { geometry(new CylinderGeometry(top, r, h, 10), color, x, y, z); },
  });
  if(kind==='mule') {
    part('pack-body',[0,0,0],null);
    const hitch=new TorusGeometry(.085,.025,6,12);hitch.rotateY(Math.PI/2);
    geometry(hitch,'#bba06c',.43,1.32,.18);
    geometry(new BoxGeometry(.08,.24,.24),'#71513b',.38,1.27,.18);
    // Unit-length members are positioned between the axle and hitch each frame.
    part('pack-drive-arm',[0,0,0],null);geometry(new BoxGeometry(.16,.16,1),'#916a48',0,0,.5);
    part('pack-drive-drop',[0,0,0],null);geometry(new BoxGeometry(.12,1,.12),'#71513b',0,.5,0);
    part('pack-drive-hub',[0,0,0],null);geometry(new CylinderGeometry(.235,.235,.24,12),'#bba06c',0,0,0);
  }
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  for (const [name, entry] of parts) {
    const { group, pivot, parent } = entry; group.name = name;
    const merged = mergeGeometries(entry.geometry, false);
    if (!merged) throw new Error(`Cannot merge ${kind}/${name}`);
    for (const source of entry.geometry) source.dispose();
    merged.translate(-pivot[0], -pivot[1], -pivot[2]);
    const indexed = mergeVertices(merged); merged.dispose();
    const mesh = new Mesh(indexed, material); mesh.name = `${name}-mesh`; mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    const parentPart = parent ? parts.get(parent) : null;
    group.position.set(pivot[0] - (parentPart?.pivot[0] ?? 0), pivot[1] - (parentPart?.pivot[1] ?? 0), pivot[2] - (parentPart?.pivot[2] ?? 0));
    (parentPart?.group ?? root).add(group);
  }
  root.userData.packAnimal = kind;
  return root;
}
