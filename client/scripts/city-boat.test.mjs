import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, CylinderGeometry, IcosahedronGeometry, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { buildCityBoat } from './city-boat.mjs';

// Standalone geometry acceptance: node --test client/scripts/city-boat.test.mjs
// Uses the generator's primitive signatures without generating files or loading WebGL.
const group = new Group();
const mesh = (geometry, color, x, y, z, sx = 1, sy = 1, sz = 1) => {
  geometry.scale(sx, sy, sz);
  geometry.translate(x, y, z);
  group.add(new Mesh(geometry, new MeshStandardMaterial({ color })));
};
const api = {
  mesh,
  box: (c, x, y, z, w, h, d) => mesh(new BoxGeometry(w, h, d), c, x, y, z),
  cylinder: (c, x, y, z, r, h, top = r) => mesh(new CylinderGeometry(top, r, h, 12), c, x, y, z),
  bead: (c, x, y, z, w, h, d) => mesh(new IcosahedronGeometry(1, 0), c, x, y, z, w, h, d),
};
const footprint = buildCityBoat(api);
group.updateMatrixWorld(true);
after(() => {
  for (const child of group.children) {
    child.geometry.dispose();
    child.material.dispose();
  }
  group.clear();
});

function insideFootprint(x, z) {
  let inside = false;
  for (let i = 0, j = footprint.length - 1; i < footprint.length; j = i++) {
    const a = footprint[i], b = footprint[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

test('boat geometry has finite positions and usable unit normals', () => {
  assert.ok(group.children.length > 0);
  for (const [part, child] of group.children.entries()) {
    const position = child.geometry.getAttribute('position');
    const normal = child.geometry.getAttribute('normal');
    assert.ok(position && normal, `missing attributes in part ${part}`);
    assert.equal(position.count, normal.count);
    for (let i = 0; i < position.count; i++) {
      const values = [position.getX(i), position.getY(i), position.getZ(i), normal.getX(i), normal.getY(i), normal.getZ(i)];
      assert.ok(values.every(Number.isFinite), `nonfinite geometry in part ${part}, vertex ${i}`);
      const length = Math.hypot(...values.slice(3));
      assert.ok(length > .99 && length < 1.01, `unusable normal in part ${part}, vertex ${i}: ${length}`);
    }
  }
});

test('tapered water footprint contains body-height geometry without blocking its empty bounding rectangle', () => {
  assert.ok(footprint.length >= 8 && footprint.length <= 64);
  assert.ok(footprint.every(point => point.length === 2 && point.every(Number.isFinite)));
  const area = Math.abs(footprint.reduce((sum, a, i) => {
    const b = footprint[(i + 1) % footprint.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0)) / 2;
  const xs = footprint.map(p => p[0]), zs = footprint.map(p => p[1]);
  const rectangle = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
  assert.ok(area > 0 && area < rectangle * .9, 'footprint must preserve the tapered ends');
  for (const [part, child] of group.children.entries()) {
    const position = child.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) >= 1.9) continue;
      const x = position.getX(i), z = position.getZ(i);
      assert.ok(insideFootprint(x, z), `body-height geometry outside hull footprint: part ${part}, vertex ${i}, (${x}, ${z})`);
    }
  }
});

test('both hull sides, ends, keel and both sail sides remain visible with front-face culling', () => {
  const rays = [
    ['port', [-14, .45, -7], [1, 0, 0]],
    ['starboard', [-6, .45, -7], [-1, 0, 0]],
    ['stern', [-10, .75, -15], [0, 0, 1]],
    ['bow', [-10, 1.1, 1], [0, 0, -1]],
    ['keel', [-10, -3, -7], [0, 1, 0]],
    ['sail front', [-9.6, 3, 0], [0, 0, -1]],
    ['sail back', [-9.6, 3, -14], [0, 0, 1]],
  ];
  for (const [label, origin, direction] of rays) {
    const ray = new Raycaster(new Vector3(...origin), new Vector3(...direction));
    const hit = ray.intersectObject(group, true)[0];
    assert.ok(hit?.face, `missing exterior surface: ${label}`);
    assert.ok(hit.distance > 0 && Number.isFinite(hit.distance), `invalid hit: ${label}`);
    assert.ok(hit.face.normal.dot(ray.ray.direction) < -.1, `inverted or grazing exterior normal: ${label}`);
  }
});
