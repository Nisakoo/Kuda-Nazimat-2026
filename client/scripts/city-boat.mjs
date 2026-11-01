import { BufferGeometry, Float32BufferAttribute, CylinderGeometry, BoxGeometry, Vector3, Quaternion, CatmullRomCurve3, TubeGeometry } from 'three';

/** Moored river boat. The caller applies the usual district transform once.
 * Its water-only hull does not become a land obstacle or move through fitDistrict.
 * Return the exact authored gunwale footprint for geometry/shoreline checks.
 */
export function buildCityBoat(api, x = -10, z = -7) {
  const { mesh, box, bead, cylinder } = api;
  const wood = '#94704c', lightWood = '#ba9766', darkWood = '#654b35';
  const rope = '#bba27b', linen = '#decdaa', teal = '#547e7d', bronze = '#a88754', clay = '#bc855d';
  // z, maximum half-beam, sheer height, keel height; pointed ends and a broad middle.
  const stations = [
    [-3.6, .06, 1.07, .5], [-3.05, .68, .94, -.01], [-2.05, 1.15, .83, -.17],
    [-.85, 1.39, .79, -.2], [.75, 1.4, .8, -.2], [2, 1.17, .89, -.16],
    [3.02, .64, 1.07, .04], [3.65, .05, 1.3, .71],
  ];
  // Convex water footprint includes the rounded gunwale, not the empty rectangle around it.
  // Circumscribed 16-gons conservatively enclose each 7-sided .075 m rail.
  const outline = stations.flatMap(([pz, width]) => [-1, 1].flatMap(side =>
    Array.from({ length: 16 }, (_, i) => [x + side * width + Math.cos(i * Math.PI / 8) * .086, z + pz + Math.sin(i * Math.PI / 8) * .086])));
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  outline.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const chain = points => { const result = []; for (const p of points) { while (result.length > 1 && cross(result.at(-2), result.at(-1), p) <= 0) result.pop(); result.push(p); } return result; };
  const footprint = [...chain(outline).slice(0, -1), ...chain(outline.slice().reverse()).slice(0, -1)];
  // Optional callback for standalone authoring tools. Production relies on impassable water.
  api.polygon?.(footprint);
  function surface(points, color, bothSides = false) {
    const triangles = [];
    for (let i = 1; i < points.length - 1; i++) {
      triangles.push(...points[0], ...points[i], ...points[i + 1]);
      if (bothSides) triangles.push(...points[0], ...points[i + 1], ...points[i]);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(triangles, 3));
    geometry.computeVertexNormals(); mesh(geometry, color, x, 0, z);
  }
  function spar(a, b, radius, color = wood, top = radius) {
    const start = new Vector3(...a), end = new Vector3(...b), direction = end.clone().sub(start);
    const geometry = new CylinderGeometry(top, radius, direction.length(), 7);
    geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()));
    const centre = start.add(end).multiplyScalar(.5);
    mesh(geometry, color, x + centre.x, centre.y, z + centre.z);
  }
  function cord(points, radius = .025, color = rope) {
    const curve = new CatmullRomCurve3(points.map(point => new Vector3(...point)));
    mesh(new TubeGeometry(curve, Math.max(8, points.length * 5), radius, 5, false), color, x, 0, z);
  }
  function shellPoint(station, side, t, inner = false) {
    const [pz, width, sheer, keel] = station;
    const beam = width * (.28 + .72 * t);
    return [side * (inner ? Math.max(.025, beam - .105) : beam), keel + (sheer - keel) * t + (inner ? .045 : 0), pz];
  }
  // Six individually coloured strakes, with caulk seams; inner faces keep the boat visibly open.
  for (const side of [-1, 1]) {
    for (let course = 0; course < 6; course++) {
      const low = course / 6, high = (course + 1) / 6;
      for (let i = 0; i < stations.length - 1; i++) {
        const a = stations[i], b = stations[i + 1];
        surface([shellPoint(a, side, low), shellPoint(b, side, low), shellPoint(b, side, high), shellPoint(a, side, high)], course === 4 ? teal : ['#94704c', '#aa8053', '#9d764f'][course % 3], true);
        surface([shellPoint(a, side, low, true), shellPoint(b, side, low, true), shellPoint(b, side, high, true), shellPoint(a, side, high, true)], course % 2 ? lightWood : '#ac895c', true);
        if (course > 0) spar(shellPoint(a, side, low), shellPoint(b, side, low), .013, darkWood);
      }
    }
    for (let i = 0; i < stations.length - 1; i++) {
      const a = shellPoint(stations[i], side, 1), b = shellPoint(stations[i + 1], side, 1);
      spar(a, b, .075, darkWood);
      spar([a[0], a[1] + .03, a[2]], [b[0], b[1] + .03, b[2]], .032, lightWood);
    }
  }
  // Keel closure and raised end stems, rather than the old solid rectangular block.
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i], b = stations[i + 1];
    surface([shellPoint(a, -1, 0), shellPoint(a, 1, 0), shellPoint(b, 1, 0), shellPoint(b, -1, 0)], darkWood, true);
  }
  for (const end of [stations[0], stations.at(-1)]) spar([0, end[3], end[0]], [0, end[2] + .09, end[0]], .08, darkWood);
  // Long floorboards, cross frames and fastening heads make the interior readable from the quay.
  for (let i = 0; i < 7; i++) {
    const px = (i - 3) * .24, length = 4.8 - Math.abs(i - 3) * .18;
    box(i % 2 ? '#b28b59' : lightWood, x + px, .18, z, .22, .1, length);
  }
  for (let i = 1; i < stations.length - 1; i++) {
    const station = stations[i], left = shellPoint(station, -1, .92, true), right = shellPoint(station, 1, .92, true);
    const lowLeft = shellPoint(station, -1, .24, true), lowRight = shellPoint(station, 1, .24, true);
    spar(left, lowLeft, .055, '#765439'); spar(lowLeft, lowRight, .055, '#765439'); spar(lowRight, right, .055, '#765439');
    for (const side of [-1, 1]) {
      const p = shellPoint(station, side, .88);
      bead(bronze, x + p[0], p[1], z + p[2], .045, .045, .045);
    }
  }
  for (const [pz, width] of [[-1.8, 1.88], [.65, 2.36], [2.15, 1.82]]) {
    box(wood, x, .58, z + pz, width, .15, .4);
    box(lightWood, x, .66, z + pz, width - .07, .025, .32);
    for (const side of [-1, 1]) box(darkWood, x + side * (width / 2 - .18), .39, z + pz, .12, .3, .24);
  }
  // Two stowed oars stay inside the hull; the boardwalk and water beside it remain unobstructed.
  for (const side of [-1, 1]) {
    const px = side * .73;
    spar([px, .72, -2.15], [px - side * .12, .72, 1.75], .035, lightWood);
    const paddle = new BoxGeometry(.25, .06, .68); paddle.rotateY(side * -.08);
    mesh(paddle, '#ab8153', x + px, .72, z - 2.25);
    spar([px - side * .12, .72, 1.65], [px - side * .12, .72, 1.95], .055, darkWood);
    // Rope loops secure the oars against the thwarts.
    cord([[px - .12, .7, .65], [px, .82, .65], [px + .12, .7, .65]], .02);
  }
  // Mast step, rigging and a lightly billowing square linen sail with stitched panels.
  box(darkWood, x, .35, z -.55, .5, .3, .48);
  spar([0, .25, -.55], [0, 5.15, -.55], .095, wood, .055);
  spar([-1.5, 4.5, -.55], [1.5, 4.5, -.55], .06, darkWood);
  const sailPoint = (u, v) => [(u - .5) * 2.68, 4.4 - v * 2.45, -.54 + Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * .32];
  for (let row = 0; row < 5; row++) for (let col = 0; col < 4; col++) {
    const u = col / 4, v = row / 5;
    surface([sailPoint(u, v), sailPoint(u + .25, v), sailPoint(u + .25, v + .2), sailPoint(u, v + .2)], (row + col) % 3 ? linen : '#cdbd9c', true);
  }
  for (let i = 0; i <= 4; i++) cord(Array.from({ length: 6 }, (_, j) => sailPoint(i / 4, j / 5)), .012, '#ac9976');
  for (let i = 0; i <= 5; i++) cord(Array.from({ length: 5 }, (_, j) => sailPoint(j / 4, i / 5)), .012, '#ad9a78');
  // Small contrasting repair patch and sail ties; all remain above body collision height.
  surface([sailPoint(.15, .58), sailPoint(.33, .58), sailPoint(.33, .78), sailPoint(.15, .78)].map(([px, py, pz]) => [px, py, pz + .025]), '#baaa88', true);
  for (const side of [-1, 1]) {
    cord([[side * 1.34, 1.95, -.54], [side * 1.2, 1.35, .2], [side * 1.15, .82, .75]], .026);
    cord([[0, 4.8, -.55], [side * .45, 2.3, 1.2], [side * .65, .95, 2.55]], .02);
  }
  cord([[0, 5.1, -.55], [0, 2.6, -1.9], [0, 1.05, -3.1]], .025);
  for (let i = 0; i < 5; i++) cord([[-1.3 + i * .65, 4.45, -.61], [-1.3 + i * .65, 4.57, -.55], [-1.3 + i * .65, 4.45, -.48]], .02);
  // Compact cargo at the stern leaves the middle of the boat open.
  box('#8d6846', x + .26, .43, z - 2.57, .76, .48, .72);
  for (const px of [-.04, .56]) box('#c3a371', x + px, .69, z - 2.57, .07, .035, .75);
  for (let row = 0; row < 3; row++) box(darkWood, x + .26, .26 + row * .16, z - 2.94, .76, .025, .02);
  cylinder(clay, x -.4, .4, z - 2.55, .18, .46, .13);
  cylinder(clay, x -.4, .69, z - 2.55, .09, .16, .11);
  cylinder('#775c41', x -.4, .78, z - 2.55, .1, .025);
  for (let ring = 0; ring < 3; ring++) {
    const radius = .16 + ring * .06;
    cord(Array.from({ length: 13 }, (_, i) => [.35 + Math.sin(i * Math.PI / 6) * radius, .3 + ring * .025, 1.48 + Math.cos(i * Math.PI / 6) * radius]), .025);
  }
  // Small bow cleat and a short tied painter, contained within the water-side hull.
  box(darkWood, x, 1.03, z + 2.75, .48, .08, .12);
  for (const px of [-.15, .15]) cylinder(darkWood, x + px, .95, z + 2.75, .045, .18);
  cord([[-.18, 1.08, 2.75], [.16, 1.1, 2.75], [.3, .98, 2.42], [.05, .93, 2.3]], .025);
  return footprint;
}
