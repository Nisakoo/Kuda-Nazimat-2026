/**
 * City residents reuse the player avatar sculptures (bodies, faces, hair), recoloured
 * per resident and finished with role headwear. Each resident stays a static single batch.
 * Output pieces are non-indexed with position, normal and normalised 8-bit colour, as the city
 * generator's `mesh` helper produces. Metres, +Y up, +Z forward, origin on the ground.
 */
import { Box3, Color, ConeGeometry, CylinderGeometry, BufferAttribute, Matrix4, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { AVATAR_PROPORTIONS, createAvatarModel } from './generate-avatar-models.mjs';

const HEIGHT = 1.8, CHILD_SCALE = .72, CLEAR_HAIR = new Set(['wrap', 'helmet', 'turban']);
const SKIN_LIGHT = '#f2b488', SKIN_WARM = '#dd9f6c', SKIN_TAN = '#bf8153', SKIN_DEEP = '#95603d';
const BLACK = '#2e241e', DARK = '#47301f', BROWN = '#6b4529', AUBURN = '#8a4a2b', GREY = '#b9b3a8', WHITE = '#e6e1d6';
/** base: body and face donor; hair: hair donor. Women use ksu; men use lukas without glasses. */
const LOOKS = {
  belu: { base: 'lukas', hair: 'nic', skin: SKIN_WARM, hairColor: DARK, belt: '#a87a3c', props: 'spear' },
  zeria: { base: 'ksu', hair: 'ksu', skin: SKIN_WARM, hairColor: BLACK, belt: '#9c5a3c' },
  herodotus: { base: 'lukas', hair: 'dan', skin: SKIN_LIGHT, hairColor: GREY, belt: '#4f7a8c', beard: GREY },
  nanaya: { base: 'ksu', hair: 'ksu', skin: SKIN_TAN, hairColor: DARK, belt: '#d1a452' },
  haddad: { base: 'lukas', hair: 'nic', skin: SKIN_TAN, hairColor: BLACK, belt: '#7c4a31', beard: BLACK },
  rimi: { base: 'lukas', hair: 'dan', skin: SKIN_DEEP, hairColor: BLACK, belt: '#d1a452' },
  ilta: { base: 'ksu', hair: 'ksu', skin: SKIN_WARM, hairColor: AUBURN, belt: '#e0c27a' },
  apil: { base: 'lukas', hair: 'nic', skin: SKIN_WARM, hairColor: WHITE, belt: '#7c6a4e', beard: WHITE },
  beltani: { base: 'ksu', hair: 'ksu', skin: SKIN_DEEP, hairColor: BLACK, belt: '#d9b65c' },
  ishme: { base: 'lukas', hair: 'dan', skin: SKIN_LIGHT, hairColor: BROWN, belt: '#6f5a3e' },
  lipit: { base: 'lukas', hair: 'dan', skin: SKIN_WARM, hairColor: AUBURN, belt: '#e0c27a' },
  kuddu: { base: 'lukas', hair: 'nic', skin: SKIN_TAN, hairColor: BROWN, belt: '#6f5a3e' },
  shamhat: { base: 'ksu', hair: 'ksu', skin: SKIN_WARM, hairColor: BROWN, belt: '#a8804a' },
  ibbi: { base: 'lukas', hair: 'nic', skin: SKIN_LIGHT, hairColor: DARK, belt: '#c98f4a' },
  'nur-sin': { base: 'lukas', hair: 'dan', skin: SKIN_DEEP, hairColor: BLACK, belt: '#a64f6a' },
  sharrum: { base: 'lukas', hair: 'lukas', skin: SKIN_TAN, hairColor: DARK, belt: '#5a7f85' },
  bau: { base: 'ksu', hair: 'ksu', skin: SKIN_TAN, hairColor: DARK, belt: '#c9a35c' },
  taram: { base: 'ksu', hair: 'ksu', skin: SKIN_LIGHT, hairColor: BROWN, belt: '#d9b65c' },
  enki: { base: 'lukas', hair: 'lukas', skin: SKIN_TAN, hairColor: BLACK, belt: '#e0c27a' },
  niya: { base: 'ksu', hair: 'ksu', skin: SKIN_TAN, hairColor: BLACK, belt: '#4f8d91' },
  nindada: { base: 'ksu', hair: 'ksu', skin: SKIN_WARM, hairColor: AUBURN, belt: '#d9b65c' },
  amytis: { base: 'ksu', hair: 'ksu', skin: SKIN_LIGHT, hairColor: BLACK, belt: '#dbb251' },
  nebuchadnezzar: { base: 'lukas', hair: 'nic', skin: SKIN_WARM, hairColor: BLACK, belt: '#dbb251', beard: BLACK },
  'fruit-seller': { base: 'lukas', hair: 'nic', skin: SKIN_TAN, hairColor: DARK, belt: '#7c4a31' },
  'fabric-seller': { base: 'ksu', hair: 'ksu', skin: SKIN_WARM, hairColor: BLACK, belt: '#d9b65c' },
  potter: { base: 'lukas', hair: 'dan', skin: SKIN_WARM, hairColor: BROWN, belt: '#e0c27a', beard: BROWN },
  visitor: { base: 'ksu', hair: 'ksu', skin: SKIN_TAN, hairColor: DARK, belt: '#e0c27a' },
  shepherd: { base: 'lukas', hair: 'nic', skin: SKIN_TAN, hairColor: GREY, belt: '#7c6a4e', beard: GREY },
  merchant: { base: 'lukas', hair: 'dan', skin: SKIN_WARM, hairColor: DARK, belt: '#7c4a31' },
};
/** Market and pasture people authored inside market.glb; colours and headwear match the city catalogue. */
export const MARKET_CAST = Object.freeze({
  'fruit-seller': { id: 'fruit-seller', color: '#d6a64e', hat: 'wrap', child: false },
  'fabric-seller': { id: 'fabric-seller', color: '#4b8b82', hat: 'wrap', child: false },
  potter: { id: 'potter', color: '#b96c49', hat: 'turban', child: false },
  visitor: { id: 'visitor', color: '#bf6a45', hat: 'wrap', child: false },
  shepherd: { id: 'shepherd', color: '#d6a64e', hat: 'straw', child: false },
  merchant: { id: 'merchant', color: '#a46e83', hat: 'turban', child: false },
});
/** Sculpture palette anchors in sRGB; shading stays as each surface's ratio to its anchor. */
const ANCHORS = {
  lukas: { tunic: '#279399', belt: '#d49d4d', skin: '#faaa6f', brow: '#846135', glasses: '#141f21' },
  ksu: { tunic: '#8091ab', belt: '#d49d4d', skin: '#faaa6f', brow: '#614734' },
};
const HAIR_ANCHOR = { lukas: '#cb9142', nic: '#7d5332', dan: '#483022', ksu: '#483226' };

const srgb = hex => new Color(hex).convertLinearToSRGB();
const distance = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
const donors = new Map();
function donor(id) {
  if (!donors.has(id)) { const { root } = createAvatarModel(id); root.updateMatrixWorld(true); donors.set(id, root); }
  return donors.get(id);
}
/** Keeps only triangles accepted by `keep`, with colours rewritten by `tint`; returns 8-bit colours. */
function repaint(source, matrix, tint, keep = () => true) {
  const flat = source.index ? source.toNonIndexed() : source.clone();
  const position = flat.attributes.position, normal = flat.attributes.normal, color = flat.attributes.color;
  const c = new Color(), corners = [], vertex = new Vector3();
  for (let i = 0; i < position.count; i += 3) {
    c.fromBufferAttribute(color, i);
    vertex.fromBufferAttribute(position, i);
    if (keep(c, vertex, i, position)) corners.push(i);
  }
  const count = corners.length * 3, p = new Float32Array(count * 3), n = new Float32Array(count * 3), rgb = new Uint8Array(count * 3);
  corners.forEach((corner, t) => {
    for (let k = 0; k < 3; k++) {
      const at = t * 3 + k, from = corner + k;
      p.set([position.getX(from), position.getY(from), position.getZ(from)], at * 3);
      n.set([normal.getX(from), normal.getY(from), normal.getZ(from)], at * 3);
      c.fromBufferAttribute(color, from);
      tint(c);
      rgb.set([c.r, c.g, c.b].map(v => Math.round(Math.min(1, v) * 255)), at * 3);
    }
  });
  const result = flat.clone(); result.deleteAttribute('uv');
  result.setAttribute('position', new BufferAttribute(p, 3));
  result.setAttribute('normal', new BufferAttribute(n, 3));
  result.setAttribute('color', new BufferAttribute(rgb, 3, true));
  result.applyMatrix4(matrix);
  flat.dispose();
  return result;
}
/** Replaces a colour family while preserving the sculpted shade of each vertex. */
const remap = (c, anchor, target) => { c.r *= target.r / anchor.r; c.g *= target.g / anchor.g; c.b *= target.b / anchor.b; };
function bodyTint(look, anchors, npc, face) {
  const family = [
    { near: srgb(anchors.tunic), radius: .075, anchor: new Color(anchors.tunic), target: new Color(npc.color) },
    { near: srgb(anchors.belt), radius: .06, anchor: new Color(anchors.belt), target: new Color(look.belt) },
    { near: srgb(anchors.skin), radius: .1, anchor: new Color(anchors.skin), target: new Color(look.skin) },
    // Boot leather sits close to the brow colour, so only the face takes this family.
    ...(face ? [{ near: srgb(anchors.brow), radius: .05, anchor: new Color(anchors.brow), target: new Color(look.hairColor) }] : []),
  ], probe = new Color();
  return c => {
    probe.copy(c).convertLinearToSRGB();
    const match = family.find(f => distance(probe, f.near) < f.radius);
    if (match) remap(c, match.anchor, match.target);
  };
}
/** Faceted cloth, like the avatars' tunics: flat normals with a slight per-face shade change. */
function cloth(geometry, tint, matrix) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv'); g.applyMatrix4(matrix); g.computeVertexNormals();
  const base = new Color(tint), count = g.attributes.position.count, rgb = new Uint8Array(count * 3);
  for (let i = 0; i < count; i += 3) {
    const shade = 1 + (((i / 3) * 17 + 11) % 13 - 6) * .006;
    for (let k = 0; k < 3; k++) rgb.set([base.r, base.g, base.b].map(v => Math.round(Math.min(1, v * shade) * 255)), (i + k) * 3);
  }
  g.setAttribute('color', new BufferAttribute(rgb, 3, true));
  return g;
}
const dome = (cut = Math.PI / 2) => new SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, cut);
const orb = () => new SphereGeometry(1, 14, 8);
const ring = (tube = .12) => new TorusGeometry(1, tube, 6, 22).rotateX(Math.PI / 2);
const HAT_COLORS = { helmet: '#ae9973', straw: '#dcc080', crown: '#dbb251', cap: '#efe2c6', band: '#efe2c6', };
/** Headwear in head-frame units: 1 is a head radius from the head centre, +Y up, +Z forward. */
function headwear(npc, look, put) {
  // Cloth headwear is woven to match its wearer; metal and straw keep their material colour.
  const woven = '#' + new Color(npc.color).lerp(new Color('#f1dec0'), .45).getHexString();
  const hat = npc.hat, color = HAT_COLORS[hat] ?? woven, darker = '#' + new Color(color).multiplyScalar(.72).getHexString();
  if (hat === 'helmet') {
    put(dome(), color, 1.12, 1.08, 1.14, 0, .12, 0);
    put(ring(.09), darker, 1.13, 1, 1.15, 0, .14, 0);
    put(new ConeGeometry(.16, .4, 8), darker, 1, 1, 1, 0, 1.36, 0);
  } else if (hat === 'wrap') {
    put(dome(), color, 1.12, 1.02, 1.14, 0, .2, 0);
    put(orb(), color, 1, 1.25, .62, 0, -.42, -.62);
    put(ring(.1), darker, 1.08, 1, 1.1, 0, .24, 0);
  } else if (hat === 'turban') {
    put(dome(), color, 1.08, .86, 1.1, 0, .22, 0);
    for (const [y, r] of [[.26, 1.1], [.52, 1.02], [.78, .82]]) put(ring(.2), y === .52 ? darker : color, r, 1, r, 0, y, 0);
    put(orb(), darker, .2, .2, .2, 0, .72, .84);
  } else if (hat === 'cap') {
    put(dome(), color, 1.1, .92, 1.12, 0, .28, 0);
    put(ring(.1), darker, 1.09, 1, 1.11, 0, .3, 0);
  } else if (hat === 'straw') {
    put(new CylinderGeometry(1.95, 2.05, .07, 22), color, 1, 1, 1, 0, .34, 0);
    put(new CylinderGeometry(.74, 1.08, .62, 16), color, 1, 1, 1, 0, .66, 0);
    put(ring(.09), '#9c7a44', 1.04, 1, 1.04, 0, .42, 0);
  } else if (hat === 'band') {
    put(ring(.1), color, 1.14, 1.2, 1.16, 0, .38, 0);
  } else if (hat === 'flowers') {
    put(ring(.09), '#729163', 1.13, 1, 1.15, 0, .42, 0);
    ['#e8a6b8', '#f2d27a', '#ffffff', '#c98fd0'].forEach((tint, i) => {
      for (let k = 0; k < 3; k++) {
        const a = (i * 3 + k) * Math.PI * 2 / 12;
        put(orb(), tint, .15, .15, .15, Math.sin(a) * 1.16, .46, Math.cos(a) * 1.18);
      }
    });
  } else if (hat === 'crown') {
    const tall = npc.id === 'nebuchadnezzar';
    if (tall) {
      put(new CylinderGeometry(.92, 1.18, 1.05, 18), color, 1, 1, 1, 0, .86, 0);
      put(ring(.08), '#ae3b3b', 1.2, 1, 1.2, 0, .4, 0);
      put(ring(.06), darker, 1, 1, 1, 0, 1.1, 0);
    } else {
      put(new CylinderGeometry(1.26, 1.26, .3, 20), color, 1, 1, 1, 0, .66, 0);
      put(ring(.07), '#ae3b3b', 1.28, 1, 1.28, 0, .54, 0);
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI * 2 / 8;
        put(new ConeGeometry(.15, .36, 5), color, 1, 1, 1, Math.sin(a) * 1.2, .98, Math.cos(a) * 1.2);
      }
    }
  }
  if (look.beard) {
    put(orb(), look.beard, .62, npc.id === 'nebuchadnezzar' ? .72 : .48, .46, 0, npc.id === 'nebuchadnezzar' ? -1.2 : -1.02, .52);
  }
}

function lookOf(npc) {
  const look = LOOKS[npc.id];
  if (!look) throw new RangeError('Resident has no authored look: ' + npc.id);
  return look;
}
const sizeOf = (npc, look) => (npc.child ? CHILD_SCALE : 1) * HEIGHT / AVATAR_PROPORTIONS[look.base].height;
/** Paints the sculpture into buckets; targetFor(node) names each node's bucket and its local-to-bucket matrix. */
function assemble(npc, look, targetFor) {
  const base = donor(look.base), anchors = ANCHORS[look.base], tint = bodyTint(look, anchors, npc, false), faceTint = bodyTint(look, anchors, npc, true);
  const buckets = new Map(), add = (bucket, piece) => { if (!buckets.has(bucket)) buckets.set(bucket, []); buckets.get(bucket).push(piece); };
  const glasses = anchors.glasses ? srgb(anchors.glasses) : null, probe = new Color();
  const notGlasses = c => !glasses || distance(probe.copy(c).convertLinearToSRGB(), glasses) > .05;
  base.traverse(node => {
    if (!node.isMesh || node.name === 'hair-surface') return;
    const target = targetFor(node);
    add(target.bucket, repaint(node.geometry, target.matrix, node.name === 'face-surface' ? faceTint : tint, notGlasses));
  });
  const headNode = base.getObjectByName('head'), skull = headNode.getObjectByName('head-surface');
  skull.geometry.computeBoundingBox();
  const box = new Box3().copy(skull.geometry.boundingBox), center = box.getCenter(new Vector3()), radius = box.getSize(new Vector3()).multiplyScalar(.5);
  const { bucket, matrix: head } = targetFor(headNode);
  if (!CLEAR_HAIR.has(npc.hat)) {
    const from = donor(look.hair), fromHead = from.getObjectByName('head'), hair = from.getObjectByName('hair-surface');
    const hairAnchor = new Color(HAIR_ANCHOR[look.hair]), target = new Color(look.hairColor);
    const place = new Matrix4().multiplyMatrices(new Matrix4().copy(fromHead.matrixWorld).invert(), hair.matrixWorld);
    // Under a cap, straw hat or tall crown only the hair below the headwear's edge remains.
    const limit = ['cap', 'straw'].includes(npc.hat) || npc.id === 'nebuchadnezzar' ? center.y + radius.y * .3 : Infinity, world = new Vector3();
    add(bucket, repaint(hair.geometry, new Matrix4().multiplyMatrices(head, place), c => remap(c, hairAnchor, target), (c, v, i, position) => {
      for (let k = 0; k < 3; k++) if (world.fromBufferAttribute(position, i + k).applyMatrix4(place).y > limit) return false;
      return true;
    }));
  }
  const frame = new Matrix4().multiplyMatrices(head, new Matrix4().makeTranslation(center.x, center.y, center.z)).multiply(new Matrix4().makeScale(radius.x, radius.y, radius.z));
  headwear(npc, look, (geometry, color, sx, sy, sz, x, y, z) => {
    geometry.scale(sx, sy, sz); geometry.translate(x, y, z); add(bucket, cloth(geometry, color, frame));
  });
  return buckets;
}

/** Returns a static resident's non-indexed mesh pieces. Throws on a resident without an authored look. */
export function residentPieces(npc) {
  const look = lookOf(npc), size = sizeOf(npc, look), normalize = new Matrix4().makeScale(size, size, size);
  const pieces = assemble(npc, look, node => ({ bucket: 'all', matrix: new Matrix4().multiplyMatrices(normalize, node.matrixWorld) })).get('all');
  if (look.props === 'spear') {
    const hand = new Matrix4().makeScale(HEIGHT, HEIGHT, HEIGHT);
    const put = (g, color, x, y, z) => { g.translate(x, y, z); pieces.push(cloth(g, color, hand)); };
    put(new CylinderGeometry(.018, .018, 1.08, 8), '#916a48', .335, .54, .08);
    put(new ConeGeometry(.034, .13, 6), '#b7af98', .335, 1.14, .08);
  }
  return pieces;
}

const RIG_JOINTS = ['torso', 'head', 'shoulder-left', 'shoulder-right', 'elbow-left', 'elbow-right'];
/** The same person split at the animated joints: { root, torso, head, shoulder-*, elbow-* } with position and pieces in metres. */
export function residentRig(npc) {
  const look = lookOf(npc), base = donor(look.base), size = sizeOf(npc, look) * base.scale.x;
  const scale = new Matrix4().makeScale(size, size, size);
  const jointOf = node => { for (let n = node; n && n !== base; n = n.parent) if (RIG_JOINTS.includes(n.name)) return n; return base; };
  const buckets = assemble(npc, look, node => {
    const joint = jointOf(node);
    return { bucket: joint === base ? 'root' : joint.name, matrix: scale.clone().multiply(joint.matrixWorld.clone().invert()).multiply(node.matrixWorld) };
  });
  return Object.fromEntries(['root', ...RIG_JOINTS].map(name => [name, {
    position: name === 'root' ? [0, 0, 0] : base.getObjectByName(name).position.clone().multiplyScalar(size).toArray(),
    pieces: buckets.get(name) ?? [],
  }]));
}
export const RESIDENT_LOOK_IDS = Object.freeze(Object.keys(LOOKS));
